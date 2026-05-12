/**
 * E2E integration tests for the poll cycle (pollOnce) with a mock GHE client.
 *
 * These tests exercise the full poll state machine: seeding, new comment
 * detection, merged/closed cleanup, review-request dedup, cooldown
 * suppression, mention detection, and state persistence.
 *
 * No real network calls, no real credentials — the GHE client is a mock
 * that returns controlled responses.
 *
 * HC-GHENT-POLL-COVERAGE: full poll cycle uses paginateSearch
 * HC-GHENT-COMMENT-WINDOW: new PR comments filtered by created_at
 * HC-GHENT-STATE-RESILIENCE: state survives across poll cycles
 * HC-GHENT-RATE-HEADROOM: active PR count is reported correctly
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let TEST_DIR: string;

// Mock notify to capture toast calls — use vi.hoisted for mock factory refs
const { mockNotify, mockConfig } = vi.hoisted(() => ({
  mockNotify: vi.fn(),
  mockConfig: {
    dataDir: '',
    pollIntervalSec: 60,
    notifCooldownSec: 0, // no cooldown for most tests
    notifFlags: {} as Record<string, boolean>,
    toastTitleTemplate: '{commenter} {action}',
    toastBodyTemplate: '{repo}#{num}: {prTitle}\n{body}',
    accounts: [] as unknown[],
    mode: 'poll',
    configured: false,
  },
}));

vi.mock('../../src/notifier.js', () => ({
  notify: mockNotify,
}));
vi.mock('../../src/logger.js', () => ({
  logEvent: vi.fn(),
  patchConsole: vi.fn(),
  LOG_FILE: '/tmp/test.jsonl',
  TASK_LOG: '/tmp/test-task.log',
}));

vi.mock('../../src/config.js', () => ({
  config: mockConfig,
  DEFAULT_NOTIF_FLAGS: {
    onComment: true, onReviewComment: true, onApproved: true,
    onChangesRequested: true, onReviewCommented: true, onMerged: true,
    onClosed: false, onReviewRequested: true, onMention: true,
  },
}));

import { pollOnce, loadState, minSafeIntervalSec, kindAction, renderTemplate, emit, _lastNotifAt } from '../../src/poller.js';
import type { PollerState } from '../../src/poller.js';
import type { GheClient } from '../../src/ghe-client.js';
import type { AccountConfig } from '../../src/config.js';

const TEST_ACCOUNT: AccountConfig = {
  id: 'github.com',
  label: 'GitHub',
  username: 'myuser',
  apiBase: 'https://api.github.com',
  token: '',
  enabled: true,
};

function freshState(): PollerState {
  return { prs: {}, reviewRequestedKeys: {}, mentionsSince: null, seeded: false, lastPollTime: null };
}

function seededState(): PollerState {
  return { prs: {}, reviewRequestedKeys: {}, mentionsSince: null, seeded: true, lastPollTime: '2024-06-01T00:00:00Z' };
}

/** Build a mock GHE client with configurable responses */
function mockClient(overrides: {
  searchResults?: unknown[];
  mentionResults?: unknown[];
  reviewRequestedResults?: unknown[];
  prComments?: Record<string, unknown[]>;
  prReviewComments?: Record<string, unknown[]>;
  prReviews?: Record<string, unknown[]>;
  prDetails?: Record<string, unknown>;
} = {}): GheClient {
  const {
    searchResults = [],
    mentionResults = [],
    reviewRequestedResults = [],
    prComments = {},
    prReviewComments = {},
    prReviews = {},
    prDetails = {},
  } = overrides;

  return {
    get: vi.fn(async (path: string) => {
      // /repos/{owner}/{repo}/pulls/{num} — for merged/closed detection
      const match = path.match(/\/repos\/(.+)\/pulls\/(\d+)$/);
      if (match) {
        const key = `${match[1]}#${match[2]}`;
        if (prDetails[key]) return prDetails[key];
      }
      throw new Error(`Unexpected GET: ${path}`);
    }),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    paginate: vi.fn(async (path: string) => {
      // /repos/{o}/{r}/issues/{n}/comments
      const issueMatch = path.match(/\/repos\/(.+)\/issues\/(\d+)\/comments/);
      if (issueMatch) {
        const key = `${issueMatch[1]}#${issueMatch[2]}`;
        return prComments[key] ?? [];
      }
      // /repos/{o}/{r}/pulls/{n}/comments
      const pullMatch = path.match(/\/repos\/(.+)\/pulls\/(\d+)\/comments/);
      if (pullMatch) {
        const key = `${pullMatch[1]}#${pullMatch[2]}`;
        return prReviewComments[key] ?? [];
      }
      // /repos/{o}/{r}/pulls/{n}/reviews
      const reviewMatch = path.match(/\/repos\/(.+)\/pulls\/(\d+)\/reviews/);
      if (reviewMatch) {
        const key = `${reviewMatch[1]}#${reviewMatch[2]}`;
        return prReviews[key] ?? [];
      }
      return [];
    }),
    // Note: paths contain URL-encoded query strings (e.g. mentions%3A not mentions:)
    paginateSearch: vi.fn(async (path: string) => {
      const decoded = decodeURIComponent(path);
      if (decoded.includes('review-requested:')) return reviewRequestedResults;
      if (decoded.includes('mentions:')) return mentionResults;
      return searchResults; // author search
    }),
  };
}

