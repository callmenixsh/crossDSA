// Read the public profile's server-rendered data without executing website scripts.
export function parseTufProfile(html, handle) {
  if (typeof html !== 'string') throw new Error('TakeUForward profile unavailable.');
  const canonical = html.match(/<link\b[^>]*rel="canonical"[^>]*href="([^"]+)"/i)?.[1];
  if (canonical !== `https://takeuforward.org/profile/${encodeURIComponent(handle)}`) throw new Error('TakeUForward profile did not match the connected handle.');
  const chunks = [];
  for (const [, encoded] of html.matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g)) {
    try { const chunk = JSON.parse(encoded); if (chunk[0] === 1 && typeof chunk[1] === 'string') chunks.push(chunk[1]); } catch { /* Other script data is ignored. */ }
  }
  let progress, heatmap;
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (value.dsaProgress?.byPlatform?.TUF) progress = value.dsaProgress.byPlatform.TUF;
    if (value.username === handle && value.initialHeatmap) heatmap = value.initialHeatmap;
    for (const item of Object.values(value)) visit(item);
  };
  for (const line of chunks.join('').split('\n')) {
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    try { visit(JSON.parse(line.slice(separator + 1))); } catch { /* Non-JSON flight records are ignored. */ }
  }
  if (progress?.platform !== 'TUF' || !Number.isFinite(progress.solved) || progress.solved < 0) throw new Error('TakeUForward public solved totals are unavailable.');
  return {
    progress: { platform: 'TUF', totalSolved: progress.solved,
      difficultyBreakdown: (progress.categories || []).map(item => ({ level: item.label, solved: item.solved })),
      topicAnalysis: (progress.topics || []).map(item => ({ topic: item.label, solved: item.solved })) },
    heatmap: heatmap || { availableFilters: [], heatmapData: [] },
  };
}
