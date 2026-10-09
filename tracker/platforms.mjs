import { problemKey } from './core.mjs';

const num = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
const required = (condition, message = 'The platform returned an unexpected response. Try again later.') => { if (!condition) throw new Error(message); };
const record = (platform, id, title, url, timestamp, extra = {}) => ({ id: `${platform}:${id}`, key: problemKey(platform, url), platform, title: String(title), url, timestamp: num(timestamp), ...extra });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function leetcode(handle, ctx) {
  const username = JSON.stringify(handle);
  const data = await ctx.json('https://leetcode.com/graphql', { method: 'POST', body: JSON.stringify({ query: `query {
    matchedUser(username: ${username}) { username profile { ranking } submitStatsGlobal { acSubmissionNum { difficulty count } } badges { name } userCalendar { activeYears streak totalActiveDays submissionCalendar } }
    recentAcSubmissionList(username: ${username}, limit: 20) { id title titleSlug timestamp }
    userContestRanking(username: ${username}) { rating globalRanking attendedContestsCount }
    userContestRankingHistory(username: ${username}) { attended rating contest { title startTime } }
  }` }) });
  required(!data.errors, data.errors?.[0]?.message);
  const user = data.data?.matchedUser;
  required(user, 'LeetCode profile not found. Check your handle.');
  const calendar = {};
  let submissions = data.data.recentAcSubmissionList || [];
  let activityWarning = '', recentSource = 'public';
  if (ctx.ownRecent) {
    try {
      const own = await ctx.ownRecent(handle);
      submissions = [...submissions, ...own]; recentSource = 'signed-in';
    } catch (error) {
      if (!submissions.length) activityWarning = error.message;
    }
  }
  if (!submissions.length && recentSource === 'public' && !activityWarning) activityWarning = 'LeetCode returned no public accepted submissions. Open a signed-in LeetCode tab and refresh activity.';
  const recent = [...new Map(submissions.filter(s => s.id && s.titleSlug && num(s.timestamp)).map(s => {
    const item = record('leetcode', s.id, s.title, `https://leetcode.com/problems/${encodeURIComponent(s.titleSlug)}/`, num(s.timestamp) * 1000);
    return [item.id, item];
  })).values()];
  const addCalendar = raw => {
    const entries = JSON.parse(raw || '{}');
    for (const [seconds, count] of Object.entries(entries)) {
      const time = num(seconds) * 1000;
      if (time && num(count)) calendar[new Date(time).toISOString().slice(0, 10)] = num(count);
    }
  };
  addCalendar(user.userCalendar?.submissionCalendar);
  const activeYears = user.userCalendar?.activeYears || [];
  const currentYear = new Date().getUTCFullYear();
  // Three years keep background refresh bounded. Never claim full account history.
  for (const year of activeYears.filter(y => y >= currentYear - 2 && y < currentYear)) {
    const older = await ctx.json('https://leetcode.com/graphql', { method: 'POST', body: JSON.stringify({ query: `query { matchedUser(username: ${username}) { userCalendar(year: ${Number(year)}) { submissionCalendar } } }` }) });
    required(!older.errors && older.data?.matchedUser?.userCalendar);
    addCalendar(older.data.matchedUser.userCalendar.submissionCalendar);
  }
  const breakdown = Object.fromEntries((user.submitStatsGlobal?.acSubmissionNum || []).map(v => [v.difficulty, num(v.count)]));
  return { totalSolved: breakdown.All || 0, breakdown, rank: num(user.profile?.ranking), rating: data.data.userContestRanking?.rating ?? null, badges: (user.badges || []).map(b => b.name),
    ratings: (data.data.userContestRankingHistory || []).filter(v => v.attended).map(v => ({ timestamp: num(v.contest.startTime) * 1000, rating: num(v.rating), title: v.contest.title })),
    calendar, recent, activityWarning, recentSource, coverage: `${recentSource === 'signed-in' ? 'Accepted metadata from up to 100 recent submissions in the matching signed-in LeetCode tab, plus public accepts.' : 'Public recent accepted list: up to 20 per sync.'} Older records retained locally. Calendar: up to 3 years of platform-reported submissions, including activity that may not be a new solve. ${activityWarning}`, activityKind: 'submissions', partial: true };
}

