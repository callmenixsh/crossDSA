import test from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEY, emptyState, normalizeState, orderedPlatformIds } from '../../tracker/core.mjs';

function event() { return { listeners: [], addListener(fn) { this.listeners.push(fn); } }; }
async function harness(fetcher = async () => { throw new Error('Offline'); }) {
  const storage = {};
  let allowed = true;
  const scheduled = new Map();
  globalThis.chrome = {
    storage: { local: { get: async key => ({ [key]: structuredClone(storage[key]) }), set: async data => { Object.assign(storage, structuredClone(data)); } } },
    runtime: { id: 'test-extension', getURL: path => `chrome-extension://test-extension/${path}`, onMessage: event(), onInstalled: event(), onStartup: event() },
    alarms: { clear: async name => scheduled.delete(name), get: async name => scheduled.get(name), create: async (name, options) => { scheduled.set(name, options); }, onAlarm: event() },
    permissions: { contains: async () => allowed },
    tabs: { query: async () => [], get: async () => ({ url: 'https://leetcode.com/' }), onUpdated: event(), onActivated: event() },
  };
  globalThis.fetch = fetcher;
  const service = await import(`../../tracker/tracker-service.mjs?test=${crypto.randomUUID()}`);
  service.registerTracker();
  await new Promise(resolve => setImmediate(resolve));
  const listener = chrome.runtime.onMessage.listeners[0];
  const send = (action, data = {}, sender = { id: 'test-extension', url: 'chrome-extension://test-extension/dashboard.html' }) => new Promise(resolve => {
    const result = listener({ action: `tracker:${action}`, ...data }, sender, resolve);
    if (result !== true && result === undefined) resolve(undefined);
  });
  return { storage, send, service, scheduled, setAllowed(value) { allowed = value; } };
}
const settings = { dailyGoal: 3, timeZone: 'Asia/Kolkata', autoSync: false };
const entry = { key: 'leetcode:two-sum', platform: 'leetcode', title: 'Two Sum', url: 'https://leetcode.com/problems/two-sum/', topics: ['Array'], difficulty: 'Easy', listIds: ['saved'] };

test('backup restore replaces data, renews account generations and pauses scans', async () => {
  const h = await harness();
  const backup = emptyState();
  backup.settings = { ...backup.settings, ...settings };
  backup.accounts.leetcode = { handle: 'sample', generation: 'old', status: 'syncing', historyImport: { id: 'scan', status: 'running' }, snapshot: { totalSolved: 1, recent: [], solved: { [entry.key]: entry } } };
  backup.workspace[entry.key] = entry;
  h.storage[STORAGE_KEY] = { ...emptyState(), lists: { saved: { id: 'saved', name: 'Starred' }, extra: { id: 'extra', name: 'Old list' } } };
  const result = await h.send('import-data', { data: backup });
  assert.equal(result.ok, true);
  assert.equal(result.state.accounts.leetcode.status, 'idle');
  assert.notEqual(result.state.accounts.leetcode.generation, 'old');
  assert.equal(result.state.accounts.leetcode.historyImport.status, 'paused');
  assert.equal(result.state.accounts.leetcode.snapshot.solved[entry.key].title, 'Two Sum');
  assert.equal(result.state.lists.extra, undefined);
  assert.deepEqual(result.state.workspace[entry.key].listIds, ['saved']);
  const saved = structuredClone(h.storage[STORAGE_KEY]);
  for (const data of [{}, [], { ...backup, version: 2 }, { ...backup, accounts: { unknown: {} } }, { ...backup, settings: { ...settings, timeZone: 'Invalid/Zone' } }, { ...backup, workspace: { invalid: entry } }]) {
    assert.equal((await h.send('import-data', { data })).ok, false);
    assert.deepEqual(h.storage[STORAGE_KEY], saved);
  }
});

test('delete resets connected and archived data and clears tracking jobs; data writes require dashboard access', async () => {
  const h = await harness();
  const state = emptyState();
  state.accounts.leetcode = { handle: 'sample', generation: 'old' };
  state.disconnectedAccounts.codeforces = { handle: 'archived' };
  state.workspace[entry.key] = entry;
  h.storage[STORAGE_KEY] = state;
  h.scheduled.set('crossdsa-history:leetcode', {});
  h.scheduled.set('crossdsa-verify:leetcode', {});
  for (const action of ['delete-data', 'import-data']) for (const sender of [
    { id: 'test-extension', url: 'chrome-extension://test-extension/popup.html' },
    { id: 'test-extension', url: 'https://leetcode.com/' },
  ]) assert.equal((await h.send(action, { data: emptyState() }, sender)).ok, false);
  assert.deepEqual(h.storage[STORAGE_KEY], state);
  const result = await h.send('delete-data');
  assert.equal(result.ok, true);
  assert.deepEqual(result.state, emptyState());
  assert.equal(h.scheduled.has('crossdsa-history:leetcode'), false);
  assert.equal(h.scheduled.has('crossdsa-verify:leetcode'), false);
});

test('in-flight sync cannot restore deleted data or overwrite an imported account', async () => {
  for (const action of ['delete-data', 'import-data']) {
    let finish, started;
    const requested = new Promise(resolve => { started = resolve; });
    const h = await harness(async () => {
      started();
      await new Promise(resolve => { finish = resolve; });
      return { ok: true, json: async () => ({ data: { dsa_domain_data: { problem_count_data: { total_count: 99 } } } }) };
    });
    const state = emptyState();
    state.settings.autoSync = false;
    state.accounts.code360 = { handle: 'sample', generation: 'original' };
    h.storage[STORAGE_KEY] = state;
    const sync = h.send('sync', { platform: 'code360' });
    await requested;
    const backup = structuredClone(state);
    backup.accounts.code360.snapshot = { totalSolved: 7, recent: [] };
    assert.equal((await h.send(action, { data: backup })).ok, true);
    finish(); await sync;
    if (action === 'delete-data') assert.deepEqual(h.storage[STORAGE_KEY].accounts, {});
    else assert.equal(h.storage[STORAGE_KEY].accounts.code360.snapshot.totalSolved, 7);
  }
});

test('TUF syncs without a tab and Code360 totals survive a streak 404', async () => {
  const frame = 'a:' + JSON.stringify({ dsaProgress: { byPlatform: { TUF: { platform: 'TUF', solved: 122 } } } }) + '\n';
  const html = '<link rel="canonical" href="https://takeuforward.org/profile/sample"/><script>self.__next_f.push(' + JSON.stringify([1, frame]) + ')</script>';
  const h = await harness(async url => {
    if (url.includes('takeuforward.org/profile')) return { ok: true, text: async () => html };
    if (url.includes('streaks')) return { ok: false, status: 404 };
    return { ok: true, json: async () => ({ data: { dsa_domain_data: { problem_count_data: { total_count: 7 } } } }) };
  });
  const state = emptyState(); state.accounts = { tuf: { handle: 'sample', generation: 'tuf' }, code360: { handle: 'sample', generation: 'cn' } };
  h.storage[STORAGE_KEY] = state;
  const result = await h.send('sync');
  assert.equal(result.state.accounts.tuf.status, 'ready');
  assert.equal(result.state.accounts.tuf.snapshot.totalSolved, 122);
  assert.equal(result.state.accounts.code360.status, 'ready');
  assert.equal(result.state.accounts.code360.snapshot.totalSolved, 7);
  assert.equal(result.state.accounts.code360.error, null);
});

test('Code360 links from legacy URLs and profile IDs with one successful request', async () => {
  const requests = [];
  const h = await harness(async url => {
    requests.push(url);
    return { ok: true, json: async () => ({ data: { dsa_domain_data: { problem_count_data: { total_count: 7 } } } }) };
  });
  for (const input of ['www.codingninjas.com/studio/profile/sample', 'https://www.naukri.com/code360/profile/1ccafe76-59cf-423a-8fe2-12c9deccb93f']) {
    const result = await h.send('connect', { platform: 'code360', handle: input });
    assert.equal(result.ok, true);
    assert.equal(result.state.accounts.code360.status, 'ready');
    assert.equal(result.state.accounts.code360.snapshot.totalSolved, 7);
  }
  assert.equal(requests.length, 2);
  assert.ok(requests.every(url => url.includes('profile/user_details?uuid=')));
});

