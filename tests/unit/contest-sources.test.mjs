import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCodechefContests, normalizeAtcoderContests, normalizeGfgContests, normalizeCode360Contests, CONTEST_KEY, CONTEST_SOURCES, safeContestUrl, reminderPlan } from '../../tracker/contests/contests.mjs';
import { emptyState, STORAGE_KEY } from '../../tracker/core.mjs';

const start = Date.now() + 2 * 86400000;
const cc = { status: 'success', present_contests: [], future_contests: [{ contest_code: 'START260', contest_name: 'Starters 260', contest_start_date_iso: new Date(start).toISOString(), contest_end_date_iso: new Date(start + 7200000).toISOString() }] };
const ac = '<div id="contest-table-upcoming"><table><tr><td><time class="fixtime">2026-10-10 21:00:00+0900</time></td><td><a href="/contests/arc232">ARC &amp; Friends</a></td><td class="text-center">02:30</td></tr></table></div>';
const gfg = { next_upcoming: false, results: { upcoming: [{ type: 3, slug: 'weekly-100', name: 'Weekly 100', start_time: '2026-10-11T19:00:00', end_time: '2026-10-11T21:00:00' }], past: [] } };
const cnEvent = { event_category: 'CONTEST', slug: 'weekly-contest-252', name: 'Weekly Contest 252', event_start_time: start / 1000, event_end_time: start / 1000 + 7200 };
const cn = { data: { events: [cnEvent], current_page: 1, total_pages: 2 } };

test('official schedules normalize times, durations, titles and safe platform URLs', () => {
  const [chef] = normalizeCodechefContests(cc), [atcoder] = normalizeAtcoderContests(ac), [geeks] = normalizeGfgContests(gfg), [ninjas] = normalizeCode360Contests(cn);
  assert.equal(chef.start, start);
  assert.equal(atcoder.start, Date.parse('2026-10-10T12:00:00Z'));
  assert.equal(atcoder.end - atcoder.start, 150 * 60000);
  assert.equal(atcoder.title, 'ARC & Friends');
  assert.equal(geeks.start, Date.parse('2026-10-11T13:30:00Z'));
  assert.equal(ninjas.start, start);
  for (const item of [chef, atcoder, geeks, ninjas]) {
    assert.equal(safeContestUrl(item), true);
    assert.equal(safeContestUrl({ ...item, url: item.url + '/../../evil' }), false);
    assert.equal(safeContestUrl({ ...item, platform: 'tuf' }), false);
  }
  assert.equal(normalizeCodechefContests({ ...cc, future_contests: [...cc.future_contests, ...cc.future_contests] }).length, 1);
  assert.equal(normalizeGfgContests({ results: { upcoming: [{ ...gfg.results.upcoming[0], type: 1 }], past: [] } }).length, 0, 'Webinars are excluded');
  assert.equal(normalizeCode360Contests({ data: { events: [{ ...cnEvent, event_category: 'WEBINAR' }] } }).length, 0);
  assert.throws(() => normalizeCodechefContests({ ...cc, future_contests: [{ ...cc.future_contests[0], contest_code: '../../unsafe' }] }));
  for (const parse of [normalizeCodechefContests, normalizeAtcoderContests, normalizeGfgContests, normalizeCode360Contests]) assert.throws(() => parse({ error: 'unavailable' }));
});

test('new sources fetch independently, paginate upcoming schedules, cache failures and stop after disconnect', async () => {
  const state = emptyState(); state.accounts = Object.fromEntries(['codechef', 'atcoder', 'geeksforgeeks', 'code360'].map(id => [id, {}]));
  const storage = { [STORAGE_KEY]: state }, alarms = new Map(), requests = [];
  globalThis.chrome = {
    storage: { local: { get: async key => ({ [key]: structuredClone(storage[key]) }), set: async data => Object.assign(storage, structuredClone(data)) } },
    permissions: { contains: async () => true },
    alarms: { get: async key => alarms.get(key), getAll: async () => [...alarms].map(([name, data]) => ({ name, ...data })), create: async (key, data) => alarms.set(key, data), clear: async key => alarms.delete(key) },
  };
  let offline = false;
  globalThis.fetch = async url => {
    requests.push(url);
    if (offline && url.includes('codechef')) throw new Error('Offline');
    if (url.includes('atcoder')) return { ok: true, text: async () => ac };
    if (url.includes('codechef')) return { ok: true, json: async () => cc };
    if (url.includes('geeksforgeeks')) return { ok: true, json: async () => ({ ...gfg, next_upcoming: url.includes('page_number=1') }) };
    return { ok: true, json: async () => url.includes('page=1') ? cn : { data: { events: [{ ...cnEvent, slug: 'older', event_start_time: (start - 5 * 86400000) / 1000, event_end_time: (start - 5 * 86400000) / 1000 + 7200 }], current_page: 2, total_pages: 2 } } };
  };
  const service = await import(`../../tracker/contests/contest-service.mjs?expanded=${crypto.randomUUID()}`);
  await service.refreshContests();
  const cache = storage[CONTEST_KEY];
  for (const platform of Object.keys(state.accounts)) {
    assert.ok(cache.sources[platform].updatedAt, platform);
    assert.ok(cache.items.some(item => item.platform === platform), platform);
  }
  assert.equal(requests.length, 6);
  assert.equal(requests.some(url => url.includes('leetcode') || url.includes('codeforces')), false);
  assert.equal(reminderPlan(cache).filter(item => item.contest.platform === 'codechef').length, 2);
  offline = true;
  storage[CONTEST_KEY].sources.codechef.attemptedAt -= 31 * 60000;
  await service.refreshContests();
  assert.ok(storage[CONTEST_KEY].sources.codechef.error);
  assert.ok(storage[CONTEST_KEY].items.some(item => item.platform === 'codechef'));
  assert.equal(reminderPlan(storage[CONTEST_KEY]).some(item => item.contest.platform === 'codechef'), false);
  state.accounts = {};
  const count = requests.length;
  await service.refreshContests();
  assert.equal(requests.length, count);
  assert.deepEqual(storage[CONTEST_KEY].items, []);
  assert.equal(Object.keys(CONTEST_SOURCES).length, 6);
});
