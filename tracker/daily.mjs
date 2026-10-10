export async function leetcodeDailyUrl(fetcher = fetch) {
  const response = await fetcher('https://leetcode.com/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '{ activeDailyCodingChallengeQuestion { date link } }' }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('Could not load the LeetCode daily problem. Try again.');
  const data = await response.json();
  const link = data.data?.activeDailyCodingChallengeQuestion?.link;
  const day = data.data?.activeDailyCodingChallengeQuestion?.date;
  if (data.errors?.length || typeof link !== 'string') throw new Error('The LeetCode daily problem is unavailable. Try again.');
  if (day && day !== dailyDay('leetcode')) throw new Error('The LeetCode daily problem is updating. Try again.');
  const url = new URL(link, 'https://leetcode.com');
  if (url.origin !== 'https://leetcode.com' || !/^\/problems\/[^/]+\//.test(url.pathname)) {
    throw new Error('The LeetCode daily problem link is invalid.');
  }
  return url.href;
}
export const DAILY_PAGES = {
  leetcode: 'https://leetcode.com/problemset/',
  geeksforgeeks: 'https://www.geeksforgeeks.org/problem-of-the-day',
  code360: 'https://www.naukri.com/code360/problem-of-the-day',
  tuf: 'https://takeuforward.org/potd',
};

export const DAILY_DONE_PREFIX = 'crossdsa-potd-done:';
export function dailyDay(platform, now = Date.now()) {
  return dateKey(now, platform === 'leetcode' ? 'UTC' : 'Asia/Kolkata');
}
export function dailyDoneKey(platform, handle) {
  return `${DAILY_DONE_PREFIX}${platform}:${encodeURIComponent(String(handle).toLowerCase())}`;
}
export async function dailyProblem(platform, fetcher = fetch, now = Date.now()) {
  const day = dailyDay(platform, now);
  if (platform === 'leetcode') return { day, url: await leetcodeDailyUrl(fetcher) };
  if (platform !== 'geeksforgeeks') return null;
  const response = await fetcher('https://practiceapi.geeksforgeeks.org/api/vr/problems-of-day/problem/today/', {
    credentials: 'omit', signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('Could not load the GFG daily problem.');
  const data = await response.json();
  const url = new URL(data.problem_url);
  if (String(data.date).slice(0, 10) !== day || url.origin !== 'https://www.geeksforgeeks.org' || !/^\/problems\/[a-zA-Z0-9_-]+\/1\/?$/.test(url.pathname)) throw new Error('The GFG daily problem is unavailable.');
  return { day, url: url.href };
}
export function dailySolved(platform, state, target, now = Date.now()) {
  if (!state.accounts[platform] || !target || target.day !== dailyDay(platform, now)) return false;
  const key = problemKey(platform, target.url);
  const entry = state.workspace?.[key];
  if (entry?.done && Number.isFinite(entry.doneAt) && dailyDay(platform, entry.doneAt) === target.day) return true;
  return (state.accounts[platform].snapshot?.recent || []).some(item => item.key === key &&
    (item.day || (Number.isFinite(item.timestamp) ? dailyDay(platform, item.timestamp) : null)) === target.day);
}

import { dateKey, problemKey } from './core.mjs';

