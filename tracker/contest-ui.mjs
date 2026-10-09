import { STORAGE_KEY, normalizeState } from './core.mjs';
import { CONTEST_KEY, CONTEST_SOURCES, activeContests, countdown, contestPlatform, sourceIsFresh } from './contests.mjs';
import { createContestCalendar } from './contest-calendar.mjs';

export async function mountContestStrip(host) {
  if (!host) return;
  let prefs = normalizeState().settings, cache = {};
  const dashboard = location.pathname.endsWith('/dashboard.html');
  const calendar = dashboard ? createContestCalendar({ host: document.getElementById('contestCalendar'), getSettings: () => prefs, getCache: () => cache, makeCard: card }) : null;
  function platformIcon(contest) {
    const icon = document.createElement('span'); icon.className = 'contest-platform-icon';
    const platform = contestPlatform(contest); icon.title = CONTEST_SOURCES[platform].name; icon.setAttribute('aria-label', icon.title);
    icon.innerHTML = platform === 'codeforces'
      ? '<svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M1 8h3v7H1zm5-7h3v14H6zm5 4h3v10h-3z"/></svg>'
      : '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m10 1-6 6a3 3 0 0 0 0 4l3 3a3 3 0 0 0 4 0M4 8h10"/></svg>';
    return icon;
  }
  function card(contest) {
    const a = anchor('', contest.url, 'contest-card');
    a.dataset.platform = contestPlatform(contest);
    const time = document.createElement('span'); time.className = 'contest-card-time';
    time.textContent = new Intl.DateTimeFormat(undefined, { timeZone: prefs.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(contest.start));
    time.append(platformIcon(contest));
    const title = document.createElement('span'); title.className = 'contest-card-title'; title.textContent = contest.title;
    a.title = `${contest.title} · ${new Intl.DateTimeFormat(undefined, { timeZone: prefs.timeZone, dateStyle: 'full', timeStyle: 'short' }).format(new Date(contest.start))} · ${countdown(contest)}`;
    a.classList.toggle('is-live', countdown(contest) === 'Live'); a.classList.toggle('has-ended', contest.end <= Date.now());
    if (!sourceIsFresh(cache, contestPlatform(contest))) { const saved = document.createElement('span'); saved.className = 'contest-card-date'; saved.textContent = 'Saved schedule'; a.append(saved); }
    a.append(time, title); return a;
  }
  function calendarLink(text = 'View calendar ↗', className = 'contest-calendar-link') {
    const a = anchor(text, chrome.runtime.getURL('dashboard.html#contests'), className);
    if (dashboard) { a.removeAttribute('target'); a.href = '#contests'; }
    return a;
  }
  function anchor(text, url, className = '') {
    const a = document.createElement('a'); a.textContent = text; a.href = url; a.className = className;
    a.target = '_blank'; a.rel = 'noopener noreferrer'; return a;
  }
  function row(contest) {
    const a = anchor('', contest.url, 'contest-row');
    a.dataset.platform = contestPlatform(contest);
    const dot = document.createElement('span'); dot.className = 'contest-dot'; dot.setAttribute('aria-hidden', 'true');
    const icon = platformIcon(contest);
    const title = document.createElement('span'); title.className = 'contest-title'; title.textContent = contest.title;
    const time = document.createElement('span'); time.className = 'contest-time'; time.textContent = countdown(contest);
    a.classList.toggle('is-live', time.textContent === 'Live');
    a.title = `${CONTEST_SOURCES[contestPlatform(contest)].name} · ${new Intl.DateTimeFormat(undefined, { timeZone: prefs.timeZone, dateStyle: 'full', timeStyle: 'short' }).format(new Date(contest.start))}${!sourceIsFresh(cache, contestPlatform(contest)) ? ' (saved schedule)' : ''}`;
    a.append(dot, icon, title, time); return a;
  }
  function render() {
    host.replaceChildren(); host.hidden = !dashboard && !prefs.contestsEnabled;
    calendar?.update();
    if (host.hidden) return;
    if (cache.needsAccess) { host.append(anchor('Enable contest schedule access \u2197', chrome.runtime.getURL('dashboard.html#contests'), 'contest-empty')); return; }
    const contests = activeContests(cache.items);
    if (!contests.length) {
      host.append(anchor(cache.error ? 'Contest schedule unavailable \u2197' : cache.updatedAt ? 'No upcoming contests \u2197' : 'Loading contests\u2026', chrome.runtime.getURL('dashboard.html#contests'), 'contest-empty'), calendarLink()); return;
    }
    host.append(row(contests[0]));
    const more = calendarLink(contests.length > 1 ? `+${contests.length - 1}` : 'Calendar', 'contest-more');
    more.setAttribute('aria-label', contests.length > 1 ? `View ${contests.length - 1} more upcoming contests in calendar` : 'View contest calendar');
    host.append(more);
    if (contests.some(contest => !sourceIsFresh(cache, contestPlatform(contest)))) {
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
  const refresh = () => { if (dashboard || prefs.contestsEnabled) chrome.runtime.sendMessage({ action: 'contests:refresh' }).catch(() => {}); };
  refresh();
  setInterval(() => { if (!document.hidden) { render(); refresh(); } }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { render(); refresh(); } });
}
