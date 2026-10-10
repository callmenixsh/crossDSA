import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../../tracker/platforms/tuf-session.js', import.meta.url), 'utf8');
const auth = { success: true, data: { logged_in: true, username: 'Sample', email: 'private', session: 'secret' } };
const potd = status => ({ success: true, data: { day_id: 20261010, tracks: [{ track_slug: 'dsa', day_id: 20261010, problem: { type: 'dsa', slug: 'depth-of-bst-given-insertion-order' }, user_status: status }] } });
function harness(responses) {
  let listener;
  const requests = [];
  const context = vm.createContext({ AbortSignal,
    chrome: { runtime: { id: 'extension', getURL: path => `chrome-extension://extension/${path}`, onMessage: { addListener(fn) { listener = fn; } } } },
    fetch: async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => responses.shift() }; },
  });
  vm.runInContext(source, context);
  return { requests, send: (message = {}, sender = { id: 'extension', url: 'chrome-extension://extension/popup.html' }) => new Promise(resolve => {
    if (listener({ action: 'tuf:daily', handle: 'sample', day: '2026-10-10', ...message }, sender, resolve) !== true) resolve(undefined);
  }) };
}
test('TUF POTD checks account and provider day and returns only completion metadata', async () => {
  for (const status of ['solved', 'attempted', 'not_started']) {
    const h = harness([auth, potd(status), auth]);
    const result = await h.send();
    assert.equal(result.ok, true); assert.equal(result.done, status === 'solved');
    assert.equal(result.day, '2026-10-10'); assert.deepEqual([...result.handles], ['sample']);
    assert.equal(h.requests.length, 3);
    assert.equal(h.requests[1].url, 'https://backend-go.takeuforward.org/api/v1/potd/today?track=dsa');
    assert.ok(h.requests.every(r => r.options.credentials === 'include'));
    assert.equal(JSON.stringify(result).includes('private'), false);
    assert.equal(JSON.stringify(result).includes('secret'), false);
  }
});
test('TUF ignores old POTDs, SQL solves, unknown status and changed accounts', async () => {
  const old = potd('solved'); old.data.day_id = 20261009;
  const sql = potd('solved'); sql.data.tracks[0].track_slug = 'sql';
  const oldTrack = potd('solved'); oldTrack.data.tracks[0].day_id = 20261009;
  for (const payload of [old, sql, oldTrack, potd('future'), { success: false, data: null }]) {
    assert.equal((await harness([auth, payload, auth]).send()).ok, false);
  }
  const other = { success: true, data: { logged_in: true, username: 'other' } };
  assert.equal((await harness([auth, potd('solved'), other]).send()).ok, false);
  const loggedOut = harness([{ success: true, data: { logged_in: false } }]);
  assert.equal((await loggedOut.send()).ok, false); assert.equal(loggedOut.requests.length, 1);
});
test('TUF daily reader rejects website senders and invalid dates', async () => {
  const h = harness([]);
  assert.equal(await h.send({}, { id: 'extension', tab: { id: 1 }, url: 'https://takeuforward.org/' }), undefined);
  assert.equal(await h.send({}, { id: 'other', url: 'chrome-extension://extension/popup.html' }), undefined);
  assert.equal((await h.send({ day: 'today' })).ok, false);
  assert.equal(h.requests.length, 0);
});
