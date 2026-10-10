import { problemKey, safeProblemUrl } from './core.mjs';

// Contract verified against Code360's profile API service and solved-list UI.
export function parseCode360History(data, handle, cursor = {}) {
  const page = cursor.page ?? 1;
  if (!Array.isArray(data?.handles) || !data.handles.includes(handle.toLowerCase())) throw new Error('Code360 account did not match.');
  if (data.page !== page || !Number.isSafeInteger(data.totalPages) || data.totalPages < 0 || !Array.isArray(data.rows) || data.rows.length > 1000) throw new Error('Invalid Code360 history page.');
  if ((!data.rows.length && page < data.totalPages) || (data.totalPages === 0 && data.rows.length)) throw new Error('Code360 history pagination stalled.');
  const solved = {}, recent = [];
  let skipped = 0;
  for (const row of data.rows) {
    let url;
    try {
      const parsed = new URL(row.link, 'https://www.naukri.com');
      if (['www.codingninjas.com', 'codingninjas.com'].includes(parsed.hostname) && /^\/(?:studio|codestudio)\/problems\//.test(parsed.pathname)) {
        parsed.hostname = 'www.naukri.com'; parsed.pathname = parsed.pathname.replace(/^\/(?:studio|codestudio)/, '/code360');
      }
      if (!row.link || !safeProblemUrl(parsed.href, 'code360') || parsed.username || parsed.password || parsed.port || !/^\/code360\/problems\/[a-zA-Z0-9_-]+\/?$/.test(parsed.pathname)) throw new Error();
      url = `https://www.naukri.com${parsed.pathname.replace(/\/+$/, '')}`;
    } catch { skipped++; continue; }
    if (typeof row.title !== 'string' || !row.title.trim()) { skipped++; continue; }
    const key = problemKey('code360', url);
    // A timezone is required: browser locale must not shift provider timestamps.
    const timestamp = typeof row.solvedAt === 'string' && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(row.solvedAt) ? Date.parse(row.solvedAt) : NaN;
    const dated = Number.isFinite(timestamp) && timestamp > 0 && timestamp <= Date.now() + 60000;
    const record = { key, platform: 'code360', url, title: row.title.trim().slice(0, 300), source: 'provider', ...(dated ? { id: `code360:solved:${key}`, timestamp } : {}) };
    if (!solved[key] || (record.timestamp || 0) > (solved[key].timestamp || 0)) solved[key] = record;
  }
  const fingerprint = JSON.stringify(data.rows.map(r => [r.link, r.solvedAt]));
  if (data.rows.length && fingerprint === cursor.fingerprint) throw new Error('Code360 returned the same history page again.');
  for (const record of Object.values(solved)) if (record.timestamp) recent.push(record);
  return { solved, recent, skipped, cursor: { page: page + 1, fingerprint }, complete: page >= data.totalPages };
}
