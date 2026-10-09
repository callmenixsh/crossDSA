export const STORAGE_KEY = 'crossdsa-tracker-v1';
export const PLATFORMS = {
  leetcode: { name: 'LeetCode', short: 'LC', color: '#f5b64c', origins: ['https://leetcode.com/*'], profile: h => `https://leetcode.com/u/${encodeURIComponent(h)}/` },
  codeforces: { name: 'Codeforces', short: 'CF', color: '#73a7ff', origins: ['https://codeforces.com/*'], profile: h => `https://codeforces.com/profile/${encodeURIComponent(h)}` },
  codechef: { name: 'CodeChef', short: 'CC', color: '#d7ad8b', origins: ['https://www.codechef.com/*'], profile: h => `https://www.codechef.com/users/${encodeURIComponent(h)}` },
  geeksforgeeks: { name: 'GeeksforGeeks', short: 'GfG', color: '#70cf9b', origins: ['https://authapi.geeksforgeeks.org/*', 'https://practiceapi.geeksforgeeks.org/*'], profile: h => `https://www.geeksforgeeks.org/profile/${encodeURIComponent(h)}` },
  code360: { name: 'Code 360', short: '360', color: '#ff9972', origins: ['https://www.naukri.com/*'], profile: h => `https://www.naukri.com/code360/profile/${encodeURIComponent(h)}` },
  atcoder: { name: 'AtCoder', short: 'AC', color: '#d4d4d4', origins: ['https://atcoder.jp/*', 'https://kenkoooo.com/*'], profile: h => `https://atcoder.jp/users/${encodeURIComponent(h)}` },
  tuf: { name: 'TakeUForward', short: 'TUF', color: '#f28291', origins: ['https://takeuforward.org/*', 'https://backend-go.takeuforward.org/*'], profile: h => `https://takeuforward.org/profile/${encodeURIComponent(h)}` },
};
// Question sources can be available before account tracking is implemented.
export const QUESTION_PLATFORMS = {
  ...PLATFORMS,
  atcoder: { ...PLATFORMS.atcoder, libraryOnly: true },
};

export function emptyState() {
  return { version: 1, accounts: {}, disconnectedAccounts: {}, workspace: {}, lists: { saved: { id: 'saved', name: 'Starred' } }, settings: { dailyGoal: 2, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', autoSync: true, contestsEnabled: true, contestReminders: false } };
}

export function normalizeState(value) {
  const base = emptyState();
  if (!value || value.version !== 1) return base;
  const lists = { ...base.lists, ...value.lists, saved: base.lists.saved };
  const workspace = Object.fromEntries(Object.entries(value.workspace || {}).map(([key, entry]) => [key, {
    ...entry, listIds: Array.isArray(entry.listIds) ? [...new Set(entry.listIds.filter(id => Object.hasOwn(lists, id)))] : entry.bookmarked ? ['saved'] : [],
  }]));
  return { ...base, ...value, accounts: value.accounts || {}, workspace, lists, settings: { ...base.settings, ...value.settings } };
}

export function cleanHandle(platform, input) {
  if (!PLATFORMS[platform]) throw new Error('Unknown platform.');
  let value = String(input || '').trim();
  if (/^https?:/i.test(value)) {
    const url = new URL(value);
    const expected = new URL(PLATFORMS[platform].profile('example')).hostname;
    if (url.hostname !== expected) throw new Error(`Use a ${PLATFORMS[platform].name} profile link.`);
    const parts = url.pathname.split('/').filter(Boolean);
    const profileParts = new URL(PLATFORMS[platform].profile('example')).pathname.split('/').filter(Boolean);
    if (parts.length !== profileParts.length || parts.slice(0, -1).join('/') !== profileParts.slice(0, -1).join('/')) throw new Error('Use a profile link, not a problem link.');
    value = decodeURIComponent(parts.at(-1));
  }
  value = value.replace(/^@/, '');
  if (platform === 'atcoder' && !/^[a-zA-Z0-9_]{1,32}$/.test(value)) throw new Error('Enter a valid AtCoder handle (letters, numbers and underscores).');
  if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(value)) throw new Error('Enter a valid handle (letters, numbers, dots, underscores or hyphens).');
  return value;
}

export function problemKey(platform, url) {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '');
    if (platform === 'leetcode') return `leetcode:${path.split('/problems/')[1]?.split('/')[0] || path}`;
    if (platform === 'codechef') return `codechef:${path.split('/').at(-1)}`;
    if (platform === 'atcoder') {
      const match = path.match(/^\/contests\/[a-zA-Z0-9_-]+\/tasks\/([a-zA-Z0-9_-]+)$/);
      if (match) return `atcoder:${match[1]}`;
    }
    if (platform === 'codeforces') {
      const m = path.match(/\/(?:problemset\/problem|contest|gym)\/(\d+)\/(?:problem\/)?([a-z0-9]+)/i);
      if (m) return `codeforces:${m[1]}:${m[2].toUpperCase()}`;
    }
    if (platform === 'geeksforgeeks') return `geeksforgeeks:${path.split('/problems/')[1]?.split('/')[0] || path}`;
    return `${platform}:${path}`;
  } catch { return `${platform}:${String(url)}`; }
}

