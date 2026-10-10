import { problemKey } from '../core.mjs';

const API = 'https://kenkoooo.com/atcoder/atcoder-api/v3/user/submissions';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const assert = (condition, message) => { if (!condition) throw new Error(message); };

export function parseAtCoderProfile(html, handle) {
  assert(new RegExp(`<title>\\s*${handle} - AtCoder\\s*</title>`, 'i').test(html), 'AtCoder profile not found or unavailable. Check your handle.');
  const cell = label => {
    const raw = html.match(new RegExp(`<th\\b[^>]*>\\s*${label}\\s*</th>\\s*<td\\b[^>]*>([\\s\\S]*?)</td>`, 'i'))?.[1];
    return raw?.replace(/<[^>]+>/g, '').trim();
  };
  const integer = text => {
    const match = text?.match(/^[\d,]+/);
    return match ? Number(match[0].replaceAll(',', '')) : null;
  };
  return { rating: integer(cell('Rating')), highestRating: integer(cell('Highest Rating')), rank: integer(cell('Rank')) };
}

export async function atcoder(handle, ctx) {
  assert(/^[a-zA-Z0-9_]{1,32}$/.test(handle), 'Enter a valid AtCoder handle (letters, numbers and underscores).');
  const wait = ctx.wait || pause, now = Math.floor((ctx.now?.() ?? Date.now()) / 1000);
  const profile = parseAtCoderProfile(await ctx.text(`https://atcoder.jp/users/${encodeURIComponent(handle)}?lang=en`), handle);
  await wait(1100);
  let ratings = ctx.previous?.ratings || [], ratingWarning = '';
  try {
    const history = await ctx.json(`https://atcoder.jp/users/${encodeURIComponent(handle)}/history/json`);
    assert(Array.isArray(history), 'AtCoder rating history is unavailable.');
    ratings = history.filter(r => r.IsRated === true && Number.isFinite(r.NewRating) && r.NewRating >= 0 && Number.isFinite(Date.parse(r.EndTime)))
      .map(r => ({ timestamp: Date.parse(r.EndTime), rating: r.NewRating, title: String(r.ContestNameEn || r.ContestName || 'AtCoder contest') })).sort((a, b) => a.timestamp - b.timestamp);
  } catch { ratingWarning = 'Rating history could not refresh; previously cached history is retained.'; }

  const previous = ctx.previous, sync = previous?.atcoderSync?.version === 1 ? previous.atcoderSync : {};
  const recent = new Map((previous?.recent || []).map(r => [r.id, r]));
  const solved = new Set(sync.solvedTaskIds || [...recent.values()].map(r => r.key?.replace(/^atcoder:/, '')).filter(validId));
  let cursor = Number.isSafeInteger(sync.cursor) ? sync.cursor : 0;
  let recentCursor = Number.isSafeInteger(sync.recentCursor) ? sync.recentCursor : Math.max(0, now - 7 * 86400);
  let historyComplete = sync.historyComplete === true, recentComplete = false, warning = '', requests = 0;
  const initialSize = recent.size;
  const page = async from => {
    if (requests) await wait(1100);
    requests++;
    const rows = await ctx.json(`${API}?user=${encodeURIComponent(handle)}&from_second=${from}`);
    assert(Array.isArray(rows) && rows.length <= 500, 'AtCoder Problems returned invalid submission history.');
    let maximum = from;
    for (const row of rows) {
      assert(Number.isSafeInteger(row.id) && row.id > 0 && Number.isSafeInteger(row.epoch_second) && row.epoch_second >= from && row.epoch_second <= now + 300 && typeof row.result === 'string' && validId(row.problem_id) && validId(row.contest_id) && typeof row.user_id === 'string' && row.user_id.toLowerCase() === handle.toLowerCase(), 'AtCoder Problems returned unexpected submission data.');
      maximum = Math.max(maximum, row.epoch_second);
      if (row.result !== 'AC') continue;
      const url = `https://atcoder.jp/contests/${row.contest_id}/tasks/${row.problem_id}`;
      solved.add(row.problem_id);
      recent.set(`atcoder:${row.id}`, { id: `atcoder:${row.id}`, key: problemKey('atcoder', url), platform: 'atcoder', title: ctx.problemTitles?.get(row.problem_id) || row.problem_id, url, timestamp: row.epoch_second * 1000 });
    }
    return { full: rows.length === 500, maximum };
  };
  try {
    // Recent activity gets priority over old history. Revisit a day to catch delayed indexing.
    let from = Math.max(0, recentCursor - (sync.recentComplete === false ? 0 : 86400));
    for (let i = 0; i < 5; i++) {
      const data = await page(from);
      recentCursor = data.maximum;
      if (!data.full) { recentComplete = true; recentCursor = Math.max(recentCursor, now - 86400); break; }
      if (data.maximum === from) { warning = 'Submission pagination stalled at a timestamp; history remains incomplete.'; break; }
      from = data.maximum; // Inclusive boundary: replay the last second, never skip it.
    }
    for (let i = 0; !historyComplete && i < 5; i++) {
      const data = await page(cursor);
      if (!data.full) { historyComplete = true; cursor = data.maximum; break; }
      if (data.maximum === cursor) { warning = 'Submission pagination stalled at a timestamp; history remains incomplete.'; break; }
      cursor = data.maximum;
    }
  } catch (error) {
    // Commit successfully imported pages and their cursors, even if a later request fails.
    warning = `AtCoder Problems activity could not fully refresh: ${error.message}`;
    if (!previous && recent.size === initialSize && !solved.size) throw new Error(warning);
  }
  const incomplete = !historyComplete || !recentComplete;
  const localHistoryTruncated = previous?.localHistoryTruncated === true || recent.size > 15000;
  const activityWarning = warning || (!recentComplete ? 'Recent submissions are still being imported. Sync again to continue.' : '');
  const coverage = `Submissions from the unofficial AtCoder Problems index; updates may be delayed. ${historyComplete ? 'Available historical submissions imported.' : 'Older submissions are still being imported; solved total is a lower bound. Sync again to continue.'} ${recentComplete ? '' : 'Recent activity may be incomplete.'} Up to 5 recent and 5 historical pages per sync, 500 submissions per page. Ratings are for Algorithm contests. ${ratingWarning} ${activityWarning}`.trim();
  return { ...profile, totalSolved: solved.size, totalIsLowerBound: incomplete, breakdown: {}, badges: [], ratings, ratingWarning, recent: [...recent.values()].sort((a, b) => b.timestamp - a.timestamp), localHistoryTruncated, partial: incomplete || Boolean(warning) || localHistoryTruncated, activityKind: 'accepted submissions', activityWarning, coverage: coverage + (localHistoryTruncated ? ' Local activity retains the newest 15,000 accepted records; unique solved IDs are retained separately.' : ''),
    atcoderSync: { version: 1, cursor, recentCursor, historyComplete, recentComplete, solvedTaskIds: [...solved].sort() } };
}
