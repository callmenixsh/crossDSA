// Disposable extension browser only. Code360 documents and auth responses are
// synthetic; no real account, credentials or submission requests are used.
import assert from 'node:assert/strict';
const root = process.env.CROSSDSA_CDP || 'http://127.0.0.1:9333';
class CDP {
  constructor(url) {
    this.id = 0; this.pending = new Map(); this.handlers = new Map(); this.socket = new WebSocket(url);
    this.ready = new Promise(resolve => this.socket.addEventListener('open', resolve, { once: true }));
    this.socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) { const task = this.pending.get(message.id); this.pending.delete(message.id); message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result); }
      else this.handlers.get(message.method)?.(message.params);
    });
  }
  async send(method, params = {}) {
    await this.ready; const id = ++this.id;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.socket.send(JSON.stringify({ id, method, params })); });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  close() { this.socket.close(); }
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let worker, page;
try {
  const targets = await (await fetch(`${root}/json/list`)).json();
  for (const target of targets.filter(t => t.type === 'service_worker' && t.url.endsWith('/background.js'))) {
    const candidate = new CDP(target.webSocketDebuggerUrl);
    if (await candidate.evaluate('chrome.runtime.getManifest().name') === 'crossDSA') { worker = candidate; break; }
    candidate.close();
  }
  assert.ok(worker, 'Load crossDSA in a disposable extension browser first');
  const tab = await (await fetch(`${root}/json/new?about:blank`, { method: 'PUT' })).json();
  page = new CDP(tab.webSocketDebuggerUrl);
  let identity = 'sample', result = 'Accepted', component = 'ninjas-problems-ui-code-current-submission', spa = false;
  const fixtureErrors = [];
  page.handlers.set('Fetch.requestPaused', params => {
    const isAuth = params.request.url.includes('/api/v2/users/auth_details');
    const body = isAuth ? JSON.stringify({ data: { uuid: 'test-uuid', screen_name: identity } }) : `<!doctype html><html><head><title>Two Sum</title></head><body><h1>Two Sum</h1><script>
      fetch('/code360/api/v2/users/auth_details').then(r=>r.json()).then(()=>{
        if (${spa}) history.pushState({},'', '/code360/problems/two-sum_839653');
        const node=document.createElement('${component}');node.innerHTML='<div class="status-header">${result}</div>';document.body.append(node);
      });
    </script></body></html>`;
    page.send('Fetch.fulfillRequest', { requestId: params.requestId, responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: isAuth ? 'application/json' : 'text/html' }], body: Buffer.from(body).toString('base64') }).catch(error => fixtureErrors.push(error.message));
  });
  await page.send('Fetch.enable', { patterns: [{ urlPattern: 'https://www.naukri.com/code360/*' }] });
  const solved = () => worker.evaluate("(async()=>{const s=(await chrome.storage.local.get('crossdsa-tracker-v1'))['crossdsa-tracker-v1'];return !!s.accounts.code360.snapshot.solved?.['code360:/code360/problems/two-sum_839653']})()");
  for (const scenario of [
    { identity: 'sample', result: 'Accepted', expected: true },
    { identity: 'sample', result: 'Accepted', spa: true, expected: true },
    { identity: 'other', result: 'Accepted', expected: false },
    { identity: 'sample', result: 'Wrong Answer', expected: false },
    { identity: 'sample', result: 'Correct Answer', component: 'ninjas-problems-ui-test-case', expected: false },
  ]) {
    identity = scenario.identity; result = scenario.result; component = scenario.component || 'ninjas-problems-ui-code-current-submission'; spa = Boolean(scenario.spa);
    await worker.evaluate(`(async()=>{
      const s={version:1,accounts:{},workspace:{},lists:{saved:{id:'saved',name:'Starred'}},settings:{autoSync:false,timeZone:'UTC',dailyGoal:2}};
      s.accounts.code360={handle:'sample',generation:'fixture',snapshot:{recent:[],solved:{},totalSolved:0}};
      await chrome.storage.local.set({'crossdsa-tracker-v1':s});
    })()`);
    await page.send('Page.navigate', { url: spa ? 'https://www.naukri.com/code360/home' : 'https://www.naukri.com/code360/problems/two-sum_839653' });
    await wait(1800);
    assert.equal(await solved(), scenario.expected, JSON.stringify(scenario));
  }
  assert.deepEqual(fixtureErrors, []);
  console.log('PASS: Code360 MAIN-world auth capture and isolated acceptance watcher work with the menu closed; wrong users, failures and sample runs are rejected. Synthetic site responses.');
} finally { worker?.close(); page?.close(); }
