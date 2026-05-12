# Ghent

Windows toast notifications when comments or reviews land on PRs you authored on GitHub Enterprise. Runs as a Windows scheduled task, polls the GHE API every 90 seconds, and fires a clickable toast that opens the comment in Edge.

**Stack:** Node 22, TypeScript (esbuild bundle), Express, `node-notifier` (SnoreToast), WiX 7 MSI.

## Screenshots

| Config UI | Toast notification |
|---|---|
| ![Config UI](docs/screenshots/config-ui.png) | ![Toast](docs/screenshots/toast.png) |

---

## What it does

- Polls GHE for open PRs you authored and surfaces new comments, review comments, and reviews.
- Also catches `@mention`s on PRs you didn't author.
- Skips your own comments.
- Fires a clickable Windows toast — clicking opens the comment URL in Edge.
- Per-PR cooldown (default 3 min) prevents spam when multiple comments land in quick succession on the same PR.
- Appends every event to `%LOCALAPPDATA%\Ghent\events.jsonl` — one JSON object per line.
- On restart, picks up from the last successful poll so nothing is replayed as new.
- Also supports `MODE=webhook` for real-time delivery (requires a public endpoint, e.g. DevTunnel).

---

## Dev setup

```powershell
cd projects/ghe-pr-notifier
npm install
npm run dev        # starts via Task Scheduler (Ghent task must exist)
```

Or run directly:

```powershell
npx tsx src/server.ts
```

Then open **http://localhost:9420/** and add your GHE account via the web UI.

