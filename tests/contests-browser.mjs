// Run against a separate Edge/Chrome test profile with remote debugging on 9333.
// Never point this script at your everyday browser profile: it seeds test storage.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.env.CROSSDSA_CDP || 'http://127.0.0.1:9335';
class CDP {
  constructor(url) {
    this.id = 0; this.pending = new Map(); this.events = [];
    this.socket = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => { this.socket.addEventListener('open', resolve); this.socket.addEventListener('error', reject); });
    this.socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) {
        const task = this.pending.get(message.id); if (!task) return;
        clearTimeout(task.timeout); this.pending.delete(message.id);
        if (message.error) task.reject(new Error(message.error.message)); else task.resolve(message.result);
      } else this.events.push(message);
    });
  }
  async send(method, params = {}) {
    await this.ready; const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
      this.pending.set(id, { resolve, reject, timeout }); this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ': ' + result.exceptionDetails.exception?.description);
    return result.result.value;
  }
  close() { this.socket.close(); }
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(client, expression) {
  for (let i = 0; i < 100; i++) { if (await client.evaluate(expression)) return; await sleep(100); }
  throw new Error(`Browser condition not met: ${expression}`);
}


let client;
try {
  const targets = await (await fetch(`${root}/json/list`)).json();
  const worker = targets.find(t => t.type === 'service_worker' && t.url.endsWith('/background.js'));
  const extensionId = process.env.CROSSDSA_EXTENSION_ID || (worker && new URL(worker.url).hostname);
  assert.ok(extensionId, 'Load crossDSA in an isolated test browser');
  let tab = targets.find(t => t.type === 'page' && (t.url === 'about:blank' || t.url.startsWith(`chrome-extension://${extensionId}/`)));
  if (!tab) tab = await (await fetch(`${root}/json/new?about:blank`, {method:'PUT'})).json();
  client = new CDP(tab.webSocketDebuggerUrl);
  await client.send('Runtime.enable'); await client.send('Page.enable');
  await client.send('Page.navigate', { url: `chrome-extension://${extensionId}/dashboard.html#settings` });
  await until(client, "document.getElementById('contestSettingsForm') && document.getElementById('libraryCount').textContent !== '\u2026'");
  await until(client, "document.getElementById('contestStrip').textContent.includes('access')");
  assert.equal(await client.evaluate("document.getElementById('contestReminders').checked"), false);
  await client.evaluate(`(async () => {
    const start = Date.now() + 27 * 3600000;
    const items = [{id:'biweekly-contest-193', title:'Biweekly Contest 193', start, end:start+5400000, url:'https://leetcode.com/contest/biweekly-contest-193/'}, {id:'weekly-contest-523', title:'Weekly Contest 523', start:start+86400000, end:start+91800000, url:'https://leetcode.com/contest/weekly-contest-523/'}];
    await chrome.storage.local.set({'crossdsa-contests-v1':{items,updatedAt:Date.now(),attemptedAt:Date.now(),sent:{}}});
  })()`);
  await until(client, "document.querySelector('.contest-title')?.textContent === 'Biweekly Contest 193'");
  assert.equal(await client.evaluate("document.querySelector('.contest-time').textContent"), 'in 1d 3h');
  await client.evaluate("document.querySelector('#contestStrip summary').click()");
  assert.equal(await client.evaluate("document.querySelector('#contestStrip details').open"), true);
  const directory = join(tmpdir(), 'crossdsa-contest-screenshots'); await mkdir(directory, {recursive:true});
  for (const width of [1440, 390]) {
    await client.send('Emulation.setDeviceMetricsOverride', {width,height:1000,deviceScaleFactor:1,mobile:false});
    assert.equal(await client.evaluate("document.documentElement.scrollWidth <= innerWidth"), true, `No overflow at ${width}`);
    assert.equal(await client.evaluate("document.querySelector('.topbar').getBoundingClientRect().bottom <= document.querySelector('.page').getBoundingClientRect().top"), true);
    const {data} = await client.send('Page.captureScreenshot', {format:'png'});
    await writeFile(join(directory, `settings-${width}.png`), Buffer.from(data,'base64'));
  }
  await client.evaluate("document.getElementById('contestsEnabled').click(); document.querySelector('#contestSettingsForm button').click()");
  await until(client, "document.getElementById('toast').textContent === 'Contest settings saved.'");
  assert.equal(await client.evaluate("document.getElementById('contestStrip').hidden"), true);
  assert.equal(await client.evaluate("document.getElementById('contestReminders').disabled"), true);
  assert.equal(await client.evaluate("(async()=> (await chrome.alarms.getAll()).filter(a=>a.name.startsWith('crossdsa-contest')).length)()"), 0);
  await client.send('Page.navigate', { url: `chrome-extension://${extensionId}/popup.html` });
  await until(client, "document.getElementById('overviewStatus')?.textContent !== 'Connect a platform.' || document.getElementById('contestStrip')?.hidden === true");
  assert.equal(await client.evaluate("document.getElementById('contestStrip').hidden"), true);
  await client.evaluate(`(async()=>{const key='crossdsa-tracker-v1';const s=(await chrome.storage.local.get(key))[key];s.settings.contestsEnabled=true;await chrome.storage.local.set({[key]:s});})()`);
  await until(client, "document.getElementById('contestStrip').textContent.includes('access')");
  await client.evaluate(`(async()=>{const key='crossdsa-contests-v1';const s=(await chrome.storage.local.get(key))[key];s.needsAccess=false;s.error=null;await chrome.storage.local.set({[key]:s});})()`);
  await until(client, "document.querySelector('.contest-title')?.textContent === 'Biweekly Contest 193'");
  await client.send('Emulation.setDeviceMetricsOverride', {width:380,height:900,deviceScaleFactor:1,mobile:false});
  assert.equal(await client.evaluate("document.querySelector('.contest-row').getBoundingClientRect().width <= innerWidth"), true);
  const {data} = await client.send('Page.captureScreenshot', {format:'png'});
  await writeFile(join(directory, 'popup.png'),Buffer.from(data,'base64'));
  console.log(`Contest browser checks passed. Screenshots: ${directory}`);
} finally { client?.close(); }