test('platform order persists independently and rejects invalid or popup writes', async () => {
  const h = await harness();
  const order = ['tuf', 'atcoder', 'code360', 'geeksforgeeks', 'codechef', 'codeforces', 'leetcode'];
  assert.equal((await h.send('platform-order', { order })).ok, true);
  assert.deepEqual(h.storage[STORAGE_KEY].settings.platformOrder, order);
  assert.deepEqual(orderedPlatformIds(normalizeState(structuredClone(h.storage[STORAGE_KEY])).settings), order);
  assert.equal((await h.send('platform-order', { order: [...order].reverse() }, { id: 'test-extension', url: 'chrome-extension://test-extension/popup.html' })).ok, false);
  assert.equal((await h.send('settings', { settings })).ok, true);
  assert.deepEqual(h.storage[STORAGE_KEY].settings.platformOrder, order);
  for (const invalid of [[], order.slice(1), [...order.slice(1), 'unknown'], Array(7).fill('leetcode')]) {
    assert.equal((await h.send('platform-order', { order: invalid })).ok, false);
  }
  assert.deepEqual(h.storage[STORAGE_KEY].settings.platformOrder, order);
});

test('AtCoder connects, imports activity and ratings, preserves cached accepts and disconnects', async () => {
  let activityOffline = false;
  const timestamp = Math.floor(Date.now() / 1000);
  const h = await harness(async url => {
    if (url.includes('data/atcoder-data.json')) return { ok: true, json: async () => [{ id: 'dp_a', title: 'Frog 1' }] };
    if (url.includes('/history/json')) return { ok: true, json: async () => [{ IsRated: true, NewRating: 1200, ContestName: 'ABC', EndTime: new Date().toISOString() }] };
    if (url.includes('kenkoooo.com')) {
      if (activityOffline) throw new Error('Offline');
      return { ok: true, json: async () => [{ id: 123, epoch_second: timestamp, user_id: 'sample', problem_id: 'dp_a', contest_id: 'dp', result: 'AC' }] };
    }
    return { ok: true, text: async () => '<title>sample - AtCoder</title><th>Rating</th><td>1200</td><th>Rank</th><td>50th</td>' };
  });
  let result = await h.send('connect', { platform: 'atcoder', handle: 'https://atcoder.jp/users/sample' });
  assert.equal(result.ok, true);
  let account = result.state.accounts.atcoder;
  assert.equal(account.status, 'ready'); assert.equal(account.snapshot.totalSolved, 1);
  assert.equal(account.snapshot.rating, 1200); assert.equal(account.snapshot.rank, 50);
  assert.equal(account.snapshot.recent[0].title, 'Frog 1');
  activityOffline = true;
  result = await h.send('sync', { platform: 'atcoder' });
  assert.equal(result.state.accounts.atcoder.snapshot.recent.length, 1);
  assert.match(result.state.accounts.atcoder.snapshot.activityWarning, /Offline/);
  h.setAllowed(false);
  await h.send('sync', { platform: 'atcoder' });
  account = h.storage[STORAGE_KEY].accounts.atcoder;
  assert.equal(account.status, 'error'); assert.equal(account.snapshot.totalSolved, 1);
  assert.equal((await h.send('disconnect', { platform: 'atcoder' })).ok, true);
  assert.equal(h.storage[STORAGE_KEY].accounts.atcoder, undefined);
  assert.equal(h.storage[STORAGE_KEY].disconnectedAccounts.atcoder.snapshot.recent.length, 1);
});

test('AtCoder supports Starred and custom lists before connecting an account', async () => {
  const h = await harness();
  const question = { ...entry, key: 'atcoder:dp_a', platform: 'atcoder', title: 'Frog 1', url: 'https://atcoder.jp/contests/dp/tasks/dp_a', topics: [], listIds: [] };
  assert.equal((await h.send('question-state', { entry: question, patch: { done: true } })).ok, false);
  assert.equal((await h.send('question-state', { entry: question, patch: { starred: true } })).ok, true);
  await h.send('list:create', { name: 'DP practice' });
  const state = h.storage[STORAGE_KEY], list = Object.values(state.lists).find(p => p.name === 'DP practice');
  assert.equal((await h.send('workspace', { entry: { ...question, listIds: [list.id] }, customListsOnly: true })).ok, true);
  const saved = h.storage[STORAGE_KEY].workspace[question.key];
  assert.equal(saved.done, undefined);
  assert.deepEqual(saved.listIds, [list.id, 'saved']);
  assert.deepEqual(h.storage[STORAGE_KEY].accounts, {});
});
const response = value => ({ ok: true, json: async () => value });

test('startup migrates the activity refresh alarm from hourly to every 30 minutes', async () => {
  const h = await harness();
  h.scheduled.set('crossdsa-hourly-sync', { periodInMinutes: 60 });
  chrome.runtime.onStartup.listeners[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.scheduled.get('crossdsa-hourly-sync').periodInMinutes, 30);
});
const leetcodeData = total => ({ data: { matchedUser: { profile: {}, submitStatsGlobal: { acSubmissionNum: [{ difficulty: 'All', count: total }] }, badges: [], userCalendar: { activeYears: [], submissionCalendar: '{}' } }, recentAcSubmissionList: [], userContestRanking: null, userContestRankingHistory: [] } });

test('browser accepts update immediately, deduplicate, and become verified on sync', async () => {
  const timestamp = Math.floor(Date.now() / 1000) * 1000;
  const data = leetcodeData(1);
  data.data.recentAcSubmissionList = [{ id: '123', title: 'Two Sum', titleSlug: 'two-sum', timestamp: timestamp / 1000 }];
  const h = await harness(async () => response(data));
  const initial = emptyState(); initial.settings.autoSync = false;
  initial.accounts.leetcode = { handle: 'sample', generation: 'test', syncedAt: timestamp - 10000, snapshot: { totalSolved: 0, calendar: {}, recent: [] } };
  h.storage[STORAGE_KEY] = initial;
  const sender = { id: 'test-extension', tab: { id: 1 }, url: 'https://leetcode.com/problems/two-sum/' };
  const payload = { platform: 'leetcode', handle: 'sample', generation: 'test', submission: { id: '123', title: 'Two Sum', slug: 'two-sum', timestamp } };
  assert.equal((await h.send('accepted', payload, sender)).ok, true);
  assert.equal((await h.send('accepted', payload, sender)).ok, true);
  let records = h.storage[STORAGE_KEY].accounts.leetcode.snapshot.recent;
  assert.equal(records.length, 1); assert.equal(records[0].pending, true);
  assert.ok(h.scheduled.has('crossdsa-verify:leetcode'));
  await h.send('sync', { platform: 'leetcode' });
  records = h.storage[STORAGE_KEY].accounts.leetcode.snapshot.recent;
  assert.equal(records.length, 1); assert.equal(records[0].pending, undefined);
});

test('browser accepts reject foreign senders, account changes, stale times and wrong questions', async () => {
  const h = await harness(); const initial = emptyState();
  initial.accounts.leetcode = { handle: 'sample', generation: 'test', snapshot: { totalSolved: 0, recent: [] } };
  h.storage[STORAGE_KEY] = initial;
  const sender = { id: 'test-extension', tab: { id: 1 }, url: 'https://leetcode.com/problems/two-sum/' };
  const payload = { platform: 'leetcode', handle: 'sample', generation: 'test', submission: { id: '123', title: 'Two Sum', slug: 'two-sum', timestamp: Date.now() } };
  for (const invalid of [{ ...payload, handle: 'other' }, { ...payload, generation: 'old' }, { ...payload, submission: { ...payload.submission, slug: 'three-sum' } }, { ...payload, submission: { ...payload.submission, timestamp: 1 } }]) {
    assert.equal((await h.send('accepted', invalid, sender)).ok, false);
  }
  assert.equal((await h.send('accepted', payload, { ...sender, id: 'foreign' })).ok, false);
  assert.equal(h.storage[STORAGE_KEY].accounts.leetcode.snapshot.recent.length, 0);
});

