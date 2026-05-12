// Config loader. Resolution order:
//   1. %LOCALAPPDATA%\Ghent\config.json  (installed/MSI mode)
//   2. process.env via dotenv (dev mode, silent no-op if no .env found)
//
// Old single-account format (username/token/apiBase) is migrated
// transparently to the new accounts[] format on first load.
import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// Which notification kinds fire a toast. All true by default except onClosed.
export interface NotifFlags {
  onComment:          boolean; // PR conversation comment (issue_comment)
  onReviewComment:    boolean; // Inline code review comment
  onApproved:         boolean; // PR approved
  onChangesRequested: boolean; // Changes requested
  onReviewCommented:  boolean; // Review submitted with a comment body
  onMerged:           boolean; // Your PR was merged
  onClosed:           boolean; // Your PR was closed without merging
  onReviewRequested:  boolean; // Someone requested your review
  onMention:          boolean; // @mentioned on a PR you didn't author
}

export const DEFAULT_NOTIF_FLAGS: NotifFlags = {
  onComment:          true,
  onReviewComment:    true,
  onApproved:         true,
  onChangesRequested: true,
  onReviewCommented:  true,
  onMerged:           true,
  onClosed:           false,
  onReviewRequested:  true,
  onMention:          true,
};

// Per-host account. gh CLI is always tried first for token resolution;
// `token` is a PAT kept only as a silent fallback.
export interface AccountConfig {
  id: string;       // = hostname, e.g. "your-company.ghe.com" — used as stable key
  label: string;    // display name shown in the UI
  username: string; // GitHub/GHE login (lowercase)
  apiBase: string;  // REST API root, e.g. "https://your-company.ghe.com/api/v3"
  token: string;    // PAT fallback; empty = rely on gh CLI only
  enabled: boolean; // false = poller stopped, no toasts
}

export interface Config {
  accounts: AccountConfig[];
  mode: 'poll' | 'webhook';
  pollIntervalSec: number;
  notifCooldownSec: number;
  notifFlags: NotifFlags;
  toastTitleTemplate: string; // {commenter} {action} {repo} {repo_name} {num} {prTitle} {body}
  toastBodyTemplate: string;
  port: number;
  webhookSecret: string;
  dataDir: string;
  snoreToastPath: string | null;
  configured: boolean;
}

export function appDataDir(): string {
  const base = process.env.LOCALAPPDATA || join(process.env.USERPROFILE || '', 'AppData', 'Local');
  const dir = join(base, 'Ghent');
  // One-time migration: rename old data dir if it exists and new one doesn't
  const oldDir = join(base, 'GhePrNotifier');
  if (existsSync(oldDir) && !existsSync(dir)) {
    renameSync(oldDir, dir);
  }
  return dir;
}

interface RawConfig {
  accounts?: Array<Partial<AccountConfig>>;
  // Legacy single-account fields — migrated transparently on load
  username?: string;
  token?: string;
  tokenSource?: string;
  apiBase?: string;
  // Global settings
  mode?: string;
  pollIntervalSec?: number;
  notifCooldownSec?: number;
  notifFlags?: Partial<NotifFlags>;
  toastTitleTemplate?: string;
  toastBodyTemplate?: string;
  port?: number;
  webhookSecret?: string;
  dataDir?: string;
  snoreToastPath?: string | null;
}

function readJsonConfig(): RawConfig | null {
  const path = join(appDataDir(), 'config.json');
  if (!existsSync(path)) return null;
  try {
    let text = readFileSync(path, 'utf8');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    return JSON.parse(text) as RawConfig;
  } catch (err) {
    console.error(`[config] failed to parse ${path}: ${(err as Error).message}`);
    return null;
  }
}

function migrateAccounts(raw: RawConfig): AccountConfig[] {
  // New format: accounts array
  if (Array.isArray(raw.accounts) && raw.accounts.length > 0) {
    return raw.accounts
      .filter(a => a.username && a.apiBase)
      .map(a => {
        // Prefer the stored id (hostname) over deriving from apiBase URL.
        // e.g. github.com has apiBase=https://api.github.com whose hostname is api.github.com — wrong.
        const hostname = a.id || new URL(a.apiBase!).hostname;
        return {
          id:       hostname,
          label:    a.label || hostname,
          username: (a.username || '').toLowerCase(),
          apiBase:  a.apiBase!,
          token:    a.token || '',
          enabled:  a.enabled !== false,
        };
      });
  }
  // Legacy single-account — migrate transparently, preserve PAT as fallback.
  const rawUsername = raw.username || process.env.GHE_USERNAME || '';
  if (rawUsername) {
    const apiBase = raw.apiBase || process.env.GHE_API_BASE || '';
    if (!apiBase) return []; // can't derive hostname — caller must configure via UI
    const hostname = new URL(apiBase).hostname;
    const token = raw.tokenSource === 'gh-cli' ? '' : (raw.token || process.env.GHE_TOKEN || '');
    return [{ id: hostname, label: hostname, username: rawUsername.toLowerCase(), apiBase, token, enabled: true }];
  }
  return [];
}

function writeTemplateIfMissing(): string {
  const dir = appDataDir();
  const path = join(dir, 'config.json');
  if (existsSync(path)) return path;
  mkdirSync(dir, { recursive: true });
  const template: RawConfig = {
    accounts: [],
    mode: 'poll',
    pollIntervalSec: 60,
    notifCooldownSec: 180,
    notifFlags: DEFAULT_NOTIF_FLAGS,
    toastTitleTemplate: '{commenter} {action}',
    toastBodyTemplate: '{repo}#{num}: {prTitle}\n{body}',
    port: 9420,
    webhookSecret: ''
  };
  writeFileSync(path, JSON.stringify(template, null, 2), 'utf8');
  return path;
}

export function loadConfig(): Config {
  const json = readJsonConfig();
  const accounts = migrateAccounts(json || {});
  const isConfigured = accounts.length > 0;
  if (!isConfigured) {
    const path = writeTemplateIfMissing();
    console.log(`[config] Welcome to Ghent! Add a GHE account to get started.`);
  }

  const here = dirname(resolve(process.argv[1] || process.cwd()));
  const installedSnore = resolve(here, 'snoretoast', 'snoretoast-x64.exe');
  const snoreToastPath = json?.snoreToastPath
    || (existsSync(installedSnore) ? installedSnore : null);

  const installedDataDir = appDataDir();
  const devDataDir = resolve(here, '..', 'logs');
  const dataDir = json?.dataDir || (json ? installedDataDir : devDataDir);
  mkdirSync(dataDir, { recursive: true });

  return {
    accounts,
    mode: ((json?.mode || process.env.MODE || 'poll').toLowerCase() === 'webhook' ? 'webhook' : 'poll'),
    pollIntervalSec: json?.pollIntervalSec ?? parseInt(process.env.POLL_INTERVAL_SEC || '60', 10),
    notifCooldownSec: json?.notifCooldownSec ?? 180,
    notifFlags: { ...DEFAULT_NOTIF_FLAGS, ...(json?.notifFlags || {}) },
    toastTitleTemplate: json?.toastTitleTemplate ?? '{commenter} {action}',
    toastBodyTemplate: json?.toastBodyTemplate ?? '{repo}#{num}: {prTitle}\n{body}',
    port: json?.port ?? parseInt(process.env.PORT || '9420', 10),
    webhookSecret: json?.webhookSecret || process.env.WEBHOOK_SECRET || '',
    dataDir,
    snoreToastPath,
    configured: isConfigured
  };
}

export const config = loadConfig();

export function reloadConfig(): void {
  Object.assign(config, loadConfig());
}