function searchItem(repo: string, num: number, opts?: { updated_at?: string }) {
  return {
    number: num,
    title: `PR #${num}`,
    repository_url: `https://api.github.com/repos/${repo}`,
    html_url: `https://github.com/${repo}/pull/${num}`,
    user: { login: 'myuser' },
    pull_request: {},
    updated_at: opts?.updated_at ?? '2024-06-01T12:00:00Z',
  };
}

function comment(id: number, login: string, body: string, opts?: { created_at?: string }) {
  return {
    id,
    user: { login },
    body,
    html_url: `https://github.com/org/repo/pull/1#comment-${id}`,
    created_at: opts?.created_at ?? '2024-06-01T12:00:00Z',
  };
}

function review(id: number, login: string, state: string, body: string | null, opts?: { submitted_at?: string }) {
  return {
    id,
    user: { login },
    state,
    body,
    html_url: `https://github.com/org/repo/pull/1#review-${id}`,
    submitted_at: opts?.submitted_at ?? '2024-06-01T12:00:00Z',
  };
}

beforeEach(() => {
  TEST_DIR = join(tmpdir(), `ghent-e2e-poller-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(TEST_DIR, { recursive: true });
  mockConfig.dataDir = TEST_DIR;
  mockConfig.notifCooldownSec = 0;
  mockConfig.notifFlags = {};
  mockNotify.mockReset();
  _lastNotifAt.clear();
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

// ── Seeding ──────────────────────────────────────────────────────────────

describe('seeding (first poll)', () => {
  it('discovers PRs without firing any toasts', async () => {
    const client = mockClient({
      searchResults: [searchItem('org/repo', 1), searchItem('org/repo', 2)],
      prComments: {
        'org/repo#1': [comment(10, 'reviewer', 'Looks good')],
        'org/repo#2': [comment(20, 'boss', 'Please fix')],
      },
    });
    const state = freshState();

    await pollOnce(TEST_ACCOUNT, client, state);

    expect(mockNotify).not.toHaveBeenCalled();
    expect(state.seeded).toBe(true);
    expect(state.prs['org/repo#1']).toBeDefined();
    expect(state.prs['org/repo#2']).toBeDefined();
    expect(state.prs['org/repo#1'].lastCommentId).toBe(10);
    expect(state.prs['org/repo#2'].lastCommentId).toBe(20);
  });

  it('records lastPollTime after seeding', async () => {
    const client = mockClient({ searchResults: [] });
    const state = freshState();

    await pollOnce(TEST_ACCOUNT, client, state);

    expect(state.lastPollTime).toBeDefined();
    expect(new Date(state.lastPollTime!).getTime()).toBeGreaterThan(0);
  });
});

// ── New comments on existing PRs ─────────────────────────────────────────

describe('new comment detection (post-seeding)', () => {
  it('fires toast for new comments from others', async () => {
    const state = seededState();
    state.prs['org/repo#1'] = { lastCommentId: 5, lastReviewId: 0, lastReviewCommentId: 0, updatedAt: '2024-06-01T00:00:00Z' };

    const client = mockClient({
      searchResults: [searchItem('org/repo', 1, { updated_at: '2024-06-01T13:00:00Z' })],
      prComments: {
        'org/repo#1': [
          comment(5, 'old', 'old comment'), // already seen
          comment(6, 'reviewer', 'New feedback', { created_at: '2024-06-01T12:00:00Z' }),
        ],
      },
    });

    await pollOnce(TEST_ACCOUNT, client, state);

    expect(mockNotify).toHaveBeenCalledOnce();
    expect(mockNotify.mock.calls[0][0].title).toContain('reviewer');
    expect(state.prs['org/repo#1'].lastCommentId).toBe(6);
  });

  it('skips self-comments', async () => {
    const state = seededState();
    state.prs['org/repo#1'] = { lastCommentId: 5, lastReviewId: 0, lastReviewCommentId: 0, updatedAt: '2024-06-01T00:00:00Z' };

    const client = mockClient({
      searchResults: [searchItem('org/repo', 1, { updated_at: '2024-06-01T13:00:00Z' })],
      prComments: {
        'org/repo#1': [comment(6, 'myuser', 'My own reply')],
      },
    });

    await pollOnce(TEST_ACCOUNT, client, state);

    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('skips unchanged PRs (same updated_at)', async () => {
    const state = seededState();
    state.prs['org/repo#1'] = { lastCommentId: 5, lastReviewId: 0, lastReviewCommentId: 0, updatedAt: '2024-06-01T12:00:00Z' };

    const client = mockClient({
      searchResults: [searchItem('org/repo', 1, { updated_at: '2024-06-01T12:00:00Z' })], // unchanged
      prComments: {
        'org/repo#1': [comment(99, 'sneaky', 'Should not be fetched')],
      },
    });

    await pollOnce(TEST_ACCOUNT, client, state);

    expect(mockNotify).not.toHaveBeenCalled();
    // paginate should not have been called — PR was skipped
    expect(client.paginate).not.toHaveBeenCalled();
  });
});

// ── Comment window filtering (HC-GHENT-COMMENT-WINDOW) ───────────────────

describe('comment window filtering (HC-GHENT-COMMENT-WINDOW)', () => {
  it('skips stale comments on newly-detected PRs', async () => {
    const state = seededState();
    state.lastPollTime = '2024-06-01T10:00:00Z';
    // PR #5 is new — not in state yet

    const client = mockClient({
      searchResults: [searchItem('org/repo', 5, { updated_at: '2024-06-01T12:00:00Z' })],
      prComments: {
        'org/repo#5': [
          comment(100, 'reviewer', 'Old comment from yesterday', { created_at: '2024-05-31T09:00:00Z' }), // before lastPollTime
          comment(101, 'reviewer', 'New comment after poll', { created_at: '2024-06-01T11:00:00Z' }),     // after lastPollTime
        ],
      },
    });

    await pollOnce(TEST_ACCOUNT, client, state);

    // Only the new comment should fire — stale one filtered by created_at guard
    expect(mockNotify).toHaveBeenCalledOnce();
    expect(mockNotify.mock.calls[0][0].message).toContain('New comment after poll');
  });
});

// ── Review detection ─────────────────────────────────────────────────────

describe('review detection', () => {
  it('fires toast for APPROVED review', async () => {
    const state = seededState();
    state.prs['org/repo#1'] = { lastCommentId: 0, lastReviewId: 0, lastReviewCommentId: 0, updatedAt: '2024-06-01T00:00:00Z' };

    const client = mockClient({
      searchResults: [searchItem('org/repo', 1, { updated_at: '2024-06-01T13:00:00Z' })],
      prReviews: {
        'org/repo#1': [review(10, 'boss', 'APPROVED', 'Ship it!')],
      },
    });

    await pollOnce(TEST_ACCOUNT, client, state);

    expect(mockNotify).toHaveBeenCalledOnce();
    expect(mockNotify.mock.calls[0][0].title).toContain('approved');
    expect(state.prs['org/repo#1'].lastReviewId).toBe(10);
  });

  it('fires toast for CHANGES_REQUESTED', async () => {
    const state = seededState();
    state.prs['org/repo#1'] = { lastCommentId: 0, lastReviewId: 0, lastReviewCommentId: 0, updatedAt: '2024-06-01T00:00:00Z' };

    const client = mockClient({
      searchResults: [searchItem('org/repo', 1, { updated_at: '2024-06-01T13:00:00Z' })],
      prReviews: {
        'org/repo#1': [review(11, 'boss', 'CHANGES_REQUESTED', 'Fix the tests')],
      },
    });

    await pollOnce(TEST_ACCOUNT, client, state);

    expect(mockNotify).toHaveBeenCalledOnce();
    expect(mockNotify.mock.calls[0][0].title).toContain('requested changes');
  });

  it('skips COMMENTED review with no body', async () => {
    const state = seededState();
    state.prs['org/repo#1'] = { lastCommentId: 0, lastReviewId: 0, lastReviewCommentId: 0, updatedAt: '2024-06-01T00:00:00Z' };

    const client = mockClient({
      searchResults: [searchItem('org/repo', 1, { updated_at: '2024-06-01T13:00:00Z' })],
      prReviews: {
        'org/repo#1': [review(12, 'bot', 'COMMENTED', null)],
      },
    });

    await pollOnce(TEST_ACCOUNT, client, state);

    expect(mockNotify).not.toHaveBeenCalled();
  });
});

// ── Merged/closed detection ──────────────────────────────────────────────

describe('merged/closed detection', () => {
  it('fires toast and removes state when PR is merged', async () => {
    const state = seededState();
    state.prs['org/repo#1'] = { lastCommentId: 5, lastReviewId: 0, lastReviewCommentId: 0 };

    const client = mockClient({
      searchResults: [], // PR #1 no longer open
      prDetails: {
        'org/repo#1': { merged: true, state: 'closed', title: 'My PR', html_url: 'https://github.com/org/repo/pull/1', user: { login: 'merger' } },
      },
    });

    await pollOnce(TEST_ACCOUNT, client, state);

    expect(mockNotify).toHaveBeenCalledOnce();
    expect(mockNotify.mock.calls[0][0].title).toContain('merged');
    expect(state.prs['org/repo#1']).toBeUndefined(); // cleaned up
  });

  it('does not fire for closed when onClosed is false (default)', async () => {
    const state = seededState();
    state.prs['org/repo#1'] = { lastCommentId: 5, lastReviewId: 0, lastReviewCommentId: 0 };

    const client = mockClient({
      searchResults: [],
      prDetails: {
        'org/repo#1': { merged: false, state: 'closed', title: 'Closed PR', html_url: 'u', user: { login: 'closer' } },
      },
    });

    await pollOnce(TEST_ACCOUNT, client, state);

    // onClosed is false by default — no toast
    expect(mockNotify).not.toHaveBeenCalled();
    // But state should still be cleaned up
    expect(state.prs['org/repo#1']).toBeUndefined();
  });

  it('fires for closed when onClosed is true', async () => {
    mockConfig.notifFlags = { onClosed: true };
    const state = seededState();
    state.prs['org/repo#1'] = { lastCommentId: 5, lastReviewId: 0, lastReviewCommentId: 0 };

    const client = mockClient({
      searchResults: [],
      prDetails: {
        'org/repo#1': { merged: false, state: 'closed', title: 'Closed PR', html_url: 'u', user: { login: 'closer' } },
      },
    });

    await pollOnce(TEST_ACCOUNT, client, state);

    expect(mockNotify).toHaveBeenCalledOnce();
    expect(mockNotify.mock.calls[0][0].title).toContain('closed');
  });
});

// ── @mention detection ───────────────────────────────────────────────────

describe('@mention detection', () => {
  it('fires toast for @mention on someone else\'s PR', async () => {
    const state = seededState();

    const client = mockClient({
      searchResults: [],
      mentionResults: [{
        number: 99,
        title: 'Other PR',
        repository_url: 'https://api.github.com/repos/other/repo',
        html_url: 'https://github.com/other/repo/pull/99',
        user: { login: 'other-author' },
        pull_request: {},
        updated_at: '2024-06-01T12:00:00Z',
      }],
    });

    await pollOnce(TEST_ACCOUNT, client, state);

    expect(mockNotify).toHaveBeenCalledOnce();
    expect(mockNotify.mock.calls[0][0].title).toContain('@mentioned');
  });

  it('skips mentions on own PRs (already tracked)', async () => {
    const state = seededState();
    state.prs['org/repo#1'] = { lastCommentId: 0, lastReviewId: 0, lastReviewCommentId: 0 };

    const client = mockClient({
      searchResults: [searchItem('org/repo', 1)],
      mentionResults: [{
        number: 1,
        title: 'My PR',
        repository_url: 'https://api.github.com/repos/org/repo',
        html_url: 'u',
        user: { login: 'myuser' },
        pull_request: {},
        updated_at: '2024-06-01T12:00:00Z',
      }],
    });

    await pollOnce(TEST_ACCOUNT, client, state);

    // Only the mention should be skipped (it's my own PR)
    expect(mockNotify).not.toHaveBeenCalled();
  });
});

// ── Review-requested detection + dedup ───────────────────────────────────

describe('review-requested detection', () => {
  it('fires toast for new review request', async () => {
    const state = seededState();

    const client = mockClient({
      searchResults: [],
      reviewRequestedResults: [{
        number: 50,
        title: 'Please review',
        repository_url: 'https://api.github.com/repos/other/repo',
        html_url: 'https://github.com/other/repo/pull/50',
        user: { login: 'requester' },
        pull_request: {},
        updated_at: '2024-06-01T12:00:00Z',
      }],
    });

    await pollOnce(TEST_ACCOUNT, client, state);

    expect(mockNotify).toHaveBeenCalledOnce();
    expect(mockNotify.mock.calls[0][0].title).toContain('requested your review');
    expect(state.reviewRequestedKeys['other/repo#50']).toBe(true);
  });

  it('does not re-fire for already-notified review request', async () => {
    const state = seededState();
    state.reviewRequestedKeys['other/repo#50'] = true;

    const client = mockClient({
      searchResults: [],
      reviewRequestedResults: [{
        number: 50,
        title: 'Please review',
        repository_url: 'https://api.github.com/repos/other/repo',
        html_url: 'u',
        user: { login: 'requester' },
        pull_request: {},
        updated_at: '2024-06-01T12:00:00Z',
      }],
    });

    await pollOnce(TEST_ACCOUNT, client, state);

    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('prunes resolved review requests', async () => {
    const state = seededState();
    state.reviewRequestedKeys['old/repo#10'] = true;
    state.reviewRequestedKeys['other/repo#50'] = true;

    const client = mockClient({
      searchResults: [],
      reviewRequestedResults: [{
        number: 50,
        title: 'Still pending',
        repository_url: 'https://api.github.com/repos/other/repo',
        html_url: 'u',
        user: { login: 'requester' },
        pull_request: {},
        updated_at: '2024-06-01T12:00:00Z',
      }],
    });

    await pollOnce(TEST_ACCOUNT, client, state);

    // old/repo#10 should be pruned (not in current results)
    expect(state.reviewRequestedKeys['old/repo#10']).toBeUndefined();
    // other/repo#50 should remain
    expect(state.reviewRequestedKeys['other/repo#50']).toBe(true);
  });
});

// ── Cooldown suppression ─────────────────────────────────────────────────

describe('cooldown suppression', () => {
  it('suppresses rapid notifications for the same PR', async () => {
    mockConfig.notifCooldownSec = 300; // 5 minute cooldown
    const state = seededState();
    state.prs['org/repo#1'] = { lastCommentId: 5, lastReviewId: 0, lastReviewCommentId: 0, updatedAt: '2024-06-01T00:00:00Z' };

    const client = mockClient({
      searchResults: [searchItem('org/repo', 1, { updated_at: '2024-06-01T13:00:00Z' })],
      prComments: {
        'org/repo#1': [
          comment(6, 'user1', 'Comment 1'),
          comment(7, 'user2', 'Comment 2'),
        ],
      },
    });

    await pollOnce(TEST_ACCOUNT, client, state);

    // First toast fires, second is suppressed by cooldown
    expect(mockNotify).toHaveBeenCalledOnce();
  });
});

// ── State persistence ────────────────────────────────────────────────────

describe('state persistence', () => {
  it('saves state to disk after poll', async () => {
    const client = mockClient({
      searchResults: [searchItem('org/repo', 1)],
    });
    const state = freshState();

    await pollOnce(TEST_ACCOUNT, client, state);

    const stateFile = join(TEST_DIR, 'poller-state-github.com.json');
    expect(existsSync(stateFile)).toBe(true);
    const saved = JSON.parse(readFileSync(stateFile, 'utf8'));
    expect(saved.seeded).toBe(true);
    expect(saved.prs['org/repo#1']).toBeDefined();
  });

  it('state survives across multiple poll cycles', async () => {
    const state = freshState();

    // Poll 1: seed
    const client1 = mockClient({
      searchResults: [searchItem('org/repo', 1)],
      prComments: { 'org/repo#1': [comment(10, 'reviewer', 'hello')] },
    });
    await pollOnce(TEST_ACCOUNT, client1, state);
    expect(state.seeded).toBe(true);
    expect(mockNotify).not.toHaveBeenCalled(); // seeding

    // Poll 2: new comment
    const client2 = mockClient({
      searchResults: [searchItem('org/repo', 1, { updated_at: '2024-06-02T00:00:00Z' })],
      prComments: { 'org/repo#1': [comment(10, 'reviewer', 'hello'), comment(11, 'reviewer', 'follow-up')] },
    });
    await pollOnce(TEST_ACCOUNT, client2, state);
    expect(mockNotify).toHaveBeenCalledOnce();
    expect(state.prs['org/repo#1'].lastCommentId).toBe(11);

    // Poll 3: no change
    const client3 = mockClient({
      searchResults: [searchItem('org/repo', 1, { updated_at: '2024-06-02T00:00:00Z' })],
    });
    await pollOnce(TEST_ACCOUNT, client3, state);
    // No new toasts — updated_at unchanged
    expect(mockNotify).toHaveBeenCalledOnce(); // still just the one from poll 2
  });
});

// ── Active PR count (HC-GHENT-RATE-HEADROOM) ─────────────────────────────

describe('active PR count reporting (HC-GHENT-RATE-HEADROOM)', () => {
  it('reports active PRs correctly', async () => {
    const state = seededState();
    state.prs['org/repo#1'] = { lastCommentId: 0, lastReviewId: 0, lastReviewCommentId: 0, updatedAt: '2024-06-01T00:00:00Z' };

    const client = mockClient({
      searchResults: [
        searchItem('org/repo', 1, { updated_at: '2024-06-02T00:00:00Z' }), // changed
        searchItem('org/repo', 2, { updated_at: '2024-06-02T00:00:00Z' }), // new
      ],
    });

    const result = await pollOnce(TEST_ACCOUNT, client, state);

    // Both PRs are active (one changed, one new)
    expect(result.activePrs).toBe(2);
  });

  it('reports 0 active PRs when all unchanged', async () => {
    const state = seededState();
    state.prs['org/repo#1'] = { lastCommentId: 0, lastReviewId: 0, lastReviewCommentId: 0, updatedAt: '2024-06-01T12:00:00Z' };

    const client = mockClient({
      searchResults: [searchItem('org/repo', 1, { updated_at: '2024-06-01T12:00:00Z' })],
    });

    const result = await pollOnce(TEST_ACCOUNT, client, state);

    expect(result.activePrs).toBe(0);
  });
});

// ── Pure function tests ──────────────────────────────────────────────────

describe('minSafeIntervalSec', () => {
  it('returns 30s floor for few PRs', () => {
    expect(minSafeIntervalSec(0)).toBe(30);
    expect(minSafeIntervalSec(5)).toBe(30);
    expect(minSafeIntervalSec(9)).toBe(30);
  });

  it('raises floor proportionally for many PRs', () => {
    expect(minSafeIntervalSec(100)).toBe(273);
    expect(minSafeIntervalSec(50)).toBeGreaterThan(30);
    expect(minSafeIntervalSec(200)).toBeGreaterThan(minSafeIntervalSec(100));
  });
});

describe('kindAction', () => {
  it('returns human-readable action for each kind', () => {
    expect(kindAction('approved')).toContain('approved');
    expect(kindAction('changes_requested')).toContain('requested changes');
    expect(kindAction('review_commented')).toContain('reviewed');
    expect(kindAction('merged')).toContain('merged');
    expect(kindAction('closed')).toContain('closed');
    expect(kindAction('review_requested')).toContain('requested your review');
    expect(kindAction('mention')).toContain('@mentioned');
    expect(kindAction('issue_comment')).toContain('commented');
    expect(kindAction('review_comment')).toContain('inline comment');
  });
});

describe('renderTemplate', () => {
  it('replaces placeholders', () => {
    expect(renderTemplate('{commenter} {action}', { commenter: 'alice', action: 'approved' }))
      .toBe('alice approved');
  });

  it('removes unknown placeholders', () => {
    expect(renderTemplate('{foo} bar', {})).toBe(' bar');
  });

  it('handles empty template', () => {
    expect(renderTemplate('', { x: 'y' })).toBe('');
  });

  it('handles all standard vars', () => {
    const result = renderTemplate('{repo}#{num}: {prTitle}', {
      repo: 'org/repo', num: '42', prTitle: 'Fix bug',
    });
    expect(result).toBe('org/repo#42: Fix bug');
  });
});

describe('emit (flag suppression)', () => {
  it('suppresses notification when flag is false', () => {
    emit({ onComment: false }, {
      kind: 'issue_comment', repo: 'o/r', num: 1, prTitle: 'T',
      commenter: 'x', body: 'hi', url: 'u', reason: 'my-pr',
    });
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('fires notification when flag is true', () => {
    emit({ onApproved: true }, {
      kind: 'approved', repo: 'o/r', num: 1, prTitle: 'T',
      commenter: 'boss', body: 'LGTM', url: 'u', reason: 'my-pr',
    });
    expect(mockNotify).toHaveBeenCalledOnce();
  });
});
