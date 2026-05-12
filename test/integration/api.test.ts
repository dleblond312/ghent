/**
 * Integration tests for Express API routes in src/server.ts
 *
 * HC-SAFE-SIDE-EFFECTS: webhook signature verification end-to-end
 * HC-NO-SECRETS: API responses don't expose tokens
 * HC-ERRORS-SURFACED: bad inputs handled gracefully
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';

// Mock heavy dependencies before importing the server module
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
  getPollerStatus: vi.fn(() => ({
    running: true,
    lastPoll: new Date('2024-01-01'),
    prCount: 5,
    effectiveIntervalSec: 60,
  })),
}));
vi.mock('../../src/ui.js', () => ({
  UI_HTML: '<html><body>Test UI</body></html>',
}));

vi.mock('../../src/config.js', () => ({
  config: {
    accounts: [
      {
        id: 'github.com',
        label: 'GitHub',
        username: 'testuser',
        apiBase: 'https://api.github.com',
        token: 'secret-token-should-not-leak',
        enabled: true,
      },
    ],
    mode: 'poll',
    pollIntervalSec: 60,
    notifCooldownSec: 180,
    notifFlags: {},
    toastTitleTemplate: '{commenter} {action}',
    toastBodyTemplate: '{repo}#{num}: {prTitle}',
    port: 0,
    webhookSecret: 'integration-test-secret',
    dataDir: '/tmp/ghent-test',
    snoreToastPath: null,
    configured: true,
  },
  reloadConfig: vi.fn(),
  appDataDir: vi.fn(() => '/tmp/ghent-test'),
  DEFAULT_NOTIF_FLAGS: {
    onComment: true, onReviewComment: true, onApproved: true,
    onChangesRequested: true, onReviewCommented: true, onMerged: true,
    onClosed: false, onReviewRequested: true, onMention: true,
  },
}));

// Must import supertest dynamically to ensure mocks are in place
import supertest from 'supertest';
import { app } from '../../src/server.js';

describe('GET /health', () => {
  it('returns ok status', async () => {
    const res = await supertest(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.mode).toBe('poll');
    expect(res.body.accounts).toBe(1);
  });
});

describe('GET /', () => {
  it('serves HTML UI', async () => {
    const res = await supertest(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('html');
    expect(res.text).toContain('Test UI');
  });
});

describe('GET /api/config', () => {
  it('returns config without sensitive fields (HC-NO-SECRETS)', async () => {
    const res = await supertest(app).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body.pollIntervalSec).toBe(60);
    expect(res.body.configured).toBe(true);
    // Should NOT contain tokens, webhookSecret, or dataDir
    expect(res.body.token).toBeUndefined();
    expect(res.body.webhookSecret).toBeUndefined();
    expect(res.body.dataDir).toBeUndefined();
  });
});

describe('GET /api/status', () => {
  it('returns account status with poller info', async () => {
    const res = await supertest(app).get('/api/status');
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
    expect(res.body.accounts).toHaveLength(1);
    expect(res.body.accounts[0].id).toBe('github.com');
    expect(res.body.accounts[0].username).toBe('testuser');
    // Should NOT expose token
    expect(res.body.accounts[0].token).toBeUndefined();
  });
});

describe('POST /webhook', () => {
  function signPayload(payload: object): string {
    const body = JSON.stringify(payload);
    return 'sha256=' + crypto.createHmac('sha256', 'integration-test-secret').update(body).digest('hex');
  }

  it('accepts valid webhook with correct signature', async () => {
    const payload = {
      action: 'created',
      issue: {
        number: 1,
        title: 'Test PR',
        user: { login: 'testuser' },
        html_url: 'https://github.com/org/repo/pull/1',
        pull_request: {},
        repository_url: 'https://api.github.com/repos/org/repo',
      },
      comment: {
        id: 1,
        user: { login: 'reviewer' },
        body: 'LGTM',
        html_url: 'https://github.com/org/repo/pull/1#comment-1',
      },
    };
    const body = JSON.stringify(payload);
    const sig = signPayload(payload);

    const res = await supertest(app)
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sig)
      .set('X-GitHub-Event', 'issue_comment')
      .set('X-GitHub-Delivery', 'test-delivery-1')
      .send(body);

    expect(res.status).toBe(200);
    expect(res.text).toBe('ok');
  });

  it('rejects webhook with bad signature (HC-SAFE-SIDE-EFFECTS)', async () => {
    const res = await supertest(app)
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', 'sha256=bad-signature')
      .set('X-GitHub-Event', 'push')
      .send('{"action":"push"}');

    expect(res.status).toBe(401);
    expect(res.text).toBe('bad signature');
  });

  it('rejects webhook with missing signature', async () => {
    const res = await supertest(app)
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .set('X-GitHub-Event', 'push')
      .send('{"test":true}');

    expect(res.status).toBe(401);
  });

  it('rejects malformed JSON with valid signature', async () => {
    const badJson = 'not valid json {{{';
    const sig = 'sha256=' + crypto.createHmac('sha256', 'integration-test-secret').update(badJson).digest('hex');

    const res = await supertest(app)
      .post('/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', sig)
      .set('X-GitHub-Event', 'push')
      .send(badJson);

    expect(res.status).toBe(400);
    expect(res.text).toBe('bad json');
  });
});

describe('Security headers', () => {
  it('sets security headers on all responses', async () => {
    const res = await supertest(app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['content-security-policy']).toBeDefined();
  });
});
