import { STORAGE_KEY, normalizeState } from './core.mjs';
import { CONTEST_KEY, CONTEST_SOURCES, REFRESH_ALARM, REMINDER_PREFIX, normalizeContests, normalizeCodeforcesContests, normalizeCodechefContests, normalizeAtcoderContests, normalizeGfgContests, normalizeCode360Contests, activeContests, reminderPlan, reminderName, contestPlatform, sourceCache, sourceIsFresh, safeContestUrl, retainContests } from './contests.mjs';

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
  if (!prefs.contestReminders || !await chrome.permissions.contains({ permissions: ['notifications'] })) { await clearReminders(); return; }
  const now = Date.now();
  const cache = await readCache();
  // Keep alarms intact at their due time; periodic UI refreshes must not
  // clear an alarm just before Chrome dispatches it. Recover recent alarms
  // lost during a worker/browser restart within the delivery grace period.
  const allowed = await sourcePermissions();
  const plan = reminderPlan(cache, now - 5 * 60000).filter(item => allowed[contestPlatform(item.contest)] && sourceIsFresh(cache, contestPlatform(item.contest), now));
  const desired = new Map(plan.map(item => [item.name, item]));
  const existing = new Map((await chrome.alarms.getAll()).filter(alarm => alarm.name.startsWith(REMINDER_PREFIX)).map(alarm => [alarm.name, alarm]));
  for (const name of existing.keys()) if (!desired.has(name)) await chrome.alarms.clear(name);
  for (const item of plan) if (!existing.has(item.name)) await chrome.alarms.create(item.name, { when: Math.max(now + 1000, item.when) });
}
async function sourcePermissions() {
  const accounts = normalizeState((await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY]).accounts;
  return Object.fromEntries(await Promise.all(Object.entries(CONTEST_SOURCES).map(async ([platform, source]) =>
    [platform, Boolean(accounts[platform]) && await chrome.permissions.contains({ origins: [source.origin] })])));
}
async function fetchSchedule(platform) {
  const options = { credentials: 'omit', signal: AbortSignal.timeout(20000) };
  const request = async url => {
    const response = await fetch(url, options);
    if (!response.ok) throw new Error('Schedule request failed.');
    return response;
  };
  if (platform === 'codechef') return { items: normalizeCodechefContests(await (await request('https://www.codechef.com/api/list/contests/all')).json()), limited: false };
  if (platform === 'atcoder') return { items: normalizeAtcoderContests(await (await request('https://atcoder.jp/contests/?lang=en')).text()), limited: false };
  if (platform === 'geeksforgeeks' || platform === 'code360') {
    const items = [];
    let more = true;
    for (let page = 1; page <= 20 && more; page++) {
      if (platform === 'geeksforgeeks') {
        const data = await (await request(`https://practiceapi.geeksforgeeks.org/api/vr/events/?page_number=${page}&sub_type=${page === 1 ? 'all' : 'upcoming'}&type=contest`)).json();
        items.push(...normalizeGfgContests(data));
        more = data.next_upcoming === true;
      } else {
        const data = await (await request(`https://www.naukri.com/code360/api/v3/public_section/contest_list?page=${page}`)).json();
        const batch = normalizeCode360Contests(data);
        items.push(...batch);
        // The official listing puts upcoming events before its paginated history.
        more = page < Number(data.data.total_pages) && batch.some(item => item.end > Date.now());
      }
    }
    return { items, limited: more };
  }
  if (platform === 'codeforces') {
    const response = await fetch('https://codeforces.com/api/contest.list?gym=false', options);
    if (!response.ok) throw new Error('Schedule request failed.');
    return { items: normalizeCodeforcesContests(await response.json()), limited: false };
  }
  const query = async field => {
    const response = await fetch('https://leetcode.com/graphql/', { ...options, method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: `query { ${field} { title titleSlug startTime duration } }` }) });
    if (!response.ok) throw new Error('Schedule request failed.');
    return response.json();
  };
  const data = await query('allContests');
  // Fall back only if LeetCode removes the full listing from its schema.
  if (data.errors?.some(error => /Cannot query field ["']allContests["']/.test(error.message || ''))) {
    return { items: normalizeContests(await query('topTwoContests')), limited: true };
  }
  return { items: normalizeContests(data), limited: false };
}
async function refresh() {
  const cache = await readCache(), allowed = await sourcePermissions();
  if (Object.values(allowed).some(Boolean)) {
    if ((await chrome.alarms.get(REFRESH_ALARM))?.periodInMinutes !== 30) await chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: 30 });
  } else await chrome.alarms.clear(REFRESH_ALARM);
  const sources = Object.fromEntries(await Promise.all(Object.keys(CONTEST_SOURCES).map(async platform => {
    const saved = sourceCache(cache, platform);
    if (!allowed[platform]) return [platform, { ...saved, needsAccess: true }];
    if (cache.sources && saved.attemptedAt && Date.now() - saved.attemptedAt < 30 * 60000 && !saved.needsAccess) return [platform, saved];
    const attemptedAt = Date.now();
    try {
      const result = await fetchSchedule(platform);
      // Retain past confirmed events; replace upcoming entries so cancellations disappear.
      const history = (saved.items || []).filter(item => item.end <= attemptedAt);
      const items = retainContests([...new Map([...history, ...result.items].map(item => [item.id, item])).values()], attemptedAt).sort((a, b) => a.start - b.start);
      return [platform, { items, limited: result.limited, updatedAt: Date.now(), attemptedAt, error: null, needsAccess: false }];
    } catch {
      return [platform, { ...saved, attemptedAt, error: 'Schedule unavailable. Showing saved times.', needsAccess: false }];
    }
  })));
  const items = Object.values(sources).filter(source => !source.needsAccess).flatMap(source => retainContests(source.items || [])).sort((a, b) => a.start - b.start);
  const sent = Object.fromEntries(Object.entries(cache.sent || {}).filter(([, time]) => Date.now() - time < 7 * 86400000));
  await chrome.storage.local.set({ [CONTEST_KEY]: { sources, items, sent, updatedAt: Math.max(0, ...Object.values(sources).map(source => source.updatedAt || 0)),
    needsAccess: !Object.values(allowed).some(Boolean), error: Object.entries(sources).filter(([, source]) => source.error && !source.needsAccess).map(([platform]) => `${CONTEST_SOURCES[platform].name} schedule unavailable`).join(' · ') || null } });
  await reconcile();
}
export function refreshContests() {
  if (!running) running = serialized(refresh).finally(() => { running = null; });
  return running;
}
export async function deliverReminder(name, now = Date.now()) {
  const prefs = await settings();
  if (!prefs.contestReminders || !await chrome.permissions.contains({ permissions: ['notifications'] })) return;
  const cache = await readCache();
  if (cache.sent?.[name]) return;
  const contest = activeContests(cache.items, now).find(item => [60, 10].some(minutes => reminderName(item, minutes) === name));
  if (!contest || contest.start <= now || !safeContestUrl(contest) || !sourceIsFresh(cache, contestPlatform(contest), now) ||
    !(await sourcePermissions())[contestPlatform(contest)] ||
    !await chrome.permissions.contains({ origins: [CONTEST_SOURCES[contestPlatform(contest)].origin] })) return;
  const minutes = name.endsWith(':60') ? 60 : 10;
  const due = contest.start - minutes * 60000;
  // Avoid overdue reminders after sleep, and never send the one-hour alert
  // once the ten-minute reminder window has arrived.
  if (now < due || now - due > 5 * 60000) return;
  // Persist first: worker restarts must not deliver the same alert again.
  cache.sent = { ...cache.sent, [name]: now };
  await chrome.storage.local.set({ [CONTEST_KEY]: cache });
  await chrome.notifications.create(name, { type: 'basic', iconUrl: chrome.runtime.getURL('icons/cDSA-128.png'), title: contest.title, message: `Starts in ${Math.ceil((contest.start - now) / 60000)} minutes. Click to open ${CONTEST_SOURCES[contestPlatform(contest)].name}.` });
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
      const previousAccounts = Object.keys(changes[STORAGE_KEY].oldValue?.accounts || {}).sort().join(',');
      const nextAccounts = Object.keys(changes[STORAGE_KEY].newValue?.accounts || {}).sort().join(',');
      if (previousAccounts !== nextAccounts || before.contestsEnabled !== after.contestsEnabled || before.contestReminders !== after.contestReminders) serialized(refresh).catch(console.error);
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
        if (contest && safeContestUrl(contest)) await chrome.tabs.create({ url: contest.url });
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
