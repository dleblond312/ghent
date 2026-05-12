// Discovers repos where you've authored PRs in the last DISCOVER_DAYS days.
// Prints a comma-separated list suitable for REGISTER_REPOS in .env.
import 'dotenv/config';
import { ghe } from './ghe-client.js';

interface SearchItem { repository_url: string }
interface SearchResult { items?: SearchItem[] }

const ME = (process.env.GHE_USERNAME || '').toLowerCase();
const DAYS = parseInt(process.env.DISCOVER_DAYS || '90', 10);

if (!ME) { console.error('GHE_USERNAME required'); process.exit(1); }

const since = new Date(Date.now() - DAYS * 24 * 3600 * 1000).toISOString().slice(0, 10);
const q = `is:pr author:${ME} created:>=${since}`;
const res = await ghe.get<SearchResult>(`/search/issues?q=${encodeURIComponent(q)}&per_page=100`);

const repos = new Set<string>();
for (const item of (res.items || [])) {
  const repo = item.repository_url.replace(/.*\/repos\//, '');
  repos.add(repo);
}

const list = [...repos].sort();
console.log(`# Found ${list.length} repos with PRs you authored in the last ${DAYS} days:`);
console.log(`REGISTER_REPOS=${list.join(',')}`);
