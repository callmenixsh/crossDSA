export const CONTEST_KEY = 'crossdsa-contests-v1';
export const CONTEST_SOURCES = {
  leetcode: { name: 'LeetCode', origin: 'https://leetcode.com/*' },
  codeforces: { name: 'Codeforces', origin: 'https://codeforces.com/*' },
};
export const CONTEST_ORIGINS = Object.values(CONTEST_SOURCES).map(source => source.origin);
export const REFRESH_ALARM = 'crossdsa-contests-refresh';
export const REMINDER_PREFIX = 'crossdsa-contest:';
const HOUR = 3600000;

export function normalizeContests(data) {
  const items = data?.data?.allContests ?? data?.data?.topTwoContests;
  if (!Array.isArray(items) || data.errors?.length) throw new Error('Contest schedule unavailable.');
  const contests = new Map();
  for (const item of items) {
    if (!item) continue;
    if (typeof item.titleSlug !== 'string' || item.titleSlug.length > 100 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.titleSlug) || typeof item.title !== 'string' || !item.title.trim() || !Number.isFinite(item.startTime) || item.startTime <= 0 || !Number.isFinite(item.duration) || item.duration <= 0 || item.duration > 14 * 86400 || !Number.isFinite(new Date((item.startTime + item.duration) * 1000).getTime())) continue;
    contests.set(item.titleSlug, { id: item.titleSlug, platform: 'leetcode', title: item.title.slice(0, 150), start: item.startTime * 1000, end: (item.startTime + item.duration) * 1000, url: `https://leetcode.com/contest/${item.titleSlug}/` });
  }
  if (items.length && !contests.size) throw new Error('Contest schedule unavailable.');
  return [...contests.values()].sort((a, b) => a.start - b.start);
}

export function normalizeCodeforcesContests(data) {
  if (data?.status !== 'OK' || !Array.isArray(data.result)) throw new Error('Contest schedule unavailable.');
  const contests = new Map();
  for (const item of data.result) {
    if (!item || !Number.isSafeInteger(item.id) || item.id <= 0 || typeof item.name !== 'string' || !item.name.trim() ||
      !['BEFORE', 'CODING', 'PENDING_SYSTEM_TEST', 'SYSTEM_TEST', 'FINISHED'].includes(item.phase) ||
      !Number.isFinite(item.startTimeSeconds) || item.startTimeSeconds <= 0 || !Number.isFinite(item.durationSeconds) || item.durationSeconds <= 0 || item.durationSeconds > 14 * 86400 || !Number.isFinite(new Date((item.startTimeSeconds + item.durationSeconds) * 1000).getTime())) continue;
    const id = `codeforces-${item.id}`;
    contests.set(id, { id, platform: 'codeforces', title: item.name.slice(0, 150), start: item.startTimeSeconds * 1000,
      end: (item.startTimeSeconds + item.durationSeconds) * 1000, url: `https://codeforces.com/contest/${item.id}` });
  }
  if (data.result.length && !contests.size) throw new Error('Contest schedule unavailable.');
  return [...contests.values()].sort((a, b) => a.start - b.start);
}

export function contestPlatform(contest) { return contest.platform || 'leetcode'; }
export function sourceCache(cache, platform) {
  if (cache.sources) return cache.sources[platform] || {};
  return platform === 'leetcode' ? { ...cache, items: (cache.items || []).map(item => ({ ...item, platform: 'leetcode' })) } : {};
}
export function sourceIsFresh(cache, platform, now = Date.now()) {
  const source = sourceCache(cache, platform);
  return Boolean(source.updatedAt && now - source.updatedAt <= 6 * HOUR && !source.error && !source.needsAccess);
}
export function safeContestUrl(contest) {
  return contestPlatform(contest) === 'codeforces' ? /^https:\/\/codeforces\.com\/contest\/[1-9]\d*$/.test(contest.url)
    : contestPlatform(contest) === 'leetcode' && /^https:\/\/leetcode\.com\/contest\/[a-z0-9]+(?:-[a-z0-9]+)*\/$/.test(contest.url);
}
export function retainContests(items, now = Date.now()) {
  return items.filter(item => safeContestUrl(item) && Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start && item.end >= now - 90 * 86400000);
}

export function activeContests(items = [], now = Date.now()) {
  return items.filter(item => item.end > now).sort((a, b) => a.start - b.start);
}

export function countdown(contest, now = Date.now()) {
  if (now >= contest.end) return 'Ended';
  if (now >= contest.start) return 'Live';
  const minutes = Math.ceil((contest.start - now) / 60000);
  if (minutes >= 1440) return `in ${Math.floor(minutes / 1440)}d ${Math.floor(minutes % 1440 / 60)}h`;
  if (minutes >= 60) return `in ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `in ${minutes}m`;
}

export function reminderName(contest, minutes) {
  return `${REMINDER_PREFIX}${contest.id}:${contest.start}:${minutes}`;
}

export function reminderPlan(cache, now = Date.now()) {
  return activeContests(cache.items, now).filter(contest => sourceIsFresh(cache, contestPlatform(contest), now) && safeContestUrl(contest))
    .flatMap(contest => [60, 10].map(minutes => ({ name: reminderName(contest, minutes), when: contest.start - minutes * 60000, contest, minutes })))
    .filter(item => item.when > now && !cache.sent?.[item.name]);
}
