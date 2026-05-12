/**
 * Tests for src/config.ts
 *
 * HC-GHENT-STATE-RESILIENCE: corrupt config falls back to defaults
 * HC-NO-SECRETS: API responses don't expose tokens (tested in integration)
 * HC-DOCS-MATCH-REPO: config shape matches documented interface
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Isolated temp directory per test run
let TEST_DIR: string;

beforeEach(() => {
  TEST_DIR = join(tmpdir(), `ghent-test-config-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(TEST_DIR, { recursive: true });
  vi.resetModules();
  vi.unstubAllEnvs();
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** Helper: write a config.json into a temp "Ghent" dir and load it */
async function loadConfigFrom(raw: Record<string, unknown>) {
  const ghentDir = join(TEST_DIR, 'Ghent');
  mkdirSync(ghentDir, { recursive: true });
  writeFileSync(join(ghentDir, 'config.json'), JSON.stringify(raw), 'utf8');

  // Mock LOCALAPPDATA so appDataDir() uses our temp. Also clear other env vars
  // that loadConfig reads as fallbacks.
  vi.stubEnv('LOCALAPPDATA', TEST_DIR);
  vi.stubEnv('GHE_USERNAME', '');
  vi.stubEnv('GHE_TOKEN', '');
  vi.stubEnv('GHE_API_BASE', '');

  const mod = await import('../../src/config.js');
  return mod.loadConfig();
}

/** Load config with no file at all */
async function loadEmptyConfig() {
  vi.stubEnv('LOCALAPPDATA', TEST_DIR);
  vi.stubEnv('GHE_USERNAME', '');
  vi.stubEnv('GHE_TOKEN', '');
  vi.stubEnv('GHE_API_BASE', '');
  const mod = await import('../../src/config.js');
  return mod.loadConfig();
}