test('failed verification retains browser-observed accepts', async () => {
  const h = await harness(); const initial = emptyState();
  initial.accounts.leetcode = { handle: 'sample', generation: 'test', snapshot: { totalSolved: 0, recent: [] } };
  h.storage[STORAGE_KEY] = initial;
  await h.send('accepted', { platform: 'leetcode', handle: 'sample', generation: 'test', submission: { id: '123', title: 'Two Sum', slug: 'two-sum', timestamp: Date.now() } }, { id: 'test-extension', tab: { id: 1 }, url: 'https://leetcode.com/problems/two-sum/' });
  await h.send('sync', { platform: 'leetcode' });
  assert.equal(h.storage[STORAGE_KEY].accounts.leetcode.snapshot.recent[0].pending, true);
});

test('service restricts tracker messages to the extension dashboard', async () => {
  const h = await harness();
  const result = await h.send('settings', { settings }, { id: 'test-extension', url: 'https://leetcode.com/problems/two-sum', tab: { id: 1 } });
  assert.equal(result.ok, false); assert.match(result.error, /Dashboard/);
});

test('question stars preserve lists and notes while manual Done writes are rejected', async () => {
  const h = await harness(); const initial = emptyState();
  initial.lists.custom = { id: 'custom', name: 'Custom' };
  initial.workspace[entry.key] = { ...entry, listIds: ['custom'], notes: 'Keep this note' };
  h.storage[STORAGE_KEY] = initial;
  assert.equal((await h.send('question-state', { entry, patch: { starred: true } })).ok, true);
  for (const done of [true, false]) assert.equal((await h.send('question-state', { entry, patch: { done } })).ok, false);
  let saved = h.storage[STORAGE_KEY].workspace[entry.key];
  assert.deepEqual(saved.listIds, ['custom', 'saved']); assert.equal(saved.done, undefined);
  assert.equal(saved.notes, 'Keep this note');
  await h.send('question-state', { entry, patch: { starred: false } });
  saved = h.storage[STORAGE_KEY].workspace[entry.key];
  assert.deepEqual(saved.listIds, ['custom']); assert.equal(saved.notes, 'Keep this note');
});

test('question state rejects invalid patches and website or popup mutations', async () => {
  const h = await harness();
  for (const patch of [{ done: 'yes' }, { unknown: true }, { starred: true, done: true }, {}]) {
    assert.equal((await h.send('question-state', { entry, patch })).ok, false);
  }
  assert.equal((await h.send('question-state', { entry: { ...entry, key: 'wrong' }, patch: { done: true } })).ok, false);
  assert.equal((await h.send('question-state', { entry, patch: { done: true } }, { id: 'test-extension', url: 'chrome-extension://test-extension/popup.html' })).ok, false);
  assert.equal((await h.send('question-state', { entry, patch: { done: true } }, { id: 'test-extension', tab: { id: 1 }, url: entry.url })).ok, false);
});

test('custom list saves preserve current Starred status, including concurrent star changes', async () => {
  const h = await harness(); const initial = emptyState();
  initial.lists.custom = { id: 'custom', name: 'Custom' };
  initial.workspace[entry.key] = { ...entry, done: true, listIds: ['saved', 'custom'] };
  h.storage[STORAGE_KEY] = initial;
  const result = await h.send('workspace', { entry: { ...entry, listIds: [] }, customListsOnly: true });
  assert.deepEqual(result.state.workspace[entry.key].listIds, ['saved']);
  assert.equal(result.state.workspace[entry.key].done, true);
  assert.equal((await h.send('workspace', { entry, customListsOnly: true })).ok, false);
  await Promise.all([
    h.send('question-state', { entry, patch: { starred: false } }),
    h.send('workspace', { entry: { ...entry, listIds: ['custom'] }, customListsOnly: true }),
  ]);
  assert.deepEqual(h.storage[STORAGE_KEY].workspace[entry.key].listIds, ['custom']);
});

test('concurrent settings and practice saves preserve both changes', async () => {
  const h = await harness();
  const [a, b] = await Promise.all([h.send('settings', { settings }), h.send('workspace', { entry })]);
  assert.equal(a.ok, true); assert.equal(b.ok, true);
  assert.equal(h.storage[STORAGE_KEY].settings.dailyGoal, 3);
  assert.deepEqual(h.storage[STORAGE_KEY].workspace[entry.key].listIds, ['saved']);
});

test('invalid settings or workspace links do not overwrite stored data', async () => {
  const h = await harness();
  assert.equal((await h.send('settings', { settings: { ...settings, dailyGoal: -1 } })).ok, false);
  assert.equal((await h.send('settings', { settings: { ...settings, timeZone: 'Mars/Test' } })).ok, false);
  assert.equal((await h.send('workspace', { entry: { ...entry, url: 'javascript:alert(1)' } })).ok, false);
});

test('contest preferences persist independently of activity settings and validate permissions', async () => {
  const h = await harness();
  assert.equal((await h.send('contest-settings', { contestsEnabled: true, contestReminders: true })).ok, true);
  await h.send('settings', { settings });
  assert.equal(h.storage[STORAGE_KEY].settings.contestReminders, true);
  h.setAllowed(false);
  assert.equal((await h.send('contest-settings', { contestsEnabled: true, contestReminders: true })).ok, false);
  assert.equal((await h.send('contest-settings', { contestsEnabled: false, contestReminders: true })).ok, false);
  h.setAllowed(true);
  assert.equal((await h.send('contest-settings', { contestsEnabled: false, contestReminders: true })).ok, true);
  assert.equal(h.storage[STORAGE_KEY].settings.contestReminders, true);
  assert.equal((await h.send('contest-settings', { contestsEnabled: false, contestReminders: false })).ok, true);
  assert.equal(h.storage[STORAGE_KEY].settings.contestReminders, false);
  assert.equal(h.storage[STORAGE_KEY].settings.dailyGoal, 3);
});

test('failed sync preserves the previous snapshot and last successful update', async () => {
  const h = await harness();
  const initial = emptyState(); initial.accounts.leetcode = { handle: 'sample', generation: 'original', status: 'ready', syncedAt: 123, snapshot: { totalSolved: 42, recent: [] } };
  h.storage[STORAGE_KEY] = initial;
  const result = await h.send('sync', { platform: 'leetcode' });
  assert.equal(result.ok, true); assert.equal(result.state.accounts.leetcode.status, 'error');
  assert.equal(result.state.accounts.leetcode.snapshot.totalSolved, 42); assert.equal(result.state.accounts.leetcode.syncedAt, 123);
  assert.match(result.state.accounts.leetcode.error, /Offline/);
});

test('missing site permissions preserve cached data without making requests', async () => {
  let requested = false;
  const h = await harness(async () => { requested = true; throw new Error('Unexpected request'); }); h.setAllowed(false);
  const initial = emptyState(); initial.accounts.leetcode = { handle: 'sample', generation: 'test', snapshot: { totalSolved: 7, recent: [] } }; h.storage[STORAGE_KEY] = initial;
  const result = await h.send('sync', { platform: 'leetcode' });
  assert.equal(requested, false); assert.equal(result.state.accounts.leetcode.snapshot.totalSolved, 7);
  assert.match(result.state.accounts.leetcode.error, /access is missing/);
});

