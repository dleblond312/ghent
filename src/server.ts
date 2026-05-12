// Express server — serves the web config UI and handles GHE webhooks.
import express, { type Request, type Response } from 'express';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { notify } from './notifier.js';
import { logEvent, patchConsole } from './logger.js';
import { config, reloadConfig, appDataDir, type AccountConfig } from './config.js';
import { startPolling, stopPolling, getPollerStatus } from './poller.js';
import { UI_HTML } from './ui.js';

// Timestamps on every log line from the start.
patchConsole();

const VERSION = '0.2.0';
const PORT = config.port;
const MODE = config.mode;

// Start a poller for every enabled configured account.
if (MODE === 'poll') {
  for (const account of config.accounts) {
    if (account.enabled !== false) startPolling(account);
  }
} else if (MODE === 'webhook' && !config.webhookSecret) {
  console.error('webhookSecret is required in webhook mode. See config README.txt.');
  process.exit(1);
}

interface GheUser { login: string }
interface GheCommentLike { id: number; user: GheUser; body: string | null; html_url: string }
interface GheReviewLike { id: number; user: GheUser; body: string | null; state: string; html_url: string }
interface GhePrLike {
  number: number;
  title: string;
  user: GheUser;
  html_url: string;
  repository_url?: string;
}
interface WebhookPayload {
  action?: string;
  issue?: GhePrLike & { pull_request?: unknown };
  pull_request?: GhePrLike;
  comment?: GheCommentLike;
  review?: GheReviewLike;
  repository?: { full_name?: string };
  sender?: { login?: string };
}

interface Classified {
  kind: 'issue_comment' | 'review_comment' | 'review';
  reason: 'my-pr' | 'mention' | 'my-pr+mention';
  repo: string;
  prNumber: number;
  prTitle: string;
  commenter: string;
  body: string;
  url: string;
}

const app = express();

// Security headers — minimal but covers XSS/MIME-sniff/frame basics.
app.use((_req: Request, res: Response, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0'); // CSP is the modern replacement
  res.setHeader('Referrer-Policy', 'no-referrer');
  // Only serve to localhost — belt and suspenders (OS firewall is the real gate)
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'");
  next();
});

// Rudimentary rate-limit for webhook: 120 req/min per IP.
const _hits = new Map<string, number[]>();
app.use('/webhook', (req: Request, res: Response, next) => {
  const ip = req.socket.remoteAddress ?? '?';
  const now = Date.now();
  const window = 60_000;
  const times = (_hits.get(ip) ?? []).filter(t => now - t < window);
  times.push(now);
  _hits.set(ip, times);
  if (times.length > 120) { res.status(429).send('too many requests'); return; }
  next();
});

// Raw body for webhook HMAC; JSON for the config API.
app.use('/webhook', express.raw({ type: '*/*', limit: '10mb' }));
app.use('/api', express.json());

// ── Web UI ────────────────────────────────────────────────────────────────
app.get('/', (_req: Request, res: Response) => {
  res.type('html').send(UI_HTML);
});

// ── Config API (global settings) ─────────────────────────────────────────
app.get('/api/config', (_req: Request, res: Response) => {
  res.json({
    configured:          config.configured,
    pollIntervalSec:     config.pollIntervalSec,
    notifCooldownSec:    config.notifCooldownSec,
    notifFlags:          config.notifFlags,
    toastTitleTemplate:  config.toastTitleTemplate,
    toastBodyTemplate:   config.toastBodyTemplate,
    port:                config.port
  });
});

app.post('/api/config', (req: Request, res: Response) => {
  // express.json() middleware has already parsed req.body into a plain object;
  // shape is unvalidated — all fields are optional and defaulted below.
  const body = req.body as { pollIntervalSec?: number; notifCooldownSec?: number; notifFlags?: Record<string, boolean>; toastTitleTemplate?: string; toastBodyTemplate?: string };
  const cfgDir  = appDataDir();
  const cfgPath = join(cfgDir, 'config.json');
  let existing: Record<string, unknown> = {};
  if (existsSync(cfgPath)) {
    try {
      let raw = readFileSync(cfgPath, 'utf8');
      if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
      existing = JSON.parse(raw) as Record<string, unknown>;
    } catch (err) { console.warn('[config] could not read existing config before save:', (err as Error).message); }
  }
  const newCfg = {
    ...existing,
    // Use explicit undefined check so a submitted value of 0 isn't swallowed by || falsy coercion
    // (clamped to 30 minimum — values < 30 would hammer the API).
    pollIntervalSec:  body.pollIntervalSec != null ? Math.max(30, Number(body.pollIntervalSec)) : config.pollIntervalSec,
    notifCooldownSec: Math.max(0,  Number(body.notifCooldownSec) ?? config.notifCooldownSec),
    ...(body.notifFlags && typeof body.notifFlags === 'object'
      ? { notifFlags: { ...(existing.notifFlags as object || {}), ...body.notifFlags } }
      : {}),
    ...(typeof body.toastTitleTemplate === 'string' ? { toastTitleTemplate: body.toastTitleTemplate } : {}),
    ...(typeof body.toastBodyTemplate  === 'string' ? { toastBodyTemplate:  body.toastBodyTemplate  } : {}),
  };
  mkdirSync(cfgDir, { recursive: true });
  writeFileSync(cfgPath, JSON.stringify(newCfg, null, 2), 'utf8');
  reloadConfig();
  // Restart pollers so the new pollIntervalSec takes effect immediately.
  if (config.mode === 'poll') {
    for (const account of config.accounts) { stopPolling(account.id); startPolling(account); }
  }
  const updatedFields = (Object.keys(body) as (keyof typeof body)[]).filter(k => body[k] !== undefined);
  logEvent({ kind: 'config_update', fields: updatedFields });
  res.json({ ok: true });
});

