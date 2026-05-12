# ghe-pr-notifier — Sub-constitution

Inherits from: [docs/methodology/CONSTITUTION.md](../../docs/methodology/CONSTITUTION.md)

Delta-only — omitted sections fall through to the global baseline.

---

## Overrides / relaxations / N/A

| Global HC | Status | Justification |
|---|---|---|
| `[HC-BROWSER-EVIDENCE]` | Relaxed → Emerging | Windows desktop app; no browser test harness. UI evidence is toast screenshots captured manually and noted in the commit description. |
| `[HC-KQL-VALIDATED]` | N/A | No KQL in this project. |
| `[HC-SAFE-SIDE-EFFECTS]` | N/A | No external state mutations beyond GHE read-only API calls. Windows Task Scheduler registration via WiX MSI is system-local and idempotent (reinstall is safe). |

---

## Project-specific HCs

- **`[HC-GHENT-POLL-COVERAGE]` Search queries use paginated fetching.** All `/search/issues` calls in `src/poller.ts` use `paginateSearch()`, not single-page `client.get()`. No result cap below the API maximum of 1 000. The probe: *"would a user with 150 open PRs silently miss notifications?"*
  Verified: `grep -c "paginateSearch" src/poller.ts` must be ≥ 3 (author + mention + review-requested). Automated: N — manual grep. Gap: wire to a lint step.

- **`[HC-GHENT-COMMENT-WINDOW]` Comments on newly-detected PRs are not silently dropped.** New PRs (first seen after seeding) are fetched without `?since` filter; old comments (created before `lastPollTime`) are excluded by `created_at` timestamp guard, mirroring the existing review `submitted_at` guard. The probe: *"if a PR was missed last poll and already has comments, do they surface on next detection?"*
  Verified: no `sinceSuffix` variable in `src/poller.ts`; `created_at` timestamp guard is present in both issue_comment and review_comment emit loops. Automated: N.

- **`[HC-GHENT-STATE-RESILIENCE]` State file parse failures fall back to defaults without crash.** `loadState()` wraps `JSON.parse` in a try/catch that returns empty defaults and logs a warning. The poller continues. The probe: *"if the state file is truncated or corrupted, does the daemon crash at startup?"*
  Verified: `loadState()` in `src/poller.ts` — catch block returns `defaults` and calls `console.warn`. Automated: N.

- **`[HC-GHENT-TOKEN-VISIBLE]` Token failures surface as user-visible events.** Any auth failure from `resolveToken()` must reach the toast notifier or `logEvent()` within 2 poll cycles. Silent auth gaps cause invisible notification voids. The probe: *"if the GHE token expires overnight, how does the user find out?"*
  Verified: poll error paths call `console.warn`; logEvent + toast planned for future polish. Automated: N. Gap: open.

- **`[HC-GHENT-RATE-HEADROOM]` API calls stay within 80 % of GHE rate limit.** `minSafeIntervalSec()` enforces the floor. Any new call added to the per-poll loop must increment `CALLS_PER_PR` or `SEARCHES_PER_POLL`. The probe: *"if the user adds a fifth account, does the poller stay within rate limits?"*
  Verified: code review — check constants match actual call count per loop iteration. Automated: N.

---

## Verification chain

Run in order after any change to `src/`:

```powershell
cd projects/ghe-pr-notifier
npx tsc --noEmit
npm run build
```

1. `npx tsc --noEmit` — must exit 0.
2. `npm run build` — must produce `build/bundle/server.cjs` without error.
3. If `src/poller.ts` was changed: `grep -c "paginateSearch" src/poller.ts` must be ≥ 3.

---

## Self-hardening rule (project-local)

Any bug fixed in this project must:

1. Append a row to `docs/methodology/known-symptoms.md` before the commit ships.
2. If the bug reveals an HC gap — no existing HC would have caught it — route to `/constitute` and add the HC to this file before the next commit.
3. Update the verification chain above if a new automated check is now possible.

This rule is what makes the loop self-learning: each fix tightens the gates so the same class of bug is caught automatically next time.
