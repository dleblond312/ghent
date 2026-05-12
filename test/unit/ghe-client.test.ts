/**
 * Tests for src/ghe-client.ts — createGheClient
 *
 * HC-ERRORS-SURFACED: retry on 500, throw on 401, transient error retry
 * HC-GHENT-POLL-COVERAGE: pagination and search pagination
 * HC-GHENT-TOKEN-VISIBLE: auth failures surface clearly
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.hoisted runs before vi.mock hoisting
const { mockExecFileSync } = vi.hoisted(() => {
  return { mockExecFileSync: vi.fn() };
});

vi.mock('node:child_process', () => ({
  execFileSync: mockExecFileSync,
}));

// Mock config module
vi.mock('../../src/config.js', () => ({
  config: { dataDir: '/tmp/ghent-test' },
}));

import { createGheClient } from '../../src/ghe-client.js';
import type { AccountConfig } from '../../src/config.js';

const testAccount: AccountConfig = {
  id: 'github.com',
  label: 'GitHub',
  username: 'testuser',
  apiBase: 'https://api.github.com',
  token: 'fallback-token',
  enabled: true,
};

beforeEach(() => {
  mockExecFileSync.mockReset();
  // Default: gh CLI returns a token
  mockExecFileSync.mockReturnValue('gh-cli-token\n');
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(responses: Array<{ status: number; body?: unknown; ok?: boolean }>) {
  const fn = vi.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce({
      ok: r.ok ?? (r.status >= 200 && r.status < 300),
      status: r.status,
      json: () => Promise.resolve(r.body),
      text: () => Promise.resolve(JSON.stringify(r.body ?? '')),
    });
  }
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('createGheClient', () => {
  describe('get()', () => {
    it('makes authenticated GET request', async () => {
      const fetchFn = mockFetch([{ status: 200, body: { id: 1 } }]);
      const client = createGheClient(testAccount);
      const result = await client.get('/user');
      expect(result).toEqual({ id: 1 });
      expect(fetchFn).toHaveBeenCalledWith(
        'https://api.github.com/user',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Authorization: 'token gh-cli-token',
          }),
        }),
      );
    });

    it('uses gh CLI token first', async () => {
      mockFetch([{ status: 200, body: {} }]);
      const client = createGheClient(testAccount);
      await client.get('/test');
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'gh',
        ['auth', 'token', '--hostname', 'api.github.com'],
        expect.any(Object),
      );
    });

    it('falls back to PAT when gh CLI fails (HC-GHENT-TOKEN-VISIBLE)', async () => {
      mockExecFileSync.mockImplementation(() => { throw new Error('gh not found'); });
      const fetchFn = mockFetch([{ status: 200, body: {} }]);
      const client = createGheClient(testAccount);
      await client.get('/test');
      expect(fetchFn).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'token fallback-token',
          }),
        }),
      );
    });

    it('throws when no token available (HC-GHENT-TOKEN-VISIBLE)', async () => {
      mockExecFileSync.mockImplementation(() => { throw new Error('gh not found'); });
      const noTokenAccount = { ...testAccount, token: '' };
      const client = createGheClient(noTokenAccount);
      await expect(client.get('/test')).rejects.toThrow(/No token for/);
    });
  });

  describe('retry logic (HC-ERRORS-SURFACED)', () => {
    it('retries on 500 and succeeds on second attempt', async () => {
      const fetchFn = mockFetch([
        { status: 500, body: 'Internal Server Error', ok: false },
        { status: 200, body: { retried: true } },
      ]);
      const client = createGheClient(testAccount);
      const result = await client.get('/test');
      expect(result).toEqual({ retried: true });
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('throws after max retries on persistent 500', async () => {
      mockFetch([
        { status: 500, body: 'error', ok: false },
        { status: 500, body: 'error', ok: false },
        { status: 500, body: 'error', ok: false },
      ]);
      const client = createGheClient(testAccount);
      await expect(client.get('/test')).rejects.toThrow(/500/);
    });

    it('does not retry on 401 (auth failure)', async () => {
      const fetchFn = mockFetch([
        { status: 401, body: 'Unauthorized', ok: false },
      ]);
      const client = createGheClient(testAccount);
      await expect(client.get('/test')).rejects.toThrow(/401/);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('does not retry on 404', async () => {
      const fetchFn = mockFetch([
        { status: 404, body: 'Not Found', ok: false },
      ]);
      const client = createGheClient(testAccount);
      await expect(client.get('/test')).rejects.toThrow(/404/);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('retries on transient network errors', async () => {
      const fetchFn = vi.fn()
        .mockRejectedValueOnce(Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } }))
        .mockResolvedValueOnce({
          ok: true, status: 200,
          json: () => Promise.resolve({ recovered: true }),
          text: () => Promise.resolve(''),
        });
      vi.stubGlobal('fetch', fetchFn);

      const client = createGheClient(testAccount);
      const result = await client.get('/test');
      expect(result).toEqual({ recovered: true });
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('does not retry on non-transient network errors', async () => {
      const fetchFn = vi.fn()
        .mockRejectedValueOnce(new Error('bad request'));
      vi.stubGlobal('fetch', fetchFn);

      const client = createGheClient(testAccount);
      await expect(client.get('/test')).rejects.toThrow('bad request');
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('paginate() (HC-GHENT-POLL-COVERAGE)', () => {
    it('fetches all pages until empty', async () => {
      const page1 = Array.from({ length: 100 }, (_, i) => ({ id: i }));
      const page2 = [{ id: 100 }, { id: 101 }];
      const fetchFn = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(page1), text: () => Promise.resolve('') })
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(page2), text: () => Promise.resolve('') });
      vi.stubGlobal('fetch', fetchFn);

      const client = createGheClient(testAccount);
      const result = await client.paginate('/repos/org/repo/comments');
      expect(result).toHaveLength(102);
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('stops on empty array response', async () => {
      const fetchFn = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve([]), text: () => Promise.resolve('') });
      vi.stubGlobal('fetch', fetchFn);

      const client = createGheClient(testAccount);
      const result = await client.paginate('/repos/org/repo/comments');
      expect(result).toEqual([]);
    });

    it('handles query parameters in path', async () => {
      const fetchFn = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve([{ id: 1 }]), text: () => Promise.resolve('') });
      vi.stubGlobal('fetch', fetchFn);

      const client = createGheClient(testAccount);
      await client.paginate('/repos/o/r/comments?since=2024-01-01');
      // Should use & not ? for additional params
      expect(fetchFn.mock.calls[0][0]).toContain('&per_page=');
    });
  });

  describe('paginateSearch() (HC-GHENT-POLL-COVERAGE)', () => {
    it('unwraps items from search response', async () => {
      const items = [{ number: 1, title: 'PR1' }, { number: 2, title: 'PR2' }];
      const fetchFn = vi.fn()
        .mockResolvedValueOnce({
          ok: true, status: 200,
          json: () => Promise.resolve({ items, total_count: 2 }),
          text: () => Promise.resolve(''),
        });
      vi.stubGlobal('fetch', fetchFn);

      const client = createGheClient(testAccount);
      const result = await client.paginateSearch('/search/issues?q=is:pr');
      expect(result).toEqual(items);
    });

    it('paginates through multiple search pages', async () => {
      const page1Items = Array.from({ length: 100 }, (_, i) => ({ id: i }));
      const page2Items = [{ id: 100 }];
      const fetchFn = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ items: page1Items }), text: () => Promise.resolve('') })
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ items: page2Items }), text: () => Promise.resolve('') });
      vi.stubGlobal('fetch', fetchFn);

      const client = createGheClient(testAccount);
      const result = await client.paginateSearch('/search/issues?q=test');
      expect(result).toHaveLength(101);
      expect(fetchFn).toHaveBeenCalledTimes(2);
    });

    it('handles empty search result', async () => {
      const fetchFn = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ items: [] }), text: () => Promise.resolve('') });
      vi.stubGlobal('fetch', fetchFn);

      const client = createGheClient(testAccount);
      const result = await client.paginateSearch('/search/issues?q=nothing');
      expect(result).toEqual([]);
    });

    it('handles missing items key gracefully', async () => {
      const fetchFn = vi.fn()
        .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({}), text: () => Promise.resolve('') });
      vi.stubGlobal('fetch', fetchFn);

      const client = createGheClient(testAccount);
      const result = await client.paginateSearch('/search/issues?q=test');
      expect(result).toEqual([]);
    });
  });

  describe('post/patch/delete methods', () => {
    it('sends POST with body', async () => {
      const fetchFn = mockFetch([{ status: 201, body: { created: true } }]);
      const client = createGheClient(testAccount);
      const result = await client.post('/repos/o/r/hooks', { url: 'https://hook.example.com' });
      expect(result).toEqual({ created: true });
      expect(fetchFn).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ url: 'https://hook.example.com' }),
        }),
      );
    });

    it('handles 204 No Content response', async () => {
      mockFetch([{ status: 204, ok: true }]);
      const client = createGheClient(testAccount);
      const result = await client.delete('/repos/o/r/hooks/1');
      expect(result).toBeNull();
    });
  });
});
