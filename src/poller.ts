// Polling fallback. Hits GHE search API for PRs you authored, then walks
// new comments on each since the last check. Persists per-PR last-seen
// comment IDs in <dataDir>/poller-state.json.
//
// On first run (no state file), the poller seeds last-seen IDs to current
// max values WITHOUT toasting, so you only get notified on things that
// arrive after startup.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createGheClient, type GheClient } from './ghe-client.js';
import { notify } from './notifier.js';
import { logEvent } from './logger.js';
import { config, DEFAULT_NOTIF_FLAGS, type AccountConfig, type NotifFlags } from './config.js';

// Per-account poller handles, keyed by account.id (hostname).
interface PollerHandle {
  timer: ReturnType<typeof setTimeout> | null;
  lastPoll: Date | null;
  running: boolean;
  prCount: number;
  effectiveIntervalSec: number; // may be higher than config.pollIntervalSec due to rate-limit floor
}
const _pollers = new Map<string, PollerHandle>();

export function getPollerStatus(accountId: string): { running: boolean; lastPoll: Date | null; prCount: number; effectiveIntervalSec: number } {
  const h = _pollers.get(accountId);
  return { running: h?.running ?? false, lastPoll: h?.lastPoll ?? null, prCount: h?.prCount ?? 0, effectiveIntervalSec: h?.effectiveIntervalSec ?? config.pollIntervalSec };
}

// GHE REST API rate limit: 5 000 req/hr; stay within 80% headroom.
const GHE_SAFE_PER_HOUR = Math.floor(5000 * 0.80);
const SEARCHES_PER_POLL  = 3;   // author + mentions + review-requested
const CALLS_PER_PR       = 3;   // issue_comments + pull_comments + reviews
function minSafeIntervalSec(activePrs: number): number {
  const calls = activePrs * CALLS_PER_PR + SEARCHES_PER_POLL;
  return Math.max(30, Math.ceil(calls * 3600 / GHE_SAFE_PER_HOUR));
}

export function stopPolling(accountId?: string): void {
  if (accountId) {
    const h = _pollers.get(accountId);
    if (h) { if (h.timer) clearInterval(h.timer); h.timer = null; h.running = false; }
    return;
  }
  for (const [id, h] of _pollers) {
    if (h.timer) clearInterval(h.timer);
    _pollers.delete(id);
  }
}

interface PrState {
  lastCommentId: number;
  lastReviewId: number;
  lastReviewCommentId: number;
  updatedAt?: string; // ISO `updated_at` from search — skip fetch if unchanged
}

interface PollerState {
  prs: Record<string, PrState>;            // my authored PRs
  reviewRequestedKeys: Record<string, true>; // keys where review was requested of me
  mentionsSince: string | null;
  seeded: boolean;
  lastPollTime: string | null;
}

interface GheUser { login: string }
// created_at used to filter old comments on newly-detected PRs (mirrors review submitted_at guard)
interface GheComment { id: number; user: GheUser; body: string; html_url: string; created_at?: string }
interface GheReview { id: number; user: GheUser; body: string | null; state: string; html_url: string; submitted_at?: string }
interface GhePr { merged: boolean; state: string; title: string; html_url: string; user: GheUser }
interface GheSearchItem {
  number: number;
  title: string;
  repository_url: string;
  html_url: string;
  user: GheUser;
  pull_request?: unknown;
  updated_at: string; // used to skip unchanged PRs
}

interface EmitArgs {
  kind: 'issue_comment' | 'review_comment' | 'approved' | 'changes_requested'
      | 'review_commented' | 'mention' | 'merged' | 'closed' | 'review_requested';
  repo: string;
  num: number;
  prTitle: string;
  commenter: string;
  body: string | null;
  url: string;
  reason: 'my-pr' | 'mention';
}

// Map each emit kind to its notifFlags key so new kinds never need emit() changes.
const FLAG_MAP: Record<EmitArgs['kind'], keyof NotifFlags> = {
  issue_comment:      'onComment',
  review_comment:     'onReviewComment',
  approved:           'onApproved',
  changes_requested:  'onChangesRequested',
  review_commented:   'onReviewCommented',
  mention:            'onMention',
  merged:             'onMerged',
  closed:             'onClosed',
  review_requested:   'onReviewRequested',
};

// Concurrency limiter — run at most `limit` tasks simultaneously.
async function runConcurrent<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<void> {
  let i = 0;
  const worker = async () => { while (i < tasks.length) { const idx = i++; try { await tasks[idx](); } catch { /* per-task errors handled inside */ } } };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
}

