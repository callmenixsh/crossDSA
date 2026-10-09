import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../tracker/leetcode-session.js', import.meta.url), 'utf8');
function harness(username, pages = []) {
  let listener, listeners = 0; const requested = [];
  const context = vm.createContext({
    chrome: { runtime: { id: 'test', getURL: path => `chrome-extension://test/${path}`, onMessage: { addListener: fn => { listener = fn; listeners++; } } } },
    AbortSignal, Date,
    fetch: async (path, options) => { requested.push(path); assert.equal(options.credentials, 'same-origin'); return { ok: true, json: async () => path.startsWith('/graphql') ? { data: { userStatus: { isSignedIn: Boolean(username), username } } } : pages.shift() }; },
  });
  vm.runInContext(source, context);
  const send = (handle = 'sample', sender = { id: 'test', url: 'chrome-extension://test/background.js' }) => new Promise(resolve => {
    if (listener({ action: 'leetcode:recent', handle }, sender, value => resolve(JSON.parse(JSON.stringify(value)))) !== true) resolve(undefined);
  });
  return { requested, send, reinject() { vm.runInContext(source, context); }, listenerCount() { return listeners; } };
}

test('reattaching the LeetCode helper does not register duplicate listeners', () => {
  const h = harness('sample'); h.reinject(); h.reinject();
  assert.equal(h.listenerCount(), 1);
});

test('LeetCode session verifies the signed-in username before reading submissions', async () => {
  for (const username of [null, 'someone-else']) {
    const h = harness(username); const result = await h.send();
    assert.equal(result.ok, false); assert.equal(h.requested.length, 1);
  }
});

test('LeetCode session returns accepted metadata only and handles pagination', async () => {
  const row = { id: 1, title: 'Two Sum', title_slug: 'two-sum', timestamp: Math.floor(Date.now() / 1000), status_display: 'Accepted', code: 'private solution' };
  const h = harness('Sample', [
    { has_next: true, submissions_dump: [row, { ...row, id: 2, status_display: 'Wrong Answer' }] },
    { has_next: false, submissions_dump: [{ ...row, id: 3 }] },
  ]);
  const result = await h.send();
  assert.equal(result.ok, true); assert.deepEqual(result.submissions.map(row => row.id), [1, 3]);
  assert.equal('code' in result.submissions[0], false); assert.equal(h.requested.length, 3);
});

test('LeetCode session rejects website senders', async () => {
  const h = harness('sample');
  assert.equal(await h.send('sample', { id: 'test', tab: { id: 1 }, url: 'https://leetcode.com/' }), undefined);
  assert.equal(h.requested.length, 0);
});
