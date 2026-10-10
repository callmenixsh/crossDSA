import { acceptedToday, dateKey } from './core.mjs';

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