async function codeforces(handle, ctx) {
  const accepted = [], seen = new Set();
  const previous = ctx.previous?.recent || [];
  const latestKnown = previous.length ? Math.max(...previous.map(r => Number(r.id.split(':').at(-1)) || 0)) : 0;
  let complete = false;
  for (let page = 0; page < 10; page++) {
    if (page) await (ctx.wait || wait)(2100);
    const data = await ctx.json(`https://codeforces.com/api/user.status?handle=${encodeURIComponent(handle)}&from=${page * 1000 + 1}&count=1000`);
    required(data.status === 'OK', data.comment || 'Codeforces profile could not be loaded.');
    required(Array.isArray(data.result));
    for (const s of data.result) {
      if (s.verdict !== 'OK' || !s.problem?.contestId || !s.problem.index || seen.has(s.id)) continue;
      seen.add(s.id);
      const url = s.problem.contestId >= 100000 ? `https://codeforces.com/gym/${s.problem.contestId}/problem/${s.problem.index}` : `https://codeforces.com/problemset/problem/${s.problem.contestId}/${s.problem.index}`;
      accepted.push(record('codeforces', s.id, s.problem.name, url, num(s.creationTimeSeconds) * 1000, { topics: s.problem.tags || [], difficulty: s.problem.rating ? String(s.problem.rating) : 'Unrated' }));
    }
    if (data.result.length < 1000) { complete = true; break; }
    if (latestKnown && data.result.some(s => s.id <= latestKnown)) { complete = !ctx.previous.partial; break; }
  }
  await (ctx.wait || wait)(2100);
  const history = await ctx.json(`https://codeforces.com/api/user.rating?handle=${encodeURIComponent(handle)}`);
  required(history.status === 'OK', history.comment);
  const ratings = history.result.map(r => ({ timestamp: num(r.ratingUpdateTimeSeconds) * 1000, rating: num(r.newRating), title: r.contestName }));
  const merged = new Map(previous.map(r => [r.id, r]));
  for (const item of accepted) merged.set(item.id, item);
  return { totalSolved: new Set([...merged.values()].map(r => r.key)).size, totalIsLowerBound: !complete, breakdown: {}, rating: ratings.at(-1)?.rating ?? null, rank: null, badges: [], ratings, recent: [...merged.values()],
    coverage: complete ? 'Accepted submission history imported. Unique solves count once per problem; practice activity includes repeat accepts.' : 'Imported the newest 10,000 submissions. Solved count is a lower bound; older history is not included.', activityKind: 'accepted submissions', partial: !complete };
}

