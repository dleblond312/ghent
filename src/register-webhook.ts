// Registers (or removes/lists) the webhook on each repo in REGISTER_REPOS.
// Idempotent: if a hook with the same URL already exists, it's updated
// rather than duplicated.
//
// Usage:
//   npm run register      # create/update hooks
//   npm run unregister    # remove hooks created by this tool
//   npm run list-hooks    # show hooks pointing at PUBLIC_WEBHOOK_URL
import 'dotenv/config';
import { ghe } from './ghe-client.js';

interface Hook {
  id: number;
  active: boolean;
  config?: { url?: string };
}

interface Target {
  kind: 'repo' | 'org';
  path: string;
  label: string;
}

const URL_ = process.env.PUBLIC_WEBHOOK_URL;
const SECRET = process.env.WEBHOOK_SECRET;
const SCOPE = (process.env.REGISTER_SCOPE || 'repo').toLowerCase();
const ORG = process.env.REGISTER_ORG;
const REPOS = (process.env.REGISTER_REPOS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

if (!URL_) { console.error('PUBLIC_WEBHOOK_URL required'); process.exit(1); }
if (!SECRET) { console.error('WEBHOOK_SECRET required'); process.exit(1); }

const EVENTS = ['issue_comment', 'pull_request_review', 'pull_request_review_comment'];

const action: 'create' | 'remove' | 'list' =
  process.argv.includes('--remove') ? 'remove'
  : process.argv.includes('--list') ? 'list'
  : 'create';

let targets: Target[];
if (SCOPE === 'org') {
  if (!ORG) { console.error('REGISTER_ORG required when REGISTER_SCOPE=org'); process.exit(1); }
  targets = [{ kind: 'org', path: `/orgs/${ORG}/hooks`, label: ORG }];
} else {
  targets = REPOS.map(r => ({ kind: 'repo', path: `/repos/${r}/hooks`, label: r }));
}

if (targets.length === 0) {
  console.error('No targets. Set REGISTER_REPOS (run `npm run discover-repos` to find them) or REGISTER_SCOPE=org with REGISTER_ORG.');
  process.exit(1);
}

let okCount = 0, failCount = 0;
for (const t of targets) {
  try {
    const existing = await ghe.get<Hook[]>(t.path);
    const mine = existing.find(h => h.config?.url === URL_);

    if (action === 'list') {
      console.log(`${t.label}: ${mine ? `hook #${mine.id} active=${mine.active}` : '(no hook)'}`);
      okCount++;
      continue;
    }

    if (action === 'remove') {
      if (mine) {
        await ghe.delete(`${t.path}/${mine.id}`);
        console.log(`${t.label}: removed hook #${mine.id}`);
      } else {
        console.log(`${t.label}: no hook to remove`);
      }
      okCount++;
      continue;
    }

    // create or update
    const body = {
      name: 'web',
      active: true,
      events: EVENTS,
      config: { url: URL_, content_type: 'json', secret: SECRET, insecure_ssl: '0' }
    };

    if (mine) {
      await ghe.patch(`${t.path}/${mine.id}`, body);
      console.log(`${t.label}: updated hook #${mine.id}`);
    } else {
      const created = await ghe.post<Hook>(t.path, body);
      console.log(`${t.label}: created hook #${created.id}`);
    }
    okCount++;
  } catch (err) {
    failCount++;
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${t.label}: FAILED - ${msg}`);
  }
}

console.log(`\nDone. ${okCount} ok, ${failCount} failed.`);
process.exit(failCount === 0 ? 0 : 1);
