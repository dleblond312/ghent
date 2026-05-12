# Ghent Constitution

## Goal

Ghent is a public Windows desktop notifier for GitHub Enterprise pull request activity. The project exists to deliver reliable, low-noise notifications for comments, reviews, merges, and mentions on pull requests relevant to the configured user accounts.

This constitution defines the minimum engineering bar for changes to this repository and is intentionally repo-local.

---

## Context

- Ghent is developed in the open and must be safe to publish in full.
- The codebase is TypeScript-first, bundles to a single Node-based server, and runs as a Windows scheduled task or webhook receiver.
- Verification is local-first. The automated test suite (`npm test`) is the first line of defense; each change must carry direct evidence appropriate to its risk.
- Public documentation and repository history are part of the product surface. Repo instructions must match what actually exists here.

---

## Hard Constraints

Stable `[slug]` IDs survive reorders and are used when discussing amendments or bug-fix follow-up.

- **`[HC-NO-SECRETS]` Credentials never live in the repo.** No API keys, tokens, passwords, webhook secrets, or connection strings in tracked source, config, screenshots, logs, or examples. The probe: *"if this repository were mirrored publicly right now, what secret would leak?"*
  Verified: repository review for obvious secret material before shipping changes that touch auth, config, logging, docs, or examples.

- **`[HC-ERRORS-SURFACED]` Errors must be visible, not swallowed.** Async failures must be logged with context, returned to the caller, or rethrown with useful detail. Silent `.catch(() => {})` and equivalent suppression are forbidden. The probe: *"how would an operator know this failed overnight?"*
  Verified: code review of touched error paths and executable verification when available.

- **`[HC-SAFE-SIDE-EFFECTS]` Stateful operations need a safe verification path.** Any change that mutates system state, registers hooks, writes config, or triggers notifications must have a way to verify intent without accidental damage, such as an idempotent flow, a dry-run mode, a targeted smoke test, or a clearly reversible local action. The probe: *"what happens if this runs twice or against the wrong target?"*
  Verified: command review plus the narrowest available smoke check for the touched path.

- **`[HC-DOCS-MATCH-REPO]` Repository instructions must describe the real repo.** Top-level docs and constitutions may not reference absent folders, inherited private-workspace rules, or tools that this repo does not use. The probe: *"would a new contributor be sent to a file, command, or process that does not exist here?"*
  Verified: direct doc review of touched instructions and paths.

---

## Emerging Quality Dimensions

These are active review lenses for the current codebase. They are not generic portfolio rules; they exist because they matter to Ghent's behavior.

### TypeScript / runtime integrity

- **`[HC-TYPES-HONEST]` Types must describe the runtime truth.** Avoid `any` in TypeScript source. Use `unknown` and narrowing at I/O boundaries. Casts should be rare and local. The probe: *"what breaks if the GitHub API or persisted config shape changes?"*
  Verified: `npm run typecheck`.

- **`[HC-IDEMPOTENT-LOCAL-OPS]` Local setup and deployment flows should be safe to re-run.** Scripts for install, deploy, bundle, and task registration should converge instead of duplicating or corrupting local state. The probe: *"if setup is interrupted, can the operator run it again safely?"*
  Verified: script review and targeted manual execution when those scripts are touched.

### UI and notification surface

- **`[HC-USER-VISIBLE-EVIDENCE]` User-visible changes require user-visible evidence.** Changes to the config UI, toast format, or notification flow should include a screenshot, smoke test, or equivalent direct artifact. The probe: *"what did the user-facing surface actually look like after this change?"*
  Verified: manual evidence capture when the UI or toast payload changes.

- **`[HC-NO-SENSITIVE-LOGGING]` Logs and notifications must not leak sensitive content unnecessarily.** Avoid logging tokens, raw secrets, or excessive user content when a narrower summary is enough. The probe: *"would the task log or event log expose data a contributor should not see?"*
  Verified: review of touched logging and notification code.

### Evidence integrity

- **`[HC-EVIDENCE-INTEGRITY]` Verification claims must be backed by direct artifacts.** When a change claims behavior is fixed or preserved, the accompanying command output, screenshot, or smoke result must support that claim. The probe: *"would a skeptical reviewer accept this evidence without private context?"*
  Verified: human review of the supplied verification artifacts.

---

## Project-Specific HCs

- **`[HC-GHENT-POLL-COVERAGE]` Search queries use paginated fetching.** All `/search/issues` calls in `src/poller.ts` use `paginateSearch()`, not single-page `client.get()`. No result cap below the API maximum of 1,000. The probe: *"would a user with many open PRs silently miss notifications?"*
  Verified: `grep -c "paginateSearch" src/poller.ts` must be greater than or equal to 3 when `src/poller.ts` changes.

