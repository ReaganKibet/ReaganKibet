// Builds activity.json for the shipping log on reagansang.netlify.app.
// Reads recent commits from every repo the token can see (public and private),
// groups them into pushes per repo per day, and hides private repo names and
// commit messages unless SHOW_PRIVATE_NAMES / SHOW_PRIVATE_MESSAGES are "true".
import { writeFileSync, readFileSync, existsSync } from 'node:fs';

const TOKEN = process.env.ACTIVITY_TOKEN;
const USER = process.env.GH_USER || 'ReaganKibet';
const SHOW_NAMES = process.env.SHOW_PRIVATE_NAMES === 'true';
const SHOW_MSGS = process.env.SHOW_PRIVATE_MESSAGES === 'true';
const DAYS = Number(process.env.WINDOW_DAYS || 60);
const OUT = process.env.OUT_FILE || 'activity.json';

if (!TOKEN) {
  console.error('ACTIVITY_TOKEN secret is missing. Add a read-only token in Settings > Secrets and variables > Actions.');
  process.exit(1);
}

async function gh(path) {
  const r = await fetch('https://api.github.com' + path, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
  });
  if (r.status === 409) return []; // empty repository
  if (!r.ok) throw new Error(`${r.status} ${path}: ${await r.text()}`);
  return r.json();
}

const since = new Date(Date.now() - DAYS * 864e5).toISOString();
const repos = (await gh('/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member'))
  .filter(r => r.pushed_at && r.pushed_at >= since && !r.fork)
  .slice(0, 20);

const commits = [];
for (const repo of repos) {
  let list = [];
  try { list = await gh(`/repos/${repo.full_name}/commits?per_page=30&since=${since}&author=${USER}`); }
  catch (e) { console.warn('skip', repo.full_name, e.message.slice(0, 120)); continue; }
  for (const c of list) {
    commits.push({
      at: c.commit.author?.date || c.commit.committer?.date,
      repo: repo.full_name,
      private: repo.private,
      branch: repo.default_branch,
      msg: (c.commit.message || '').split('\n')[0].slice(0, 140)
    });
  }
}
commits.sort((a, b) => b.at.localeCompare(a.at));

// one event per repo per day, newest commit message on top
const events = [];
for (const c of commits) {
  const day = c.at.slice(0, 10);
  const last = events.find(e => e._key === c.repo + day);
  if (last) { last.count++; continue; }
  const hide = c.private;
  events.push({
    _key: c.repo + day,
    at: c.at,
    repo: hide && !SHOW_NAMES ? null : c.repo,
    private: c.private,
    url: c.private ? null : `https://github.com/${c.repo}`,
    branch: c.branch,
    msg: hide && !SHOW_MSGS ? null : c.msg,
    count: 1
  });
}
events.forEach(e => delete e._key);

const out = {
  user: USER,
  windowDays: DAYS,
  totals: {
    commits: commits.length,
    repos: new Set(commits.map(c => c.repo)).size,
    privateCommits: commits.filter(c => c.private).length
  },
  latest: commits[0]?.at || null,
  events: events.slice(0, 30)
};

const next = JSON.stringify(out, null, 2) + '\n';
const prev = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
if (prev === next) { console.log('No new activity.'); process.exit(0); }
writeFileSync(OUT, next);
console.log(`Wrote ${OUT}: ${out.totals.commits} commits across ${out.totals.repos} repos in ${DAYS} days.`);
