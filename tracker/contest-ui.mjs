import { STORAGE_KEY, normalizeState } from './core.mjs';
import { CONTEST_KEY, activeContests, countdown } from './contests.mjs';

export async function mountContestStrip(host) {
  if (!host) return;
  let prefs = normalizeState().settings, cache = {};
  function anchor(text, url, className = '') {
    const a = document.createElement('a'); a.textContent = text; a.href = url; a.className = className;
    a.target = '_blank'; a.rel = 'noopener noreferrer'; return a;
  }
  function row(contest) {
    const a = anchor('', contest.url, 'contest-row');
    const dot = document.createElement('span'); dot.className = 'contest-dot'; dot.setAttribute('aria-hidden', 'true');
    const icon = document.createElement('span'); icon.className = 'contest-trophy'; icon.setAttribute('aria-hidden', 'true');
    // Use a small inline trophy, consistent across system fonts.
    icon.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M8 3h8v7a4 4 0 0 1-8 0V3ZM8 5H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4M12 14v5m-4 2h8m-6-2h4"/></svg>';
    const title = document.createElement('span'); title.className = 'contest-title'; title.textContent = contest.title;
    const time = document.createElement('span'); time.className = 'contest-time'; time.textContent = countdown(contest);
    a.classList.toggle('is-live', time.textContent === 'Live');
    a.title = `${new Intl.DateTimeFormat(undefined, { timeZone: prefs.timeZone, dateStyle: 'full', timeStyle: 'short' }).format(new Date(contest.start))}${cache.error ? ' (saved schedule)' : ''}`;
    a.append(dot, icon, title, time); return a;
  }
  function render() {
    const expanded = host.querySelector('details')?.open;
    host.replaceChildren(); host.hidden = !prefs.contestsEnabled;
    if (host.hidden) return;
    if (cache.needsAccess) { host.append(anchor('Enable contest schedule access \u2197', chrome.runtime.getURL('dashboard.html#settings'), 'contest-empty')); return; }
    const contests = activeContests(cache.items);
    if (!contests.length) {
      host.append(anchor(cache.error ? 'Contest schedule unavailable \u2197' : cache.updatedAt ? 'No upcoming contests \u2197' : 'Loading contests\u2026', 'https://leetcode.com/contest/', 'contest-empty')); return;
    }
    host.append(row(contests[0]));
    if (contests.length > 1) {
      const details = document.createElement('details'); details.open = Boolean(expanded);
      const summary = document.createElement('summary'); summary.textContent = `+${contests.length - 1} upcoming`;
      details.append(summary, ...contests.slice(1).map(row)); host.append(details);
    }
    if (cache.error || Date.now() - cache.updatedAt > 6 * 3600000) {
      const status = document.createElement('span'); status.className = 'contest-cache'; status.textContent = 'Saved schedule'; status.title = 'Refresh unavailable. Times may have changed.'; host.append(status);
    }
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[STORAGE_KEY]) prefs = normalizeState(changes[STORAGE_KEY].newValue).settings;
    if (changes[CONTEST_KEY]) cache = changes[CONTEST_KEY].newValue || {};
    if (changes[STORAGE_KEY] || changes[CONTEST_KEY]) render();
  });
  const stored = await chrome.storage.local.get([STORAGE_KEY, CONTEST_KEY]);
  prefs = normalizeState(stored[STORAGE_KEY]).settings; cache = stored[CONTEST_KEY] || {}; render();
  const refresh = () => { if (prefs.contestsEnabled) chrome.runtime.sendMessage({ action: 'contests:refresh' }).catch(() => {}); };
  refresh();
  setInterval(() => { if (!document.hidden) { render(); refresh(); } }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); refresh(); } });
}
