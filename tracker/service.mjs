import { configureTufRequests, clearTufRequests } from './tuf-network.mjs';
import { importQuestion } from './solved-import.mjs';
import { prepareBackup } from './data-backup.mjs';
import { HISTORY_PLATFORMS, historyPage } from './history-import.mjs';
import { dailyDay, savedDailyStatus, recordDailyStatus } from './daily.mjs';
import { STORAGE_KEY, PLATFORMS, QUESTION_PLATFORMS, emptyState, normalizeState, cleanHandle, mergeSnapshot, safeProblemUrl, problemKey } from './core.mjs';
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
  if (current?.generation !== account.generation) return;
  if (current.historyImport?.status === 'waiting-tab') {
    try {
      // Explicit imports resume even when periodic refresh is disabled.
      await leetcodeRecent(current.handle);
      await updateState(state => {
        const connected = state.accounts.leetcode;
        if (connected?.generation === current.generation && connected.historyImport?.status === 'waiting-tab') connected.historyImport = { ...connected.historyImport, status: 'running', error: null };
      });
      await chrome.alarms.create(historyAlarm('leetcode'), { delayInMinutes: 0.5 });
    } catch { /* Keep waiting until a tab matches the connected account. */ }
  }
  if (!latest.settings.autoSync) return;
  if (!current.snapshot || current.snapshot.activityStatus === 'cached' || current.snapshot.activityWarning || current.status === 'error' || current.historyImport?.status === 'error' || Date.now() - (current.syncedAt || 0) >= 30 * 60000) await syncPlatform('leetcode');
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
  const response = await fetch(url, { ...options, credentials: 'omit', headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }, signal: options.signal || AbortSignal.timeout(25000) });
  if (!response.ok) throw new Error(response.status === 429 ? 'Platform rate limit reached. Try again later.' : `Platform request failed (${response.status}). Try again later.`);
  if (text) return response.text();
  try { return await response.json(); } catch { throw new Error('The platform returned a non-JSON response. It may require a browser visit or be temporarily unavailable.'); }
}

async function leetcodeSession(handle, extra = {}) {
  const tabs = await chrome.tabs.query({ url: 'https://leetcode.com/*' });
  if (!tabs.length) throw Object.assign(new Error('Waiting for LeetCode to reopen.'), { code: 'LEETCODE_TAB_CLOSED' });
  let sessionError;
  const refreshMessage = 'Could not read LeetCode activity. Open LeetCode and check that you are signed in.';
  for (const tab of tabs) {
    try {
      // Both helpers are idempotent. Restore the watcher too, including tabs
      // that still have a history receiver but predate an extension update.
      try { await attachLeetcodeHelpers(tab.id); } catch { /* An existing receiver may still work. */ }
      const message = { action: 'leetcode:recent', handle, ...extra };
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
      return result;
    } catch { /* Try another LeetCode tab; transport failures are not account errors. */ }
  }
  throw sessionError || new Error(refreshMessage);
}

async function leetcodeRecent(handle) { return (await leetcodeSession(handle)).submissions; }

async function code360Session(handle, page, extra = {}) {
  return siteSession('code360', { action: 'code360:history', handle, page, ...extra });
}
async function siteSession(platform, message) {
  const tuf = platform === 'tuf', name = tuf ? 'TakeUForward' : 'Code360';
  const tabs = await chrome.tabs.query({ url: tuf ? 'https://takeuforward.org/*' : 'https://www.naukri.com/code360/*' });
  if (!tabs.length) throw Object.assign(new Error(`Open ${name} signed in as the connected account.`), { code: tuf ? 'TUF_TAB_CLOSED' : 'CODE360_TAB_CLOSED' });
  let error;
  for (const tab of tabs) {
    try {
      if (chrome.scripting?.executeScript && await chrome.permissions.contains({ permissions: ['scripting'] })) {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [tuf ? 'tracker/tuf-session.js' : 'tracker/code360-history.js'] });
      }
      const result = await chrome.tabs.sendMessage(tab.id, message);
      if (result?.ok) return result;
      error = new Error(result?.error || `${name} session data unavailable.`);
    } catch (cause) { error = new Error(`Could not read ${name} data. Reload your signed-in ${name} tab. ${cause.message || ''}`); }
  }
  throw error;
}