describe('loadConfig', () => {
  it('returns defaults when no config file exists', async () => {
    const cfg = await loadEmptyConfig();
    expect(cfg.accounts).toEqual([]);
    expect(cfg.configured).toBe(false);
    expect(cfg.mode).toBe('poll');
    expect(cfg.pollIntervalSec).toBe(60);
    expect(cfg.notifCooldownSec).toBe(180);
    expect(cfg.port).toBe(9420);
  });

  it('loads accounts from valid config', async () => {
    const cfg = await loadConfigFrom({
      accounts: [{
        id: 'github.com',
        label: 'GitHub',
        username: 'testuser',
        apiBase: 'https://api.github.com',
        token: 'ghp_test123',
        enabled: true,
      }],
    });
    expect(cfg.accounts).toHaveLength(1);
    expect(cfg.accounts[0].username).toBe('testuser');
    expect(cfg.accounts[0].id).toBe('github.com');
    expect(cfg.configured).toBe(true);
  });

  it('handles BOM-prefixed config files', async () => {
    const ghentDir = join(TEST_DIR, 'Ghent');
    mkdirSync(ghentDir, { recursive: true });
    const content = JSON.stringify({
      accounts: [{ id: 'gh.com', username: 'bom-user', apiBase: 'https://gh.com/api/v3', token: '', enabled: true }],
    });
    writeFileSync(join(ghentDir, 'config.json'), '\uFEFF' + content, 'utf8');
    vi.stubEnv('LOCALAPPDATA', TEST_DIR);
    vi.stubEnv('GHE_USERNAME', '');
    const mod = await import('../../src/config.js');
    const cfg = mod.loadConfig();
    expect(cfg.accounts[0].username).toBe('bom-user');
  });

  it('falls back to defaults on corrupt JSON (HC-GHENT-STATE-RESILIENCE)', async () => {
    const ghentDir = join(TEST_DIR, 'Ghent');
    mkdirSync(ghentDir, { recursive: true });
    writeFileSync(join(ghentDir, 'config.json'), '{broken json!!!', 'utf8');
    const cfg = await loadEmptyConfig();
    // corrupt JSON → readJsonConfig returns null → no accounts
    expect(cfg.accounts).toEqual([]);
    expect(cfg.configured).toBe(false);
  });

  it('migrates legacy single-account format', async () => {
    const cfg = await loadConfigFrom({
      username: 'legacyuser',
      apiBase: 'https://ghe.corp.com/api/v3',
      token: 'legacy-token',
    });
    expect(cfg.accounts).toHaveLength(1);
    expect(cfg.accounts[0].id).toBe('ghe.corp.com');
    expect(cfg.accounts[0].username).toBe('legacyuser');
    expect(cfg.accounts[0].token).toBe('legacy-token');
  });

  it('migrates legacy tokenSource=gh-cli to empty token', async () => {
    const cfg = await loadConfigFrom({
      username: 'cliuser',
      apiBase: 'https://ghe.corp.com/api/v3',
      token: 'should-be-cleared',
      tokenSource: 'gh-cli',
    });
    expect(cfg.accounts[0].token).toBe('');
  });

  it('preserves stored id over derived hostname', async () => {
    const cfg = await loadConfigFrom({
      accounts: [{
        id: 'github.com',
        username: 'u',
        apiBase: 'https://api.github.com',
        token: '',
        enabled: true,
      }],
    });
    expect(cfg.accounts[0].id).toBe('github.com');
  });

  it('filters accounts missing username or apiBase', async () => {
    const cfg = await loadConfigFrom({
      accounts: [
        { id: 'good.com', username: 'u', apiBase: 'https://good.com/api/v3', token: '', enabled: true },
        { id: 'no-user.com', apiBase: 'https://no-user.com/api/v3' },
        { id: 'no-api.com', username: 'u2' },
      ],
    });
    expect(cfg.accounts).toHaveLength(1);
    expect(cfg.accounts[0].id).toBe('good.com');
  });

  it('merges notifFlags with defaults', async () => {
    const cfg = await loadConfigFrom({
      notifFlags: { onClosed: true, onComment: false },
    });
    expect(cfg.notifFlags.onClosed).toBe(true);
    expect(cfg.notifFlags.onComment).toBe(false);
    expect(cfg.notifFlags.onApproved).toBe(true);
    expect(cfg.notifFlags.onMerged).toBe(true);
  });
});

describe('appDataDir', () => {
  it('returns Ghent subdirectory of LOCALAPPDATA', async () => {
    vi.stubEnv('LOCALAPPDATA', TEST_DIR);
    const mod = await import('../../src/config.js');
    const dir = mod.appDataDir();
    expect(dir).toContain('Ghent');
  });
});

describe('writeTemplateIfMissing', () => {
  it('creates template config.json when missing', async () => {
    const ghentDir = join(TEST_DIR, 'Ghent');
    const cfg = await loadEmptyConfig();
    // loadConfig calls writeTemplateIfMissing when unconfigured (no accounts)
    expect(cfg.configured).toBe(false);
    expect(existsSync(join(ghentDir, 'config.json'))).toBe(true);
  });

  it('does not overwrite existing config', async () => {
    const ghentDir = join(TEST_DIR, 'Ghent');
    mkdirSync(ghentDir, { recursive: true });
    writeFileSync(join(ghentDir, 'config.json'), '{"custom": true}', 'utf8');
    vi.stubEnv('LOCALAPPDATA', TEST_DIR);
    vi.stubEnv('GHE_USERNAME', '');
    const mod = await import('../../src/config.js');
    mod.loadConfig();
    const content = JSON.parse(readFileSync(join(ghentDir, 'config.json'), 'utf8'));
    expect(content.custom).toBe(true);
  });
});

describe('DEFAULT_NOTIF_FLAGS', () => {
  it('has expected shape', async () => {
    const mod = await import('../../src/config.js');
    const flags = mod.DEFAULT_NOTIF_FLAGS;
    expect(flags.onComment).toBe(true);
    expect(flags.onClosed).toBe(false);
    expect(flags.onReviewRequested).toBe(true);
  });
});