// ── Accounts API ───────────────────────────────────────────────────────────

// Derive the REST API base for a given hostname.
// github.com uses api.github.com; GHE uses <host>/api/v3.
function hostToApiBase(hostname: string): string {
  return hostname === 'github.com'
    ? 'https://api.github.com'
    : `https://${hostname}/api/v3`;
}

// Parse `gh auth status` text output (written to stderr, mixed in via 2>&1).
// Returns one entry per authenticated host.
function listGhAccounts(): Array<{ hostname: string; username: string; apiBase: string }> {
  try {
    const out = execFileSync('gh', ['auth', 'status'], {
      encoding: 'utf8' as const,
      timeout: 8000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe']
    });
    return parseGhAuthStatus(out);
  } catch (e: unknown) {
    // gh writes to stderr; try the combined stderr from the thrown error.
    const err = e as { stderr?: string; stdout?: string };
    const text = (err.stderr || '') + (err.stdout || '');
    if (text) return parseGhAuthStatus(text);
    return [];
  }
}

function parseGhAuthStatus(text: string): Array<{ hostname: string; username: string; apiBase: string }> {
  const results: Array<{ hostname: string; username: string; apiBase: string }> = [];
  let currentHost = '';
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.startsWith(' ') && line.trim()) {
      currentHost = line.trim();
    } else if (currentHost) {
      // Matches: "  ✓ Logged in to <host> account <username> (...)"
      const m = line.match(/Logged in to .+ account ([\w.@-]+)/i);
      if (m) {
        results.push({ hostname: currentHost, username: m[1], apiBase: hostToApiBase(currentHost) });
        currentHost = '';
      }
    }
  }
  return results;
}

// Returns all gh CLI authenticated accounts plus whether each is already configured.
app.get('/api/gh-accounts', (_req: Request, res: Response) => {
  const detected = listGhAccounts();
  const configuredIds = new Set(config.accounts.map(a => a.id));
  res.json(detected.map(d => ({ ...d, added: configuredIds.has(d.hostname) })));
});

app.get('/api/accounts', (_req: Request, res: Response) => {
  // Always source from gh CLI — shows all authenticated hosts, not just configured ones.
  const detected = listGhAccounts();
  const cfgMap = new Map(config.accounts.map(a => [a.id, a]));
  const result = detected.map(d => {
    const cfg = cfgMap.get(d.hostname);
    const enabled = cfg?.enabled ?? false;
    return {
      id:       d.hostname,
      label:    cfg?.label || d.hostname,
      username: d.username,
      apiBase:  d.apiBase,
      enabled,
      hasToken: !!cfg?.token,
      ...(enabled
        ? getPollerStatus(d.hostname)
        : { running: false, lastPoll: null, prCount: 0, effectiveIntervalSec: config.pollIntervalSec }
      ),
    };
  });
  res.json(result);
});

