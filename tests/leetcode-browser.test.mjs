import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../tracker/leetcode-browser.js', import.meta.url), 'utf8');

async function observe({ label = 'Submit', username = 'sample', status = 'Accepted', slug = 'two-sum', old = false } = {}) {
  let click; const messages = [], requests = [];
  const context = vm.createContext({
    Date, AbortSignal, setTimeout: fn => { fn(); }, location: { pathname: '/problems/two-sum/' },
    document: { addEventListener: (_name, fn) => { click = fn; } },
    chrome: { storage: { local: { get: async () => ({ 'crossdsa-tracker-v1': { accounts: { leetcode: { handle: 'sample', generation: 'test', snapshot: { recent: [] } } } } }) } }, runtime: { sendMessage: async message => { messages.push(message); } } },
    fetch: async path => {
      requests.push(path);
      return { ok: true, json: async () => path.startsWith('/graphql') ? { data: { userStatus: { isSignedIn: true, username } } } : { submissions_dump: [{ id: 123, title: 'Two Sum', title_slug: slug, timestamp: Math.floor(Date.now() / 1000) - (old ? 60 : 0), status_display: status, code: 'private' }] } };
    },
  });
  vm.runInContext(source, context);
  click({ target: { closest: () => ({ textContent: label, getAttribute: () => '', closest: () => null }) } });
  await new Promise(resolve => setImmediate(resolve));
  return { messages, requests };
}

test('browser watcher emits accepted metadata only after a successful submit', async () => {
  const { messages } = await observe();
  assert.equal(messages.length, 1);
  assert.equal(messages[0].action, 'tracker:accepted');
  assert.equal(messages[0].submission.id, '123');
  assert.equal('code' in messages[0].submission, false);
});

test('browser watcher ignores sample runs, wrong accounts, failures, old results and other questions', async () => {
  for (const options of [{ label: 'Run' }, { username: 'other' }, { status: 'Wrong Answer' }, { old: true }, { slug: 'three-sum' }]) {
    assert.equal((await observe(options)).messages.length, 0);
  }
});