You need [gh CLI](https://cli.github.com) installed and authenticated:

```powershell
gh auth login --hostname your-company.ghe.com
```

A PAT fallback can be set in the UI (needs `repo` + `notifications` scopes) but gh CLI is preferred — token refreshes are transparent without a restart.

---

## Configuration

All config lives in `%LOCALAPPDATA%\Ghent\config.json`. The web UI at http://localhost:9420/ is the preferred way to edit it.

Key fields:

```json
{
  "accounts": [
    {
      "id": "your-company.ghe.com",
      "label": "Work GHE",
      "username": "your-username",
      "apiBase": "https://your-company.ghe.com/api/v3",
      "token": ""
    }
  ],
  "mode": "poll",
  "pollIntervalSec": 90,
  "notifCooldownSec": 180,
  "port": 9420
}
```

Changes saved via the UI take effect immediately — poll interval changes restart the poller timer.

---

## Production: scheduled task

```powershell
# Dev task (runs from repo via tsx)
pwsh scripts/install-task.ps1

# MSI-installed task (runs from C:\Program Files\Ghent\)
pwsh scripts/install-task-msi.ps1 -InstallRoot "C:\Program Files\Ghent\"
```

Logs: `%LOCALAPPDATA%\Ghent\task.log` and `%LOCALAPPDATA%\Ghent\events.jsonl`.

```powershell
# Start / stop
Start-ScheduledTask -TaskName Ghent
Stop-ScheduledTask  -TaskName Ghent
```

---

## MSI build

```powershell
npm run msi        # builds dist/Ghent-0.2.0.msi
```

Requires [WiX 7 CLI](https://wixtoolset.org/) (`wix` on PATH) and Node 22 portable runtime at `build/node/node.exe`.

---

## Deploy (dev → installed)

```powershell
npm run deploy     # bundle + copy to C:\Program Files\Ghent\ + bounce task
```

Requires one-time icacls grant:

```powershell
icacls "C:\Program Files\Ghent" /grant "$env:USERNAME:(OI)(CI)F" /T
```

---

## Webhook mode

For real-time delivery instead of polling:

```json
{ "mode": "webhook", "webhookSecret": "<32-byte-hex>" }
```

The server exposes `/webhook` — forward it via DevTunnel and register hooks:

```powershell
npm run discover-repos   # find repos with recent PRs
# set REGISTER_REPOS and PUBLIC_WEBHOOK_URL in .env, then:
npm run register
```

---

## Event log format

`%LOCALAPPDATA%\Ghent\events.jsonl` — append-only, one JSON object per line:

```json
{"ts":"2026-05-10T23:11:46Z","source":"poll","kind":"review","repo":"org/my-project","num":341,"prTitle":"feat: add thing","commenter":"someone","body":"LGTM","url":"https://..."}
```

Suppressed toasts (per-PR cooldown) are logged with `"suppressed":true` so no activity is lost.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Toast doesn't appear | Open Settings → Notifications → find **SnoreToast** → turn On. Windows defaults it off on first run. |
| `npm run test-toast` prints `DisabledForUser` | Same as above. |
| Server won't start — port 9420 in use | Another instance is running: `Get-NetTCPConnection -LocalPort 9420 \| Select-Object OwningProcess` |
| No notifications for a PR | Check `events.jsonl` — if events appear with `"suppressed":true`, the per-PR cooldown is active. |
| Poll never runs | Check `task.log` for errors. Common: gh CLI not authenticated (`gh auth login --hostname <host>`). |
| Config lost after save | Check `task.log` for `[config] could not read existing config` warnings — indicates corrupt config.json. |


> GHE doesn't expose a true "all repos I can access" webhook for regular users. Per-repo is the practical equivalent. If you have `admin:org_hook` on your org you can switch to `REGISTER_SCOPE=org` + `REGISTER_ORG=your-org` for one hook covering everything.

### 6. Register the webhooks

```powershell
npm run register
```

Idempotent — re-running updates existing hooks rather than duplicating.

### 7. Smoke test the toast

```powershell
npm run test-toast
```

You should see a Windows toast. Click it; it should open https://your-company.ghe.com.

### 8. Start the listener

```powershell
npm start
```

Trigger a real test by commenting on one of your open PRs from another account. Within ~1s you should get a toast.

---

## Production: auto-start at logon

```powershell
pwsh ./scripts/install-task.ps1
Start-ScheduledTask -TaskName Ghent
```

Logs go to `%LOCALAPPDATA%\Ghent\task.log`. Remove with:

```powershell
pwsh ./scripts/install-task.ps1 -Remove
```

> The DevTunnel itself is NOT auto-started by this task. If you want the tunnel to come up at logon too, register a separate scheduled task that runs `devtunnel host YOUR-TUNNEL-NAME -p 51847`.

---

## Polling fallback

If the tunnel is offline or you want zero infra:

```env
MODE=poll
POLL_INTERVAL_SEC=60
```

`npm start` will then ignore the webhook path and poll the GHE API every minute. State is persisted in `%LOCALAPPDATA%\Ghent\poller-state.json` (so a restart doesn't replay every comment as new). The first run after deleting state seeds without toasting.

---

## Event log format

`%LOCALAPPDATA%\Ghent\events.jsonl` — append-only, one JSON object per line:

```json
{"ts":"2026-05-09T18:42:11.123Z","delivery":"abc-123","event":"issue_comment","kind":"issue_comment","reason":"my-pr","repo":"org/my-project","prNumber":42,"prTitle":"Add foo","commenter":"someone","body":"LGTM with one nit","url":"https://your-company.ghe.com/org/my-project/pull/42#issuecomment-9999"}
```

Skipped events are also logged (`kind:"skip"`) so you can audit filtering.

To consume from another tool, tail the file or read it on a timer. It's safe to delete old lines (truncate) while the notifier runs — Node opens it in append mode each write.

---

## Log files & diagnostics

All activity is written to local files under `%LOCALAPPDATA%\Ghent\`. Nothing is ever sent anywhere automatically — if you need help debugging a crash, you share the files yourself ("sneaker mail").

| File | Contents |
|---|---|
| `events.jsonl` | Structured event log: startup, shutdown, install, uninstall, config changes, account changes, PR notifications, crashes |
| `task.log` | Raw stdout/stderr from the server process (timestamped) |

Each file rotates at 5 MB, keeping one previous generation (`.old`). Disk usage is bounded to ~20 MB total.

### Opening the logs

```powershell
# Explorer
explorer $env:LOCALAPPDATA\Ghent

# Quick tail in PowerShell
Get-Content $env:LOCALAPPDATA\Ghent\events.jsonl -Tail 50
Get-Content $env:LOCALAPPDATA\Ghent\task.log -Tail 100

# Pretty-print the last event
Get-Content $env:LOCALAPPDATA\Ghent\events.jsonl -Tail 1 | ConvertFrom-Json
```

### Sending logs when reporting a bug

1. Open `%LOCALAPPDATA%\Ghent\` in Explorer.
2. Zip `events.jsonl` and `task.log` (include `.old` backups if present).
3. Attach the zip to your GitHub issue.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| GHE shows webhook delivery failing with 401 | `WEBHOOK_SECRET` in `.env` doesn't match what was registered. Re-run `npm run register`. |
| GHE delivery times out | Tunnel is down or `PORT` doesn't match `devtunnel host -p`. Check `https://YOUR-TUNNEL.devtunnels.ms/health` returns JSON. |
| Toast doesn't appear | Run `npm run test-toast`. If it fails, check Windows Focus Assist isn't suppressing notifications. |
| `npm run test-toast` prints `DisabledForUser` | Open Settings → System → Notifications → scroll to **SnoreToast** → turn it **On**. SnoreToast is the helper exe `node-notifier` ships; Windows installs it on first run, then defaults it to disabled. |
| GHE rejects hook creation with 404 | Token is missing `admin:repo_hook` scope, or you don't have admin on that repo. |
| Lots of noise from old comments | Delete `%LOCALAPPDATA%\Ghent\poller-state.json` (poll mode only) — next run reseeds without toasting. |

---

## Architecture

```
GHE repo  ──webhook──>  https://YOUR-TUNNEL.devtunnels.ms/webhook
                                       │
                              devtunnel relay
                                       │
                                       ▼
                          localhost:51847  (express)
                                       │
                          ┌────────────┴────────────┐
                          ▼                         ▼
                   notifier.js                  logger.js
                  (toast + open)    (%LOCALAPPDATA%\Ghent\events.jsonl)
```