async function recoverCode360() {
  const account = (await readState()).accounts.code360;
  if (account?.historyImport?.status !== 'waiting-tab') return;
  await updateState(state => {
    const current = state.accounts.code360;
    if (current?.generation === account.generation && current.historyImport?.status === 'waiting-tab') current.historyImport = { ...current.historyImport, status: 'running', error: null };
  });
  await chrome.alarms.create(historyAlarm('code360'), { delayInMinutes: 0.5 });
}

const importing = new Map();
const historyAlarm = platform => `crossdsa-history:${platform}`;
async function runHistoryImport(platform) {
  if (importing.has(platform)) return importing.get(platform);
  const task = (async () => {
    await chrome.alarms.create(historyAlarm(platform), { delayInMinutes: 1 });
    // Five checkpoints keep each wake bounded; the next alarm continues automatically.
    for (let batch = 0; batch < (platform === 'atcoder' ? 1 : 5); batch++) {
      const account = (await readState()).accounts[platform], job = account?.historyImport;
      if (job?.status !== 'running') return;
      try {
        if (!await chrome.permissions.contains({ origins: PLATFORMS[platform].origins })) throw new Error('Reconnect this platform to grant site access.');
        // Serialize normal sync and history requests for this platform.
        if (syncing.has(platform)) await syncing.get(platform);
        const context = { json: request, code360Session, session: (handle, offset) => leetcodeSession(handle, { action: 'leetcode:history', offset }) };
        let page;
        if (platform === 'atcoder' || platform === 'geeksforgeeks') {
          const snapshot = await collectors[platform](account.handle, { json: request, text: (url, options) => request(url, options, true), previous: account.snapshot, ...(platform === 'atcoder' ? { problemTitles: await getAtcoderTitles() } : {}) });
          page = { warning: snapshot.activityWarning, snapshot, recent: snapshot.recent, solved: snapshot.solved, complete: platform === 'geeksforgeeks' || snapshot.atcoderSync?.historyComplete === true, cursor: {} };
        } else page = await historyPage(platform, account.handle, job.cursor, context);
        let committed = false;
        await updateState(state => {
          const current = state.accounts[platform];
          if (current?.generation !== account.generation || current.historyImport?.id !== job.id || current.historyImport.status !== 'running') return;
          const snapshot = current.snapshot || { totalSolved: 0, breakdown: {}, partial: true, recent: [] };
          const recent = (page.recent || []).filter(r => r.key === problemKey(platform, r.url) && r.id && Number.isFinite(r.timestamp) && r.timestamp > 0 && safeProblemUrl(r.url, platform));
          current.snapshot = mergeSnapshot(snapshot, { ...snapshot, ...page.snapshot, recent, solved: page.solved || {} });
          if (platform === 'code360') {
            const skipped = (job.skipped || 0) + (page.skipped || 0);
            current.snapshot.historyComplete = page.complete;
            current.snapshot.activityKind = 'dated solves';
            current.snapshot.coverage = `Public profile totals plus ${page.complete ? 'available' : 'partially imported'} signed-in solved coding history. Exact dated solves contribute activity; undated solves mark Done only. MCQ activity is excluded.${skipped ? ` ${skipped} unavailable problem links could not be imported.` : ''}`;
          }
          if (platform === 'codeforces') {
            current.snapshot.totalSolved = Object.values(current.snapshot.solved).filter(r => r.timestamp && !['import', 'page'].includes(r.source)).length;
            current.snapshot.totalIsLowerBound = !page.complete;
            if (page.complete) { current.snapshot.historyComplete = true; current.snapshot.partial = false; current.snapshot.coverage = 'Available accepted history imported. Solved identities retained separately from bounded activity.'; }
          }
          current.historyImport = { ...job, cursor: page.cursor, pages: (job.pages || 0) + 1, accepted: (job.accepted || 0) + recent.length, skipped: (job.skipped || 0) + (page.skipped || 0), solved: Object.keys(current.snapshot.solved).length, status: page.warning ? 'error' : page.complete ? 'complete' : 'running', updatedAt: Date.now(), error: page.warning || null };
          committed = true;
        });
        if (!committed || page.complete || page.warning) return;
        await new Promise(resolve => setTimeout(resolve, platform === 'codeforces' ? 2100 : 1100));
      } catch (error) {
        await updateState(state => {
          const current = state.accounts[platform];
          const waiting = ['LEETCODE_TAB_CLOSED', 'CODE360_TAB_CLOSED'].includes(error.code);
          if (current?.generation === account.generation && current.historyImport?.id === job.id && current.historyImport.status === 'running') current.historyImport = { ...current.historyImport, status: waiting ? 'waiting-tab' : 'error', error: waiting ? null : String(error.message).slice(0, 400), updatedAt: Date.now() };
        });
        return;
      }
    }
  })().finally(async () => {
    importing.delete(platform);
    const job = (await readState()).accounts[platform]?.historyImport;
    if (job?.status === 'running') await chrome.alarms.create(historyAlarm(platform), { delayInMinutes: 0.5 });
    else await chrome.alarms.clear(historyAlarm(platform));
  });
  importing.set(platform, task);
  return task;
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
    if (platform === 'tuf') await configureTufRequests();
    // One shared deadline bounds TUF's public profile, API fallback and calendar.
    const signal = platform === 'tuf' ? AbortSignal.timeout(45000) : undefined;
    const snapshot = await collectors[platform](handle, { json: (url, options) => request(url, { ...options, signal }), text: (url, options) => request(url, { ...options, signal }, true), ownRecent: leetcodeRecent, ...(platform === 'code360' ? { code360History: handle => historyPage('code360', handle, {}, { code360Session }) } : {}), previous: account.snapshot, ...(platform === 'atcoder' ? { problemTitles: await getAtcoderTitles() } : {}) });
    snapshot.recent = (snapshot.recent || []).filter(r => r.id && r.key && Number.isFinite(r.timestamp) && r.timestamp > 0 && safeProblemUrl(r.url, platform));
    await updateState(state => {
      account = state.accounts[platform];
      if (!account || account.generation !== generation) return;
      account.snapshot = mergeSnapshot(account.snapshot, snapshot);
      account.status = 'ready'; account.error = null; account.syncedAt = Date.now();
      account.profileSyncedAt = account.syncedAt;
      if (platform === 'leetcode' && snapshot.calendarAvailable) account.calendarSyncedAt = account.syncedAt;
      if (!snapshot.activityWarning && (platform !== 'leetcode' || snapshot.acceptedHistoryAvailable)) account.activitySyncedAt = account.syncedAt;
      if (state.settings.autoSync && HISTORY_PLATFORMS.includes(platform)) {
        if (!account.historyImport) account.historyImport = { id: crypto.randomUUID(), status: 'running', cursor: {}, pages: 0, accepted: 0, updatedAt: Date.now() };
        else if (account.historyImport.status === 'error') account.historyImport = { ...account.historyImport, status: 'running', error: null };
      }
    });
    if ((await readState()).accounts[platform]?.historyImport?.status === 'running') await chrome.alarms.create(historyAlarm(platform), { delayInMinutes: 0.5 });
  } catch (error) {
    await updateState(state => {
      const current = state.accounts[platform];
      if (current?.generation === generation) { current.status = 'error'; current.error = String(error.message || 'Sync failed.').slice(0, 400); }
    });
  }
}

