# GitHub REST API Reference — PR Notification Polling

Verified against GitHub docs May 2026. Applies to both GHE (enterprise) and GH.com.

---

## Comment namespaces on a PR

There are three separate ID spaces. Each must be tracked with its own watermark.

| What | Endpoint | ID field | Default order | `since` param? |
|---|---|---|---|---|
| PR timeline / general comments | `GET /repos/{owner}/{repo}/issues/{num}/comments` | `id` | ascending by `id` | ✅ yes |
| Inline diff review comments | `GET /repos/{owner}/{repo}/pulls/{num}/comments` | `id` | ascending by `id` | ✅ yes |
| Review submissions (APPROVE / REQUEST_CHANGES / COMMENT) | `GET /repos/{owner}/{repo}/pulls/{num}/reviews` | `id` | chronological | ❌ no |

The three ID spaces are **independent** — review comment IDs and issue comment IDs can collide numerically without conflict. Tracking them separately (as `lastCommentId`, `lastReviewCommentId`, `lastReviewId`) is correct.

---

## Current poller state shape

```ts
interface PrState {
  lastCommentId: number;        // /issues/{num}/comments
  lastReviewId: number;         // /pulls/{num}/reviews
  lastReviewCommentId: number;  // /pulls/{num}/comments
}
```

---

## ID-based deduplication

Both issue comments and review comments are guaranteed ascending by ID (docs say so explicitly). The watermark pattern `c.id <= last.lastXxxId` is reliable — new items always have higher IDs.

Reviews use the same approach. Reviews do not support `since`, so all reviews for a PR must be fetched every poll and filtered by ID.

---

## The `since` optimization (not yet implemented)

The issue comments and review comments endpoints both accept `?since=<ISO8601>`. Passing the last poll timestamp means the API returns only comments updated after that time — avoids transferring all historical comments on every tick.

```
GET /repos/{owner}/{repo}/issues/{num}/comments?since=2026-05-10T23:00:00Z&per_page=100
GET /repos/{owner}/{repo}/pulls/{num}/comments?since=2026-05-10T23:00:00Z&per_page=100
```

Keep the ID filter as a safety net for clock skew — the `since` filter uses `updated_at`, which can be non-monotonic if someone edits an old comment. The ID gate prevents re-toasting an edited comment.

Implementation sketch:
- Store `lastPollTime` per PR (or globally per account) in `PollerState`
- Pass it as `since` query param on the two endpoints that support it
- Reviews endpoint always gets full-paginated (no `since`)

---

## The `COMMENTED` review skip

When someone posts inline diff comments without a review-level body, GitHub creates a review with `state: "COMMENTED"` and an empty `body`. The poller skips these:

```ts
if (!r.body && r.state === 'COMMENTED') continue;
```

This prevents a duplicate toast — the individual inline comments already fired via the `/pulls/{num}/comments` endpoint.

---

## What's NOT covered

- **Commit comments** (`GET /repos/{owner}/{repo}/commits/{sha}/comments`) — comments on individual commit SHAs, not the PR diff. Rare in practice; most reviewers use inline diff comments.
- **PR review comment replies** — these are regular review comments with `in_reply_to_id` set. They DO appear in `/pulls/{num}/comments` and are already captured.

---

## Rate limits

GHE default: **5,000 requests/hour** per token.

At 90s poll interval, 7 PRs, 3 endpoints each:
- Current (no `since`): ~280 req/hour, fetching all history every time
- With `since` optimization: effectively 0 data transferred when quiet, pagination only for new items

Both are well inside the limit. Secondary rate limit (burst) applies if you paginate many pages rapidly — not a concern at 7 PRs.

---

## Search API (mentions)

```
GET /search/issues?q=mentions:{user}+updated:>{since}&per_page=50
```

- `updated:>` is a GitHub search qualifier, not a query param `since`
- Returns PRs and issues; filter to PRs only with `item.pull_request` truthy
- Results are not ordered by ID — use `mentionsSince` timestamp watermark (stored in state)
- Rate limit: search API has a separate limit of **30 req/min** (not the 5k/hr pool)
