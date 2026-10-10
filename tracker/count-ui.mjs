import { acceptedToday, dateKey, tufActivityToday } from './core.mjs';
export { tufActivityToday } from './core.mjs';

export function appendTufActivityToday(element, account, now = Date.now()) {
  const count = tufActivityToday(account, now);
  if (!count) return;
  const activity = document.createElement('sup');
  activity.className = 'today-increase';
  activity.textContent = `\u2191${count.toLocaleString()}`;
  activity.title = 'TUF calendar activity for today (India time), as of the last profile sync. May include repeat activity.';
  activity.setAttribute('aria-label', `${count} TUF activities today`);
  element.append(activity);
}

export function solvedToday(accounts, timeZone, now = Date.now()) {
  return acceptedToday(accounts, dateKey(now, timeZone), timeZone);
}

export function appendTodayIncrease(element, count, partial = false) {
  if (!count) return;
  const increase = document.createElement('sup');
  increase.className = 'today-increase';
  increase.textContent = `\u2191${Number(count).toLocaleString()}`;
  const description = `${partial ? 'At least ' : ''}${count} problem${count === 1 ? '' : 's'} solved today`;
  increase.title = description;
  increase.setAttribute('aria-label', description);
  element.append(increase);
}