export function syncPlatform(platform) {
  if (!PLATFORMS[platform]) return Promise.reject(new Error('Unknown platform.'));
  if (importing.has(platform)) return importing.get(platform).then(() => syncPlatform(platform));
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
    if (message.action === 'tracker:solved-observed') {
      (async () => {
        const entry = importQuestion(message.entry);
        if (entry.platform === 'tuf') throw new Error('TakeUForward is not supported in Done Questions.');
        // Chrome keeps the document's original sender URL after SPA navigation.
        // Only the top-level Code360 document may use Chrome's current tab URL.
        const pageUrl = entry.platform === 'code360' && sender.frameId === 0 && /^https:\/\/www\.naukri\.com\/code360\//.test(sender.url || '')
          ? sender.tab?.url : sender.url;
        if (sender.id !== chrome.runtime.id || !sender.tab || !safeProblemUrl(pageUrl, entry.platform) || problemKey(entry.platform, pageUrl) !== entry.key || !['accepted', 'solved'].includes(message.evidence)) throw new Error('Invalid solved observation.');
        return updateState(state => {
          const account = state.accounts[entry.platform];
          if (!account || account.generation !== message.generation || account.handle.toLowerCase() !== String(message.handle).toLowerCase()) throw new Error('Connected account changed.');
          const snapshot = account.snapshot || { totalSolved: 0, partial: true, breakdown: {}, recent: [] };
          // A page proves solved status, but provides no trustworthy submission date.
          account.snapshot = mergeSnapshot(snapshot, { ...snapshot, solved: { [entry.key]: { ...entry, source: 'page', observedAt: Date.now() } } });
        });
      })().then(state => sendResponse({ ok: true, state }), error => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    if (message.action === 'tracker:page') {
      (async () => {
        const pageUrl = message.platform === 'code360' && sender.frameId === 0 && /^https:\/\/www\.naukri\.com\/code360\//.test(sender.url || '')
          ? sender.tab?.url : sender.url;
        const entry = importQuestion({ url: pageUrl });
        if (sender.id !== chrome.runtime.id || !sender.tab || entry.platform !== message.platform) throw new Error('Invalid page source.');
        const account = (await readState()).accounts[entry.platform];
        if (!account || !(await readState()).settings.autoSync) return;
        if (Date.now() - (account.pageScannedAt || 0) < (message.submitted ? 3000 : 60000)) return;
        await updateState(state => { if (state.accounts[entry.platform]?.generation === account.generation) state.accounts[entry.platform].pageScannedAt = Date.now(); });
        if (entry.platform === 'leetcode') {
          try {
            const data = await leetcodeSession(account.handle, { action: 'leetcode:problem', slug: entry.key.slice('leetcode:'.length) });
            const page = await historyPage('leetcode', account.handle, {}, { session: async () => data });
            await updateState(state => {
              const current = state.accounts.leetcode;
              if (current?.generation === account.generation) current.snapshot = mergeSnapshot(current.snapshot, { ...(current.snapshot || { totalSolved: 0, partial: true, breakdown: {} }), recent: page.recent });
            });
          } catch { /* Public sync and subsequent page visits can retry. */ }
        } else await syncPlatform(entry.platform);
      })().then(() => sendResponse({ ok: true }), error => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    // Tracking mutations and remote requests are available only to our own UI.
    if (sender.id !== chrome.runtime.id || ![chrome.runtime.getURL('dashboard.html'), chrome.runtime.getURL('popup.html')].includes(sender.url?.split(/[?#]/)[0])) {
      sendResponse({ ok: false, error: 'Dashboard access required.' }); return;
    }
    if (sender.url?.split(/[?#]/)[0] === chrome.runtime.getURL('popup.html') && !['tracker:get', 'tracker:sync', 'tracker:daily-status'].includes(message.action)) {
      sendResponse({ ok: false, error: 'Dashboard access required.' }); return;
    }
    (async () => {
      switch (message.action) {
        case 'tracker:get': return readState();
        case 'tracker:daily-status': {
          const platform = message.platform;
          if (!['code360', 'tuf'].includes(platform)) throw new Error('Unsupported daily status platform.');
          const account = (await readState()).accounts[platform];
          if (!account || !await chrome.permissions.contains({ origins: PLATFORMS[platform].origins })) throw new Error(`Connect ${PLATFORMS[platform].name} first.`);
          const day = dailyDay(platform);
          let result;
          try { result = await siteSession(platform, { action: `${platform}:daily`, handle: account.handle, day }); }
          catch (error) {
            const current = (await readState()).accounts[platform];
            const saved = current?.generation === account.generation && current.handle === account.handle ? savedDailyStatus(platform, current) : null;
            if (saved) return { ...saved, cached: true, error: error.message };
            throw error;
          }
          const current = (await readState()).accounts[platform];
          if (current?.generation !== account.generation || current.handle !== account.handle || day !== dailyDay(platform) || result.day !== day || !Array.isArray(result.handles) || !result.handles.includes(account.handle.toLowerCase()) || typeof result.done !== 'boolean') throw new Error(`${PLATFORMS[platform].name} account or day changed during POTD check.`);
          let saved;
          await updateState(state => {
            const connected = state.accounts[platform];
            if (connected?.generation !== account.generation || connected.handle !== account.handle || day !== dailyDay(platform)) throw new Error('Account or day changed during POTD check.');
            saved = recordDailyStatus(platform, connected, result);
          });
          return saved;
        }
        case 'tracker:import-data':
        case 'tracker:delete-data': {
          const replacement = message.action === 'tracker:import-data' ? prepareBackup(message.data) : emptyState();
          const result = await updateState(state => {
            for (const key of Object.keys(state)) delete state[key];
            Object.assign(state, replacement);
          });
          for (const platform of Object.keys(PLATFORMS)) {
            for (const name of [historyAlarm(platform), `crossdsa-submission:${platform}`, `crossdsa-submission:${platform}:retry`, `crossdsa-verify:${platform}`]) await chrome.alarms.clear(name);
          }
          await chrome.alarms.clear(LEETCODE_RECOVERY_ALARM);
          if (!replacement.accounts.tuf) await clearTufRequests();
          await ensureAlarm();
          return result;
        }
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
            state.accounts[platform] = { handle, generation: replacementGeneration, status: 'idle', snapshot: archived?.handle === handle ? archived.snapshot : null, ...(archived?.handle === handle && archived.historyImport ? { historyImport: archived.historyImport } : {}), ...(archived?.handle === handle && archived.dailyHistory ? { dailyHistory: archived.dailyHistory } : {}) };
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
          if (platform === 'tuf') await clearTufRequests();
          await chrome.alarms.clear(historyAlarm(platform));
          await chrome.alarms.clear(`crossdsa-submission:${platform}`);
          await chrome.alarms.clear(`crossdsa-submission:${platform}:retry`);
          if (platform === 'leetcode') await chrome.alarms.clear(LEETCODE_RECOVERY_ALARM);
          return state;
        }
        case 'tracker:import-solved': {
          if (!Array.isArray(message.records) || message.records.length > 20000) throw new Error('Import at most 20,000 questions.');
          const records = message.records.map(importQuestion);
          if (records.some(entry => entry.platform === 'tuf')) throw new Error('TakeUForward is not supported in Done Questions.');
          return updateState(state => {
            for (const entry of records) {
              const account = state.accounts[entry.platform];
              if (!account || account.generation !== message.generations?.[entry.platform]) throw new Error('Connected account changed. Preview the import again.');
            }
            const grouped = new Map();
            for (const entry of records) {
              if (!grouped.has(entry.platform)) grouped.set(entry.platform, {});
              grouped.get(entry.platform)[entry.key] = entry;
            }
            for (const [platform, solved] of grouped) {
              const account = state.accounts[platform], snapshot = account.snapshot || { totalSolved: 0, partial: true, breakdown: {}, recent: [] };
              account.snapshot = mergeSnapshot(snapshot, { ...snapshot, recent: [], solved });
            }
          });
        }
        case 'tracker:history': {
          const platform = message.platform;
          if (!HISTORY_PLATFORMS.includes(platform)) throw new Error('Use problem URLs or a solved-page scan for this platform.');
          const state = await updateState(state => {
            const account = state.accounts[platform];
            if (!account) throw new Error('Connect this platform first.');
            const previous = account.historyImport;
            if (message.command === 'cancel') { if (previous) account.historyImport = { ...previous, status: 'cancelled' }; return; }
            if (!['start', 'resume'].includes(message.command)) throw new Error('Invalid import command.');
            if (previous?.status === 'running') return;
            account.historyImport = message.command === 'resume' && previous ? { ...previous, status: 'running', error: null } : { id: crypto.randomUUID(), status: 'running', cursor: {}, pages: 0, accepted: 0, updatedAt: Date.now() };
          });
          if (message.command === 'cancel') await chrome.alarms.clear(historyAlarm(platform));
          else await chrome.alarms.create(historyAlarm(platform), { delayInMinutes: 0.5 });
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
        case 'tracker:platform-order': {
          const order = message.order;
          if (!Array.isArray(order) || order.length !== Object.keys(PLATFORMS).length || new Set(order).size !== order.length || order.some(id => !Object.hasOwn(PLATFORMS, id))) throw new Error('Invalid platform order.');
          return updateState(state => { state.settings = { ...state.settings, platformOrder: order.slice() }; });
        }
        case 'tracker:question-state': {
          const entry = message.entry, patch = message.patch;
          if (!entry || !QUESTION_PLATFORMS[entry.platform] || !safeProblemUrl(entry.url, entry.platform) || entry.key !== problemKey(entry.platform, entry.url) || typeof entry.title !== 'string' || !patch || Object.keys(patch).length !== 1 || typeof patch.starred !== 'boolean') throw new Error('Invalid question state.');
          return updateState(state => {
            const previous = state.workspace[entry.key] || {};
            const next = { ...previous, key: entry.key, platform: entry.platform, title: entry.title.slice(0, 300), url: entry.url, topics: previous.topics || (Array.isArray(entry.topics) ? entry.topics.filter(v => typeof v === 'string').slice(0, 30) : []), difficulty: previous.difficulty || String(entry.difficulty || '').slice(0, 50), listIds: [...(previous.listIds || [])], updatedAt: Date.now() };
            if (Object.hasOwn(patch, 'starred')) {
              next.listIds = next.listIds.filter(id => id !== 'saved');
              if (patch.starred) next.listIds.push('saved');
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
            state.workspace[entry.key] = { ...previous, key: entry.key, platform: entry.platform, title: String(entry.title).slice(0, 300), url: entry.url, difficulty: String(entry.difficulty || '').slice(0, 50), topics: entry.topics.filter(v => typeof v === 'string').slice(0, 30), listIds, updatedAt: Date.now() };
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
    if (alarm.name.startsWith('crossdsa-history:')) { runHistoryImport(alarm.name.split(':')[1]).catch(console.error); return; }
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
    if ((change.status === 'complete' || change.url && tab.status === 'complete') && /^https:\/\/www\.naukri\.com\/code360\//.test(tab.url || change.url || '')) recoverCode360().catch(console.error);
    if ((change.status === 'complete' || change.url && tab.status === 'complete') && /^https:\/\/leetcode\.com\//.test(tab.url || change.url || '')) recoverLeetcode().catch(console.error);
  });
  chrome.tabs.onActivated.addListener(({ tabId }) => {
    chrome.tabs.get(tabId).then(tab => {
      if (/^https:\/\/www\.naukri\.com\/code360\//.test(tab.url || '')) return recoverCode360();
      if (/^https:\/\/leetcode\.com\//.test(tab.url || '')) return recoverLeetcode();
    }).catch(console.error);
  });
  const startup = () => {
    ensureAlarm().catch(console.error);
    recoverLeetcode().catch(console.error);
    chrome.tabs.query({ url: 'https://www.naukri.com/code360/*' }).then(tabs => { if (tabs.length) return recoverCode360(); }).catch(console.error);
    readState().then(state => Promise.all(Object.entries(state.accounts).filter(([, account]) => account.historyImport?.status === 'running').map(([platform]) => chrome.alarms.create(historyAlarm(platform), { delayInMinutes: 0.5 })))).catch(console.error);
  };
  chrome.runtime.onInstalled.addListener(startup);
  chrome.runtime.onStartup.addListener(startup);
  // A suspended worker can leave a stale UI status; syncing resumes on next request.
  updateState(state => { for (const a of Object.values(state.accounts)) if (a.status === 'syncing') { a.status = 'error'; a.error = 'Previous sync was interrupted. Sync again to refresh.'; } }).catch(console.error);
}
