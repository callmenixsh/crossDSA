import { PLATFORMS, problemKey, safeProblemUrl } from '../core.mjs';

// Only question URLs are importable; profile and editorial links are not solves.
export function importQuestion(value) {
  const item = typeof value === 'string' ? { url: value } : value;
  if (!item || typeof item.url !== 'string') throw new Error('Expected a problem URL.');
  const url = new URL(item.url.trim());
  if (url.username || url.password || url.port || url.protocol !== 'https:') throw new Error('Use an HTTPS problem URL.');
  const host = url.hostname.replace(/^www\./, '');
  const routes = [
    ['leetcode', 'leetcode.com', /^\/problems\/[a-zA-Z0-9-]+(?:\/.*)?$/],
    ['codeforces', 'codeforces.com', /^\/(?:problemset\/problem\/\d+\/[a-zA-Z0-9]+|(?:contest|gym)\/\d+\/problem\/[a-zA-Z0-9]+)\/?$/],
    ['codechef', 'codechef.com', /^\/problems\/[a-zA-Z0-9_]+\/?$/],
    ['geeksforgeeks', 'geeksforgeeks.org', /^\/problems\/[^/]+(?:\/\d+)?\/?$/],
    ['code360', 'naukri.com', /^\/code360\/problems\/[^/]+\/?$/],
    ['tuf', 'takeuforward.org', /^\/(?:practice\/dsa|plus\/dsa\/problems)\/[^/]+\/?$/],
    ['atcoder', 'atcoder.jp', /^\/contests\/[a-zA-Z0-9_-]+\/tasks\/[a-zA-Z0-9_-]+\/?$/],
  ];
  const platform = routes.find(([, domain, path]) => host === domain && path.test(url.pathname))?.[0];
  if (!platform || item.platform && item.platform !== platform) throw new Error('Unsupported problem URL or mismatched platform.');
  url.hostname = new URL(PLATFORMS[platform].profile('sample')).hostname;
  url.search = ''; url.hash = '';
  if (platform === 'leetcode') url.pathname = `/problems/${url.pathname.split('/')[2]}/`;
  const href = safeProblemUrl(url.href, platform);
  if (!href) throw new Error('Invalid problem URL.');
  const title = String(item.title || decodeURIComponent(platform === 'geeksforgeeks' ? url.pathname.split('/')[2] : url.pathname.split('/').filter(Boolean).at(-1))).trim().slice(0, 300);
  return { key: problemKey(platform, href), platform, title, url: href, source: 'import' };
}

function csvRows(text) {
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (char === ',' || char === '\n' || char === '\r')) {
      row.push(field.trim()); field = '';
      if (char !== ',') { if (row.some(Boolean)) rows.push(row); row = []; if (char === '\r' && text[i + 1] === '\n') i++; }
    } else field += char;
  }
  if (quoted) throw new Error('CSV contains an unclosed quote.');
  row.push(field.trim()); if (row.some(Boolean)) rows.push(row);
  return rows;
}

export function previewSolvedImport(text, accounts = {}, catalog = []) {
  if (typeof text !== 'string' || text.length > 2_000_000) throw new Error('Import must be smaller than 2 MB.');
  text = text.replace(/^\uFEFF/, '').trim();
  let input;
  if (text.startsWith('[') || text.startsWith('{')) {
    const data = JSON.parse(text);
    input = Array.isArray(data) ? data : data.questions;
    if (!Array.isArray(input)) throw new Error('JSON must be an array or an object containing a questions array.');
  } else if (/^"?(?:url|platform|title)"?[,\r\n]/i.test(text)) {
    const [headers = [], ...rows] = csvRows(text);
    const names = headers.map(h => h.toLowerCase());
    if (!names.includes('url')) throw new Error('CSV needs a url column.');
    input = rows.map(row => Object.fromEntries(names.map((name, i) => [name, row[i]])));
  } else input = text.split(/\s+/).filter(Boolean);
  if (input.length > 20000) throw new Error('Import at most 20,000 questions at a time.');
  const known = new Map(catalog.map(item => [item.key, item]));
  const seen = new Set(), records = [], unresolved = []; let duplicates = 0;
  for (const [index, value] of input.entries()) {
    try {
      let item = importQuestion(value);
      if (item.platform === 'tuf') throw new Error('TakeUForward is not supported in Done Questions.');
      if (!accounts[item.platform]) throw new Error(`Connect ${PLATFORMS[item.platform].name} first.`);
      if (seen.has(item.key) || accounts[item.platform].snapshot?.solved?.[item.key] || accounts[item.platform].snapshot?.recent?.some(r => r.key === item.key)) { duplicates++; continue; }
      seen.add(item.key);
      const match = known.get(item.key);
      if (match) item = { ...item, title: match.title, difficulty: match.difficulty, topics: match.topics };
      records.push(item);
    } catch (error) { unresolved.push({ row: index + 1, reason: error.message }); }
  }
  return { records, duplicates, unresolved };
}