test('new handles replace the old account snapshot instead of mixing histories', async () => {
  const h = await harness(async () => response(leetcodeData(8)));
  const initial = emptyState(); initial.accounts.leetcode = { handle: 'old', generation: 'old', snapshot: { totalSolved: 100, recent: [{ id: 'old-record', key: 'old' }] } }; h.storage[STORAGE_KEY] = initial;
  const result = await h.send('connect', { platform: 'leetcode', handle: 'new' });
  assert.equal(result.ok, true); assert.equal(result.state.accounts.leetcode.handle, 'new');
  assert.equal(result.state.accounts.leetcode.snapshot.totalSolved, 8); assert.deepEqual(result.state.accounts.leetcode.snapshot.recent, []);
});

test('an invalid new handle keeps the previous account and its successful snapshot', async () => {
  const h = await harness(async () => response({ data: { matchedUser: null } }));
  const initial = emptyState(); initial.accounts.leetcode = { handle: 'old', generation: 'old', syncedAt: 123, snapshot: { totalSolved: 100, recent: [] } }; h.storage[STORAGE_KEY] = initial;
  const result = await h.send('connect', { platform: 'leetcode', handle: 'missing' });
  assert.equal(result.state.accounts.leetcode.handle, 'old'); assert.equal(result.state.accounts.leetcode.snapshot.totalSolved, 100);
  assert.equal(result.state.accounts.leetcode.syncedAt, 123); assert.match(result.state.accounts.leetcode.error, /Kept the previous/);
});

test('a bookmark saved during a network sync survives the completed sync', async () => {
  let resolveRequest, started;
  const requestStarted = new Promise(resolve => { started = resolve; });
  const h = await harness(async () => { started(); return new Promise(resolve => { resolveRequest = () => resolve(response(leetcodeData(5))); }); });
  const initial = emptyState(); initial.accounts.leetcode = { handle: 'sample', generation: 'test', status: 'ready' }; h.storage[STORAGE_KEY] = initial;
  const sync = h.send('sync', { platform: 'leetcode' });
  await requestStarted;
  assert.equal((await h.send('workspace', { entry })).ok, true);
  resolveRequest(); await sync;
  assert.deepEqual(h.storage[STORAGE_KEY].workspace[entry.key].listIds, ['saved']);
  assert.equal(h.storage[STORAGE_KEY].accounts.leetcode.snapshot.totalSolved, 5);
});


test('named lists support multiple memberships and reject unknown lists', async () => {
  const h = await harness();
  const created = await h.send('list:create', { name: 'Arrays' });
  const id = Object.values(created.state.lists).find(list => list.name === 'Arrays').id;
  assert.equal((await h.send('list:create', { name: ' arrays ' })).ok, false);
  const saved = await h.send('workspace', { entry: { ...entry, listIds: ['saved', id] } });
  assert.deepEqual(saved.state.workspace[entry.key].listIds, ['saved', id]);
  assert.equal((await h.send('workspace', { entry: { ...entry, listIds: ['missing'] } })).ok, false);
  const removed = await h.send('workspace', { entry: { ...entry, listIds: [] } });
  assert.deepEqual(removed.state.workspace[entry.key].listIds, []);
});

test('list changes retain legacy notes and revision data', async () => {
  const h = await harness();
  const initial = emptyState(); initial.workspace[entry.key] = { ...entry, bookmarked: true, notes: 'Keep me', revisionDate: '2026-10-10' };
  h.storage[STORAGE_KEY] = initial;
  const result = await h.send('workspace', { entry: { ...entry, listIds: [] } });
  assert.equal(result.state.workspace[entry.key].notes, 'Keep me');
  assert.equal(result.state.workspace[entry.key].revisionDate, '2026-10-10');
});

test('submission refresh is scoped to the sending platform and obeys auto sync', async () => {
  let requests = 0;
  const h = await harness(async () => { requests++; return response(leetcodeData(9)); });
  const initial = emptyState(); initial.accounts.leetcode = { handle: 'sample', generation: 'test', status: 'ready' };
  h.storage[STORAGE_KEY] = initial;
  const sender = { id: 'test-extension', url: 'https://leetcode.com/problems/two-sum/submissions/123/', tab: { id: 1 } };
  assert.equal((await h.send('submission', { platform: 'codechef' }, sender)).ok, false);
  assert.equal((await h.send('submission', { platform: 'leetcode' }, { ...sender, url: 'https://evil.example/' })).ok, false);
  assert.equal((await h.send('submission', { platform: 'leetcode' }, sender)).ok, true);
  assert.equal(requests, 0, 'Submission event does not invent a solve or immediately fetch');
  assert.deepEqual(h.scheduled.get('crossdsa-submission:leetcode'), { delayInMinutes: 0.5 });
  assert.deepEqual(h.scheduled.get('crossdsa-submission:leetcode:retry'), { delayInMinutes: 2 });
  chrome.alarms.onAlarm.listeners[0]({ name: 'crossdsa-submission:leetcode' });
  for (let i = 0; i < 20 && h.storage[STORAGE_KEY].accounts.leetcode.status !== 'ready'; i++) await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.storage[STORAGE_KEY].accounts.leetcode.snapshot.totalSolved, 9);
  h.storage[STORAGE_KEY].settings.autoSync = false; h.scheduled.clear();
  await h.send('submission', { platform: 'leetcode' }, sender);
  assert.equal(h.scheduled.size, 0);
});


test('popup can read and refresh activity but cannot change settings or lists', async () => {
  const h = await harness();
  const sender = { id: 'test-extension', url: 'chrome-extension://test-extension/popup.html' };
  assert.equal((await h.send('get', {}, sender)).ok, true);
  assert.equal((await h.send('sync', {}, sender)).ok, true);
  assert.equal((await h.send('settings', { settings }, sender)).ok, false);
  assert.equal((await h.send('list:create', { name: 'Unexpected' }, sender)).ok, false);
});


test('background merges verified LeetCode tab accepts when public history is empty', async () => {
  const h = await harness(async () => response(leetcodeData(299)));
  const initial = emptyState(); initial.accounts.leetcode = { handle: 'sample', generation: 'test', status: 'ready' }; h.storage[STORAGE_KEY] = initial;
  chrome.tabs.query = async () => [{ id: 7 }];
  chrome.tabs.sendMessage = async (id, message) => {
    assert.equal(id, 7); assert.equal(message.handle, 'sample');
    return { ok: true, username: 'Sample', submissions: [{ id: 42, title: 'Two Sum', titleSlug: 'two-sum', timestamp: Math.floor(Date.now() / 1000) }] };
  };
  const result = await h.send('sync', { platform: 'leetcode' });
  assert.equal(result.state.accounts.leetcode.snapshot.recent[0].key, 'leetcode:two-sum');
  assert.equal(result.state.accounts.leetcode.snapshot.recentSource, 'signed-in');
  chrome.tabs.sendMessage = async () => ({ ok: true, username: 'other-user', submissions: [{ id: 99, titleSlug: 'other' }] });
  const mismatch = await h.send('sync', { platform: 'leetcode' });
  assert.match(mismatch.state.accounts.leetcode.snapshot.activityWarning, /did not match/);
  assert.equal(mismatch.state.accounts.leetcode.snapshot.recent.length, 1, 'Old verified accepts retained without importing the wrong account');
});


test('disconnect removes active tracking, clears pending refreshes and preserves lists and cached history', async () => {
  const h = await harness(); const initial = emptyState();
  initial.accounts.leetcode = { handle: 'sample', generation: 'old', status: 'ready', snapshot: { totalSolved: 42, recent: [] } };
  initial.workspace[entry.key] = entry; h.storage[STORAGE_KEY] = initial;
  h.scheduled.set('crossdsa-submission:leetcode', {}); h.scheduled.set('crossdsa-submission:leetcode:retry', {});
  const result = await h.send('disconnect', { platform: 'leetcode' });
  assert.equal(result.ok, true); assert.equal(result.state.accounts.leetcode, undefined);
  assert.equal(result.state.disconnectedAccounts.leetcode.snapshot.totalSolved, 42);
  assert.deepEqual(result.state.workspace[entry.key], entry); assert.equal(h.scheduled.size, 0);
  assert.equal((await h.send('disconnect', { platform: 'unknown' })).ok, false);
});

