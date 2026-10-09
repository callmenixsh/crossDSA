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
  await client.evaluate(`(async()=>{const key='crossdsa-tracker-v1';const s=(await chrome.storage.local.get(key))[key];s.settings.contestsEnabled=true;s.settings.contestReminders=false;await chrome.storage.local.set({[key]:s});})()`);
  await until(client, "document.getElementById('contestsEnabled').checked");
  assert.equal(await client.evaluate("document.getElementById('contestReminders').checked"), false);
  await client.evaluate(`(async () => {
    const start = Date.now() + 27 * 3600000;
    const lc = [{id:'biweekly-contest-193', platform:'leetcode', title:'Biweekly Contest 193', start, end:start+5400000, url:'https://leetcode.com/contest/biweekly-contest-193/'}, {id:'weekly-contest-523', platform:'leetcode', title:'Weekly Contest 523', start:start+86400000, end:start+91800000, url:'https://leetcode.com/contest/weekly-contest-523/'}, {id:'weekly-contest-522', platform:'leetcode', title:'Weekly Contest 522', start:Date.now()-86400000, end:Date.now()-81000000, url:'https://leetcode.com/contest/weekly-contest-522/'}];
    const cf = [{id:'codeforces-2276', platform:'codeforces', title:'Educational Codeforces Round 195', start:start-3600000, end:start+3600000, url:'https://codeforces.com/contest/2276'}];
    window.contestFixture = {items:[...lc,...cf].sort((a,b)=>a.start-b.start), sources:{leetcode:{items:lc,updatedAt:Date.now(),attemptedAt:Date.now()},codeforces:{items:cf,updatedAt:Date.now(),attemptedAt:Date.now()}},updatedAt:Date.now(),sent:{}};
    await chrome.storage.local.set({'crossdsa-contests-v1':window.contestFixture});
  })()`);
  await until(client, "document.querySelector('.contest-title')?.textContent === 'Educational Codeforces Round 195'");
  assert.equal(await client.evaluate("document.querySelector('.contest-time').textContent"), 'in 1d 2h');
  assert.equal(await client.evaluate("document.querySelector('#contestStrip .contest-more').textContent"), '+2');
  assert.equal(await client.evaluate("document.querySelector('#contestStrip details')"), null);
  await client.evaluate("document.querySelector('#contestStrip .contest-more').click()");
  await until(client, "location.hash === '#contests' && !document.getElementById('view-contests').hidden");
  assert.equal(await client.evaluate("document.querySelector('dialog.contest-calendar')"), null);
  assert.equal(await client.evaluate("document.querySelector('[data-view=contests]').getAttribute('aria-current')"), 'page');
  assert.equal(await client.evaluate("document.querySelectorAll('.contest-weekday').length"), 7);
  assert.equal(await client.evaluate("document.querySelectorAll('.contest-calendar .contest-card').length"), 4);
  assert.equal(await client.evaluate("document.querySelectorAll('.contest-calendar .has-ended').length"), 1);
  await client.evaluate("document.querySelector('[aria-label=\"Show Codeforces contests\"]').click()");
  assert.equal(await client.evaluate("document.querySelectorAll('.contest-calendar .contest-card').length"), 1);
  assert.equal(await client.evaluate("document.querySelector('.contest-calendar .contest-card').dataset.platform"), 'codeforces');
  await client.evaluate("document.querySelector('[aria-label=\"Show LeetCode contests\"]').click()");
  assert.equal(await client.evaluate("document.querySelectorAll('.contest-calendar .contest-card').length"), 3);
  await client.evaluate("document.querySelector('[aria-label=\"Show All contests\"]').click()");
  const originalMonth = await client.evaluate("document.querySelector('.contest-calendar h2').textContent");
  await client.evaluate("document.querySelector('[aria-label=\"Next month\"]').click()");
  assert.notEqual(await client.evaluate("document.querySelector('.contest-calendar h2').textContent"), originalMonth);
  await client.evaluate("document.querySelector('[aria-label=\"Previous month\"]').click()");
  assert.equal(await client.evaluate("document.querySelector('.contest-calendar h2').textContent"), originalMonth);
  await client.evaluate(`(async () => {
    const key = 'crossdsa-contests-v1'; window.contestTestCache = (await chrome.storage.local.get(key))[key];
    const original = window.contestTestCache.items[0];
    await chrome.storage.local.set({[key]: {...window.contestTestCache, items: Array.from({length:4}, (_, i) => ({...original, id:'weekly-contest-'+(600+i), title:'Test contest '+i, start:original.start+i*60000}))}});
  })()`);
  await until(client, "document.querySelector('.contest-day > .contest-control')?.textContent === '+1 more'");
  assert.equal(await client.evaluate("document.querySelectorAll('.contest-calendar .contest-card').length"), 3);
  await client.evaluate("document.querySelector('.contest-day > .contest-control').click()");
  assert.equal(await client.evaluate("document.querySelectorAll('.contest-calendar .contest-card').length"), 4);
  await client.evaluate("document.querySelector('.contest-day > .contest-control').click()");
  assert.equal(await client.evaluate("document.querySelectorAll('.contest-calendar .contest-card').length"), 3);
  await client.evaluate("chrome.storage.local.set({'crossdsa-contests-v1':window.contestTestCache})");
  await until(client, "document.querySelectorAll('.contest-calendar .contest-card').length === 4");
  const directory = join(tmpdir(), 'crossdsa-contest-screenshots'); await mkdir(directory, {recursive:true});
  for (const width of [1440, 390]) {
    await client.send('Emulation.setDeviceMetricsOverride', {width,height:1000,deviceScaleFactor:1,mobile:false});
    assert.equal(await client.evaluate("document.documentElement.scrollWidth <= innerWidth"), true, `No overflow at ${width}`);
    assert.equal(await client.evaluate("document.querySelector('.topbar').getBoundingClientRect().bottom <= document.querySelector('.page').getBoundingClientRect().top"), true);
    const {data} = await client.send('Page.captureScreenshot', {format:'png'});
    await writeFile(join(directory, `calendar-${width}.png`), Buffer.from(data,'base64'));
    assert.equal(await client.evaluate("document.querySelector('.contest-calendar').scrollWidth <= document.querySelector('.contest-calendar').clientWidth"), true, `Calendar fits at ${width}`);
  }
  await client.evaluate("location.hash='settings'");
  await until(client, "!document.getElementById('view-settings').hidden");
  assert.equal(await client.evaluate("document.querySelector('label:has(#autoSync)').textContent.includes('30 minutes')"), true);
  assert.equal(await client.evaluate("(async()=> (await chrome.alarms.get('crossdsa-hourly-sync'))?.periodInMinutes)()"), 30);
  await client.evaluate("document.getElementById('contestsEnabled').click(); document.querySelector('#contestSettingsForm button').click()");
  await until(client, "document.getElementById('toast').textContent === 'Contest settings saved.'");
  assert.equal(await client.evaluate("document.getElementById('contestStrip').hidden"), false);
  assert.equal(await client.evaluate("document.getElementById('contestReminders').disabled"), false);
  assert.equal(await client.evaluate("(async()=> (await chrome.alarms.getAll()).filter(a=>a.name.startsWith('crossdsa-contest')).length)()"), 0);
  await client.evaluate("location.hash='contests'");
  await until(client, "!document.getElementById('view-contests').hidden");
  assert.equal(await client.evaluate("document.querySelectorAll('.contest-calendar .contest-card').length"), 0);
  await client.send('Page.navigate', { url: `chrome-extension://${extensionId}/popup.html` });
  await until(client, "document.readyState === 'complete' && document.getElementById('contestStrip')?.hidden === true");
  assert.equal(await client.evaluate("document.getElementById('contestStrip').hidden"), true);
  assert.equal(await client.evaluate("document.getElementById('dashboardLink').previousElementSibling.id"), 'refreshOverview');
  await client.evaluate(`(async()=>{const key='crossdsa-tracker-v1';const s=(await chrome.storage.local.get(key))[key];s.settings.contestsEnabled=true;await chrome.storage.local.set({[key]:s});})()`);
  await until(client, "document.getElementById('contestStrip').textContent.includes('access')");
  await client.evaluate(`(async()=>{const start=Date.now()+27*3600000;const items=[{id:'biweekly-contest-193',platform:'leetcode',title:'Biweekly Contest 193',start,end:start+5400000,url:'https://leetcode.com/contest/biweekly-contest-193/'},{id:'codeforces-2276',platform:'codeforces',title:'Educational Codeforces Round 195',start:start+3600000,end:start+10800000,url:'https://codeforces.com/contest/2276'}];await chrome.storage.local.set({'crossdsa-contests-v1':{items,updatedAt:Date.now(),sent:{},sources:{leetcode:{items:[items[0]],updatedAt:Date.now()},codeforces:{items:[items[1]],updatedAt:Date.now(),error:'Offline'}}}});})()`);
  await until(client, "document.querySelector('.contest-title')?.textContent === 'Biweekly Contest 193'");
  assert.equal(await client.evaluate("document.querySelector('#contestStrip details')"), null);
  assert.equal(await client.evaluate("document.querySelector('.contest-more').href.endsWith('/dashboard.html#contests')"), true);
  await client.send('Emulation.setDeviceMetricsOverride', {width:380,height:900,deviceScaleFactor:1,mobile:false});
  assert.equal(await client.evaluate("document.querySelector('.contest-row').getBoundingClientRect().width <= innerWidth"), true);
  const {data} = await client.send('Page.captureScreenshot', {format:'png'});
  await writeFile(join(directory, 'popup.png'),Buffer.from(data,'base64'));
  await client.evaluate("document.querySelector('.contest-more').click()");
  await until(client, "(async()=> (await chrome.tabs.query({})).some(tab=>tab.url?.endsWith('/dashboard.html#contests') || tab.pendingUrl?.endsWith('/dashboard.html#contests')))()");
  await client.evaluate("document.getElementById('dashboardLink').click()");
  await until(client, "(async()=> (await chrome.tabs.query({})).some(tab=>tab.url?.endsWith('/dashboard.html') || tab.pendingUrl?.endsWith('/dashboard.html')))()");
  console.log(`Contest browser checks passed. Screenshots: ${directory}`);
} finally { client?.close(); }