export function dateKey(time, timeZone = 'UTC') {
  const date = new Date(time);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  return ['year', 'month', 'day'].map(k => parts.find(p => p.type === k)?.value).join('-');
}

export function shiftDay(day, offset) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function mergeSnapshot(previous, incoming, now = Date.now()) {
  // Recent public feeds are windows, so retain older verified records across syncs.
  const records = new Map((previous?.recent || []).map(item => [item.id, item]));
  for (const item of incoming.recent || []) records.set(item.id, item);
  const recent = [...records.values()].sort((a, b) => b.timestamp - a.timestamp).slice(0, 15000);
  const clipped = records.size > recent.length;
  if (clipped && incoming.atcoderSync) incoming = { ...incoming, localHistoryTruncated: true };
  // GFG exposes a current coding score, so build an honest history from syncs.
  // Keep the latest observation per UTC day, bounded to 180 observed days.
  const scoreHistory = new Map((previous?.scoreHistory || []).map(point => [dateKey(point.timestamp, 'UTC'), point]));
  if (Number.isFinite(incoming.score)) scoreHistory.set(dateKey(now, 'UTC'), { timestamp: now, rating: incoming.score });
  return { ...incoming, recent, ...(scoreHistory.size ? { scoreHistory: [...scoreHistory.values()].sort((a, b) => a.timestamp - b.timestamp).slice(-180) } : {}), ...(clipped ? { partial: true, ...(incoming.recent?.[0]?.platform === 'codeforces' ? { totalIsLowerBound: true } : {}), coverage: `${incoming.coverage || ''} Local history is limited to the newest 15,000 accepted records; older records are omitted.` } : {}) };
}

export function dailyActivity(accounts, timeZone, platform = 'all') {
  const counts = {};
  for (const [id, account] of Object.entries(accounts)) {
    if (platform !== 'all' && id !== platform) continue;
    const snapshot = account.snapshot;
    if (!snapshot) continue;
    if (snapshot.calendar) {
      // Provider calendars are already grouped by provider day. Do not shift them.
      for (const [day, count] of Object.entries(snapshot.calendar)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(count) && count > 0) counts[day] = (counts[day] || 0) + count;
      }
      // Overlay accepts observed after this calendar was fetched. A later sync
      // supplies an updated calendar, so older pending records are not added twice.
      for (const record of snapshot.recent || []) if (record.pending && record.timestamp > (account.syncedAt || 0)) {
        const day = record.day || dateKey(record.timestamp, timeZone);
        if (day) counts[day] = (counts[day] || 0) + 1;
      }
    } else {
      for (const record of snapshot.recent || []) {
        const day = record.day || dateKey(record.timestamp, timeZone);
        if (day) counts[day] = (counts[day] || 0) + 1;
      }
    }
  }
  return counts;
}