app.post('/api/accounts', (req: Request, res: Response) => {
  const body = req.body as { username?: string; hostname?: string; apiBase?: string; token?: string; label?: string; enabled?: boolean };
  const username = (body.username || '').trim().toLowerCase();
  // Accept either: { hostname } (new flow from gh-accounts picker) or { apiBase } (legacy manual form).
  let hostname: string;
  let apiBase: string;
  if (body.hostname) {
    hostname = body.hostname.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
    apiBase  = hostToApiBase(hostname);
  } else if (body.apiBase) {
    apiBase  = body.apiBase.trim();
    try { hostname = new URL(apiBase).hostname; }
    catch { res.status(400).json({ error: 'invalid apiBase URL' }); return; }
  } else {
    res.status(400).json({ error: 'hostname or apiBase is required' }); return;
  }
  if (!username) {
    res.status(400).json({ error: 'username is required' });
    return;
  }

  const cfgDir  = appDataDir();
  const cfgPath = join(cfgDir, 'config.json');
  let existing: Record<string, unknown> = {};
  if (existsSync(cfgPath)) {
    try {
      let raw = readFileSync(cfgPath, 'utf8');
      if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
      existing = JSON.parse(raw) as Record<string, unknown>;
    } catch (err) { console.warn('[config] could not read existing config before account save:', (err as Error).message); }
  }

  // Array.isArray guard above ensures the cast is safe at runtime; individual fields
  // are validated/defaulted when building newAccount below.
  const accounts: AccountConfig[] = Array.isArray(existing.accounts)
    ? (existing.accounts as AccountConfig[])
    : [];
  const idx = accounts.findIndex(a => a.id === hostname);
  const prev = idx >= 0 ? accounts[idx] : null;
  const newAccount: AccountConfig = {
    id:       hostname,
    label:    body.label?.trim() || prev?.label || hostname,
    username,
    apiBase,
    token:    body.token === '' ? '' : (body.token?.trim() || prev?.token || ''),
    enabled:  body.enabled !== undefined ? Boolean(body.enabled) : (prev?.enabled ?? true),
  };
  if (idx >= 0) accounts[idx] = newAccount;
  else accounts.push(newAccount);

  mkdirSync(cfgDir, { recursive: true });
  writeFileSync(cfgPath, JSON.stringify({ ...existing, accounts }, null, 2), 'utf8');
  reloadConfig();

  // Stop poller for this account; restart only if enabled.
  stopPolling(hostname);
  const account = config.accounts.find(a => a.id === hostname);
  if (account && account.enabled && config.mode === 'poll') startPolling(account);

  logEvent({ kind: 'account_save', hostname, isNew: !prev, enabled: newAccount.enabled });
  res.json({ ok: true });
});

app.delete('/api/accounts/:id', (req: Request, res: Response) => {
  const id = req.params.id;
  const cfgDir  = appDataDir();
  const cfgPath = join(cfgDir, 'config.json');
  let existing: Record<string, unknown> = {};
  if (existsSync(cfgPath)) {
    try {
      let raw = readFileSync(cfgPath, 'utf8');
      if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
      existing = JSON.parse(raw) as Record<string, unknown>;
    } catch (err) { console.warn('[config] could not read existing config before account delete:', (err as Error).message); }
  }
  // Array.isArray guard above; filter removes the target id before writing back.
  const accounts: AccountConfig[] = Array.isArray(existing.accounts)
    ? (existing.accounts as AccountConfig[]).filter(a => a.id !== id)
    : [];
  writeFileSync(cfgPath, JSON.stringify({ ...existing, accounts }, null, 2), 'utf8');
  stopPolling(id);
  reloadConfig();
  logEvent({ kind: 'account_removed', id });
  res.json({ ok: true });
});

app.get('/api/status', (_req: Request, res: Response) => {
  const accounts = config.accounts.map(a => ({
    id:       a.id,
    label:    a.label,
    username: a.username,
    ...getPollerStatus(a.id)
  }));
  res.json({
    configured: config.configured,
    accounts,
    version: '0.2.0'
  });
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true, mode: MODE, accounts: config.accounts.length });
});

app.post('/api/test-notification', (_req: Request, res: Response) => {
  const account = config.accounts[0];
  try {
    notify({
      title: 'Ghent',
      message: account
        ? `Test notification - watching ${account.id} as ${account.username}`
        : 'Test notification - no accounts configured yet',
      url: `http://localhost:${PORT}/`,
    });
    res.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[test-notification] failed:', msg);
    res.status(500).json({ ok: false, error: msg });
  }
});

app.post('/webhook', (req: Request, res: Response) => {
  const signature = (req.header('X-Hub-Signature-256') || '');
  const event = req.header('X-GitHub-Event') || 'unknown';
  const delivery = req.header('X-GitHub-Delivery') || '';
  const raw: Buffer = req.body as Buffer;

  if (!verifySignature(raw, signature, config.webhookSecret)) {
    console.warn(`[webhook] bad signature for delivery ${delivery}`);
    res.status(401).send('bad signature');
    return;
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(raw.toString('utf8')) as WebhookPayload;
  } catch {
    res.status(400).send('bad json');
    return;
  }

  // Always 200 fast — process async so GHE doesn't retry on slow toasts.
  res.status(200).send('ok');
  setImmediate(() => handleEvent(event, payload, delivery));
});

