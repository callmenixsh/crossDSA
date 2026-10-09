export const CONTEST_KEY = 'crossdsa-contests-v1';
export const CONTEST_ORIGINS = ['https://leetcode.com/*'];
export const REFRESH_ALARM = 'crossdsa-contests-refresh';
export const REMINDER_PREFIX = 'crossdsa-contest:';
const HOUR = 3600000;

export function normalizeContests(data) {
  if (!Array.isArray(data?.data?.topTwoContests) || data.errors?.length) throw new Error('Contest schedule unavailable.');
  const contests = new Map();
  for (const item of data.data.topTwoContests) {
    if (!/^(weekly|biweekly)-contest-\d+$/.test(item.titleSlug) || typeof item.title !== 'string' || !item.title.trim() || !Number.isFinite(item.startTime) || item.startTime <= 0 || !Number.isFinite(item.duration) || item.duration <= 0 || item.duration > 86400) continue;
    contests.set(item.titleSlug, { id: item.titleSlug, title: item.title.slice(0, 150), start: item.startTime * 1000, end: (item.startTime + item.duration) * 1000, url: `https://leetcode.com/contest/${item.titleSlug}/` });
  }
  if (data.data.topTwoContests.length && !contests.size) throw new Error('Contest schedule unavailable.');
  return [...contests.values()].sort((a, b) => a.start - b.start);
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
  if (!cache.updatedAt || now - cache.updatedAt > 6 * HOUR || cache.error) return [];
  return activeContests(cache.items, now).flatMap(contest => [60, 10].map(minutes => ({ name: reminderName(contest, minutes), when: contest.start - minutes * 60000, contest, minutes })))
    .filter(item => item.when > now && !cache.sent?.[item.name]);
}
