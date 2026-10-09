import { STORAGE_KEY, PLATFORMS, QUESTION_PLATFORMS, normalizeState, cleanHandle, mergeSnapshot, safeProblemUrl, problemKey } from './core.mjs';
import { collectors } from './platforms.mjs';
import { CONTEST_ORIGINS } from './contests.mjs';

const ALARM = 'crossdsa-hourly-sync';
let writes = Promise.resolve();
const syncing = new Map();
const LEETCODE_HELPERS = ['tracker/leetcode-session.js', 'tracker/leetcode-browser.js'];
const LEETCODE_RECOVERY_ALARM = 'crossdsa-leetcode-recovery';
let atcoderTitles;
async function getAtcoderTitles() {
  atcoderTitles ||= fetch(chrome.runtime.getURL('data/atcoder-data.json')).then(async response => {
    if (!response.ok) throw new Error('Local AtCoder index unavailable.');
    const rows = await response.json();
    return new Map(rows.map(p => [p.id, p.title]));
  }).catch(() => { atcoderTitles = undefined; return new Map(); });
  return atcoderTitles;
}

async function attachLeetcodeHelpers(tabId) {
  if (!chrome.scripting?.executeScript || !await chrome.permissions.contains({ permissions: ['scripting'] })) return false;
  await chrome.scripting.executeScript({ target: { tabId }, files: LEETCODE_HELPERS });
  return true;
}

async function recoverLeetcode() {
  const state = await readState(), account = state.accounts.leetcode;
  if (!account) return;
  if (Date.now() - (account.recoveryAttemptedAt || 0) < 60000) {
    // A quick sign-in/navigation during the cooldown still gets a later retry.
    if (!await chrome.alarms.get(LEETCODE_RECOVERY_ALARM)) await chrome.alarms.create(LEETCODE_RECOVERY_ALARM, { delayInMinutes: 1 });
    return;
  }
  const tabs = await chrome.tabs.query({ url: 'https://leetcode.com/*' });
  if (!tabs.length) return;
  let claimed = false;
  await updateState(current => {
    const connected = current.accounts.leetcode;
    if (connected?.generation === account.generation && Date.now() - (connected.recoveryAttemptedAt || 0) >= 60000) {
      connected.recoveryAttemptedAt = Date.now(); claimed = true;
    }
  });
  if (!claimed) return;
  await chrome.alarms.clear(LEETCODE_RECOVERY_ALARM);
  // Restore acceptance observation even when periodic syncing is disabled.
  await Promise.allSettled(tabs.map(tab => attachLeetcodeHelpers(tab.id)));
  const latest = await readState(), current = latest.accounts.leetcode;
  if (current?.generation !== account.generation || !latest.settings.autoSync) return;
  if (!current.snapshot || current.snapshot.activityWarning || current.status === 'error' || Date.now() - (current.syncedAt || 0) >= 30 * 60000) await syncPlatform('leetcode');
}
export async function readState() {
  return normalizeState((await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY]);
}
function updateState(mutator) {
  const task = writes.then(async () => {
    const state = await readState();
    mutator(state);
    await chrome.storage.local.set({ [STORAGE_KEY]: state });
    return state;
  });
  writes = task.catch(() => {});
  return task;
}