export function streaks(counts, today) {
  const days = Object.keys(counts).filter(day => counts[day] > 0 && day <= today).sort();
  let longest = 0, run = 0, previous = null;
  for (const day of days) {
    run = previous && shiftDay(previous, 1) === day ? run + 1 : 1;
    longest = Math.max(longest, run); previous = day;
  }
  let current = 0;
  let day = counts[today] > 0 ? today : shiftDay(today, -1);
  while (counts[day] > 0) { current++; day = shiftDay(day, -1); }
  return { current, longest };
}

export function acceptedToday(accounts, today, timeZone) {
  const keys = new Set();
  for (const account of Object.values(accounts)) for (const record of account.snapshot?.recent || []) {
    if ((record.day || dateKey(record.timestamp, timeZone)) === today) keys.add(record.key);
  }
  return keys.size;
}

export function questionIsDone(accounts, workspace, key) {
  if (typeof workspace[key]?.done === 'boolean') return workspace[key].done;
  return Object.values(accounts).some(a => a.snapshot?.recent?.some(r => r.key === key));
}

export function doneQuestions(accounts, { query = '', platform = 'all', from = '', to = '', sort = 'newest', timeZone = 'UTC', workspace = {} } = {}) {
  const unique = new Map();
  const recent = Object.values(accounts).flatMap(a => a.snapshot?.recent || []).sort((a, b) => b.timestamp - a.timestamp);
  for (const record of recent) if (workspace[record.key]?.done !== false && !unique.has(record.key)) unique.set(record.key, record);
  for (const entry of Object.values(workspace)) if (entry.done && (accounts[entry.platform] || QUESTION_PLATFORMS[entry.platform]?.libraryOnly) && !unique.has(entry.key)) {
    unique.set(entry.key, { ...entry, timestamp: entry.doneAt || entry.updatedAt, source: 'manual' });
  }
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const records = [...unique.values()].sort((a, b) => b.timestamp - a.timestamp).filter(record => {
    const day = record.day || dateKey(record.timestamp, timeZone);
    return (platform === 'all' || record.platform === platform) && terms.every(term => record.title.toLowerCase().includes(term)) && (!from || day >= from) && (!to || day <= to);
  });
  if (sort === 'oldest') records.reverse();
  return { total: unique.size, records };
}

export function safeProblemUrl(url, platform) {
  try {
    const parsed = new URL(url);
    const hosts = { leetcode: 'leetcode.com', codeforces: 'codeforces.com', codechef: 'www.codechef.com', geeksforgeeks: 'www.geeksforgeeks.org', code360: 'www.naukri.com', tuf: 'takeuforward.org', atcoder: 'atcoder.jp' };
    if (platform === 'atcoder' && (parsed.username || parsed.password || parsed.port || !/^\/contests\/[a-zA-Z0-9_-]+\/tasks\/[a-zA-Z0-9_-]+\/?$/.test(parsed.pathname))) return null;
    return parsed.protocol === 'https:' && parsed.hostname === hosts[platform] ? parsed.href : null;
  } catch { return null; }
}


export function practiceOverview(state, now = Date.now()) {
  const today = dateKey(now, state.settings.timeZone);
  const snapshots = Object.values(state.accounts).filter(account => account.snapshot);
  const leetcode = state.accounts.leetcode;
  const streakAccounts = leetcode?.snapshot ? { leetcode } : state.accounts;
  const current = streaks(dailyActivity(streakAccounts, state.settings.timeZone), today).current;
  return {
    today: acceptedToday(state.accounts, today, state.settings.timeZone), goal: state.settings.dailyGoal,
    total: snapshots.length ? snapshots.reduce((sum, account) => sum + Number(account.snapshot.totalSolved || 0), 0) : null,
    lowerBound: snapshots.some(account => account.snapshot.totalIsLowerBound),
    streak: snapshots.length ? current : null, streakLabel: leetcode?.snapshot ? 'Streak - LeetCode' : 'Activity streak',
    warning: snapshots.map(account => account.snapshot.activityWarning).filter(Boolean).join(' '),
    error: Object.values(state.accounts).map(account => account.error).filter(Boolean).join(' '),
    syncing: Object.values(state.accounts).some(account => account.status === 'syncing'),
  };
}