test('an in-flight sync cannot restore a disconnected account', async () => {
  let finish, started; const begun = new Promise(resolve => { started = resolve; });
  const h = await harness(async () => { started(); return new Promise(resolve => { finish = () => resolve(response(leetcodeData(99))); }); });
  const initial = emptyState(); initial.accounts.leetcode = { handle: 'sample', generation: 'old', snapshot: { totalSolved: 42, recent: [] } }; h.storage[STORAGE_KEY] = initial;
  const sync = h.send('sync', { platform: 'leetcode' }); await begun;
  await h.send('disconnect', { platform: 'leetcode' }); finish(); await sync;
  assert.equal(h.storage[STORAGE_KEY].accounts.leetcode, undefined);
  assert.equal(h.storage[STORAGE_KEY].disconnectedAccounts.leetcode.snapshot.totalSolved, 42);
});

test('LeetCode restores both helpers and retries a missing receiver while verifying the account', async () => {
  const h = await harness(async () => response(leetcodeData(299)));
  const initial = emptyState(); initial.accounts.leetcode = { handle: 'sample', generation: 'test' }; h.storage[STORAGE_KEY] = initial;
  chrome.tabs.query = async () => [{ id: 7 }];
  let messages = 0, injections = 0;
  chrome.tabs.sendMessage = async () => {
    if (++messages === 1) throw new Error('Could not establish connection. Receiving end does not exist.');
    return { ok: true, username: 'sample', submissions: [{ id: 42, title: 'Two Sum', titleSlug: 'two-sum', timestamp: Math.floor(Date.now() / 1000) }] };
  };
  chrome.scripting = { executeScript: async options => { injections++; assert.deepEqual(options, { target: { tabId: 7 }, files: ['tracker/platforms/leetcode-session.js', 'tracker/platforms/leetcode-browser.js'] }); } };
  const result = await h.send('sync', { platform: 'leetcode' });
  assert.equal(injections, 2); assert.equal(messages, 2);
  assert.equal(result.state.accounts.leetcode.snapshot.recentSource, 'signed-in');
  messages = 0;
  chrome.tabs.sendMessage = async () => {
    if (++messages === 1) throw new Error('Could not establish connection. Receiving end does not exist.');
    return { ok: true, username: 'other', submissions: [{ id: 99, titleSlug: 'wrong-user', timestamp: 1 }] };
  };
  const mismatch = await h.send('sync', { platform: 'leetcode' });
  assert.match(mismatch.state.accounts.leetcode.snapshot.activityWarning, /did not match/);
  assert.equal(mismatch.state.accounts.leetcode.snapshot.recent.length, 1);
});

test('missing LeetCode receiver without scripting permission shows reconnect guidance and retains totals', async () => {
  const h = await harness(async () => response(leetcodeData(299)));
  const initial = emptyState(); initial.accounts.leetcode = { handle: 'sample', generation: 'test' }; h.storage[STORAGE_KEY] = initial;
  chrome.permissions.contains = async permissions => !permissions.permissions?.includes('scripting');
  chrome.tabs.query = async () => [{ id: 7 }];
  chrome.tabs.sendMessage = async () => { throw new Error('Could not establish connection. Receiving end does not exist.'); };
  const result = await h.send('sync', { platform: 'leetcode' });
  assert.equal(result.state.accounts.leetcode.snapshot.totalSolved, 299);
  assert.match(result.state.accounts.leetcode.snapshot.activityWarning, /Reconnect LeetCode/);
  assert.doesNotMatch(result.state.accounts.leetcode.snapshot.activityWarning, /Receiving end/);
});

test('a missing receiver on another tab does not mask the signed-in account error', async () => {
  const h = await harness(async () => response(leetcodeData(299)));
  const initial = emptyState(); initial.accounts.leetcode = { handle: 'sample', generation: 'test' }; h.storage[STORAGE_KEY] = initial;
  chrome.permissions.contains = async permissions => !permissions.permissions?.includes('scripting');
  chrome.tabs.query = async () => [{ id: 7 }, { id: 8 }];
  chrome.tabs.sendMessage = async id => {
    if (id === 7) return { ok: false, error: 'Sign in to LeetCode as @sample.' };
    throw new Error('Could not establish connection. Receiving end does not exist.');
  };
  const result = await h.send('sync', { platform: 'leetcode' });
  assert.match(result.state.accounts.leetcode.snapshot.activityWarning, /Sign in.*@sample/);
});

const settleRecovery = async () => {
  for (let i = 0; i < 30; i++) await new Promise(resolve => setImmediate(resolve));
};

test('opening LeetCode recovers activity automatically and coalesces repeated tab events', async () => {
  let requests = 0, injections = 0;
  const h = await harness(async () => { requests++; return response(leetcodeData(299)); });
  const initial = emptyState();
  initial.accounts.leetcode = { handle: 'sample', generation: 'test', syncedAt: Date.now(), snapshot: { totalSolved: 299, activityWarning: 'Open LeetCode', recent: [] } };
  h.storage[STORAGE_KEY] = initial;
  chrome.tabs.query = async () => [{ id: 7 }];
  chrome.scripting = { executeScript: async () => { injections++; } };
  chrome.tabs.sendMessage = async () => ({ ok: true, username: 'sample', submissions: [{ id: 42, title: 'Two Sum', titleSlug: 'two-sum', timestamp: Math.floor(Date.now() / 1000) }] });
  const opened = () => chrome.tabs.onUpdated.listeners[0](7, { status: 'complete' }, { url: 'https://leetcode.com/problems/two-sum/' });
  opened(); opened(); opened();
  await settleRecovery();
  const account = h.storage[STORAGE_KEY].accounts.leetcode;
  assert.equal(requests, 1);
  assert.equal(account.snapshot.activityWarning, '');
  assert.equal(account.snapshot.recent[0].id, 'leetcode:42');
  assert.equal(account.activitySyncedAt, account.profileSyncedAt);
  assert.ok(injections > 0);
  chrome.tabs.onActivated.listeners[0]({ tabId: 7 });
  await settleRecovery();
  assert.equal(requests, 1);
  assert.ok(h.scheduled.has('crossdsa-leetcode-recovery'));
});

test('activity freshness and cached accepts survive closed tabs, expired sessions and wrong accounts', async () => {
  const h = await harness(async () => response(leetcodeData(299)));
  const initial = emptyState();
  const saved = { id: 'leetcode:42', key: 'leetcode:two-sum', platform: 'leetcode', title: 'Two Sum', url: 'https://leetcode.com/problems/two-sum/', timestamp: Date.now() - 10000 };
  initial.accounts.leetcode = { handle: 'sample', generation: 'test', profileSyncedAt: 123, activitySyncedAt: 100, snapshot: { totalSolved: 299, recent: [saved] } };
  h.storage[STORAGE_KEY] = initial;
  for (const result of [null, { ok: false, error: 'Sign in to LeetCode to import your accepted questions.' }, { ok: true, username: 'other', submissions: [] }]) {
    chrome.tabs.query = async () => result ? [{ id: 7 }] : [];
    chrome.tabs.sendMessage = async () => result;
    const { state } = await h.send('sync', { platform: 'leetcode' });
    const account = state.accounts.leetcode;
    assert.ok(account.profileSyncedAt > 123);
    assert.equal(account.activitySyncedAt, 100);
    assert.deepEqual(account.snapshot.recent, [saved]);
    assert.ok(account.calendarSyncedAt > 123);
    if (result === null) {
      assert.equal(account.snapshot.activityWarning, '');
      assert.equal(account.snapshot.activityStatus, 'cached');
      assert.match(account.snapshot.activityNotice, /saved submission history/);
    } else assert.ok(account.snapshot.activityWarning);
  }
});