async function request(url, options = {}, text = false) {
  const response = await fetch(url, { ...options, credentials: 'omit', headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }, signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new Error(response.status === 429 ? 'Platform rate limit reached. Try again later.' : `Platform request failed (${response.status}). Try again later.`);
  if (text) return response.text();
  try { return await response.json(); } catch { throw new Error('The platform returned a non-JSON response. It may require a browser visit or be temporarily unavailable.'); }
}

async function siteJson(url) {
  const tabs = await chrome.tabs.query({ url: 'https://takeuforward.org/*' });
  if (!tabs.length) throw new Error('Open TakeUForward in a browser tab, then sync again. Its API requires requests from its own website.');
  if (!await chrome.permissions.contains({ permissions: ['scripting'] })) throw new Error('Reconnect TakeUForward to allow syncing from its website tab.');
  const results = await chrome.scripting.executeScript({
    target: { tabId: tabs[0].id }, world: 'MAIN',
    func: async endpoint => {
      // Fixed public GET endpoint; no cookies or tokens are read or exported.
      if (!/^https:\/\/backend-go\.takeuforward\.org\/api\/v2\/profile\/[a-zA-Z0-9_.%-]+(?:\/heatmap)?$/.test(endpoint)) return { error: 'Invalid endpoint.' };
      try {
        const response = await fetch(endpoint, { credentials: 'omit', signal: AbortSignal.timeout(25000) });
        if (!response.ok) return { error: `TakeUForward request failed (${response.status}).` };
        return { data: await response.json() };
      } catch { return { error: 'TakeUForward request failed. Refresh its tab and try again.' }; }
    }, args: [url],
  });
  const result = results[0]?.result;
  if (!result || result.error) throw new Error(result?.error || 'Could not read TakeUForward activity.');
  return result.data;
}

async function leetcodeRecent(handle) {
  const tabs = await chrome.tabs.query({ url: 'https://leetcode.com/*' });
  if (!tabs.length) throw new Error(`Open LeetCode signed in as @${handle} to import accepted questions.`);
  let sessionError;
  const refreshMessage = 'Could not read LeetCode activity. Open LeetCode and check that you are signed in.';
  for (const tab of tabs) {
    try {
      // Both helpers are idempotent. Restore the watcher too, including tabs
      // that still have a history receiver but predate an extension update.
      try { await attachLeetcodeHelpers(tab.id); } catch { /* An existing receiver may still work. */ }
      const message = { action: 'leetcode:recent', handle };
      let result;
      try { result = await chrome.tabs.sendMessage(tab.id, message); }
      catch (cause) {
        if (!/receiving end does not exist|could not establish connection|message port closed/i.test(cause.message || '')) throw cause;
        if (!await chrome.permissions.contains({ permissions: ['scripting'] })) {
          sessionError ||= new Error('Reconnect LeetCode in Connect platforms to allow automatic activity recovery.');
          continue;
        }
        // Existing tabs may predate an extension reload or host permission grant.
        // Reattach our fixed, isolated helpers, then retry once.
        await attachLeetcodeHelpers(tab.id);
        result = await chrome.tabs.sendMessage(tab.id, message);
      }
      if (!result?.ok) { sessionError = new Error(result?.error || refreshMessage); continue; }
      if (result.username?.toLowerCase() !== handle.toLowerCase() || !Array.isArray(result.submissions)) { sessionError = new Error('LeetCode account did not match the connected handle.'); continue; }
      return result.submissions;
    } catch { /* Try another LeetCode tab; transport failures are not account errors. */ }
  }
  throw sessionError || new Error(refreshMessage);
}

async function performSync(platform) {
  let account = (await readState()).accounts[platform];
  if (!account) return;
  const handle = account.handle, generation = account.generation;
  await updateState(state => {
    if (state.accounts[platform]?.generation === generation) Object.assign(state.accounts[platform], { status: 'syncing', error: null, attemptedAt: Date.now() });
  });
  try {
    if (!await chrome.permissions.contains({ origins: PLATFORMS[platform].origins })) throw new Error('Site access is missing. Use Connect platforms to grant access again.');
    const snapshot = await collectors[platform](handle, { json: request, text: (url, options) => request(url, options, true), siteJson, ownRecent: leetcodeRecent, previous: account.snapshot, ...(platform === 'atcoder' ? { problemTitles: await getAtcoderTitles() } : {}) });
    snapshot.recent = (snapshot.recent || []).filter(r => r.id && r.key && Number.isFinite(r.timestamp) && r.timestamp > 0 && safeProblemUrl(r.url, platform));
    await updateState(state => {
      account = state.accounts[platform];
      if (!account || account.generation !== generation) return;
      account.snapshot = mergeSnapshot(account.snapshot, snapshot);
      account.status = 'ready'; account.error = null; account.syncedAt = Date.now();
      account.profileSyncedAt = account.syncedAt;
      if (!snapshot.activityWarning) account.activitySyncedAt = account.syncedAt;
    });
  } catch (error) {
    await updateState(state => {
      const current = state.accounts[platform];
      if (current?.generation === generation) { current.status = 'error'; current.error = String(error.message || 'Sync failed.').slice(0, 400); }
    });
  }
}

export function syncPlatform(platform) {
  if (!PLATFORMS[platform]) return Promise.reject(new Error('Unknown platform.'));
  if (syncing.has(platform)) return syncing.get(platform);
  const task = performSync(platform).finally(() => syncing.delete(platform));
  syncing.set(platform, task);
  return task;
}

async function ensureAlarm() {
  if ((await chrome.alarms.get(ALARM))?.periodInMinutes !== 30) await chrome.alarms.create(ALARM, { periodInMinutes: 30 });
}

export function registerTracker() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!String(message?.action || '').startsWith('tracker:')) return;
    // Browser records require an account-matched accepted result, never a submit click.
    if (message.action === 'tracker:accepted') {
      if (sender.id !== chrome.runtime.id || !sender.tab || message.platform !== 'leetcode' || !safeProblemUrl(sender.url, 'leetcode')) {
        sendResponse({ ok: false, error: 'Invalid acceptance source.' }); return;
      }
      (async () => {
        const item = message.submission;
        const url = item && `https://leetcode.com/problems/${encodeURIComponent(item.slug)}/`;
        if (!item || !/^\d{1,30}$/.test(item.id) || typeof item.slug !== 'string' || !/^[a-zA-Z0-9-]{1,200}$/.test(item.slug) || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 300 || !Number.isFinite(item.timestamp) || Math.abs(Date.now() - item.timestamp) > 5 * 60000 || problemKey('leetcode', sender.url) !== problemKey('leetcode', url)) throw new Error('Invalid accepted submission.');
        const state = await updateState(state => {
          const account = state.accounts.leetcode;
          if (!account || account.generation !== message.generation || account.handle.toLowerCase() !== String(message.handle).toLowerCase()) throw new Error('Connected account changed.');
          const id = `leetcode:${item.id}`;
          if (account.snapshot?.recent?.some(r => r.id === id)) return;
          const record = { id, key: problemKey('leetcode', url), platform: 'leetcode', title: item.title, url, timestamp: item.timestamp, pending: true, source: 'browser' };
          const snapshot = account.snapshot || { totalSolved: 0, totalIsLowerBound: true, partial: true, breakdown: {}, recent: [] };
          account.snapshot = mergeSnapshot(snapshot, { ...snapshot, recent: [...snapshot.recent, record] });
        });
        // Verification also runs when automatic periodic refresh is disabled.
        await chrome.alarms.create('crossdsa-verify:leetcode', { delayInMinutes: 0.5 });
        await chrome.alarms.create('crossdsa-verify:leetcode:retry', { delayInMinutes: 2 });
        return state;
      })().then(state => sendResponse({ ok: true, state }), error => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    // Submission clicks only schedule a refresh; they never create solved records.
    if (message.action === 'tracker:submission') {
      const platform = message.platform;
      if (sender.id !== chrome.runtime.id || !sender.tab || !PLATFORMS[platform] || !safeProblemUrl(sender.url, platform)) {
        sendResponse({ ok: false, error: 'Invalid submission source.' }); return;
      }
      (async () => {
        const state = await readState();
        if (!state.settings.autoSync || !state.accounts[platform]) return;
        const name = `crossdsa-submission:${platform}`;
        // Keep the first pending refresh when a user submits repeatedly.
        if (!await chrome.alarms.get(name)) {
          await chrome.alarms.create(name, { delayInMinutes: 0.5 });
          await chrome.alarms.create(`${name}:retry`, { delayInMinutes: 2 });
        }
      })().then(() => sendResponse({ ok: true }), error => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    // Tracking mutations and remote requests are available only to our own UI.
    if (sender.id !== chrome.runtime.id || ![chrome.runtime.getURL('dashboard.html'), chrome.runtime.getURL('popup.html')].includes(sender.url?.split(/[?#]/)[0])) {
      sendResponse({ ok: false, error: 'Dashboard access required.' }); return;
    }
    if (sender.url?.split(/[?#]/)[0] === chrome.runtime.getURL('popup.html') && !['tracker:get', 'tracker:sync'].includes(message.action)) {
      sendResponse({ ok: false, error: 'Dashboard access required.' }); return;
    }
    (async () => {
      switch (message.action) {
        case 'tracker:get': return readState();
        case 'tracker:connect': {
          const platform = message.platform;
          const handle = cleanHandle(platform, message.handle);
          if (!await chrome.permissions.contains({ origins: PLATFORMS[platform].origins })) throw new Error('Platform site access was not granted.');
          if (syncing.has(platform)) await syncing.get(platform);
          let previousAccount, replacementGeneration;
          await updateState(state => {
            const old = state.accounts[platform];
            if (old?.handle === handle) return;
            previousAccount = old;
            replacementGeneration = crypto.randomUUID();
            const archived = state.disconnectedAccounts?.[platform];
            state.accounts[platform] = { handle, generation: replacementGeneration, status: 'idle', snapshot: archived?.handle === handle ? archived.snapshot : null };
          });
          await ensureAlarm();
          await syncPlatform(platform);
          if (previousAccount && replacementGeneration) await updateState(state => {
            const current = state.accounts[platform];
            if (current?.generation === replacementGeneration && current.status === 'error') state.accounts[platform] = { ...previousAccount, status: 'error', error: `Could not connect @${handle}: ${current.error} Kept the previous @${previousAccount.handle} connection.` };
          });
          return readState();
        }
        case 'tracker:disconnect': {
          const platform = message.platform;
          if (!PLATFORMS[platform]) throw new Error('Unknown platform.');
          const state = await updateState(state => {
            if (!state.accounts[platform]) return;
            state.disconnectedAccounts ||= {};
            state.disconnectedAccounts[platform] = { ...state.accounts[platform], status: 'idle', error: null };
            delete state.accounts[platform];
          });
          await chrome.alarms.clear(`crossdsa-submission:${platform}`);
          await chrome.alarms.clear(`crossdsa-submission:${platform}:retry`);
          if (platform === 'leetcode') await chrome.alarms.clear(LEETCODE_RECOVERY_ALARM);
          return state;
        }
        case 'tracker:sync': {
          const state = await readState();
          if (message.platform) await syncPlatform(message.platform);
          else await Promise.all(Object.keys(state.accounts).map(syncPlatform));
          return readState();
        }
        case 'tracker:contest-settings': {
          if (typeof message.contestsEnabled !== 'boolean' || typeof message.contestReminders !== 'boolean') throw new Error('Invalid contest settings.');
          if (message.contestsEnabled || message.contestReminders) {
            const access = await Promise.all(CONTEST_ORIGINS.map(origin => chrome.permissions.contains({ origins: [origin] })));
            if (!access.some(Boolean) || message.contestReminders && !await chrome.permissions.contains({ permissions: ['notifications'] })) throw new Error('Allow contest access in Settings first.');
          }
          return updateState(state => { state.settings = { ...state.settings, contestsEnabled: message.contestsEnabled, contestReminders: message.contestReminders }; });
        }
        case 'tracker:settings': {
          const settings = message.settings || {};
          if (!Number.isInteger(settings.dailyGoal) || settings.dailyGoal < 1 || settings.dailyGoal > 50) throw new Error('Daily goal must be between 1 and 50.');
          try { new Intl.DateTimeFormat('en', { timeZone: settings.timeZone }).format(); } catch { throw new Error('Enter a valid timezone, such as Asia/Kolkata.'); }
          return updateState(state => { state.settings = { ...state.settings, dailyGoal: settings.dailyGoal, timeZone: settings.timeZone, autoSync: Boolean(settings.autoSync) }; });
        }
        case 'tracker:question-state': {
          const entry = message.entry, patch = message.patch;
          if (!entry || !QUESTION_PLATFORMS[entry.platform] || !safeProblemUrl(entry.url, entry.platform) || entry.key !== problemKey(entry.platform, entry.url) || typeof entry.title !== 'string' || !patch || Object.keys(patch).length !== 1 || !['starred', 'done'].includes(Object.keys(patch)[0]) || typeof Object.values(patch)[0] !== 'boolean') throw new Error('Invalid question state.');
          return updateState(state => {
            const previous = state.workspace[entry.key] || {};
            const next = { ...previous, key: entry.key, platform: entry.platform, title: entry.title.slice(0, 300), url: entry.url, topics: previous.topics || (Array.isArray(entry.topics) ? entry.topics.filter(v => typeof v === 'string').slice(0, 30) : []), difficulty: previous.difficulty || String(entry.difficulty || '').slice(0, 50), listIds: [...(previous.listIds || [])], updatedAt: Date.now() };
            if (Object.hasOwn(patch, 'starred')) {
              next.listIds = next.listIds.filter(id => id !== 'saved');
              if (patch.starred) next.listIds.push('saved');
              next.bookmarked = next.listIds.length > 0;
            } else {
              next.done = patch.done;
              next.doneAt = patch.done ? previous.done ? previous.doneAt : Date.now() : null;
            }
            state.workspace[entry.key] = next;
          });
        }
        case 'tracker:workspace': {
          const entry = message.entry;
          if (!entry || !QUESTION_PLATFORMS[entry.platform] || !safeProblemUrl(entry.url, entry.platform) || typeof entry.key !== 'string' || entry.key.length > 500 || entry.key !== problemKey(entry.platform, entry.url)) throw new Error('Invalid problem.');
          if (!Array.isArray(entry.topics) || !Array.isArray(entry.listIds) || entry.listIds.some(id => typeof id !== 'string')) throw new Error('Invalid list membership.');
          if (message.customListsOnly && entry.listIds.includes('saved')) throw new Error('Use the star to change Starred membership.');
          return updateState(state => {
            if (entry.listIds.some(id => !Object.hasOwn(state.lists, id))) throw new Error('List not found.');
            const previous = state.workspace[entry.key] || {};
            const listIds = [...new Set([...entry.listIds, ...(message.customListsOnly && previous.listIds?.includes('saved') ? ['saved'] : [])])];
            state.workspace[entry.key] = { ...previous, key: entry.key, platform: entry.platform, title: String(entry.title).slice(0, 300), url: entry.url, difficulty: String(entry.difficulty || '').slice(0, 50), topics: entry.topics.filter(v => typeof v === 'string').slice(0, 30), listIds, bookmarked: listIds.length > 0, updatedAt: Date.now() };
          });
        }
        case 'tracker:list:create': {
          const name = String(message.name || '').trim();
          if (!name || name.length > 80) throw new Error('Enter a list name between 1 and 80 characters.');
          return updateState(state => {
            if (Object.values(state.lists).some(list => list.name.toLowerCase() === name.toLowerCase())) throw new Error('A list with that name already exists.');
            const id = crypto.randomUUID();
            state.lists[id] = { id, name };
          });
        }
        default: throw new Error('Unknown tracker action.');
      }
    })().then(state => sendResponse({ ok: true, state }), error => sendResponse({ ok: false, error: error.message }));
    return true;
  });
  chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === LEETCODE_RECOVERY_ALARM) {
      recoverLeetcode().catch(console.error);
      return;
    }
    if (alarm.name.startsWith('crossdsa-verify:')) {
      const platform = alarm.name.split(':')[1];
      syncPlatform(platform).catch(console.error);
      return;
    }
    if (alarm.name.startsWith('crossdsa-submission:')) {
      const platform = alarm.name.split(':')[1];
      (async () => {
        const state = await readState();
        if (state.settings.autoSync && state.accounts[platform] && PLATFORMS[platform]) await syncPlatform(platform);
      })().catch(console.error);
      return;
    }
    if (alarm.name !== ALARM) return;
    (async () => {
      const state = await readState();
      if (!state.settings.autoSync) return;
      for (const [platform, account] of Object.entries(state.accounts)) {
        if (Date.now() - (account.attemptedAt || account.syncedAt || 0) >= 30 * 60 * 1000) await syncPlatform(platform);
      }
    })().catch(console.error);
  });
  chrome.tabs.onUpdated.addListener((_tabId, change, tab) => {
    if ((change.status === 'complete' || change.url && tab.status === 'complete') && /^https:\/\/leetcode\.com\//.test(tab.url || change.url || '')) recoverLeetcode().catch(console.error);
  });
  chrome.tabs.onActivated.addListener(({ tabId }) => {
    chrome.tabs.get(tabId).then(tab => {
      if (/^https:\/\/leetcode\.com\//.test(tab.url || '')) return recoverLeetcode();
    }).catch(console.error);
  });
  const startup = () => {
    ensureAlarm().catch(console.error);
    recoverLeetcode().catch(console.error);
  };
  chrome.runtime.onInstalled.addListener(startup);
  chrome.runtime.onStartup.addListener(startup);
  // A suspended worker can leave a stale UI status; syncing resumes on next request.
  updateState(state => { for (const a of Object.values(state.accounts)) if (a.status === 'syncing') { a.status = 'error'; a.error = 'Previous sync was interrupted. Sync again to refresh.'; } }).catch(console.error);
}
