import { problemKey } from './core.mjs';
import { parseCodeChefFeed } from './platforms.mjs';
import { parseCode360History } from './code360-history.mjs';

export const HISTORY_PLATFORMS = ['leetcode', 'codeforces', 'codechef', 'geeksforgeeks', 'atcoder', 'code360'];

// One bounded page per checkpoint. Cursors are committed only with its records.
export async function historyPage(platform, handle, cursor, ctx) {
  if (platform === 'code360') return parseCode360History(await ctx.code360Session(handle, cursor?.page ?? 1), handle, cursor || {});
  const offset = Number.isSafeInteger(cursor?.offset) && cursor.offset >= 0 ? cursor.offset : 0;
  if (platform === 'leetcode') {
    const data = await ctx.session(handle, offset);
    const recent = data.submissions.filter(s => /^\d+$/.test(String(s.id)) && /^[a-zA-Z0-9-]+$/.test(s.titleSlug) && Number(s.timestamp) > 0).map(s => {
      const url = `https://leetcode.com/problems/${s.titleSlug}/`;
      return { id: `leetcode:${s.id}`, key: problemKey(platform, url), platform, title: String(s.title), url, timestamp: Number(s.timestamp) * 1000 };
    });
    if (data.hasNext && !data.count) throw new Error('LeetCode history pagination stalled.');
    return { recent, cursor: { offset: offset + data.count }, complete: !data.hasNext };
  }
  if (platform === 'codeforces') {
    const data = await ctx.json(`https://codeforces.com/api/user.status?handle=${encodeURIComponent(handle)}&from=${offset + 1}&count=1000`);
    if (data.status !== 'OK' || !Array.isArray(data.result)) throw new Error(data.comment || 'Codeforces history unavailable.');
    const recent = data.result.filter(s => s.verdict === 'OK' && s.problem?.contestId && s.problem.index).map(s => {
      if (s.author?.members && !s.author.members.some(m => m.handle?.toLowerCase() === handle.toLowerCase())) throw new Error('Submission account did not match.');
      const url = s.problem.contestId >= 100000 ? `https://codeforces.com/gym/${s.problem.contestId}/problem/${s.problem.index}` : `https://codeforces.com/problemset/problem/${s.problem.contestId}/${s.problem.index}`;
      return { id: `codeforces:${s.id}`, key: problemKey(platform, url), platform, title: String(s.problem.name), url, timestamp: Number(s.creationTimeSeconds) * 1000, topics: s.problem.tags || [] };
    });
    return { recent, cursor: { offset: offset + data.result.length }, complete: data.result.length < 1000 };
  }
  if (platform === 'codechef') {
    const data = await ctx.json(`https://www.codechef.com/recent/user?user_handle=${encodeURIComponent(handle)}&page=${offset}`);
    if (typeof data.content !== 'string' || !Number.isFinite(Number(data.max_page))) throw new Error('CodeChef history unavailable.');
    return { recent: parseCodeChefFeed(data.content), cursor: { offset: offset + 1 }, complete: offset + 1 >= Math.max(1, Number(data.max_page)) };
  }
  throw new Error('This platform uses its regular solved-history collector.');
}
