import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../tracker/code360-session.js', import.meta.url), 'utf8');
const origin = 'https://www.naukri.com';
const auth = `${origin}/code360/api/v2/users/auth_details`;
function harness() {
  const messages = [], reads = [], pending = [];
  const context = vm.createContext({ URL, location: { origin, href: `${origin}/code360/problems/two-sum_839653` },
    postMessage: message => messages.push(JSON.parse(JSON.stringify(message))), addEventListener() {},
    fetch: (...args) => new Promise(resolve => pending.push({ args, resolve })),
    XMLHttpRequest: class {
      open(...args) { this.openArgs = args; }
      send(...args) { this.sendArgs = args; return 'unchanged'; }
      addEventListener(name, fn) { this[name] = fn; }
    },
  });
  vm.runInContext('window = globalThis', context);
  vm.runInContext(source, context);
  const respond = async (index, data, ok = true) => {
    const response = { ok, clone: () => ({ json: async () => { reads.push(index); return data; } }) };
    pending[index].resolve(response);
    await new Promise(resolve => setImmediate(resolve));
    return response;
  };
  return { context, messages, reads, pending, respond };
}

test('Code360 observes account aliases without changing fetch results or exporting private fields', async () => {
  const h = harness();
  const promise = h.context.fetch(auth, { credentials: 'same-origin' });
  const response = await h.respond(0, { data: { uuid: 'UUID-1', screen_name: 'Sample', email: 'private', user_access_token: 'private', id: 42 } });
  assert.equal(await promise, response);
  assert.deepEqual(h.messages.at(-1), { source: 'crossdsa:code360-session', handles: ['uuid-1', 'sample'] });
  assert.equal(JSON.stringify(h.messages).includes('private'), false);
});

test('Code360 observes Angular XHR auth responses and leaves unrelated requests unread', () => {
  const h = harness(), request = new h.context.XMLHttpRequest();
  request.open('GET', auth, true); assert.equal(request.send(), 'unchanged');
  request.status = 200; request.responseType = 'json'; request.response = { data: { uuid: 'id', screen_name: 'sample' } }; request.load();
  assert.deepEqual(h.messages.at(-1).handles, ['id', 'sample']);
  const other = new h.context.XMLHttpRequest(); other.open('GET', `${origin}/code360/api/v3/public_section/profile/user_details?uuid=other`); other.send();
  assert.equal(other.load, undefined, 'Another user public profile must not identify the signed-in user');
});

test('Code360 ignores stale auth responses after logout and never inspects other origins', async () => {
  const h = harness();
  h.context.fetch(auth);
  h.context.fetch(`${origin}/code360/api/v2/users/logout`, { method: 'POST' });
  await h.respond(0, { data: { uuid: 'old' } });
  assert.deepEqual(h.messages.at(-1).handles, []);
  h.context.fetch('https://example.org/api/v2/users/auth_details');
  await h.respond(2, { data: { uuid: 'other' } });
  assert.deepEqual(h.reads, [0]);
  assert.deepEqual(h.messages.at(-1).handles, []);
});

test('Code360 clears identity for failed and malformed authentication responses', async () => {
  const h = harness();
  h.context.fetch(auth); await h.respond(0, { data: { uuid: 'sample' } });
  h.context.fetch(auth); await h.respond(1, {}, false);
  assert.deepEqual(h.messages.at(-1).handles, []);
  h.context.fetch(auth); await h.respond(2, { data: { uuid: '../invalid', screen_name: 42 } });
  assert.deepEqual(h.messages.at(-1).handles, []);
});
