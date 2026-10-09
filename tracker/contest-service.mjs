import { STORAGE_KEY, normalizeState } from './core.mjs';
import { CONTEST_KEY, CONTEST_ORIGINS, REFRESH_ALARM, REMINDER_PREFIX, normalizeContests, activeContests, reminderPlan, reminderName } from './contests.mjs';

let running;
let clickListenerRegistered = false;
let queue = Promise.resolve();
const serialized = task => { const result = queue.then(task); queue = result.catch(() => {}); return result; };
async function settings() { return normalizeState((await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY]).settings; }
async function readCache() { return (await chrome.storage.local.get(CONTEST_KEY))[CONTEST_KEY] || { items: [], sent: {} }; }
async function clearReminders() {
  for (const alarm of await chrome.alarms.getAll()) if (alarm.name.startsWith(REMINDER_PREFIX)) await chrome.alarms.clear(alarm.name);
}
async function reconcile() {
  const prefs = await settings();
  if (!prefs.contestsEnabled || !prefs.contestReminders || !await chrome.permissions.contains({ permissions: ['notifications'], origins: CONTEST_ORIGINS })) { await clearReminders(); return; }
  const now = Date.now();
  const cache = await readCache();
  // Keep alarms intact at their due time; periodic UI refreshes must not
  // clear an alarm just before Chrome dispatches it. Recover recent alarms
  // lost during a worker/browser restart within the delivery grace period.
  const plan = cache.updatedAt && now - cache.updatedAt <= 6 * 3600000 ? reminderPlan(cache, now - 5 * 60000) : [];
  const desired = new Map(plan.map(item => [item.name, item]));
  const existing = new Map((await chrome.alarms.getAll()).filter(alarm => alarm.name.startsWith(REMINDER_PREFIX)).map(alarm => [alarm.name, alarm]));
  for (const name of existing.keys()) if (!desired.has(name)) await chrome.alarms.clear(name);
  for (const item of plan) if (!existing.has(item.name)) await chrome.alarms.create(item.name, { when: Math.max(now + 1000, item.when) });
}
async function refresh() {
  const prefs = await settings();
  if (!prefs.contestsEnabled) {
    await chrome.alarms.clear(REFRESH_ALARM); await clearReminders(); return;
  }
  if (!await chrome.permissions.contains({ origins: CONTEST_ORIGINS })) {
    await chrome.alarms.clear(REFRESH_ALARM); await clearReminders();
    await chrome.storage.local.set({ [CONTEST_KEY]: { ...await readCache(), error: 'Allow LeetCode access in Settings to load contests.', needsAccess: true } }); return;
  }
  if (!await chrome.alarms.get(REFRESH_ALARM)) await chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: 60 });
  let cache = await readCache();
  if (!cache.attemptedAt || Date.now() - cache.attemptedAt >= 3600000 || cache.needsAccess) {
    const attemptedAt = Date.now();
    try {
      const response = await fetch('https://leetcode.com/graphql/', { method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'query { topTwoContests { title titleSlug startTime duration } }' }), signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error('Schedule request failed.');
      const items = normalizeContests(await response.json());
      const sent = Object.fromEntries(Object.entries(cache.sent || {}).filter(([, time]) => Date.now() - time < 7 * 86400000));
      cache = { items, sent, updatedAt: Date.now(), attemptedAt, error: null, needsAccess: false };
    } catch {
      cache = { ...cache, attemptedAt, error: 'Schedule unavailable. Showing saved times.', needsAccess: false };
    }
    await chrome.storage.local.set({ [CONTEST_KEY]: cache });
  }
  await reconcile();
}
export function refreshContests() {
  if (!running) running = serialized(refresh).finally(() => { running = null; });
  return running;
}
export async function deliverReminder(name, now = Date.now()) {
  const prefs = await settings();
  if (!prefs.contestsEnabled || !prefs.contestReminders || !await chrome.permissions.contains({ permissions: ['notifications'], origins: CONTEST_ORIGINS })) return;
  const cache = await readCache();
  if (!cache.updatedAt || now - cache.updatedAt > 6 * 3600000 || cache.error || cache.sent?.[name]) return;
  const contest = activeContests(cache.items, now).find(item => [60, 10].some(minutes => reminderName(item, minutes) === name));
  if (!contest || contest.start <= now) return;
  const minutes = name.endsWith(':60') ? 60 : 10;
  const due = contest.start - minutes * 60000;
  // Avoid overdue reminders after sleep, and never send the one-hour alert
  // once the ten-minute reminder window has arrived.
  if (now < due || now - due > 5 * 60000) return;
  // Persist first: worker restarts must not deliver the same alert again.
  cache.sent = { ...cache.sent, [name]: now };
  await chrome.storage.local.set({ [CONTEST_KEY]: cache });
  await chrome.notifications.create(name, { type: 'basic', iconUrl: chrome.runtime.getURL('icons/cDSA-128.png'), title: contest.title, message: `Starts in ${Math.ceil((contest.start - now) / 60000)} minutes. Click to open LeetCode.` });
}
export function registerContests() {
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.action !== 'contests:refresh') return;
    if (sender.id !== chrome.runtime.id || !['dashboard.html', 'popup.html'].some(path => sender.url?.split(/[?#]/)[0] === chrome.runtime.getURL(path))) { respond({ ok: false }); return; }
    refreshContests().then(() => respond({ ok: true }), () => respond({ ok: false })); return true;
  });
  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === REFRESH_ALARM) refreshContests().catch(console.error);
    if (alarm.name.startsWith(REMINDER_PREFIX)) serialized(() => deliverReminder(alarm.name)).catch(console.error);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STORAGE_KEY]) {
      const before = normalizeState(changes[STORAGE_KEY].oldValue).settings, after = normalizeState(changes[STORAGE_KEY].newValue).settings;
      if (before.contestsEnabled !== after.contestsEnabled || before.contestReminders !== after.contestReminders) serialized(refresh).catch(console.error);
    }
  });
  chrome.permissions.onRemoved.addListener(() => serialized(refresh).catch(console.error));
  const registerNotificationClick = () => {
    if (clickListenerRegistered || !chrome.notifications?.onClicked) return;
    clickListenerRegistered = true;
    chrome.notifications.onClicked.addListener(id => {
      if (!id.startsWith(REMINDER_PREFIX)) return;
      (async () => {
        const cache = await readCache();
        const contest = cache.items?.find(item => [60, 10].some(minutes => reminderName(item, minutes) === id));
        if (contest && /^https:\/\/leetcode\.com\/contest\/(weekly|biweekly)-contest-\d+\/$/.test(contest.url)) await chrome.tabs.create({ url: contest.url });
        await chrome.notifications.clear(id);
      })().catch(console.error);
    });
  };
  registerNotificationClick();
  chrome.permissions.onAdded.addListener(() => { registerNotificationClick(); serialized(refresh).catch(console.error); });
  chrome.runtime.onInstalled.addListener(() => refreshContests().catch(console.error));
  chrome.runtime.onStartup.addListener(() => refreshContests().catch(console.error));
  refreshContests().catch(console.error);
}
