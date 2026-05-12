// Self-contained web UI served at http://localhost:PORT/.
// Inlined here so esbuild bundles it into server.cjs â€” no extra file to stage.
export const UI_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ghent</title>
<style>
:root{color-scheme:dark;--bg:#0d1117;--surface:#161b22;--border:#30363d;--text:#e6edf3;--muted:#8b949e;--accent:#238636;--accent-h:#2ea043;--input-bg:#0d1117;--green:#3fb950;--yellow:#d29922;--link:#58a6ff}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;padding:36px 24px;font-size:14px;line-height:1.5}
h1{font-size:20px;font-weight:600;display:flex;align-items:center;gap:10px;margin-bottom:24px}
h2{font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:14px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:20px;margin-bottom:16px;max-width:560px}
.status-row{display:flex;align-items:center;gap:16px;flex-wrap:wrap;min-height:22px}
.badge{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:500}
.dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.dot-g{background:var(--green);box-shadow:0 0 0 3px rgba(63,185,80,.2)}
.dot-y{background:var(--yellow)}
.dot-m{background:var(--muted)}
.stat{color:var(--muted);font-size:13px}
.stat b{color:var(--text)}
.field{margin-bottom:14px}
label{display:block;margin-bottom:4px;font-size:13px;color:var(--muted)}
input{width:100%;padding:5px 12px;background:var(--input-bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:14px;font-family:inherit;transition:border-color .15s}
input:focus{outline:none;border-color:#388bfd;box-shadow:0 0 0 3px rgba(56,139,253,.15)}
.row{display:flex;gap:8px}
.row input{flex:1}
button{padding:5px 16px;border-radius:6px;border:1px solid;font-size:14px;font-weight:500;cursor:pointer;transition:background .15s;font-family:inherit}
.btn-p{background:var(--accent);border-color:rgba(240,246,252,.1);color:#fff}
.btn-p:hover{background:var(--accent-h)}
.btn-p:disabled{opacity:.5;cursor:default}
.btn-g{background:transparent;border-color:var(--border);color:var(--text)}
.btn-g:hover{background:rgba(255,255,255,.05)}
.toast-mock{background:#1c1c1c;border:1px solid #3a3a3a;border-radius:8px;padding:12px 14px;max-width:356px;font-family:'Segoe UI',system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.5);margin-top:14px}
.toast-mock .tm-hdr{display:flex;align-items:center;gap:7px;margin-bottom:6px}
.toast-mock .tm-icon{font-size:13px;opacity:.9}
.toast-mock .tm-app{font-size:10px;font-weight:700;color:#8a8a8a;text-transform:uppercase;letter-spacing:.08em;flex:1}
.toast-mock .tm-time{font-size:10px;color:#555}
.toast-mock .tm-title{font-size:13px;font-weight:600;color:#f0f0f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:2px}
.toast-mock .tm-body{font-size:11.5px;color:#999;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap}
.chip{display:inline-block;background:#0d1117;border:1px solid var(--border);border-radius:20px;padding:2px 8px;font-size:11px;color:var(--muted);cursor:pointer;user-select:none;margin:2px}
.chip:hover{border-color:#58a6ff;color:#58a6ff}
textarea{width:100%;padding:5px 12px;background:var(--input-bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px;font-family:inherit;resize:vertical;line-height:1.5}
textarea:focus{outline:none;border-color:#388bfd;box-shadow:0 0 0 3px rgba(56,139,253,.15)}
select{padding:5px 12px;background:var(--input-bg);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px;font-family:inherit}
select:focus{outline:none;border-color:#388bfd}
a{color:var(--link);text-decoration:none}
a:hover{text-decoration:underline}
.tgl{position:relative;display:inline-block;width:36px;height:20px;flex-shrink:0}
.tgl input{opacity:0;width:0;height:0;position:absolute}
.tgl-sl{position:absolute;cursor:pointer;inset:0;background:#30363d;border-radius:10px;transition:.2s}
.tgl-sl:before{content:'';position:absolute;width:14px;height:14px;left:3px;bottom:3px;background:#fff;border-radius:50%;transition:.2s}
.tgl input:checked+.tgl-sl{background:var(--green)}
.tgl input:checked+.tgl-sl:before{transform:translateX(16px)}
</style>
</head>
<body>
<h1>
<svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style="color:#8b949e">
<path d="M8 16a2 2 0 001.985-1.75c.017-.137-.097-.25-.235-.25h-3.5c-.138 0-.252.113-.235.25A2 2 0 008 16zm.25-14.25a.75.75 0 10-1.5 0V2a.75.75 0 001.5 0V1.75zM12.28 6.25c0-2.26-1.5-4.18-3.78-4.78V2a.5.5 0 00-1 0v.47c-2.28.6-3.78 2.52-3.78 4.78 0 2.26-.59 3.52-1.16 4.23-.19.23-.36.44-.48.67-.12.23-.13.48.03.7.16.23.43.36.74.36h10.68c.31 0 .58-.13.74-.36.16-.22.15-.47.03-.7-.12-.23-.29-.44-.48-.67-.57-.71-1.16-1.97-1.16-4.23z"/>
</svg>
Ghent
</h1>

<div class="card">
<h2>Status</h2>
<div class="status-row" id="status-row">
<span class="badge"><span class="dot dot-m"></span>Loading&#8230;</span>
</div>
</div>

<div class="card">
<h2>Accounts</h2>
<p style="font-size:12px;color:var(--muted);margin-bottom:10px">All accounts authenticated via <code style="font-size:11px;background:#0d1117;padding:1px 4px;border-radius:3px">gh auth status</code>. Toggle to enable/disable notifications.</p>
<div id="accounts-list"></div>
</div>

<div class="card">
<h2>Toast format</h2>
<p style="font-size:12px;color:var(--muted);margin-bottom:14px">Customize the title and body of Windows toast notifications. Click a variable chip to insert it at the cursor.</p>
<form id="tmpl-form" autocomplete="off">
<div class="field">
<label for="tmpl-title">Title template</label>
<input type="text" id="tmpl-title" placeholder="{commenter} {action}">
</div>
<div class="field">
<label for="tmpl-body">Body template</label>
<textarea id="tmpl-body" rows="2" placeholder="{repo}#{num}: {prTitle}&#10;{body}"></textarea>
</div>
<div style="margin-bottom:12px">
<div style="font-size:11px;color:var(--muted);margin-bottom:5px">Variables (click to insert):</div>
<span class="chip" data-var="{commenter}">{commenter}</span>
<span class="chip" data-var="{action}">{action}</span>
<span class="chip" data-var="{repo}">{repo}</span>
<span class="chip" data-var="{repo_name}">{repo_name}</span>
<span class="chip" data-var="{num}">#{num}</span>
<span class="chip" data-var="{prTitle}">{prTitle}</span>
<span class="chip" data-var="{body}">{body}</span>
</div>
<div class="field" style="max-width:260px">
<label for="prev-kind">Preview event type</label>
<select id="prev-kind">
  <option value="issue_comment">PR comment</option>
  <option value="review_comment">Inline review comment</option>
  <option value="approved">Approved</option>
  <option value="changes_requested">Changes requested</option>
  <option value="review_commented">Review with comment</option>
  <option value="merged">PR merged</option>
  <option value="closed">PR closed</option>
  <option value="review_requested">Review requested</option>
  <option value="mention">@mention</option>
</select>
</div>
<div id="toast-preview" class="toast-mock">
  <div class="tm-hdr"><span class="tm-icon">&#128276;</span><span class="tm-app">Ghent</span><span class="tm-time">just now</span></div>
  <div class="tm-title" id="prev-title"></div>
  <div class="tm-body" id="prev-body"></div>
</div>
<div style="display:flex;align-items:center;gap:10px;margin-top:14px">
<button type="submit" class="btn-p" id="tmpl-save-btn">Save</button>
<button type="button" class="btn-g" id="tmpl-reset-btn" style="font-size:13px">Reset to defaults</button>
</div>
</form>
<div class="fb fb-ok" id="tmpl-fb-ok">&#10003; Toast format saved.</div>
<div class="fb fb-err" id="tmpl-fb-err"></div>
</div>

<div class="card" id="acct-pat-card" style="display:none">
<h2 id="acct-pat-title">Set PAT fallback</h2>
<p style="font-size:12px;color:var(--muted);margin-bottom:10px">gh CLI is always tried first. PAT is only used as a silent fallback.</p>
<form id="acct-pat-form" autocomplete="off">
<div class="field">
<label for="acct-tok">PAT <span style="color:var(--muted);font-size:11px">(optional &mdash; needs <code style="font-size:11px">repo</code> scope)</span></label>
<div class="row">
<input type="password" id="acct-tok" placeholder="ghp_&hellip; or leave empty to clear" autocomplete="new-password">
<button type="button" class="btn-g" id="acct-tok-tog" style="flex-shrink:0;min-width:60px">Show</button>
</div>
</div>
<div style="display:flex;gap:8px;margin-top:4px">
<button type="submit" class="btn-p" id="acct-pat-save-btn">Save PAT</button>
<button type="button" class="btn-g" id="acct-pat-cancel-btn">Cancel</button>
</div>
</form>
<div class="fb fb-ok" id="acct-pat-fb-ok">&#10003; PAT saved.</div>
<div class="fb fb-err" id="acct-pat-fb-err"></div>
</div>

<div class="card">
<h2>Global settings</h2>
<form id="global-form" autocomplete="off">
<div style="display:flex;gap:16px;flex-wrap:wrap">
<div class="field" style="max-width:200px">
<label for="intv">Poll interval (seconds, min 30)</label>
<input type="number" id="intv" min="30" step="10">
</div>
<div class="field" style="max-width:200px">
<label for="cooldown">Per-PR notification cooldown (seconds, 0 = off)</label>
<input type="number" id="cooldown" min="0" step="30">
</div>
</div>
<button type="submit" class="btn-p" id="global-save-btn">Save</button>
</form>
<div class="fb fb-ok" id="global-fb-ok">&#10003; Settings saved.</div>
<div class="fb fb-err" id="global-fb-err"></div>
<div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
<button type="button" class="btn-g" id="test-notif-btn">&#128276; Send test notification</button>
<span id="test-notif-fb" style="margin-left:10px;font-size:12px;display:none"></span>
</div>
</div>

<div class="card">
<h2>Notification types</h2>
<p style="font-size:12px;color:var(--muted);margin-bottom:14px">Choose which events fire a toast. Cooldown still applies between events on the same PR.</p>
<form id="flags-form" autocomplete="off">
<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 24px">
<label style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border);font-size:13px;color:var(--text);cursor:pointer">
  <input type="checkbox" id="f-comment" style="width:auto;accent-color:var(--green)">
  <span><b>PR comment</b> <span style="color:var(--muted);font-size:12px">— someone left a conversation comment</span></span>
</label>
<label style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border);font-size:13px;color:var(--text);cursor:pointer">
  <input type="checkbox" id="f-review-comment" style="width:auto;accent-color:var(--green)">
  <span><b>Inline review comment</b> <span style="color:var(--muted);font-size:12px">— code-level review comment</span></span>
</label>
<label style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border);font-size:13px;color:var(--text);cursor:pointer">
  <input type="checkbox" id="f-approved" style="width:auto;accent-color:var(--green)">
  <span><b>Approved</b> <span style="color:var(--muted);font-size:12px">— reviewer approved your PR</span></span>
</label>
<label style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border);font-size:13px;color:var(--text);cursor:pointer">
  <input type="checkbox" id="f-changes" style="width:auto;accent-color:var(--green)">
  <span><b>Changes requested</b> <span style="color:var(--muted);font-size:12px">— reviewer blocked your PR</span></span>
</label>
<label style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border);font-size:13px;color:var(--text);cursor:pointer">
  <input type="checkbox" id="f-review-commented" style="width:auto;accent-color:var(--green)">
  <span><b>Review with comment</b> <span style="color:var(--muted);font-size:12px">— review submitted with a body</span></span>
</label>
<label style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border);font-size:13px;color:var(--text);cursor:pointer">
  <input type="checkbox" id="f-merged" style="width:auto;accent-color:var(--green)">
  <span><b>PR merged</b> <span style="color:var(--muted);font-size:12px">— your PR was merged</span></span>
</label>
<label style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border);font-size:13px;color:var(--text);cursor:pointer">
  <input type="checkbox" id="f-closed" style="width:auto;accent-color:var(--green)">
  <span><b>PR closed (no merge)</b> <span style="color:var(--muted);font-size:12px">— PR rejected or abandoned</span></span>
</label>
<label style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border);font-size:13px;color:var(--text);cursor:pointer">
  <input type="checkbox" id="f-review-requested" style="width:auto;accent-color:var(--green)">
  <span><b>Review requested</b> <span style="color:var(--muted);font-size:12px">— someone asked you to review</span></span>
</label>
<label style="display:flex;align-items:center;gap:8px;padding:7px 0;font-size:13px;color:var(--text);cursor:pointer">
  <input type="checkbox" id="f-mention" style="width:auto;accent-color:var(--green)">
  <span><b>@mention</b> <span style="color:var(--muted);font-size:12px">— mentioned on a PR you don\u2019t own</span></span>
</label>
</div>
<div style="margin-top:14px;display:flex;align-items:center;gap:12px">
<button type="submit" class="btn-p" id="flags-save-btn">Save</button>
<button type="button" class="btn-g" id="flags-all-btn">All on</button>
<button type="button" class="btn-g" id="flags-none-btn">All off</button>
</div>
</form>
<div class="fb fb-ok" id="flags-fb-ok">&#10003; Notification types saved.</div>
<div class="fb fb-err" id="flags-fb-err"></div>
</div>

<script>
(async () => {
  const $ = id => document.getElementById(id);
  let _accounts = [];

  function he(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function timeAgo(iso) {
    if (!iso) return 'never';
    const s = Math.round((Date.now() - new Date(iso)) / 1000);
    if (s < 5)    return 'just now';
    if (s < 60)   return s + 's ago';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    return Math.floor(s / 3600) + 'h ago';
  }

  function dot(cls) { return '<span class="dot ' + cls + '" style="display:inline-block;vertical-align:middle"></span>'; }

  // Each row: toggle ON/OFF + host/user + polling status. "Set PAT" button on enabled accounts.
  function renderAccountRow(a) {
    const idAttr   = a.id.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const userAttr = he(a.username);
    const checked  = a.enabled ? 'checked' : '';
    let statusPart;
    if (a.enabled) {
      statusPart = a.running ? dot('dot-g') + ' Polling' : dot('dot-m') + ' Starting\u2026';
    } else {
      statusPart = '<span style="color:var(--muted);font-size:11px">Disabled</span>';
    }
    const prPart   = (a.enabled && a.prCount) ? ' <span style="font-size:11px;color:var(--muted)">\u00b7 ' + a.prCount + ' PR' + (a.prCount === 1 ? '' : 's') + '</span>' : '';
    const lastPart = (a.enabled && a.lastPoll) ? ' <span style="font-size:11px;color:var(--muted)">\u00b7 ' + timeAgo(a.lastPoll) + '</span>' : '';
    const patBtn   = a.enabled
      ? '<button type="button" class="btn-g acct-pat" data-id="' + idAttr + '" data-user="' + userAttr + '" style="font-size:11px;padding:2px 8px;flex-shrink:0">' + (a.hasToken ? 'PAT \u2713' : 'Set PAT') + '</button>'
      : '';
    return '<div class="acct-row" style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)">' +
      '<label class="tgl" title="' + (a.enabled ? 'Disable' : 'Enable') + ' notifications">' +
        '<input type="checkbox" class="acct-tgl" data-id="' + idAttr + '" data-user="' + userAttr + '" ' + checked + '>' +
        '<span class="tgl-sl"></span>' +
      '</label>' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-weight:600;font-size:13px">' + he(a.id) + '</div>' +
        '<div style="color:var(--muted);font-size:12px">' + userAttr + '</div>' +
      '</div>' +
      '<div style="font-size:12px">' + statusPart + prPart + lastPart + '</div>' +
      patBtn +
    '</div>';
  }

  async function loadStatus() {
    try {
      const s = await fetch('/api/status').then(r => r.json());
      const row = $('status-row');
      if (!s.configured) {
        row.innerHTML = '<span class="badge"><span class="dot dot-y"></span>No accounts enabled \u2014 toggle one below</span>';
      } else {
        const anyPolling = s.accounts.some(a => a.running);
        const totalPRs = s.accounts.reduce((n, a) => n + (a.prCount || 0), 0);
        const label = totalPRs === 1 ? '1 PR' : (totalPRs + ' PRs');
        row.innerHTML = anyPolling
          ? '<span class="badge"><span class="dot dot-g"></span>Polling</span><span class="stat">Watching <b>' + label + '</b></span>'
          : '<span class="badge"><span class="dot dot-m"></span>Starting\u2026</span>';
      }
    } catch (_) {
      $('status-row').innerHTML = '<span class="badge"><span class="dot dot-m"></span>Service not responding</span>';
    }
  }

  async function loadAccounts() {
    try {
      _accounts = await fetch('/api/accounts').then(r => r.json());
      const list = $('accounts-list');
      if (!_accounts.length) {
        list.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px 0">No GitHub accounts found. Run <code style="font-size:11px;background:#0d1117;padding:1px 4px;border-radius:3px">gh auth login</code> to authenticate.</div>';
      } else {
        list.innerHTML = _accounts.map(renderAccountRow).join('');
      }
    } catch (_) {}
  }

  // Toggle enable/disable — fires on checkbox change
  $('accounts-list').addEventListener('change', async e => {
    const cb = e.target && e.target.matches && e.target.matches('.acct-tgl') ? e.target : null;
    if (!cb) return;
    const hostname = cb.dataset.id;
    const username = cb.dataset.user;
    const enabled  = cb.checked;
    cb.disabled = true;
    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostname, username, enabled })
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      await Promise.all([loadAccounts(), loadStatus()]);
    } catch (err) {
      cb.checked = !enabled; // revert
      cb.disabled = false;
      alert('Error: ' + err.message);
    }
  });

  // "Set PAT" button — opens the minimal PAT card
  let _patTargetId = '';
  let _patTargetUser = '';
  $('accounts-list').addEventListener('click', e => {
    const btn = e.target && e.target.matches && e.target.matches('.acct-pat') ? e.target : null;
    if (!btn) return;
    _patTargetId   = btn.dataset.id;
    _patTargetUser = btn.dataset.user;
    $('acct-pat-title').textContent = 'PAT fallback \u2014 ' + _patTargetId;
    $('acct-tok').value = '';
    $('acct-pat-fb-ok').style.display = 'none';
    $('acct-pat-fb-err').style.display = 'none';
    $('acct-pat-card').style.display = '';
    $('acct-tok').focus();
  });

  $('acct-pat-cancel-btn').onclick = () => { $('acct-pat-card').style.display = 'none'; };

  $('acct-tok-tog').onclick = () => {
    const t = $('acct-tok'), show = t.type === 'password';
    t.type = show ? 'text' : 'password';
    $('acct-tok-tog').textContent = show ? 'Hide' : 'Show';
  };

  $('acct-pat-form').addEventListener('submit', async e => {
    e.preventDefault();
    $('acct-pat-fb-ok').style.display = 'none';
    $('acct-pat-fb-err').style.display = 'none';
    const btn = $('acct-pat-save-btn');
    btn.disabled = true;
    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostname: _patTargetId, username: _patTargetUser, enabled: true, token: $('acct-tok').value.trim() })
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
      $('acct-pat-fb-ok').style.display = 'block';
      setTimeout(() => { $('acct-pat-card').style.display = 'none'; }, 800);
      await loadAccounts();
    } catch (err) {
      $('acct-pat-fb-err').textContent = err.message;
      $('acct-pat-fb-err').style.display = 'block';
    } finally { btn.disabled = false; }
  });

  // Toast format helpers — defined here (before any await) so consts are initialized
  const PREV_VARS = {
    issue_comment:     { action: 'commented on your PR',   commenter: 'alice',  repo: 'org/my-project', repo_name: 'my-project', num: '342', prTitle: 'feat: add semantic search',           body: 'LGTM! Just one nit on the error handling.' },
    review_comment:    { action: 'left an inline comment', commenter: 'bob',    repo: 'org/my-project', repo_name: 'my-project', num: '342', prTitle: 'feat: add semantic search',           body: 'Why not use a Map here instead?' },
    approved:          { action: '\u2713 approved your PR',    commenter: 'carol',  repo: 'org/my-project', repo_name: 'my-project', num: '340', prTitle: 'fix: retry logic for transient errors', body: '' },
    changes_requested: { action: '\u2717 requested changes',   commenter: 'dave',   repo: 'org/my-project', repo_name: 'my-project', num: '340', prTitle: 'fix: retry logic for transient errors', body: 'Please add a test for the 500 path.' },
    review_commented:  { action: 'reviewed your PR',       commenter: 'eve',    repo: 'org/other-repo', repo_name: 'other-repo', num: '6',   prTitle: 'chore: update node to 22',             body: 'One comment before I approve.' },
    merged:            { action: 'PR merged',              commenter: 'system', repo: 'org/my-project', repo_name: 'my-project', num: '335', prTitle: 'perf: cache org mapping at startup',   body: '' },
    closed:            { action: 'PR closed',              commenter: 'system', repo: 'org/my-project', repo_name: 'my-project', num: '330', prTitle: 'wip: spike on streaming responses',     body: '' },
    review_requested:  { action: 'requested your review', commenter: 'frank',  repo: 'org/my-project', repo_name: 'my-project', num: '341', prTitle: 'refactor: split service module',        body: '' },
    mention:           { action: '@mentioned you',         commenter: 'grace',  repo: 'org/my-project', repo_name: 'my-project', num: '338', prTitle: 'feat: multi-tenant routing',            body: '(you were @mentioned)' },
  };
  function renderTmpl(tmpl, vars) {
    return tmpl.replace(/\\{(\\w+)\\}/g, (_, k) => vars[k] ?? '');
  }
  function updatePreviewEarly() {
    const kind = $('prev-kind').value;
    const vars = PREV_VARS[kind] || PREV_VARS['issue_comment'];
    const title = renderTmpl($('tmpl-title').value || '{commenter} {action}', vars);
    const body  = renderTmpl($('tmpl-body').value  || '{repo}#{num}: {prTitle}\\n{body}', vars);
    $('prev-title').textContent = title;
    $('prev-body').textContent  = body;
  }
  $('tmpl-title').addEventListener('input', updatePreviewEarly);
  $('tmpl-body').addEventListener('input', updatePreviewEarly);
  $('prev-kind').addEventListener('change', updatePreviewEarly);
  document.querySelectorAll('.chip[data-var]').forEach(chip => {
    chip.addEventListener('click', () => {
      const val = chip.dataset.var;
      const focused = document.activeElement;
      const target = (focused === $('tmpl-title') || focused === $('tmpl-body')) ? focused : $('tmpl-title');
      const start = target.selectionStart ?? target.value.length;
      const end   = target.selectionEnd   ?? target.value.length;
      target.value = target.value.slice(0, start) + val + target.value.slice(end);
      target.selectionStart = target.selectionEnd = start + val.length;
      target.focus();
      updatePreviewEarly();
    });
  });
  $('tmpl-reset-btn').onclick = () => {
    $('tmpl-title').value = '{commenter} {action}';
    $('tmpl-body').value  = '{repo}#{num}: {prTitle}\\n{body}';
    updatePreviewEarly();
  };
  $('tmpl-form').addEventListener('submit', async e => {
    e.preventDefault();
    $('tmpl-fb-ok').style.display = 'none';
    $('tmpl-fb-err').style.display = 'none';
    const btn = $('tmpl-save-btn');
    btn.disabled = true;
    try {
      const res = await fetch('/api/config', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toastTitleTemplate: $('tmpl-title').value, toastBodyTemplate: $('tmpl-body').value })
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
      $('tmpl-fb-ok').style.display = 'block';
    } catch (err) {
      $('tmpl-fb-err').textContent = err.message;
      $('tmpl-fb-err').style.display = 'block';
    } finally { btn.disabled = false; }
  });
  updatePreviewEarly();

  // Global settings
  try {
    const cfg = await fetch('/api/config').then(r => r.json());
    $('intv').value = cfg.pollIntervalSec || 60;
    $('cooldown').value = cfg.notifCooldownSec ?? 180;
    // Notification flags
    const f = cfg.notifFlags || {};
    $('f-comment').checked          = f.onComment          !== false;
    $('f-review-comment').checked   = f.onReviewComment    !== false;
    $('f-approved').checked         = f.onApproved         !== false;
    $('f-changes').checked          = f.onChangesRequested !== false;
    $('f-review-commented').checked = f.onReviewCommented  !== false;
    $('f-merged').checked           = f.onMerged           !== false;
    $('f-closed').checked           = f.onClosed           === true;  // default off
    $('f-review-requested').checked = f.onReviewRequested  !== false;
    $('f-mention').checked          = f.onMention          !== false;
    // Toast templates
    $('tmpl-title').value = cfg.toastTitleTemplate || '{commenter} {action}';
    $('tmpl-body').value  = cfg.toastBodyTemplate  || '{repo}#{num}: {prTitle}\\n{body}';
    updatePreviewEarly();
  } catch (_) {}

  $('global-form').addEventListener('submit', async e => {
    e.preventDefault();
    $('global-fb-ok').style.display = 'none';
    $('global-fb-err').style.display = 'none';
    const intv = parseInt($('intv').value, 10);
    if (intv < 30 || isNaN(intv)) {
      $('global-fb-err').textContent = 'Poll interval must be at least 30 seconds.';
      $('global-fb-err').style.display = 'block';
      return;
    }
    const btn = $('global-save-btn');
    btn.disabled = true;
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pollIntervalSec: intv, notifCooldownSec: parseInt($('cooldown').value, 10) || 0 })
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
      $('global-fb-ok').style.display = 'block';
    } catch (err) {
      $('global-fb-err').textContent = err.message;
      $('global-fb-err').style.display = 'block';
    } finally {
      btn.disabled = false;
    }
  });

  $('test-notif-btn').onclick = async () => {
    const fb = $('test-notif-fb');
    const btn = $('test-notif-btn');
    btn.disabled = true;
    fb.style.display = 'none';
    try {
      const res = await fetch('/api/test-notification', { method: 'POST' });
      const data = await res.json();
      fb.textContent = res.ok ? '\u2713 Toast sent!' : '\u2717 ' + (data.error || 'Failed');
      fb.style.color = res.ok ? 'var(--green)' : '#ff7b72';
    } catch (err) {
      fb.textContent = '\u2717 Request failed';
      fb.style.color = '#ff7b72';
    } finally {
      fb.style.display = 'inline';
      btn.disabled = false;
    }
  };

  // Notification flags form
  function readFlags() {
    return {
      onComment:          $('f-comment').checked,
      onReviewComment:    $('f-review-comment').checked,
      onApproved:         $('f-approved').checked,
      onChangesRequested: $('f-changes').checked,
      onReviewCommented:  $('f-review-commented').checked,
      onMerged:           $('f-merged').checked,
      onClosed:           $('f-closed').checked,
      onReviewRequested:  $('f-review-requested').checked,
      onMention:          $('f-mention').checked,
    };
  }
  const _flagIds = ['f-comment','f-review-comment','f-approved','f-changes','f-review-commented','f-merged','f-closed','f-review-requested','f-mention'];
  $('flags-all-btn').onclick  = () => _flagIds.forEach(id => $('flags-form').querySelector('#' + id).checked = true);
  $('flags-none-btn').onclick = () => _flagIds.forEach(id => $('flags-form').querySelector('#' + id).checked = false);

  $('flags-form').addEventListener('submit', async e => {
    e.preventDefault();
    $('flags-fb-ok').style.display = 'none';
    $('flags-fb-err').style.display = 'none';
    const btn = $('flags-save-btn');
    btn.disabled = true;
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notifFlags: readFlags() })
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
      $('flags-fb-ok').style.display = 'block';
    } catch (err) {
      $('flags-fb-err').textContent = err.message;
      $('flags-fb-err').style.display = 'block';
    } finally {
      btn.disabled = false;
    }
  });

  await Promise.all([loadStatus(), loadAccounts()]);
  setInterval(() => { void loadStatus(); void loadAccounts(); }, 15000);
})();
</script>
</body>
</html>`;