test('sign-in during recovery cooldown gets a deferred retry without another manual refresh', async () => {
  const h = await harness(async () => response(leetcodeData(299)));
  const initial = emptyState();
  initial.accounts.leetcode = { handle: 'sample', generation: 'test', recoveryAttemptedAt: Date.now(), snapshot: { totalSolved: 299, recent: [], activityWarning: 'Sign in' } };
  h.storage[STORAGE_KEY] = initial;
  chrome.tabs.query = async () => [{ id: 7 }];
  chrome.tabs.sendMessage = async () => ({ ok: true, username: 'sample', submissions: [] });
  chrome.tabs.onUpdated.listeners[0](7, { status: 'complete' }, { url: 'https://leetcode.com/' });
  await settleRecovery();
  assert.deepEqual(h.scheduled.get('crossdsa-leetcode-recovery'), { delayInMinutes: 1 });
  h.storage[STORAGE_KEY].accounts.leetcode.recoveryAttemptedAt -= 61000;
  chrome.alarms.onAlarm.listeners[0]({ name: 'crossdsa-leetcode-recovery' });
  await settleRecovery();
  assert.equal(h.storage[STORAGE_KEY].accounts.leetcode.snapshot.activityWarning, '');
  assert.ok(h.storage[STORAGE_KEY].accounts.leetcode.activitySyncedAt);
});

test('extension startup repairs both helpers while respecting disabled automatic sync', async () => {
  let requests = 0; const files = [];
  const h = await harness(async () => { requests++; return response(leetcodeData(299)); });
  const initial = emptyState(); initial.settings.autoSync = false;
  initial.accounts.leetcode = { handle: 'sample', generation: 'test', snapshot: { recent: [], activityWarning: 'Open LeetCode' } };
  h.storage[STORAGE_KEY] = initial;
  chrome.tabs.query = async () => [{ id: 7 }];
  chrome.scripting = { executeScript: async options => files.push(options.files) };
  chrome.runtime.onInstalled.listeners[0]();
  await settleRecovery();
  assert.deepEqual(files, [['tracker/platforms/leetcode-session.js', 'tracker/platforms/leetcode-browser.js']]);
  assert.equal(requests, 0);
  assert.equal(h.storage[STORAGE_KEY].accounts.leetcode.snapshot.activityWarning, 'Open LeetCode');
});

test('unrelated tab navigation does not request LeetCode recovery', async () => {
  const h = await harness(); let queries = 0;
  const initial = emptyState(); initial.accounts.leetcode = { handle: 'sample', generation: 'test' };
  h.storage[STORAGE_KEY] = initial;
  chrome.tabs.query = async () => { queries++; return []; };
  chrome.tabs.get = async () => ({ url: 'https://example.com/' });
  chrome.tabs.onUpdated.listeners[0](7, { status: 'complete' }, { url: 'https://example.com/' });
  chrome.tabs.onActivated.listeners[0]({ tabId: 7 });
  await settleRecovery();
  assert.equal(queries, 0);
});

test('sync all starts independent platforms together and preserves per-platform status', async () => {
  let requests = 0; const releases = [];
  const h = await harness(async url => {
    requests++;
    if (url.includes('leetcode')) return new Promise(resolve => releases.push(() => resolve(response(leetcodeData(5)))));
    return new Promise(resolve => releases.push(() => resolve(response({ data: null }))));
  });
  const initial = emptyState();
  initial.accounts.leetcode = { handle: 'sample', generation: 'lc' };
  initial.accounts.code360 = { handle: 'sample', generation: '360' }; h.storage[STORAGE_KEY] = initial;
  const syncing = h.send('sync');
  for (let i = 0; i < 30 && requests < 2; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests, 2);
  assert.deepEqual(Object.values(h.storage[STORAGE_KEY].accounts).map(a => a.status), ['syncing', 'syncing']);
  for (const release of releases) release();
  const result = await syncing;
  assert.equal(result.state.accounts.leetcode.status, 'ready');
  assert.equal(result.state.accounts.code360.status, 'error');
});