function verifySignature(rawBody: Buffer, signature: string, secret: string): boolean {
  if (!signature.startsWith('sha256=')) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Returns an envelope describing whether/how to notify, or null to skip.
export function classify(event: string, payload: WebhookPayload, me: string = config.accounts[0]?.username ?? ''): Classified | null {
  const action = payload.action;
  let pr: GhePrLike | null = null;
  let commentLike: GheCommentLike | GheReviewLike | null = null;
  let kind: Classified['kind'] | null = null;

  if (event === 'issue_comment' && action === 'created' && payload.issue?.pull_request && payload.comment) {
    pr = payload.issue;
    commentLike = payload.comment;
    kind = 'issue_comment';
  } else if (event === 'pull_request_review_comment' && action === 'created' && payload.pull_request && payload.comment) {
    pr = payload.pull_request;
    commentLike = payload.comment;
    kind = 'review_comment';
  } else if (event === 'pull_request_review' && action === 'submitted' && payload.pull_request && payload.review) {
    pr = payload.pull_request;
    commentLike = payload.review;
    kind = 'review';
  } else {
    return null;
  }

  const author = (pr.user?.login || '').toLowerCase();
  const commenter = (commentLike.user?.login || '').toLowerCase();
  const body = commentLike.body || '';
  const mentioned = new RegExp(`@${escapeRegExp(me)}\\b`, 'i').test(body);
  const isMyPr = author === me;

  if (commenter === me) return null;
  if (!isMyPr && !mentioned) return null;

  const reason: Classified['reason'] = isMyPr && mentioned ? 'my-pr+mention'
    : isMyPr ? 'my-pr'
    : 'mention';

  const repo = pr.repository_url
    ? pr.repository_url.replace(/.*\/repos\//, '')
    : (payload.repository?.full_name || '');

  return {
    kind: kind!,
    reason,
    repo,
    prNumber: pr.number,
    prTitle: pr.title,
    commenter,
    body: body.slice(0, 200),
    url: commentLike.html_url || pr.html_url
  };
}

function handleEvent(event: string, payload: WebhookPayload, delivery: string): void {
  try {
    const c = classify(event, payload);
    if (!c) {
      logEvent({ kind: 'skip', event, action: payload.action, delivery });
      return;
    }
    logEvent({
      delivery, event, ...c,
      payloadSummary: {
        repo: payload.repository?.full_name,
        sender: payload.sender?.login,
        action: payload.action
      }
    });

    notify({
      title: `${c.commenter} on ${c.repo}#${c.prNumber}`,
      message: `${c.prTitle}\n${c.body}`,
      url: c.url
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[webhook] handler error:', msg);
    logEvent({ kind: 'error', error: msg, delivery });
  }
}

// ── Process robustness ────────────────────────────────────────────────────

process.on('uncaughtException', (err) => {
  console.error('[fatal] uncaughtException:', err.message, err.stack);
  logEvent({ kind: 'fatal', error: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  console.error('[fatal] unhandledRejection:', msg);
  logEvent({ kind: 'fatal', error: msg });
  // Don't exit — unhandled rejections from poller ticks shouldn't kill the server.
});

// Always bind — serves the web UI in all modes, including unconfigured.
const server = app.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}/`;
  console.log(`[server] Ghent v${VERSION} - UI at ${url}`);
  console.log(`[server] mode=${MODE} accounts=${config.accounts.length} dataDir=${config.dataDir}`);
  if (MODE === 'webhook') console.log(`[webhook] endpoint: http://localhost:${PORT}/webhook`);
  logEvent({ kind: 'startup', version: VERSION, mode: MODE, port: PORT, accounts: config.accounts.map(a => a.id) });

  // First launch: auto-open the config UI so the user doesn't stare at a console.
  if (!config.configured) {
    console.log(`[server] No accounts configured — opening ${url} in your browser...`);
    import('node:child_process').then(({ exec }) => {
      exec(`start "" "${url}"`, (err) => {
        if (err) console.log('[server] Could not auto-open browser. Please open the URL above manually.');
      });
    });
  }
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[server] port ${PORT} already in use — is another instance running? Check Task Scheduler or kill PID with: Get-NetTCPConnection -LocalPort ${PORT} | Select-Object OwningProcess`);
    logEvent({ kind: 'startup_error', error: `EADDRINUSE: port ${PORT}` });
    process.exit(1);
  }
  console.error('[server] listen error:', err.message);
  process.exit(1);
});

function gracefulShutdown(signal: string): void {
  console.log(`[server] ${signal} — stopping pollers and closing HTTP server`);
  logEvent({ kind: 'shutdown', signal });
  stopPolling();
  server.close(() => {
    console.log('[server] clean shutdown');
    process.exit(0);
  });
  // Force exit if close takes too long.
  setTimeout(() => { console.error('[server] shutdown timeout — forcing exit'); process.exit(1); }, 8000).unref();
}

process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.once('SIGINT',  () => gracefulShutdown('SIGINT'));

