/**
 * Tests for classify() and related pure functions in src/server.ts
 *
 * HC-SAFE-SIDE-EFFECTS: webhook signature verification
 * HC-ERRORS-SURFACED: bad payloads handled gracefully
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock heavy side-effect modules before importing server
vi.mock('../../src/logger.js', () => ({
  logEvent: vi.fn(),
  patchConsole: vi.fn(),
  LOG_FILE: '/tmp/test-events.jsonl',
  TASK_LOG: '/tmp/test-task.log',
}));
vi.mock('../../src/notifier.js', () => ({
  notify: vi.fn(),
}));
vi.mock('../../src/poller.js', () => ({
  startPolling: vi.fn(),
  stopPolling: vi.fn(),
  getPollerStatus: vi.fn(() => ({ running: false, lastPoll: null, prCount: 0, effectiveIntervalSec: 60 })),
}));
vi.mock('../../src/ui.js', () => ({
  UI_HTML: '<html>test</html>',
}));

// Mock config to avoid reading real config file
vi.mock('../../src/config.js', () => ({
  config: {
    accounts: [],
    mode: 'poll',
    pollIntervalSec: 60,
    notifCooldownSec: 180,
    notifFlags: {},
    toastTitleTemplate: '{commenter} {action}',
    toastBodyTemplate: '{repo}#{num}: {prTitle}',
    port: 9420,
    webhookSecret: 'test-secret',
    dataDir: '/tmp/ghent-test',
    snoreToastPath: null,
    configured: false,
  },
  reloadConfig: vi.fn(),
  appDataDir: vi.fn(() => '/tmp/ghent-test'),
  DEFAULT_NOTIF_FLAGS: {
    onComment: true, onReviewComment: true, onApproved: true,
    onChangesRequested: true, onReviewCommented: true, onMerged: true,
    onClosed: false, onReviewRequested: true, onMention: true,
  },
}));

import { classify, verifySignature, parseGhAuthStatus, hostToApiBase } from '../../src/server.js';
import crypto from 'node:crypto';

describe('classify()', () => {
  it('classifies issue_comment on own PR', () => {
    const result = classify('issue_comment', {
      action: 'created',
      issue: {
        number: 42,
        title: 'Fix the thing',
        user: { login: 'me' },
        html_url: 'https://github.com/org/repo/pull/42',
        pull_request: {},
        repository_url: 'https://api.github.com/repos/org/repo',
      },
      comment: {
        id: 1,
        user: { login: 'reviewer' },
        body: 'Looks good!',
        html_url: 'https://github.com/org/repo/pull/42#comment-1',
      },
    }, 'me');

    expect(result).not.toBeNull();
    expect(result!.kind).toBe('issue_comment');
    expect(result!.reason).toBe('my-pr');
    expect(result!.commenter).toBe('reviewer');
    expect(result!.prNumber).toBe(42);
    expect(result!.repo).toBe('org/repo');
  });

  it('classifies review submission', () => {
    const result = classify('pull_request_review', {
      action: 'submitted',
      pull_request: {
        number: 10,
        title: 'Add feature',
        user: { login: 'me' },
        html_url: 'https://github.com/org/repo/pull/10',
        repository_url: 'https://api.github.com/repos/org/repo',
      },
      review: {
        id: 5,
        user: { login: 'boss' },
        body: 'LGTM',
        state: 'APPROVED',
        html_url: 'https://github.com/org/repo/pull/10#review-5',
      },
    }, 'me');

    expect(result).not.toBeNull();
    expect(result!.kind).toBe('review');
    expect(result!.reason).toBe('my-pr');
  });

  it('classifies inline review comment', () => {
    const result = classify('pull_request_review_comment', {
      action: 'created',
      pull_request: {
        number: 7,
        title: 'Refactor',
        user: { login: 'me' },
        html_url: 'https://github.com/org/repo/pull/7',
        repository_url: 'https://api.github.com/repos/org/repo',
      },
      comment: {
        id: 3,
        user: { login: 'critic' },
        body: 'This could be simpler',
        html_url: 'https://github.com/org/repo/pull/7#discussion-3',
      },
    }, 'me');

    expect(result).not.toBeNull();
    expect(result!.kind).toBe('review_comment');
  });

  it('skips comments from self', () => {
    const result = classify('issue_comment', {
      action: 'created',
      issue: {
        number: 1,
        title: 'T',
        user: { login: 'me' },
        html_url: 'u',
        pull_request: {},
        repository_url: 'https://api.github.com/repos/o/r',
      },
      comment: {
        id: 1,
        user: { login: 'me' },
        body: 'my own comment',
        html_url: 'u',
      },
    }, 'me');
    expect(result).toBeNull();
  });

  it('skips comments on PRs I did not author and am not mentioned in', () => {
    const result = classify('issue_comment', {
      action: 'created',
      issue: {
        number: 1,
        title: 'T',
        user: { login: 'someone-else' },
        html_url: 'u',
        pull_request: {},
        repository_url: 'https://api.github.com/repos/o/r',
      },
      comment: {
        id: 1,
        user: { login: 'third-party' },
        body: 'not about me',
        html_url: 'u',
      },
    }, 'me');
    expect(result).toBeNull();
  });

  it('detects @mention on someone else\'s PR', () => {
    const result = classify('issue_comment', {
      action: 'created',
      issue: {
        number: 99,
        title: 'Other PR',
        user: { login: 'author' },
        html_url: 'u',
        pull_request: {},
        repository_url: 'https://api.github.com/repos/o/r',
      },
      comment: {
        id: 1,
        user: { login: 'commenter' },
        body: 'Hey @me please take a look',
        html_url: 'u',
      },
    }, 'me');

    expect(result).not.toBeNull();
    expect(result!.reason).toBe('mention');
  });

  it('detects mention+own-pr combined reason', () => {
    const result = classify('issue_comment', {
      action: 'created',
      issue: {
        number: 99,
        title: 'My PR',
        user: { login: 'me' },
        html_url: 'u',
        pull_request: {},
        repository_url: 'https://api.github.com/repos/o/r',
      },
      comment: {
        id: 1,
        user: { login: 'bob' },
        body: 'Hey @me fixing this now',
        html_url: 'u',
      },
    }, 'me');

    expect(result).not.toBeNull();
    expect(result!.reason).toBe('my-pr+mention');
  });

  it('returns null for unsupported event types', () => {
    expect(classify('push', {}, 'me')).toBeNull();
    expect(classify('deployment', { action: 'created' }, 'me')).toBeNull();
  });

  it('returns null for non-created actions on comments', () => {
    expect(classify('issue_comment', { action: 'deleted' }, 'me')).toBeNull();
  });

  it('truncates body to 200 chars', () => {
    const longBody = 'x'.repeat(500);
    const result = classify('issue_comment', {
      action: 'created',
      issue: {
        number: 1,
        title: 'T',
        user: { login: 'me' },
        html_url: 'u',
        pull_request: {},
        repository_url: 'https://api.github.com/repos/o/r',
      },
      comment: {
        id: 1,
        user: { login: 'other' },
        body: longBody,
        html_url: 'u',
      },
    }, 'me');

    expect(result!.body.length).toBe(200);
  });

  it('extracts repo from repository.full_name fallback', () => {
    const result = classify('issue_comment', {
      action: 'created',
      issue: {
        number: 1,
        title: 'T',
        user: { login: 'me' },
        html_url: 'u',
        pull_request: {},
        // No repository_url on issue
      },
      comment: {
        id: 1,
        user: { login: 'other' },
        body: 'hi',
        html_url: 'u',
      },
      repository: { full_name: 'fallback/repo' },
    }, 'me');

    expect(result!.repo).toBe('fallback/repo');
  });
});

describe('verifySignature()', () => {
  const secret = 'webhook-secret-123';

  function sign(body: string): string {
    return 'sha256=' + crypto.createHmac('sha256', secret).update(Buffer.from(body)).digest('hex');
  }

  it('accepts valid signature', () => {
    const body = '{"hello":"world"}';
    expect(verifySignature(Buffer.from(body), sign(body), secret)).toBe(true);
  });

  it('rejects invalid signature', () => {
    expect(verifySignature(Buffer.from('body'), 'sha256=bad', secret)).toBe(false);
  });

  it('rejects missing sha256= prefix', () => {
    expect(verifySignature(Buffer.from('body'), 'notsha256=abc', secret)).toBe(false);
  });

  it('rejects empty signature', () => {
    expect(verifySignature(Buffer.from('body'), '', secret)).toBe(false);
  });

  it('is timing-safe (different length signatures)', () => {
    // Different length should still return false (not throw)
    expect(verifySignature(Buffer.from('x'), 'sha256=short', secret)).toBe(false);
  });
});

describe('parseGhAuthStatus()', () => {
  it('parses single-host output', () => {
    const text = `github.com
  ✓ Logged in to github.com account testuser (oauth_token)
  ✓ Git operations for github.com configured to use https protocol.`;
    const result = parseGhAuthStatus(text);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      hostname: 'github.com',
      username: 'testuser',
      apiBase: 'https://api.github.com',
    });
  });

  it('parses multi-host output', () => {
    const text = `github.com
  ✓ Logged in to github.com account user1 (oauth_token)
ghe.corp.com
  ✓ Logged in to ghe.corp.com account user2 (token)`;
    const result = parseGhAuthStatus(text);
    expect(result).toHaveLength(2);
    expect(result[0].hostname).toBe('github.com');
    expect(result[0].username).toBe('user1');
    expect(result[1].hostname).toBe('ghe.corp.com');
    expect(result[1].username).toBe('user2');
    expect(result[1].apiBase).toBe('https://ghe.corp.com/api/v3');
  });

  it('returns empty for empty input', () => {
    expect(parseGhAuthStatus('')).toEqual([]);
  });

  it('handles Windows-style line endings', () => {
    const text = "github.com\r\n  ✓ Logged in to github.com account testuser (token)\r\n";
    const result = parseGhAuthStatus(text);
    expect(result).toHaveLength(1);
    expect(result[0].username).toBe('testuser');
  });
});

describe('hostToApiBase()', () => {
  it('returns api.github.com for github.com', () => {
    expect(hostToApiBase('github.com')).toBe('https://api.github.com');
  });

  it('returns /api/v3 path for GHE hosts', () => {
    expect(hostToApiBase('ghe.corp.com')).toBe('https://ghe.corp.com/api/v3');
  });
});
