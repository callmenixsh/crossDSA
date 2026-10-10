import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { parseCode360History } from '../../tracker/platforms/code360-history-parser.mjs';
import { historyPage } from '../../tracker/imports/history-import.mjs';
import { mergeSnapshot, dailyActivity, acceptedToday } from '../../tracker/core.mjs';

const row = { title: 'Two Sum', link: '/code360/problems/two-sum_123', solvedAt: '2026-01-01T12:00:00Z' };
const data = { handles: ['uuid', 'sample'], page: 1, totalPages: 2, rows: [row] };
test('Code360 pages retain solved identities, exact dates and resumable pagination', async () => {
  const page = await historyPage('code360', 'sample', {}, { code360Session: async (handle, page) => {
    assert.equal(handle, 'sample'); assert.equal(page, 1); return data;
  } });
  assert.equal(page.cursor.page, 2);
  assert.equal(page.complete, false);
  const undated = parseCode360History({ ...data, page: 2, rows: [{ ...row, link: '/code360/problems/other_2', solvedAt: '2 hours ago' }] }, 'sample', page.cursor);
  assert.equal(undated.complete, true);
  assert.equal(undated.recent.length, 0);
  let snapshot = mergeSnapshot(null, { totalSolved: 9, ...page });
  snapshot = mergeSnapshot(snapshot, { totalSolved: 9, ...undated });
  snapshot = mergeSnapshot(snapshot, { totalSolved: 9, ...page });
  assert.equal(Object.keys(snapshot.solved).length, 2);
  assert.equal(snapshot.recent.length, 1);
  assert.equal(snapshot.totalSolved, 9);
  assert.deepEqual(dailyActivity({ code360: { snapshot } }, 'UTC'), { '2026-01-01': 1 });
  assert.equal(acceptedToday({ code360: { snapshot } }, '2026-01-01', 'UTC'), 1);
});
test('Code360 skips unavailable, MCQ, non-problem and unsafe links without matching titles', () => {
  const invalid = [null, 'https://evil.test/code360/problems/a', '/code360/profile/sample', '/code360/mcq/a', 'https://user:secret@www.naukri.com/code360/problems/a', 'https://www.naukri.com:444/code360/problems/a'];
  const parsed = parseCode360History({ ...data, rows: [row, { ...row, title: 'Two Sum', link: 'https://www.codingninjas.com/studio/problems/2-sum_456' }, ...invalid.map(link => ({ ...row, link }))] }, 'sample');
  assert.equal(Object.keys(parsed.solved).length, 2);
  assert.equal(parsed.skipped, invalid.length);
});
test('Code360 rejects mismatched identity, malformed and stalled pagination', () => {
  for (const bad of [{ ...data, handles: ['other'] }, { ...data, page: 2 }, { ...data, totalPages: '2' }, { ...data, rows: [] }]) assert.throws(() => parseCode360History(bad, 'sample'));
  const first = parseCode360History(data, 'sample');
  assert.throws(() => parseCode360History({ ...data, page: 2 }, 'sample', first.cursor), /same history page/);
  assert.equal(parseCode360History({ ...data, rows: [], totalPages: 0 }, 'sample').complete, true);
  for (const solvedAt of ['2026-01-01T12:00:00', '2026-01-01', null, 'invalid']) assert.equal(parseCode360History({ ...data, rows: [{ ...row, solvedAt }] }, 'sample').recent.length, 0);
});

const source = await readFile(new URL('../../tracker/platforms/code360-history-bridge.js', import.meta.url), 'utf8');
function harness(responses) {
  let listener;
  const requests = [];
  const context = vm.createContext({ AbortSignal,
    chrome: { runtime: { id: 'extension', getURL: path => `chrome-extension://extension/${path}`, onMessage: { addListener(fn) { listener = fn; } } } },
    fetch: async (url, options) => {
      requests.push({ url, options });
      const response = responses.shift();
      return { ok: true, json: async () => response };
    },
  });
  vm.runInContext(source, context);
  const sender = { id: 'extension', url: 'chrome-extension://extension/dashboard.html' };
  return { requests, send: (message = {}, from = sender) => new Promise(resolve => {
    if (listener({ action: 'code360:history', handle: 'sample', page: 1, ...message }, from, resolve) !== true) resolve(undefined);
  }) };
}
const auth = { data: { uuid: 'uuid', screen_name: 'sample', email: 'private', user_access_token: 'secret' } };
test('Code360 session uses fixed authenticated reads and exports metadata only', async () => {
  const h = harness([auth, { data: { total_pages: 1, problem_submissions: [{ link: row.link, problem_name: row.title, solved_at: row.solvedAt, code: 'private' }] } }, auth]);
  const result = await h.send();
  assert.equal(result.ok, true);
  assert.equal(h.requests.length, 3);
  assert.match(h.requests[1].url, /view_solved_problems\?page=1&naukri_request=true$/);
  assert.ok(h.requests.every(r => r.options.credentials === 'same-origin'));
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.equal(result.rows[0].solvedAt, row.solvedAt);
});
test('Code360 session rejects account changes, failed login, invalid page and untrusted senders', async () => {
  const h = harness([auth, { data: { total_pages: 1, problem_submissions: [] } }, { data: { uuid: 'changed', screen_name: 'sample' } }]);
  assert.match((await h.send()).error, /account changed/);
  const missing = harness([{ data: {} }]);
  assert.equal((await missing.send()).ok, false);
  assert.equal(missing.requests.length, 1);
  const invalid = harness([]);
  assert.equal((await invalid.send({ page: -1 })).ok, false);
  assert.equal(await invalid.send({}, { id: 'other', url: 'chrome-extension://extension/dashboard.html' }), undefined);
  assert.equal(await invalid.send({}, { id: 'extension', tab: { id: 1 }, url: 'https://www.naukri.com/' }), undefined);
  assert.equal(invalid.requests.length, 0);
});

test('Code360 daily completion is automatic for current coding challenges and excludes MCQs and partial attempts', async () => {
  const coding = { problem: { max_score: 80, user_score: 20 }, evaluated: false, is_current: true, attempt: 1 };
  for (const [item, expected] of [[coding, false], [{ ...coding, evaluated: true }, true], [{ ...coding, problem: { max_score: 80, user_score: 80 } }, true], [{ ...coding, evaluated: true, is_current: false }, false]]) {
    const h = harness([auth, { data: { details: { EASY: item, MODERATE: coding, MCQ: { ...coding, evaluated: true } } } }, auth]);
    const result = await h.send({ action: 'code360:daily', day: '2026-10-10' });
    assert.equal(result.ok, true);
    assert.equal(result.done, expected);
    assert.equal(result.day, '2026-10-10');
    assert.match(h.requests[1].url, /potd\/problem_list\?date=2026-10-10&naukri_request=true$/);
    assert.equal(JSON.stringify(result).includes('private'), false);
  }
  const h = harness([auth, { data: { details: { MCQ: { ...coding, evaluated: true } } } }, auth]);
  assert.equal((await h.send({ action: 'code360:daily', day: '2026-10-10' })).ok, false);
});
