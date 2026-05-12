// Thin GHE/GitHub REST client. gh CLI is tried first for token resolution;
// stored PAT is the silent fallback. Works with any GitHub host.
import { execFileSync } from 'node:child_process';
import { config } from './config.js';
import type { AccountConfig } from './config.js';

// gh CLI first, stored PAT fallback. Called per-request so token refreshes
// from `gh auth refresh` are transparent â€” no app restart needed.
function resolveToken(account: AccountConfig): string {
  try {
    const hostname = new URL(account.apiBase).hostname;
    return execFileSync('gh', ['auth', 'token', '--hostname', hostname], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true
    }).trim();
  } catch {
    if (account.token) return account.token;
    const host = new URL(account.apiBase).hostname;
    throw new Error(`No token for ${host}. Run: gh auth login --hostname ${host}`);
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface GheClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
  paginate<T>(path: string, perPage?: number): Promise<T[]>;
  // GitHub search API returns `{ items: T[] }` not `T[]` directly — use this instead of paginate().
  paginateSearch<T>(path: string): Promise<T[]>;
}

export function createGheClient(account: AccountConfig): GheClient {
  function sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }

  async function request<T = unknown>(method: Method, path: string, body?: unknown): Promise<T> {
    const TOKEN = resolveToken(account);
    const maxAttempts = 3;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await fetch(`${account.apiBase}${path}`, {
          method,
          headers: {
            'Authorization': `token ${TOKEN}`,
            'Accept': 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'User-Agent': 'ghent'
          },
          body: body !== undefined ? JSON.stringify(body) : undefined
        });
        if (!res.ok) {
          const text = await res.text();
          if (res.status >= 500 && attempt < maxAttempts) {
            lastErr = new Error(`${method} ${path} -> ${res.status}: ${text}`);
            await sleep(500 * attempt);
            continue;
          }
          throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
        }
        if (res.status === 204) return null as T;
        return res.json() as Promise<T>;
      } catch (err) {
        lastErr = err;
        const code = (err as { cause?: { code?: string } })?.cause?.code;
        const transient = ['ENOTFOUND','ECONNRESET','ETIMEDOUT','EAI_AGAIN','UND_ERR_SOCKET'].includes(code || '');
        if (!transient || attempt === maxAttempts) throw err;
        await sleep(500 * attempt);
      }
    }
    throw lastErr;
  }

  async function paginate<T>(path: string, perPage = 100): Promise<T[]> {
    const all: T[] = [];
    let page = 1;
    while (true) {
      const sep = path.includes('?') ? '&' : '?';
      const items = await request<T[]>('GET', `${path}${sep}per_page=${perPage}&page=${page}`);
      if (!Array.isArray(items) || items.length === 0) break;
      all.push(...items);
      if (items.length < perPage) break;
      page++;
    }
    return all;
  }

  // GitHub search API returns { items: T[], total_count: number } — not a plain array.
  // Paginate through all pages and return the flat items list.
  async function paginateSearch<T>(path: string): Promise<T[]> {
    const PER_PAGE = 100;
    const all: T[] = [];
    let page = 1;
    while (true) {
      const sep = path.includes('?') ? '&' : '?';
      const result = await request<{ items?: T[] }>('GET', `${path}${sep}per_page=${PER_PAGE}&page=${page}`);
      const items = result.items ?? [];
      all.push(...items);
      if (items.length < PER_PAGE) break;
      page++;
    }
    return all;
  }

  return {
    get:            <T>(path: string)                 => request<T>('GET', path),
    post:           <T>(path: string, body?: unknown) => request<T>('POST', path, body),
    patch:          <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
    delete:         <T>(path: string)                 => request<T>('DELETE', path),
    paginate,
    paginateSearch,
  };
}

// Convenience: first-account client for webhook handler.
export const ghe: GheClient = new Proxy({} as GheClient, {
  get(_t, prop) {
    const account = config.accounts[0];
    if (!account) throw new Error('No accounts configured');
    return createGheClient(account)[prop as keyof GheClient];
  }
});

