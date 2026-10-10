import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../tracker/solved-browser.js', import.meta.url), 'utf8');
function harness({ handles = ['sample'], text = 'Accepted', visible = true, table = false, swapAccount = false, platform = 'codechef', code360Menu = false, code360Result = false } = {}) {
  let scan, reads = 0;
  const messages = [], listeners = {};
  const context = vm.createContext({
    URL, location: platform === 'code360' ? { hostname: 'www.naukri.com', origin: 'https://www.naukri.com', href: 'https://www.naukri.com/code360/problems/two-sum_839653' } : { hostname: 'www.codechef.com', origin: 'https://www.codechef.com', href: 'https://www.codechef.com/problems/TWOSUM' },
    document: {
      documentElement: {}, title: 'Two Sum', addEventListener() {}, querySelector: () => ({ textContent: 'Two Sum' }),
      querySelectorAll: selector => {
        if (selector.startsWith('header')) {
          if (platform === 'code360' && (!code360Menu || !selector.includes('codingninjas-codestudio-navbar a[href]'))) return [];
          return handles.map(h => ({ href: platform === 'code360' ? `https://www.naukri.com/code360/profile/${h}` : `https://www.codechef.com/users/${h}` }));
        }
        if (platform === 'code360' && (!code360Result || selector !== 'ninjas-problems-ui-code-current-submission .status-header')) return [];
        return [{ textContent: text, getAttribute: () => null, getClientRects: () => visible ? [{}] : [], closest: selector => selector === 'table' && table ? {} : null }];
      },
    },
    chrome: { runtime: { id: 'test', sendMessage: async message => { messages.push(message); return { ok: true }; } }, storage: { local: { get: async () => { reads++; return { 'crossdsa-tracker-v1': { accounts: { [platform]: { handle: 'sample', generation: swapAccount && reads > 1 ? 'changed' : 'one' } } } }; } }, onChanged: { addListener() {} } } },
    MutationObserver: class { observe() {} }, addEventListener: (name, fn) => { listeners[name] = fn; }, postMessage() {}, clearTimeout() {}, setTimeout: fn => { scan = fn; },
  });
  vm.runInContext('window = globalThis', context);
  vm.runInContext(source, context);
  return { messages, scan: () => scan(), identity: handles => {
    context.sessionEventHandles = handles;
    context.identityListener = listeners.message;
    vm.runInContext("identityListener({source:window,origin:location.origin,data:{source:'crossdsa:code360-session',handles:sessionEventHandles}})", context);
  } };
}

test('page scanning requires a single matching navigation identity and explicit acceptance', async () => {
  const h = harness(); await h.scan(); await h.scan();
  assert.equal(h.messages.filter(m => m.action === 'tracker:page').length, 1);
  assert.equal(h.messages.filter(m => m.action === 'tracker:solved-observed').length, 1);
  assert.equal(h.messages.at(-1).evidence, 'accepted');
  assert.equal(h.messages.at(-1).entry.title, 'Two Sum');
  assert.equal(h.messages.at(-1).submission, undefined);
});

test('unknown, ambiguous, hidden, failed and historical table verdicts do not mark Done', async () => {
  for (const options of [{ handles: [] }, { handles: ['other'] }, { handles: ['sample', 'other'] }, { text: 'Wrong Answer' }, { text: 'Submit' }, { text: 'This problem was accepted by someone else.' }, { visible: false }, { table: true }, { swapAccount: true }]) {
    const h = harness(options); await h.scan();
    assert.equal(h.messages.some(m => m.action === 'tracker:solved-observed'), false, JSON.stringify(options));
  }
});

test('Code360 reads its Angular navigation and current submission verdict', async () => {
  for (const text of ['Correct Answer', 'Passed']) {
    const h = harness({ platform: 'code360', code360Menu: true, code360Result: true, text });
    await h.scan(); await h.scan();
    const observations = h.messages.filter(m => m.action === 'tracker:solved-observed');
    assert.equal(observations.length, 1);
    assert.equal(observations[0].entry.platform, 'code360');
    assert.equal(observations[0].evidence, 'accepted');
    assert.equal(observations[0].submission, undefined);
  }
});

test('Code360 ignores sample results, failed submissions and missing or changed accounts', async () => {
  for (const options of [{ code360Result: false }, { code360Menu: false }, { text: 'Wrong Answer' }, { text: 'Partial Success' }, { text: 'Submitted' }, { handles: ['other'] }, { handles: ['sample', 'other'] }, { visible: false }, { swapAccount: true }]) {
    const h = harness({ platform: 'code360', code360Menu: true, code360Result: true, text: 'Correct Answer', ...options });
    await h.scan();
    assert.equal(h.messages.some(m => m.action === 'tracker:solved-observed'), false, JSON.stringify(options));
  }
});

test('Code360 detects acceptance with a closed profile menu using authenticated identity aliases', async () => {
  const h = harness({ platform: 'code360', code360Result: true, code360Menu: false });
  h.identity(['some-uuid', 'sample']);
  await h.scan();
  assert.equal(h.messages.filter(m => m.action === 'tracker:solved-observed').length, 1);
});

test('Code360 logout or wrong API identity overrides a stale matching menu', async () => {
  for (const handles of [[], ['another-user']]) {
    const h = harness({ platform: 'code360', code360Result: true, code360Menu: true });
    h.identity(handles); await h.scan();
    assert.equal(h.messages.some(m => m.action === 'tracker:solved-observed'), false);
  }
});
