# Copilot Instructions for Ghent

## What is Ghent

Windows desktop notifier for GitHub Enterprise PR activity. Polls the GHE REST API (or receives webhooks) for comments, reviews, merges, and @mentions on PRs you authored, then fires clickable Windows toast notifications via PowerShell WinRT. Runs as a Windows scheduled task. Config is managed through a web UI at `http://localhost:9420/`.

## Build & Run

```powershell
npm run start          # run server directly via tsx
npm run dev            # start via Windows Task Scheduler (task must exist)
npm run typecheck      # tsc --noEmit — the primary lint/check step
npm test               # vitest unit + integration tests
npm run test:coverage  # vitest with v8 coverage report
npm run build          # tsc — emits to dist/
npm run bundle         # esbuild single-file CJS bundle → build/bundle/server.cjs
npm run msi            # WiX 7 MSI installer → dist/Ghent-<version>.msi
npm run deploy         # bundle + copy to "C:\Program Files\Ghent\" + bounce task
npm run test-toast     # smoke test: fires a test Windows toast notification
```

The verification chain after changes to `src/` is:

```powershell
npx tsc --noEmit       # must exit 0
npm test               # must exit 0
npm run bundle         # must produce build/bundle/server.cjs
```

If `src/poller.ts` was changed: `grep -c "paginateSearch" src/poller.ts` must be ≥ 3 (author + mention + review-requested searches must all use paginated fetching).

## Architecture

**Entry point:** `src/server.ts` — Express server that boots pollers, serves the web UI, and handles webhooks.

**Core flow (poll mode):**
1. `server.ts` starts a `poller.ts` instance per enabled account
2. `poller.ts` calls `ghe-client.ts` to hit GHE search/REST APIs for open PRs, comments, reviews, and @mentions
3. New activity is emitted through `notifier.ts` (WinRT toast via PowerShell) and `logger.ts` (append-only JSONL)

**Key modules:**
- `config.ts` — loads/saves `%LOCALAPPDATA%\Ghent\config.json`, handles legacy single-account → multi-account migration. Config is the singleton `config` export, mutated in-place by `reloadConfig()`.
- `ghe-client.ts` — thin GHE REST client. Token resolution: tries `gh auth token` first, falls back to stored PAT. Retries transient errors (5xx, ECONNRESET, etc.) up to 3 times.
- `poller.ts` — per-account polling loop. Persists per-PR last-seen comment/review IDs in `poller-state-<accountId>.json`. First run "seeds" without toasting. Skips unchanged PRs (by `updated_at`). Rate-limit floor auto-scales based on active PR count.
- `notifier.ts` — fires Windows toasts using PowerShell WinRT `ToastNotificationManager` (not SnoreToast). Uses `activationType="protocol"` so clicks work from Action Center even after the banner times out.
- `ui.ts` — self-contained HTML/CSS/JS for the config web UI, exported as a string constant so esbuild can inline it into the bundle.
- `logger.ts` — append-only JSONL event log with 5 MB rotation. Also patches `console.*` to prepend ISO timestamps.

**Bundle/deploy:** esbuild bundles all TS into a single `server.cjs`. `node-notifier` is externalized (loads vendor binaries at runtime). Production runs from `build/bundle/` with a portable Node 22 runtime.

## Evidence-Driven Development

This project follows Evidence-Driven Development. The constitution at `docs/methodology/CONSTITUTION.md` is the canonical source of truth for quality bars, the Implementation Loop, and the amendment path.

Read `docs/methodology/CONSTITUTION.md` for:
- The 10-step Implementation Loop
- Evidence acceptance criteria by change type
- HC (Health Check) slugs and their verification paths
- The trivial carve-out definition (typos, dep-bumps, single-line changes skip to implement → verify → ship)

Project-specific HCs are in `CONSTITUTION.md` at the repo root. Any bug fix must append to `docs/methodology/known-symptoms.md` and, if no existing HC would have caught it, add a new HC to CONSTITUTION.md.

## Key Conventions

- **ESM source, CJS bundle.** Source uses ESM (`"type": "module"` in package.json, `.js` extension in imports). The production bundle is CJS via esbuild. Always use `.js` extensions in import paths.
- **No test framework.** Verification is `tsc --noEmit` + successful bundle build. Manual smoke test via `npm run test-toast`.
- **Config is a mutable singleton.** `config` is exported from `config.ts` and mutated in-place by `reloadConfig()`. Don't destructure it at module level if you need live values.
- **Token resolution is per-request.** `ghe-client.ts` calls `gh auth token` on every API request so token refreshes are transparent without restarting.
- **Pagination is mandatory.** All GHE search calls must use `paginateSearch()`, not single-page `client.get()`. All list endpoints use `paginate()`. This is enforced by `[HC-GHENT-POLL-COVERAGE]` in CONSTITUTION.md.
- **Seeding guard.** On first run (or after state reset), the poller seeds last-seen IDs without firing toasts. New PRs detected post-seeding filter old comments by `created_at` timestamp.
- **Per-PR cooldown.** Toast spam is prevented by an in-memory per-PR cooldown (`notifCooldownSec`, default 180s). Suppressed events are still logged with `"suppressed": true`.
- **Web UI is inlined.** The UI in `ui.ts` is a single exported template literal. Changes to the UI mean editing that string directly.
- **CONSTITUTION.md contains project-specific health checks (HCs).** See the Evidence-Driven Development section above for the bug-fix protocol.