function statePath(accountId: string): string {
  const newPath = join(config.dataDir, `poller-state-${accountId}.json`);
  const oldPath = join(config.dataDir, 'poller-state.json');
  // Migrate: use old file for the first account if new one doesn't exist yet.
  if (!existsSync(newPath) && existsSync(oldPath)) return oldPath;
  return newPath;
}

function loadState(accountId: string): PollerState {
  const p = statePath(accountId);
  const defaults: PollerState = { prs: {}, reviewRequestedKeys: {}, mentionsSince: null, seeded: false, lastPollTime: null };
  if (!existsSync(p)) return defaults;
  try { return { ...defaults, ...JSON.parse(readFileSync(p, 'utf8')) as Partial<PollerState> }; }
  catch (err) { console.warn(`[poll] could not parse state at ${p}:`, (err as Error).message); return defaults; }
}

function saveState(accountId: string, s: PollerState): void {
  writeFileSync(statePath(accountId), JSON.stringify(s, null, 2));
}

async function pollOnce(account: AccountConfig, client: GheClient, state: PollerState): Promise<{ activePrs: number }> {
  const seeding = !state.seeded;
  const ME = account.username;
  const flags = { ...DEFAULT_NOTIF_FLAGS, ...config.notifFlags };
  const pollStartTime = new Date().toISOString();
  let activePrCount = 0;

  // ── 1. My open PRs — paginated so users with >100 open PRs get full coverage ——
  const items = await client.paginateSearch<GheSearchItem>(
    `/search/issues?q=${encodeURIComponent(`is:pr is:open author:${ME}`)}`
  );
  const currentKeys = new Set(items.map(i => `${i.repository_url.replace(/.*\/repos\//, '')}#${i.number}`));

  // ── 2. Detect merged/closed (was in state, no longer open) —————————
  if (!seeding && (flags.onMerged || flags.onClosed)) {
    const gone = Object.keys(state.prs).filter(k => !currentKeys.has(k));
    await runConcurrent(gone.map(key => async () => {
      const slash = key.lastIndexOf('#');
      const repo = key.slice(0, slash);
      const num  = parseInt(key.slice(slash + 1), 10);
      try {
        const pr = await client.get<GhePr>(`/repos/${repo}/pulls/${num}`);
        if (pr.merged && flags.onMerged) {
          emit(flags, { kind: 'merged', repo, num, prTitle: pr.title, commenter: pr.user.login, body: null, url: pr.html_url, reason: 'my-pr' });
        } else if (pr.state === 'closed' && !pr.merged && flags.onClosed) {
          emit(flags, { kind: 'closed', repo, num, prTitle: pr.title, commenter: pr.user.login, body: null, url: pr.html_url, reason: 'my-pr' });
        }
        delete state.prs[key]; // stop tracking
      } catch (err) { console.warn(`[poll] merged-check ${key}: ${(err as Error).message}`); }
    }), 6);
  }

  // ── 3. Per-PR activity — parallel (6 PRs concurrently, 3 calls each = 18 in-flight)
  //    Skip PRs whose updated_at is unchanged since last poll — huge win for 50-100 PRs.
  await runConcurrent(items.map(issue => async () => {
    const repo = issue.repository_url.replace(/.*\/repos\//, '');
    const num  = issue.number;
    const key  = `${repo}#${num}`;
    const isNew = !state.prs[key];
    const last: PrState = state.prs[key] || { lastCommentId: 0, lastReviewId: 0, lastReviewCommentId: 0 };

    // Skip if nothing changed since last poll (updated_at is bumped on any activity)
    if (!isNew && last.updatedAt && last.updatedAt === issue.updated_at) return;
    activePrCount++; // this PR is active — will make 3 API calls

    try {
      // Fetch all comments — no ?since filter. For new PRs, we filter by created_at below
      // (mirrors the review submitted_at guard) to avoid spamming pre-detection comments
      // while still catching any that a ?since=lastPollTime cut-off would have dropped.
      const [issueComments, reviewComments, reviews] = await Promise.all([
        client.paginate<GheComment>(`/repos/${repo}/issues/${num}/comments`),
        client.paginate<GheComment>(`/repos/${repo}/pulls/${num}/comments`),
        client.paginate<GheReview>(`/repos/${repo}/pulls/${num}/reviews`),
      ]);

      for (const c of issueComments) {
        if (c.id <= last.lastCommentId) continue;
        if ((c.user?.login || '').toLowerCase() === ME) continue;
        // On first detection post-seeding, skip comments that predate this poll window
        if (isNew && state.lastPollTime && c.created_at && c.created_at <= state.lastPollTime) continue;
        if (!seeding) emit(flags, { kind: 'issue_comment', repo, num, prTitle: issue.title, commenter: c.user.login, body: c.body, url: c.html_url, reason: 'my-pr' });
      }
      if (issueComments.length) last.lastCommentId = Math.max(last.lastCommentId, ...issueComments.map(c => c.id));

      for (const c of reviewComments) {
        if (c.id <= last.lastReviewCommentId) continue;
        if ((c.user?.login || '').toLowerCase() === ME) continue;
        if (isNew && state.lastPollTime && c.created_at && c.created_at <= state.lastPollTime) continue;
        if (!seeding) emit(flags, { kind: 'review_comment', repo, num, prTitle: issue.title, commenter: c.user.login, body: c.body, url: c.html_url, reason: 'my-pr' });
      }
      if (reviewComments.length) last.lastReviewCommentId = Math.max(last.lastReviewCommentId, ...reviewComments.map(c => c.id));

      for (const r of reviews) {
        if (r.id <= last.lastReviewId) continue;
        if ((r.user?.login || '').toLowerCase() === ME) continue;
        if (isNew && state.lastPollTime && r.submitted_at && r.submitted_at <= state.lastPollTime) continue;
        let kind: EmitArgs['kind'];
        if      (r.state === 'APPROVED')           kind = 'approved';
        else if (r.state === 'CHANGES_REQUESTED')  kind = 'changes_requested';
        else if (r.state === 'COMMENTED' && r.body) kind = 'review_commented';
        else continue;
        if (!seeding) emit(flags, { kind, repo, num, prTitle: issue.title, commenter: r.user.login, body: r.body || `(${r.state})`, url: r.html_url, reason: 'my-pr' });
      }
      if (reviews.length) last.lastReviewId = Math.max(last.lastReviewId, ...reviews.map(r => r.id));

      last.updatedAt = issue.updated_at; // record so next poll can skip if unchanged
      state.prs[key] = last;
    } catch (err) {
      console.warn(`[poll] ${key}: ${(err as Error).message}`);
    }
  }), 6);

  // ── 4. @mentions on PRs I didn't author — paginated so heavy-mention users get full coverage
  if (flags.onMention) {
    try {
      const since = state.mentionsSince || state.lastPollTime || new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const mentionItems = await client.paginateSearch<GheSearchItem>(
        `/search/issues?q=${encodeURIComponent(`mentions:${ME} updated:>${since}`)}`
      );
      for (const m of mentionItems) {
        if (!m.pull_request) continue;
        const repo = m.repository_url.replace(/.*\/repos\//, '');
        if (state.prs[`${repo}#${m.number}`]) continue; // my PR, skip
        if (!seeding) emit(flags, { kind: 'mention', repo, num: m.number, prTitle: m.title, commenter: m.user.login, body: '(you were @mentioned)', url: m.html_url, reason: 'mention' });
      }
      state.mentionsSince = new Date().toISOString();
    } catch (err) { console.warn(`[poll] mentions: ${(err as Error).message}`); }
  }

  // ── 5. Review-requested: PRs where someone asked me to review — paginated ———
  if (flags.onReviewRequested) {
    try {
      const rrItems = await client.paginateSearch<GheSearchItem>(
        `/search/issues?q=${encodeURIComponent(`is:pr is:open review-requested:${ME}`)}`
      );
      const currentRR = new Set<string>();
      for (const rr of rrItems) {
        if (!rr.pull_request) continue;
        const repo = rr.repository_url.replace(/.*\/repos\//, '');
        const key  = `${repo}#${rr.number}`;
        currentRR.add(key);
        if (state.prs[key]) continue; // my PR, skip
        if (state.reviewRequestedKeys[key]) continue; // already notified
        if (!seeding) emit(flags, { kind: 'review_requested', repo, num: rr.number, prTitle: rr.title, commenter: rr.user.login, body: null, url: rr.html_url, reason: 'mention' });
        state.reviewRequestedKeys[key] = true;
      }
      // Prune resolved review requests so we’d re-fire if the PR is re-opened
      for (const k of Object.keys(state.reviewRequestedKeys)) {
        if (!currentRR.has(k)) delete state.reviewRequestedKeys[k];
      }
    } catch (err) { console.warn(`[poll] review-requested: ${(err as Error).message}`); }
  }

  if (seeding) {
    state.seeded = true;
    console.log(`[poll:${account.id}] seeded ${Object.keys(state.prs).length} PRs; future activity will toast`);
  }
  state.lastPollTime = pollStartTime;
  saveState(account.id, state);
  return { activePrs: activePrCount };
}

// Per-PR last-toast timestamp (ms). In-memory only — resets on restart, which is fine.
const _lastNotifAt = new Map<string, number>();

// Human-readable action string for each event kind.
function kindAction(kind: EmitArgs['kind']): string {
  switch (kind) {
    case 'approved':          return '\u2713 approved your PR';
    case 'changes_requested': return '\u2717 requested changes';
    case 'review_commented':  return 'reviewed your PR';
    case 'review_comment':    return 'left an inline comment';
    case 'merged':            return 'PR merged';
    case 'closed':            return 'PR closed';
    case 'review_requested':  return 'requested your review';
    case 'mention':           return '@mentioned you';
    default:                  return 'commented on your PR';
  }
}

function renderTemplate(tmpl: string, vars: Record<string, string>): string {
  return tmpl.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
}

function emit(flags: Record<string, boolean>, ev: EmitArgs): void {
  if (!flags[FLAG_MAP[ev.kind]]) return;

  const key = `${ev.repo}#${ev.num}`;
  const cooldownMs = (config.notifCooldownSec ?? 0) * 1000;
  const now = Date.now();
  const last = _lastNotifAt.get(key) ?? 0;
  const suppressed = cooldownMs > 0 && (now - last) < cooldownMs;
  logEvent({ source: 'poll', suppressed: suppressed || undefined, ...ev });
  if (suppressed) return;
  _lastNotifAt.set(key, now);

  const repoName = ev.repo.includes('/') ? ev.repo.split('/').pop()! : ev.repo;
  const vars: Record<string, string> = {
    commenter: ev.commenter,
    action:    kindAction(ev.kind),
    repo:      ev.repo,
    repo_name: repoName,
    num:       String(ev.num),
    prTitle:   ev.prTitle,
    body:      (ev.body || '').slice(0, 200),
  };
  notify({
    title:   renderTemplate(config.toastTitleTemplate, vars),
    message: renderTemplate(config.toastBodyTemplate, vars),
    url:     ev.url
  });
}

export function startPolling(account: AccountConfig): void {
  if (_pollers.get(account.id)?.running) return; // idempotent
  const handle: PollerHandle = { timer: null, lastPoll: null, running: true, prCount: 0, effectiveIntervalSec: config.pollIntervalSec };
  _pollers.set(account.id, handle);
  const client = createGheClient(account);
  console.log(`[poll:${account.id}] starting, interval=${config.pollIntervalSec}s, user=${account.username}`);
  const state = loadState(account.id);

  const schedule = () => {
    if (!handle.running) return;
    handle.timer = setTimeout(tick, handle.effectiveIntervalSec * 1000);
  };

  const tick = async () => {
    try {
      const { activePrs } = await pollOnce(account, client, state);
      handle.lastPoll = new Date();
      handle.prCount = Object.keys(state.prs).length;

      // Compute the minimum safe interval for the observed activity level.
      const floor = minSafeIntervalSec(activePrs);
      const effective = Math.max(config.pollIntervalSec, floor);
      if (effective !== handle.effectiveIntervalSec) {
        if (effective > config.pollIntervalSec) {
          console.warn(`[poll:${account.id}] ${activePrs} active PRs \u2014 rate-limit floor raised to ${effective}s (config: ${config.pollIntervalSec}s)`);
        } else {
          console.log(`[poll:${account.id}] rate-limit floor lifted, interval restored to ${effective}s`);
        }
        handle.effectiveIntervalSec = effective;
      }
    } catch (err) {
      const e = err as Error & { cause?: { code?: string; message?: string } };
      const cause = e.cause ? ` cause=${e.cause.code || ''} ${e.cause.message || ''}` : '';
      console.error(`[poll:${account.id}] error:`, e.message, cause);
      logEvent({ kind: 'error', source: 'poll', accountId: account.id, error: e.message, cause });
    }
    schedule();
  };

  tick(); // run immediately, then self-schedule
}
