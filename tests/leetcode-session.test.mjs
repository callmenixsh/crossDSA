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
  const send = (handle = 'sample', sender = { id: 'test', url: 'chrome-extension://test/background.js' }, extra = {}) => new Promise(resolve => {
    if (listener({ action: 'leetcode:recent', handle, ...extra }, sender, value => resolve(JSON.parse(JSON.stringify(value)))) !== true) resolve(undefined);
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


test('LeetCode bulk history returns one checkpoint without applying the recent-date cutoff', async () => {
  const row = { id: 123, title: 'Two Sum', title_slug: 'two-sum', timestamp: 1000, status_display: 'Accepted', code: 'private' };
  const h = harness('sample', [{ has_next: true, submissions_dump: [row, { ...row, id: 124, status_display: 'Wrong Answer' }] }]);
  const result = await h.send('sample', undefined, { action: 'leetcode:history', offset: 40 });
  assert.equal(result.ok, true); assert.equal(result.hasNext, true); assert.equal(result.count, 2);
  assert.deepEqual(result.submissions.map(s => s.id), [123]);
  assert.equal(result.submissions[0].code, undefined);
  assert.ok(h.requested.some(path => path.includes('offset=40')));
  assert.equal(h.requested.filter(path => path.startsWith('/graphql')).length, 2, 'Identity is checked before and after history reads');
});

test('LeetCode per-problem scan rejects wrong question records and invalid input', async () => {
  const h = harness('sample', [{ has_next: false, submissions_dump: [{ id: 1, title_slug: 'two-sum', status_display: 'Accepted' }, { id: 2, title_slug: 'different', status_display: 'Accepted' }] }]);
  const result = await h.send('sample', undefined, { action: 'leetcode:problem', slug: 'two-sum' });
  assert.equal(result.ok, true); assert.deepEqual(result.submissions.map(s => s.id), [1]);
  assert.ok(h.requested.some(path => path.startsWith('/api/submissions/two-sum/')));
  const invalid = harness('sample');
  assert.equal((await invalid.send('sample', undefined, { action: 'leetcode:problem', slug: '../private' })).ok, false);
  assert.equal(invalid.requested.length, 1);
});
