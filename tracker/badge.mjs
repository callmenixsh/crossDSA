import { STORAGE_KEY, normalizeState, acceptedToday, dateKey } from './core.mjs';

const ALARM = 'crossdsa-badge-midnight';

export function nextBadgeReset(now, timeZone) {
  const today = dateKey(now, timeZone);
  let low = now, high = now + 36 * 60 * 60 * 1000;
  // Find the next local day boundary, including daylight-saving transitions.
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (dateKey(middle, timeZone) === today) low = middle;
    else high = middle;
  }
  return high;
}

export function registerBadge(api = chrome, clock = () => Date.now()) {
  let pending = Promise.resolve();
  const refresh = () => {
    // Serialize renders so an older read cannot overwrite a newer count.
    pending = pending.catch(() => {}).then(async () => {
      const state = normalizeState((await api.storage.local.get(STORAGE_KEY))[STORAGE_KEY]);
      const now = clock(), timeZone = state.settings.timeZone;
      const count = acceptedToday(state.accounts, dateKey(now, timeZone), timeZone);
      await api.action.setBadgeBackgroundColor({ color: '#2dd4bf' });
      await api.action.setBadgeTextColor?.({ color: '#04221e' });
      await api.action.setBadgeText({ text: String(count) });
      await api.action.setTitle({ title: `crossDSA — ${count} problem${count === 1 ? '' : 's'} done today (goal: ${state.settings.dailyGoal})` });
      await api.alarms.create(ALARM, { when: nextBadgeReset(now, timeZone) });
    });
    pending.catch(console.error);
    return pending;
  };
  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STORAGE_KEY]) refresh();
  });
  api.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === ALARM) refresh();
  });
  api.runtime.onInstalled.addListener(refresh);
  api.runtime.onStartup.addListener(refresh);
  refresh();
  return refresh;
}