- **`[HC-GHENT-COMMENT-WINDOW]` Comments on newly detected PRs are not silently dropped.** New PRs found after seeding must fetch comments without a `since` filter, then exclude stale comments with timestamp guards instead of suppressing the entire window. The probe: *"if a PR was missed last poll and already has comments, do those comments still surface on detection?"*
  Verified: code review of comment fetch and emit guards in `src/poller.ts`.

- **`[HC-GHENT-STATE-RESILIENCE]` State corruption must not crash the poller.** State file parse failures fall back to defaults, log a warning, and let the daemon continue. The probe: *"if the persisted state file is truncated, does startup recover without operator intervention?"*
  Verified: code review of `loadState()` in `src/poller.ts`.

- **`[HC-GHENT-TOKEN-VISIBLE]` Token failures must become visible operator signals.** Authentication failures from token resolution or API requests must show up in logs, surfaced errors, or notifications quickly enough that the user understands why polling stopped working. The probe: *"if the token expires overnight, how does the operator find out?"*
  Verified: review of auth and poll error paths. Gap: stronger user-visible signaling is still desirable.

- **`[HC-GHENT-RATE-HEADROOM]` Polling logic must preserve rate-limit headroom.** Changes to the per-poll request pattern must keep the call model aligned with `minSafeIntervalSec()` and related constants. The probe: *"if more accounts or repositories are added, does polling remain comfortably under rate limits?"*
  Verified: code review of request-count assumptions when poller behavior changes; `npm test` covers rate-limit floor calculations.

- **`[HC-GHENT-TEST-COVERAGE]` Critical paths must have automated test coverage.** Changes to config loading, webhook classify, signature verification, GHE client retry/pagination, poller state management, or notification formatting must be exercised by `npm test`. The probe: *"would a regression in this code path be caught before shipping?"*
  Verified: `npm test` must pass; new logic paths should have corresponding test cases.

---

## Evidence Acceptance Criteria

Evidence form depends on the change type. When a change touches behavior, use the narrowest artifact that can falsify the claim.

| Change type | Evidence form | Bar |
|---|---|---|
| TypeScript logic | Focused command output or targeted repro notes | Behavior matches intent and no new surfaced errors appear |
| Config UI or toast UX | Screenshot, toast smoke test, or equivalent artifact | User-visible output matches the described change |
| Script or installer flow | Dry-run output, targeted log excerpt, or reversible manual run | The flow completes as described without hidden side effects |
| Documentation only | Direct doc review | Instructions, paths, and commands match the repo |
| Bug fix | Failing symptom plus passing verification | The symptom no longer reproduces under the checked path |

If no credible verification path exists for a non-trivial change, stop and define one before treating the change as done.

---

## Bug-Fix Hardening Loop

After every bug fix:

1. Record the symptom and the verification used in the change review, issue, or accompanying notes.
2. Decide whether an existing HC would have caught the bug. If not, amend this constitution with a new HC or a stronger verification rule.
3. If the new rule can be checked mechanically, add it to the verification chain below.

The point of the loop is compounding prevention, not merely closing the current bug.

---

## Trivial Carve-Out

Typos, wording-only docs edits, comment-only changes, and formatting-only changes may skip extra process. They still must satisfy `[HC-DOCS-MATCH-REPO]` and avoid introducing false instructions.

If the change affects runtime behavior, auth, polling, notifications, installation, or persisted state, it is not trivial.

---

## Amendment Path

1. State the proposed rule change clearly.
2. Explain what concrete failure mode, review gap, or verification gap it addresses.
3. Prefer amendments that either prevent a real bug class or replace a vague manual expectation with a sharper check.
4. Keep the constitution repository-local and delete inherited rules that do not describe this codebase.

This file is the canonical constitution for Ghent unless and until the repository adds a real replacement.

---

## Verification Chain

Run the applicable steps for the touched scope. For changes under `src/`, the default chain is:

```powershell
npm run typecheck
npm test
npm run bundle
```

1. `npm run typecheck` must exit 0.
2. `npm test` must exit 0 (vitest unit + integration tests).
3. `npm run bundle` must produce `build/bundle/server.cjs` without error.
4. If `src/poller.ts` changed, `grep -c "paginateSearch" src/poller.ts` must be greater than or equal to 3.
5. If the UI or notifier changed, run `npm run test-toast` or capture equivalent manual evidence when practical.

No commit is implied by verification. Human review remains required before shipping constitution changes.