export function parseCodeChefFeed(html) {
  const records = [];
  for (const row of String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const value = row[1];
    if (!/title\s*=\s*['"]accepted['"]/i.test(value)) continue;
    const link = value.match(/href\s*=\s*['"]([^'"]*\/problems\/([a-z0-9_]+))['"]/i);
    const date = value.match(/(\d{1,2}):(\d{2})\s*(AM|PM)\s+(\d{2})\/(\d{2})\/(\d{2,4})/i);
    if (!link || !date) continue;
    const [, hour, minute, period, day, month, year] = date;
    const y = year.length === 2 ? 2000 + Number(year) : Number(year);
    // CodeChef's public feed displays IST dates, without an explicit offset.
    const timestamp = Date.parse(`${y}-${month}-${day}T${String(Number(hour) % 12 + (period.toUpperCase() === 'PM' ? 12 : 0)).padStart(2, '0')}:${minute}:00+05:30`);
    if (!Number.isFinite(timestamp)) continue;
    const code = link[2];
    const solution = value.match(/href\s*=\s*['"][^'"]*\/(?:viewsolution|status)\/(\d+)['"]/i)?.[1];
    records.push(record('codechef', solution || `${code}:${timestamp}`, code, `https://www.codechef.com/problems/${code}`, timestamp));
  }
  return records;
}

async function codechef(handle, ctx) {
  const profile = await ctx.text(`https://www.codechef.com/users/${encodeURIComponent(handle)}`);
  const total = profile.match(/Total Problems Solved:\s*([\d,]+)/i)?.[1];
  required(total !== undefined, 'CodeChef profile unavailable. Check the handle or try again later.');
  const rating = profile.match(/class=["'][^"']*rating-number[^"']*["'][^>]*>\s*(\d+)/i)?.[1];
  const accepted = [];
  let complete = false;
  for (let page = 0; page < 10; page++) {
    if (page) await (ctx.wait || wait)(500);
    const feed = await ctx.json(`https://www.codechef.com/recent/user?user_handle=${encodeURIComponent(handle)}&page=${page}`);
    required(typeof feed.content === 'string' && Number.isFinite(Number(feed.max_page)), 'CodeChef submission feed is unavailable.');
    accepted.push(...parseCodeChefFeed(feed.content));
    if (page + 1 >= Math.max(1, num(feed.max_page))) { complete = true; break; }
  }
  return { totalSolved: num(total.replaceAll(',', '')), breakdown: {}, rating: rating ? num(rating) : null, rank: null, badges: [], ratings: [], recent: accepted,
    coverage: `${complete ? 'Available submission pages imported.' : 'Newest 10 submission pages imported; older activity may be missing.'} Feed dates interpreted as IST. Repeated accepts in the same minute may be combined when no submission ID is exposed.`, partial: !complete, activityKind: 'accepted submissions' };
}

async function geeksforgeeks(handle, ctx) {
  const profile = await ctx.json(`https://authapi.geeksforgeeks.org/api-get/user-profile-info/?handle=${encodeURIComponent(handle)}&article_count=false&redirect=true`);
  required(profile.data && profile.data.total_problems_solved !== undefined, 'GeeksforGeeks profile not found or unavailable.');
  const data = await ctx.json('https://practiceapi.geeksforgeeks.org/api/v1/user/problems/submissions/', { method: 'POST', body: JSON.stringify({ handle, requestType: '', year: '', month: '' }) });
  required(data.status === 'success' && data.result, 'GeeksforGeeks solved history is unavailable.');
  const recent = [], breakdown = {};
  for (const [difficulty, group] of Object.entries(data.result)) {
    breakdown[difficulty] = Object.keys(group || {}).length;
    for (const [id, p] of Object.entries(group || {})) {
      const day = String(p.user_subtime || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !p.slug) continue;
      recent.push(record('geeksforgeeks', id, p.pname, `https://www.geeksforgeeks.org/problems/${encodeURIComponent(p.slug)}/1`, Date.parse(`${day}T12:00:00Z`), { day, difficulty }));
    }
  }
  const totalSolved = num(profile.data.total_problems_solved);
  return { totalSolved, breakdown, rating: null, score: profile.data.score == null ? null : num(profile.data.score), rank: num(profile.data.institute_rank) || null, badges: [], ratings: [], recent,
    coverage: `Dated solved-problem records (${recent.length}/${totalSolved}). Provider dates retained as supplied; these are not a complete log of attempts or repeat solves. Profile streak fields describe Problem of the Day.`, partial: recent.length !== totalSolved, activityKind: 'dated solved records' };
}

async function code360(handle, ctx) {
  const data = await ctx.json(`https://www.naukri.com/code360/api/v3/public_section/profile/user_details?uuid=${encodeURIComponent(handle)}`);
  const counts = data.data?.dsa_domain_data?.problem_count_data;
  required(counts && counts.total_count !== undefined, 'Code 360 profile unavailable. Use the ID or handle from your public profile link.');
  const streak = await ctx.json(`https://www.naukri.com/code360/api/v3/public_section/streaks/progress?uuid=${encodeURIComponent(handle)}`);
  return { totalSolved: num(counts.total_count), breakdown: Object.fromEntries((counts.difficulty_data || []).map(v => [v.level, num(v.count)])), rating: null, rank: null, badges: [], ratings: [], recent: [],
    providerStreak: streak.data ? { current: num(streak.data.current_streak), longest: num(streak.data.longest_streak) } : null,
    coverage: 'Public solved totals and streak statistics only. Dated submission history needs account access and is not imported; this platform is excluded from the combined heatmap and daily goal.', partial: true, activityKind: 'profile only' };
}

async function tuf(handle, ctx) {
  const prefix = `https://backend-go.takeuforward.org/api/v2/profile/${encodeURIComponent(handle)}`;
  const data = await ctx.siteJson(prefix);
  required(data.success && data.data?.learningProgress, data.message || 'TakeUForward profile unavailable.');
  const progress = data.data.learningProgress.find(v => v.platform === 'TUF');
  required(progress, 'No TUF progress found on this profile.');
  const heatmap = await ctx.siteJson(`${prefix}/heatmap`);
  required(heatmap.success && Array.isArray(heatmap.data?.heatmapData), 'TakeUForward activity unavailable.');
  // A TUF profile may aggregate connected external platforms. Request TUF alone.
  const filtered = (heatmap.data.availableFilters || []).filter(v => v !== 'All');
  let calendar = {};
  let coverage = 'Public TUF profile totals; activity history unavailable.';
  if (filtered.length === 1 && filtered[0] === 'TUF') {
    calendar = Object.fromEntries(heatmap.data.heatmapData.filter(v => /^\d{4}-\d{2}-\d{2}$/.test(v.date)).map(v => [v.date, num(v.count)]));
    coverage = 'TUF-only provider activity calendar (last 12 months). Calendar contributions are not guaranteed to be unique accepted problems. Individual solved problem history is not exposed here.';
  } else coverage = 'Profile totals imported. The public heatmap combines connected platforms, so it is excluded to prevent double-counting activity.';
  return { totalSolved: num(progress.totalSolved), breakdown: Object.fromEntries((progress.difficultyBreakdown || []).map(v => [v.level, num(v.solved)])), rating: null, rank: null, badges: [], ratings: [], recent: [], calendar,
    topics: (progress.topicAnalysis || []).map(v => ({ topic: v.topic, count: num(v.solved) })), coverage, partial: true, activityKind: 'provider contributions' };
}

export const collectors = { leetcode, codeforces, codechef, geeksforgeeks, code360, tuf };
