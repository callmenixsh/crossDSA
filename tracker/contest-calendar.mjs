import { dateKey } from './core.mjs';
import { CONTEST_SOURCES, contestPlatform, sourceCache, sourceIsFresh } from './contests.mjs';

export function monthDays(month) {
  const first = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
  const count = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return Array.from({ length: Math.ceil((first.getUTCDay() + count) / 7) * 7 }, (_, i) =>
    new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1 - first.getUTCDay() + i)));
}

export function createContestCalendar({ host, getSettings, getCache, makeCard }) {
  const container = host;
  container.className = 'contest-calendar'; container.setAttribute('aria-label', 'Contest calendar');
  let month, platform = 'all', expanded = new Set();
  const node = (tag, cls, text) => { const n = document.createElement(tag); n.className = cls; if (text) n.textContent = text; return n; };
  const button = (text, label, handler) => { const b = node('button', 'contest-control', text); b.type = 'button'; b.setAttribute('aria-label', label); b.addEventListener('click', handler); return b; };
  const currentMonth = () => new Date(`${dateKey(Date.now(), getSettings().timeZone).slice(0, 7)}-01T00:00:00Z`);
  function render() {
    if (!month) month = currentMonth();
    const prefs = getSettings(), cache = getCache(), today = dateKey(Date.now(), prefs.timeZone);
    container.replaceChildren();
    const header = node('div', 'contest-calendar-heading');
    header.append(node('h2', '', month.toLocaleDateString(undefined, { timeZone: 'UTC', month: 'long', year: 'numeric' })));
    const controls = node('div', 'contest-calendar-controls');
    controls.append(button('Today', 'Go to current month', () => { month = currentMonth(); expanded.clear(); render(); }),
      button('‹', 'Previous month', () => move(-1)), button('›', 'Next month', () => move(1)));
    header.append(controls); container.append(header);
    const filters = node('div', 'contest-calendar-filters'); filters.setAttribute('role', 'group'); filters.setAttribute('aria-label', 'Contest platforms');
    for (const [value, name] of [['all', 'All'], ...Object.entries(CONTEST_SOURCES).map(([key, source]) => [key, source.name])]) {
      const control = button(name, `Show ${name} contests`, () => { platform = value; expanded.clear(); render(); });
      control.setAttribute('aria-pressed', String(platform === value)); filters.append(control);
    }
    container.append(filters);
    const caption = node('p', 'contest-calendar-caption', `Confirmed contests · ${prefs.timeZone}`);
    caption.setAttribute('role', 'status'); container.append(caption);
    const statuses = node('div', 'contest-source-statuses'); statuses.setAttribute('aria-label', 'Schedule status');
    for (const [key, source] of Object.entries(CONTEST_SOURCES)) {
      const saved = sourceCache(cache, key);
      if (saved.needsAccess) {
        const control = button(`Enable ${source.name}`, `Enable ${source.name} contest access`, async () => {
          try {
            if (await chrome.permissions.request({ origins: [source.origin] })) await chrome.runtime.sendMessage({ action: 'contests:refresh' });
            else caption.textContent = 'Permission declined. Enable access to load contests.';
          } catch { caption.textContent = 'Schedule unavailable. Please try again.'; }
        });
        control.dataset.platform = key; statuses.append(control);
      } else {
        const text = saved.error || saved.updatedAt && !sourceIsFresh(cache, key) ? 'saved schedule' : saved.limited ? 'next two only' : saved.updatedAt ? 'updated' : 'loading…';
        const status = node('span', 'contest-source-status', `${source.name} · ${text}`); status.dataset.platform = key;
        status.title = saved.error || (saved.updatedAt ? `Updated ${new Date(saved.updatedAt).toLocaleString()}` : 'Loading contest schedule');
        statuses.append(status);
      }
    }
    container.append(statuses);
    const grid = node('div', 'contest-calendar-grid');
    for (const day of ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']) grid.append(node('div', 'contest-weekday', day));
    const items = (cache.needsAccess ? [] : cache.items || []).filter(item => platform === 'all' || contestPlatform(item) === platform);
    const groups = new Map();
    for (const item of items) { const key = dateKey(item.start, prefs.timeZone); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(item); }
    let inMonth = 0;
    for (const day of monthDays(month)) {
      const key = day.toISOString().slice(0, 10), outside = day.getUTCMonth() !== month.getUTCMonth();
      const cell = node('section', `contest-day${outside ? ' is-outside' : ''}${key === today ? ' is-today' : ''}`);
      cell.setAttribute('aria-label', day.toLocaleDateString(undefined, { timeZone: 'UTC', dateStyle: 'full' }));
      const label = node('div', 'contest-day-label'); label.append(node('time', '', String(day.getUTCDate()))); label.firstChild.dateTime = key;
      label.append(node('span', 'contest-agenda-date', day.toLocaleDateString(undefined, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })));
      if (key === today) label.append(node('span', '', 'Today'));
      cell.append(label);
      const events = (groups.get(key) || []).sort((a, b) => a.start - b.start);
      if (!outside) inMonth += events.length;
      for (const item of events.slice(0, expanded.has(key) ? undefined : 3)) cell.append(makeCard(item));
      if (events.length > 3) cell.append(button(expanded.has(key) ? 'Show less' : `+${events.length - 3} more`, `Toggle contests on ${key}`, () => { expanded.has(key) ? expanded.delete(key) : expanded.add(key); render(); }));
      grid.append(cell);
    }
    container.append(grid);
    if (!inMonth && !cache.needsAccess) container.append(node('p', 'contest-calendar-caption', 'No confirmed contests for this month.'));
  }
  function move(offset) { month = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + offset, 1)); expanded.clear(); render(); }
  return { update: render };
}
