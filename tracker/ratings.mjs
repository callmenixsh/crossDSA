import { dateKey } from './core.mjs';

export function ratingSeries(accounts, year, timeZone, selected = 'all') {
  const series = [];
  for (const [id, account] of Object.entries(accounts)) {
    const snapshot = account.snapshot;
    if (!snapshot || (selected !== 'all' && selected !== id)) continue;
    const score = id === 'geeksforgeeks';
    // Coding scores are a separate metric, never a contest-rating series.
    if (score && selected === 'all') continue;
    const current = score ? snapshot.score : snapshot.rating;
    let points = (score ? snapshot.scoreHistory || [] : snapshot.ratings || [])
      .filter(p => Number.isFinite(p.rating) && Number.isFinite(p.timestamp) && p.timestamp > 0)
      .map(p => ({ ...p }));
    if (!points.length && Number.isFinite(current) && Number.isFinite(account.syncedAt) && account.syncedAt > 0) {
      points = [{ timestamp: account.syncedAt, rating: current, title: score ? 'Synced score' : 'Synced rating' }];
    }
    points = points.filter(p => dateKey(p.timestamp, timeZone)?.startsWith(`${year}-`)).sort((a, b) => a.timestamp - b.timestamp);
    if (points.length) series.push({ id, score, points });
  }
  return series;
}
