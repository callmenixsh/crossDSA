import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../../background.js', import.meta.url), 'utf8');
function settings() {
  let listener;
  const storage = {};
  let write = async value => Object.assign(storage, value);
  const context = vm.createContext({ chrome: {
    runtime: { id: 'test', getURL: path => `chrome-extension://test/${path}`, onMessage: { addListener: fn => { listener = fn; } } },
    storage: { local: { get: async key => ({ [key]: storage[key] }), set: value => write(value) } },
  } });
  vm.runInContext(source.slice(source.indexOf('chrome.runtime.onMessage')), context);
  const ui = { id: 'test', url: 'chrome-extension://test/popup.html' };
  const send = (message, sender = ui) => new Promise(resolve => {
    const result = listener(message, sender, resolve);
    if (result !== true) resolve(undefined);
  });
  return { storage, send, setWriter: fn => { write = fn; } };
}

test('search settings reject unauthorized writes and malformed values', async () => {
  const h = settings();
  for (const value of [null, '', false, '0.5junk', -1, 0, 1.1, Infinity]) {
    assert.equal((await h.send({ action: 'setSimilarityThreshold', value })).success, false);
  }
  for (const platforms of [null, ['unknown'], ['leetcode', 'unknown']]) {
    assert.equal((await h.send({ action: 'setPreferredPlatforms', platforms })).success, false);
  }
  const message = { action: 'setSimilarityThreshold', value: 0.7 };
  for (const sender of [{ id: 'foreign' }, { id: 'test', tab: { id: 1 }, url: 'https://leetcode.com/problems/two-sum/' }]) {
    assert.equal((await h.send(message, sender)).success, false);
  }
  assert.equal(Object.keys(h.storage).length, 0);
});

test('search settings acknowledge writes only after persistence and report storage failures', async () => {
  const h = settings();
  let finish;
  h.setWriter(value => new Promise(resolve => { finish = () => { Object.assign(h.storage, value); resolve(); }; }));
  let acknowledged = false;
  const response = h.send({ action: 'setSimilarityThreshold', value: '0.1' }).then(result => { acknowledged = true; return result; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(acknowledged, false);
  finish();
  assert.equal((await response).success, true);
  assert.equal((await h.send({ action: 'getSimilarityThreshold' })).value, 0.1);
  h.setWriter(async () => { throw new Error('Storage failed'); });
  assert.equal((await h.send({ action: 'setSimilarityThreshold', value: 0.6 })).error, 'Storage failed');
  assert.equal((await h.send({ action: 'getSimilarityThreshold' })).value, 0.1);
});

test('search settings normalize legacy preferences and ignore unrelated messages', async () => {
  const h = settings();
  h.storage['dsa-helper-similarity-threshold'] = 'corrupt';
  h.storage['dsa-preferred-platforms'] = ['leetcode', 'unknown', 'leetcode'];
  assert.equal((await h.send({ action: 'getSimilarityThreshold' })).value, 0.4);
  assert.deepEqual(Array.from((await h.send({ action: 'getPreferredPlatforms' })).platforms), ['leetcode']);
  assert.equal(await h.send(null), undefined);
  assert.equal(await h.send({ action: 'tracker:get' }), undefined);
});

test('an empty search selection persists without restoring default platforms', async () => {
  const h = settings();
  assert.equal((await h.send({ action: 'setPreferredPlatforms', platforms: [] })).success, true);
  assert.deepEqual(Array.from((await h.send({ action: 'getPreferredPlatforms' })).platforms), []);
});