async function waitForHistory(h, platform, status) {
  for (let i = 0; i < 600; i++) {
    if (h.storage[STORAGE_KEY].accounts[platform]?.historyImport?.status === status) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail(`History did not reach ${status}`);
}

test('Code360 history checkpoints, resumes after failures and retains imported data on profile refresh', async () => {
  const h = await harness(async () => response({ data: { dsa_domain_data: { problem_count_data: { total_count: 9 } } } }));
  const state = emptyState(); state.settings.autoSync = false;
  state.accounts.code360 = { handle: 'sample', generation: '360', snapshot: { totalSolved: 9, recent: [] } };
  h.storage[STORAGE_KEY] = state;
  chrome.tabs.query = async () => [{ id: 7 }];
  let fail = true; const pages = [];
  chrome.tabs.sendMessage = async (_id, message) => {
    pages.push(message.page);
    if (message.page === 2 && fail) return { ok: false, error: 'Session expired' };
    return { ok: true, handles: ['sample'], page: message.page, totalPages: 2, rows: [{
      link: `/code360/problems/question_${message.page}`, title: `Question ${message.page}`,
      solvedAt: message.page === 1 ? '2026-01-01T12:00:00Z' : null,
    }] };
  };
  await h.send('history', { platform: 'code360', command: 'start' });
  chrome.alarms.onAlarm.listeners[0]({ name: 'crossdsa-history:code360' });
  await waitForHistory(h, 'code360', 'error');
  assert.equal(h.storage[STORAGE_KEY].accounts.code360.historyImport.cursor.page, 2);
  assert.equal(h.storage[STORAGE_KEY].accounts.code360.snapshot.recent.length, 1);
  fail = false;
  await h.send('history', { platform: 'code360', command: 'resume' });
  chrome.alarms.onAlarm.listeners[0]({ name: 'crossdsa-history:code360' });
  await waitForHistory(h, 'code360', 'complete');
  assert.deepEqual(pages, [1, 2, 2]);
  await h.send('sync', { platform: 'code360' });
  assert.deepEqual(pages, [1, 2, 2, 1], 'Normal refresh reads the newest signed-in solved page');
  const snapshot = h.storage[STORAGE_KEY].accounts.code360.snapshot;
  assert.equal(snapshot.totalSolved, 9);
  assert.equal(Object.keys(snapshot.solved).length, 2);
  assert.equal(snapshot.recent.length, 1);
  assert.equal(snapshot.historyComplete, true);
  assert.match(snapshot.coverage, /MCQ activity is excluded/);
});

test('Code360 closed-tab imports wait and resume on tab navigation with auto sync disabled', async () => {
  const h = await harness(); const state = emptyState(); state.settings.autoSync = false;
  state.accounts.code360 = { handle: 'sample', generation: '360', snapshot: { totalSolved: 9, recent: [] } };
  h.storage[STORAGE_KEY] = state;
  await h.send('history', { platform: 'code360', command: 'start' });
  chrome.alarms.onAlarm.listeners[0]({ name: 'crossdsa-history:code360' });
  await waitForHistory(h, 'code360', 'waiting-tab');
  chrome.tabs.query = async () => [{ id: 7 }];
  chrome.tabs.sendMessage = async () => ({ ok: true, handles: ['sample'], page: 1, totalPages: 0, rows: [] });
  chrome.tabs.onUpdated.listeners[0](7, { status: 'complete' }, { url: 'https://www.naukri.com/code360/home' });
  await waitForHistory(h, 'code360', 'running');
  chrome.alarms.onAlarm.listeners[0]({ name: 'crossdsa-history:code360' });
  await waitForHistory(h, 'code360', 'complete');
  assert.equal(h.storage[STORAGE_KEY].accounts.code360.snapshot.totalSolved, 9);
});

test('popup persists verified Code360 POTD completion and retains it with the tab closed', async () => {
  const h = await harness(); const state = emptyState();
  state.accounts.code360 = { handle: 'sample', generation: '360' };
  h.storage[STORAGE_KEY] = state;
  chrome.tabs.query = async () => [{ id: 7 }];
  chrome.tabs.sendMessage = async (_id, message) => {
    assert.equal(message.action, 'code360:daily');
    return { ok: true, handles: ['sample'], day: message.day, done: true };
  };
  const popup = { id: 'test-extension', url: 'chrome-extension://test-extension/popup.html' };
  const result = await h.send('daily-status', { platform: 'code360' }, popup);
  assert.equal(result.ok, true); assert.equal(result.state.done, true);
  const saved = structuredClone(h.storage[STORAGE_KEY]);
  assert.equal(saved.accounts.code360.dailyHistory[result.state.day].done, true);
  chrome.tabs.query = async () => [];
  const cached = await h.send('daily-status', { platform: 'code360' }, popup);
  assert.equal(cached.state.done, true); assert.equal(cached.state.cached, true);
  assert.deepEqual(h.storage[STORAGE_KEY], saved);
  chrome.tabs.query = async () => [{ id: 7 }];
  assert.equal((await h.send('daily-status', { platform: 'code360' }, { id: 'test-extension', url: 'https://www.naukri.com/code360/home' })).ok, false);
  for (const invalid of [{ handles: ['other'], done: true }, { handles: ['sample'], done: 'true' }, { handles: ['sample'], done: true, day: '2000-01-01' }]) {
    chrome.tabs.sendMessage = async (_id, message) => ({ ok: true, day: message.day, ...invalid });
    assert.equal((await h.send('daily-status', { platform: 'code360' }, popup)).ok, false);
  }
  chrome.tabs.sendMessage = async (_id, message) => {
    h.storage[STORAGE_KEY].accounts.code360.generation = 'replaced';
    return { ok: true, handles: ['sample'], day: message.day, done: true };
  };
  assert.equal((await h.send('daily-status', { platform: 'code360' }, popup)).ok, false);
});

test('TUF has automatic popup POTD status but rejects Done observations and imports', async () => {
  const h = await harness(); const state = emptyState();
  state.accounts.tuf = { handle: 'sample', generation: 'tuf', snapshot: { totalSolved: 9, recent: [] } };
  h.storage[STORAGE_KEY] = state;
  chrome.tabs.query = async query => { assert.equal(query.url, 'https://takeuforward.org/*'); return [{ id: 7 }]; };
  chrome.tabs.sendMessage = async (_id, message) => {
    assert.equal(message.action, 'tuf:daily');
    return { ok: true, handles: ['sample'], day: message.day, done: true };
  };
  const result = await h.send('daily-status', { platform: 'tuf' }, { id: 'test-extension', url: 'chrome-extension://test-extension/popup.html' });
  assert.equal(result.ok, true); assert.equal(result.state.done, true);
  const saved = structuredClone(h.storage[STORAGE_KEY]);
  assert.equal(saved.accounts.tuf.dailyHistory[result.state.day].done, true);
  assert.deepEqual(saved.accounts.tuf.snapshot, state.accounts.tuf.snapshot);
  chrome.tabs.query = async () => [];
  const cached = await h.send('daily-status', { platform: 'tuf' });
  assert.equal(cached.state.done, true); assert.equal(cached.state.cached, true);
  const url = 'https://takeuforward.org/practice/dsa/two-sum';
  assert.equal((await h.send('solved-observed', { entry: { platform: 'tuf', url }, handle: 'sample', generation: 'tuf', evidence: 'accepted' }, { id: 'test-extension', tab: { id: 7 }, url })).ok, false);
  assert.equal((await h.send('import-solved', { records: [{ platform: 'tuf', url }], generations: { tuf: 'tuf' } })).ok, false);
  assert.deepEqual(h.storage[STORAGE_KEY], saved);
});

test('bulk solved imports are account-bound, atomic and leave activity/totals unchanged', async () => {
  const h = await harness(); const state = emptyState();
  state.accounts.leetcode = { handle: 'sample', generation: 'one', snapshot: { totalSolved: 40, recent: [] } };
  h.storage[STORAGE_KEY] = state;
  assert.equal((await h.send('import-solved', { records: [entry], generations: { leetcode: 'old' } })).ok, false);
  assert.equal((await h.send('import-solved', { records: [entry, { ...entry, url: 'https://evil.test/' }], generations: { leetcode: 'one' } })).ok, false);
  assert.equal(h.storage[STORAGE_KEY].accounts.leetcode.snapshot.solved, undefined);
  assert.equal((await h.send('import-solved', { records: [entry], generations: { leetcode: 'one' } })).ok, true);
  const snapshot = h.storage[STORAGE_KEY].accounts.leetcode.snapshot;
  assert.equal(snapshot.totalSolved, 40); assert.equal(snapshot.recent.length, 0);
  assert.equal(snapshot.solved[entry.key].timestamp, undefined);
  assert.equal((await h.send('import-solved', { records: [], generations: {} }, { id: 'test-extension', tab: { id: 1 }, url: entry.url })).ok, false);
});

test('history import checkpoints before errors, resumes and clears completion alarms', async () => {
  let offline = true; const requests = [];
  const h = await harness(async url => {
    requests.push(url);
    if (url.endsWith('page=1') && offline) throw new Error('Offline');
    return response({ max_page: 2, content: '<tr><td title="accepted"><a href="/problems/FLOW001">A</a>01:00 PM 10/10/26</td></tr>' });
  });
  const state = emptyState(); state.accounts.codechef = { handle: 'sample', generation: 'cc', snapshot: { totalSolved: 2, recent: [] } }; h.storage[STORAGE_KEY] = state;
  assert.equal((await h.send('history', { platform: 'codechef', command: 'start' })).ok, true);
  chrome.alarms.onAlarm.listeners[0]({ name: 'crossdsa-history:codechef' });
  await waitForHistory(h, 'codechef', 'error');
  let account = h.storage[STORAGE_KEY].accounts.codechef;
  assert.equal(account.historyImport.cursor.offset, 1);
  assert.equal(account.snapshot.recent.length, 1);
  offline = false;
  await h.send('history', { platform: 'codechef', command: 'resume' });
  chrome.alarms.onAlarm.listeners[0]({ name: 'crossdsa-history:codechef' });
  await waitForHistory(h, 'codechef', 'complete');
  await new Promise(resolve => setTimeout(resolve, 10));
  account = h.storage[STORAGE_KEY].accounts.codechef;
  assert.equal(account.historyImport.cursor.offset, 2);
  assert.equal(account.snapshot.recent.length, 1);
  assert.equal(requests.filter(url => url.endsWith('page=0')).length, 1);
  assert.equal(h.scheduled.has('crossdsa-history:codechef'), false);
});

test('pausing in-flight history prevents its response from changing stored records', async () => {
  let release, started;
  const ready = new Promise(resolve => { started = resolve; });
  const h = await harness(() => { started(); return new Promise(resolve => { release = resolve; }); });
  const state = emptyState(); state.accounts.codeforces = { handle: 'sample', generation: 'cf', snapshot: { totalSolved: 0, recent: [] } }; h.storage[STORAGE_KEY] = state;
  await h.send('history', { platform: 'codeforces', command: 'start' });
  chrome.alarms.onAlarm.listeners[0]({ name: 'crossdsa-history:codeforces' });
  await ready;
  await h.send('history', { platform: 'codeforces', command: 'cancel' });
  release(response({ status: 'OK', result: [{ id: 1, verdict: 'OK', creationTimeSeconds: 1, problem: { contestId: 1, index: 'A', name: 'A' } }] }));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(h.storage[STORAGE_KEY].accounts.codeforces.snapshot.recent.length, 0);
  assert.equal(h.storage[STORAGE_KEY].accounts.codeforces.historyImport.status, 'cancelled');
  assert.equal(h.scheduled.has('crossdsa-history:codeforces'), false);
});

test('page observations are scoped to the account and question and never create activity', async () => {
  const h = await harness(); const state = emptyState();
  state.accounts.codechef = { handle: 'sample', generation: 'one', snapshot: { totalSolved: 40, recent: [] } }; h.storage[STORAGE_KEY] = state;
  const url = 'https://www.codechef.com/problems/TWOSUM';
  const payload = { handle: 'sample', generation: 'one', evidence: 'accepted', entry: { platform: 'codechef', title: 'Two Sum', url } };
  const sender = { id: 'test-extension', tab: { id: 1 }, url };
  for (const invalid of [{ ...payload, evidence: 'submitted' }, { ...payload, handle: 'other' }, { ...payload, generation: 'old' }, { ...payload, entry: { ...payload.entry, url: url + '-different' } }]) assert.equal((await h.send('solved-observed', invalid, sender)).ok, false);
  assert.equal((await h.send('solved-observed', payload, sender)).ok, true);
  const snapshot = h.storage[STORAGE_KEY].accounts.codechef.snapshot;
  assert.equal(snapshot.recent.length, 0); assert.equal(snapshot.totalSolved, 40);
  assert.equal(snapshot.solved['codechef:TWOSUM'].timestamp, undefined);
});


test('Code360 SPA observations validate the current top-level tab URL', async () => {
  const h = await harness(); const state = emptyState();
  state.accounts.code360 = { handle: 'sample', generation: 'one', snapshot: { totalSolved: 1, recent: [] } }; h.storage[STORAGE_KEY] = state;
  const url = 'https://www.naukri.com/code360/problems/two-sum_839653';
  const payload = { handle: 'sample', generation: 'one', evidence: 'accepted', entry: { platform: 'code360', title: 'Two Sum', url } };
  const sender = { id: 'test-extension', frameId: 0, url: 'https://www.naukri.com/code360/home', tab: { id: 1, url } };
  for (const invalid of [{ ...sender, frameId: 1 }, { ...sender, url: 'https://evil.example/code360/home' }, { ...sender, tab: { id: 1, url: url + '-other' } }]) {
    assert.equal((await h.send('solved-observed', payload, invalid)).ok, false);
  }
  assert.equal((await h.send('solved-observed', payload, sender)).ok, true);
  assert.ok(h.storage[STORAGE_KEY].accounts.code360.snapshot.solved['code360:/code360/problems/two-sum_839653']);
});

test('automatic successful refresh resumes failed history at its cursor and preserves paused jobs', async () => {
  const h = await harness(async url => url.includes('/users/') ? { ok: true, text: async () => 'Total Problems Solved: 5' } : response({ max_page: 1, content: '' }));
  const state = emptyState(); state.accounts.codechef = { handle: 'sample', generation: 'cc', historyImport: { id: 'job', status: 'error', cursor: { offset: 40 }, pages: 40, error: 'Offline' }, snapshot: { totalSolved: 5, recent: [] } }; h.storage[STORAGE_KEY] = state;
  await h.send('sync', { platform: 'codechef' });
  let job = h.storage[STORAGE_KEY].accounts.codechef.historyImport;
  assert.equal(job.status, 'running'); assert.equal(job.id, 'job'); assert.equal(job.cursor.offset, 40);
  assert.ok(h.scheduled.has('crossdsa-history:codechef'));
  await h.send('history', { platform: 'codechef', command: 'cancel' });
  await h.send('sync', { platform: 'codechef' });
  job = h.storage[STORAGE_KEY].accounts.codechef.historyImport;
  assert.equal(job.status, 'cancelled'); assert.equal(h.scheduled.has('crossdsa-history:codechef'), false);
});


test('closed LeetCode pauses history without errors and keeps its cursor', async () => {
  const h = await harness(); const state = emptyState(); state.settings.autoSync = false;
  state.accounts.leetcode = { handle: 'sample', generation: 'lc', snapshot: { totalSolved: 3, recent: [] }, historyImport: { id: 'job', status: 'cancelled', cursor: { offset: 40 }, pages: 2 } };
  h.storage[STORAGE_KEY] = state;
  await h.send('history', { platform: 'leetcode', command: 'resume' });
  chrome.alarms.onAlarm.listeners[0]({ name: 'crossdsa-history:leetcode' });
  await waitForHistory(h, 'leetcode', 'waiting-tab');
  await new Promise(resolve => setTimeout(resolve, 10));
  const job = h.storage[STORAGE_KEY].accounts.leetcode.historyImport;
  assert.equal(job.error, null); assert.equal(job.cursor.offset, 40); assert.equal(job.pages, 2);
  assert.equal(h.scheduled.has('crossdsa-history:leetcode'), false);
});

test('waiting history resumes only for a matching LeetCode tab, including with auto sync disabled', async () => {
  for (const username of ['other', 'sample']) {
    const h = await harness(); const state = emptyState(); state.settings.autoSync = false;
    state.accounts.leetcode = { handle: 'sample', generation: 'lc', snapshot: { totalSolved: 3, recent: [] }, historyImport: { id: 'job', status: 'waiting-tab', cursor: { offset: 40 }, pages: 2 } }; h.storage[STORAGE_KEY] = state;
    chrome.tabs.query = async () => [{ id: 7 }];
    chrome.tabs.sendMessage = async () => ({ ok: true, username, submissions: [] });
    chrome.tabs.onUpdated.listeners[0](7, { status: 'complete' }, { url: 'https://leetcode.com/', status: 'complete' });
    if (username === 'sample') await waitForHistory(h, 'leetcode', 'running');
    await new Promise(resolve => setTimeout(resolve, 15));
    const job = h.storage[STORAGE_KEY].accounts.leetcode.historyImport;
    assert.equal(job.status, username === 'sample' ? 'running' : 'waiting-tab');
    assert.equal(job.cursor.offset, 40);
    assert.equal(h.scheduled.has('crossdsa-history:leetcode'), username === 'sample');
  }
});


test('TUF configures background headers and completes API fallback with no website tabs', async () => {
  const changes = [], signals = [];
  const h = await harness(async (url, options) => {
    signals.push(options.signal);
    if (url.startsWith('https://takeuforward.org/')) throw new Error('Public page unavailable');
    return { ok: true, json: async () => url.includes('/heatmap?')
      ? { success: true, data: { selectedPlatform: 'TUF', heatmapData: [] } }
      : { success: true, data: { learningProgress: [{ platform: 'TUF', totalSolved: 122 }] } } };
  });
  chrome.declarativeNetRequest = { updateSessionRules: async change => changes.push(change) };
  chrome.tabs.query = async () => assert.fail('TUF must not query website tabs');
  const state = emptyState(); state.settings.autoSync = false;
  state.accounts.tuf = { handle: 'sample', generation: 'tuf' }; h.storage[STORAGE_KEY] = state;
  await h.service.syncPlatform('tuf');
  const account = h.storage[STORAGE_KEY].accounts.tuf;
  assert.equal(account.status, 'ready');
  assert.equal(account.snapshot.totalSolved, 122);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].addRules[0].action.type, 'modifyHeaders');
  assert.equal(signals.length, 5);
  assert.ok(signals[0] instanceof AbortSignal);
  assert.ok(signals.every(signal => signal === signals[0]), 'Every TUF request shares the sync deadline');
});

test('TUF request failure exits syncing and retains the last snapshot without a tab', async () => {
  const h = await harness();
  chrome.tabs.query = async () => assert.fail('TUF must not query website tabs');
  const state = emptyState(); state.settings.autoSync = false;
  state.accounts.tuf = { handle: 'sample', generation: 'tuf', snapshot: { totalSolved: 122, recent: [] } }; h.storage[STORAGE_KEY] = state;
  await h.service.syncPlatform('tuf');
  const account = h.storage[STORAGE_KEY].accounts.tuf;
  assert.equal(account.status, 'error');
  assert.equal(account.snapshot.totalSolved, 122);
  assert.match(account.error, /profile unavailable/);
});
