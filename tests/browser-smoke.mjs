// Run against a separate Edge/Chrome test profile with remote debugging on 9333.
// Never point this script at your everyday browser profile: it seeds test storage.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.env.CROSSDSA_CDP || 'http://127.0.0.1:9333';
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
  let extensionId = process.env.CROSSDSA_EXTENSION_ID;
  for (const target of targets.filter(t => !extensionId && t.type === 'service_worker' && t.url.endsWith('/background.js'))) {
    const worker = new CDP(target.webSocketDebuggerUrl);
    const name = await worker.evaluate('chrome.runtime.getManifest().name'); worker.close();
    if (name === 'crossDSA') { extensionId = new URL(target.url).hostname; break; }
  }
  assert.ok(extensionId, 'crossDSA extension worker must be loaded in the test browser');
  const tab = targets.find(t => t.type === 'page' && (t.url === 'about:blank' || t.url.startsWith(`chrome-extension://${extensionId}/dashboard.html`)));
  assert.ok(tab, 'An about:blank test tab is required');
  client = new CDP(tab.webSocketDebuggerUrl);
  await client.send('Runtime.enable'); await client.send('Page.enable'); await client.send('Log.enable');
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await client.send('Page.navigate', { url: `chrome-extension://${extensionId}/dashboard.html` });
  await until(client, "document.getElementById('libraryCount') && document.getElementById('libraryCount').textContent !== '…'");
  assert.equal(await client.evaluate("document.getElementById('libraryCount').textContent"), '0', 'No connected platforms means no browsable questions');
  assert.equal(await client.evaluate("document.querySelectorAll('.platform-card').length"), 0);
  assert.equal(await client.evaluate("document.querySelectorAll('#ratingPlot .chart-grid').length"), 5, 'No connected platforms keeps the chart grid');
  assert.equal(await client.evaluate("document.querySelector('#ratingPlot .empty-state') === null"), true);
  assert.equal(await client.evaluate("document.getElementById('toast').hidden"), true, 'No initial RPC failure');
  assert.equal(await client.evaluate("document.getElementById('connectedTotal') === null"), true);
  const directory = join(tmpdir(), 'crossdsa-dashboard-screenshots'); await mkdir(directory, { recursive: true });
  const screenshot = async filename => {
    const { data } = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const path = join(directory, filename); await writeFile(path, Buffer.from(data, 'base64')); console.log(`Screenshot: ${path}`);
  };
  await screenshot('overview-empty.png');
  await client.evaluate(`(async () => {
    const { 'crossdsa-tracker-v1': state } = await chrome.storage.local.get('crossdsa-tracker-v1');
    state.settings.autoSync = false;
    state.accounts.leetcode = {handle:'browser-test',generation:'test',status:'ready',syncedAt:Date.now(),snapshot:{totalSolved:0,recent:[]}};
    await chrome.storage.local.set({'crossdsa-tracker-v1':state});
  })()`);
  await until(client, "document.getElementById('questionPlatform').options.length === 2");
  assert.ok(Number((await client.evaluate("document.getElementById('libraryCount').textContent")).replaceAll(',', '')) > 0, 'Sidebar count updates when a platform connects');
  assert.deepEqual(await client.evaluate("[...document.getElementById('questionPlatform').options].map(o => o.value)"), ['all', 'leetcode']);
  assert.deepEqual(await client.evaluate("[...document.getElementById('donePlatform').options].map(o => o.value)"), ['all', 'leetcode']);
  // UI actions exercise actual extension messages, background validation and storage.
  await client.evaluate("location.hash = 'questions'");
  await until(client, "!document.getElementById('view-questions').hidden");
  const unfilteredMeta = await client.evaluate("document.getElementById('questionMeta').textContent");
  const libraryCount = await client.evaluate("document.getElementById('libraryCount').textContent");
  assert.ok(unfilteredMeta.startsWith(`${libraryCount} of ${libraryCount} questions`), 'Sidebar and unfiltered results use the same connected total');
  await client.evaluate("document.getElementById('questionSearch').value = 'two sum'; document.getElementById('questionSearch').dispatchEvent(new Event('input'))");
  await until(client, `document.getElementById('questionMeta').textContent !== ${JSON.stringify(unfilteredMeta)}`);
  assert.ok(await client.evaluate("document.querySelectorAll('.question-row').length > 0"));
  await client.evaluate("location.hash = 'workspace'");
  await until(client, "!document.getElementById('view-workspace').hidden");
  await client.evaluate("document.getElementById('newListName').value = 'Arrays <script>'; document.querySelector('#createListForm button').click()");
  await until(client, "document.getElementById('workspaceSummary').textContent.includes('Arrays <script>')");
  await client.evaluate("location.hash = 'questions'");
  await until(client, "!document.getElementById('view-questions').hidden");
  await client.evaluate("document.querySelector('.question-row .question-star').click()");
  await until(client, "document.querySelector('.question-row .question-star').getAttribute('aria-pressed') === 'true'");
  await client.evaluate("document.querySelector('.question-row .question-done input').click()");
  await until(client, "document.querySelector('.question-row .question-tags').textContent.includes('Solved')");
  await client.evaluate("location.hash = 'done'");
  await until(client, "!document.getElementById('view-done').hidden && document.querySelector('#doneList .question-actions')");
  assert.equal(await client.evaluate("document.querySelector('#doneList .question-done input').checked"), true);
  await client.evaluate("document.querySelector('#doneList .question-done input').click()");
  await until(client, "document.querySelectorAll('#doneList .recent-row').length === 0");
  await client.evaluate("location.hash = 'questions'");
  await until(client, "!document.getElementById('view-questions').hidden");
  await client.evaluate("document.querySelector('.question-row .question-list-button').click()");
  assert.equal(await client.evaluate("document.getElementById('practiceDialog').open"), true);
  assert.equal(await client.evaluate("document.querySelector('#problemLists input[value=saved]') === null"), true, 'Starred is separate from the custom list picker');
  assert.equal(await client.evaluate("document.querySelector('.question-row').firstElementChild.classList.contains('question-done')"), true, 'Done checkbox leads the row');
  await client.evaluate("document.querySelectorAll('#problemLists input').forEach(input => { input.checked = true; input.dispatchEvent(new Event('change')); }); document.querySelector('#practiceForm button[type=submit]').click()");
  await until(client, "!document.getElementById('practiceDialog').open");
  assert.equal(await client.evaluate("document.querySelector('.question-row .question-star').getAttribute('aria-pressed')"), 'true');
  await client.evaluate("location.hash = 'workspace'");
  await until(client, "!document.getElementById('view-workspace').hidden && document.querySelector('.workspace-row')");
  assert.match(await client.evaluate("document.getElementById('workspaceList').textContent"), /Arrays <script>/);
  assert.equal(await client.evaluate("document.querySelector('#workspaceList script') === null"), true, 'List names are rendered as text');
  assert.equal(await client.evaluate("document.querySelector('#practiceNotes, #revisionDate') === null"), true);
  await screenshot('practice-workspace.png');
  await client.send('Page.reload');
  await until(client, "document.querySelector('.workspace-row') && Number(document.getElementById('libraryCount').textContent.replaceAll(',', '')) > 0");
  assert.match(await client.evaluate("document.getElementById('workspaceList').textContent"), /Arrays <script>/);
  await client.evaluate("location.hash = 'settings'");
  await until(client, "!document.getElementById('view-settings').hidden");
  await client.evaluate("document.getElementById('dailyGoal').value = '3'; document.getElementById('timeZone').value = 'Asia/Kolkata'; document.querySelector('#settingsForm button[type=submit]').click()");
  await until(client, "document.getElementById('goalCaption').textContent === 'of 3 accepted problems'");
  // Seed a small, explicitly synthetic snapshot only into this disposable profile.
  await client.evaluate(`(async () => {
    const { 'crossdsa-tracker-v1': state } = await chrome.storage.local.get('crossdsa-tracker-v1');
    const now = Date.now(), day = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Kolkata'}).format(new Date(now));
    for (const entry of Object.values(state.workspace)) { delete entry.done; delete entry.doneAt; }
    state.accounts.leetcode = {handle:'browser-test',generation:'test',status:'ready',syncedAt:now,snapshot:{totalSolved:120,breakdown:{Easy:40,Medium:65,Hard:15},rating:1640,rank:123456,badges:['Test badge'],ratings:[{timestamp:now-86400000*30,rating:1500,title:"Weekly 1"},{timestamp:now-86400000*20,rating:1590},{timestamp:now-86400000*10,rating:1550},{timestamp:now,rating:1640}],calendar:{[day]:3},recent:[{id:'leetcode:test',key:'leetcode:two-sum',platform:'leetcode',title:'Two Sum',url:'https://leetcode.com/problems/two-sum/',timestamp:now}],partial:true,coverage:'Synthetic browser-test data. Not a real account.'}};
    await chrome.storage.local.set({'crossdsa-tracker-v1':state});
  })()`);
  await client.evaluate("location.hash = 'overview'");
  await until(client, "document.getElementById('solvedTotal').textContent === '120'");
  assert.equal(await client.evaluate("document.getElementById('goalCount').textContent"), '1');
  assert.equal(await client.evaluate("document.querySelectorAll('.platform-card').length"), 1, 'Only the connected LeetCode card is shown');
  assert.deepEqual(await client.evaluate("[...document.getElementById('progressPlatform').options].map(o => o.value)"), ['leetcode']);
  assert.equal(await client.evaluate("document.getElementById('progressPlatform').disabled"), true);
  await client.evaluate(`(async () => {
    const { 'crossdsa-tracker-v1': state } = await chrome.storage.local.get('crossdsa-tracker-v1');
    window.originalTestAccount = structuredClone(state.accounts.leetcode);
    state.accounts.leetcode.snapshot.activityWarning = 'Refresh your LeetCode tab, then sync again.';
    state.accounts.leetcode.snapshot.recent = [];
    await chrome.storage.local.set({'crossdsa-tracker-v1':state});
  })()`);
  await until(client, "document.getElementById('goalCount').textContent === '—'");
  assert.match(await client.evaluate("document.querySelector('.status-pill').textContent"), /Profile updated.*Activity needs LeetCode/);
  assert.equal(await client.evaluate("[...document.querySelectorAll('.platform-actions a')].some(a => a.textContent.includes('Open LeetCode') && a.href === 'https://leetcode.com/u/browser-test/')"), true);
  assert.match(await client.evaluate("document.getElementById('recentList').textContent"), /Recent activity unavailable/);
  await client.evaluate(`(async () => {
    const { 'crossdsa-tracker-v1': state } = await chrome.storage.local.get('crossdsa-tracker-v1');
    state.accounts.leetcode.status = 'syncing';
    await chrome.storage.local.set({'crossdsa-tracker-v1':state});
  })()`);
  await until(client, "document.getElementById('syncAll').textContent.includes('Syncing 1')");
  assert.equal(await client.evaluate("document.getElementById('syncAll').disabled"), true);
  assert.equal(await client.evaluate("document.getElementById('connect-leetcode').textContent"), 'Syncing…');
  assert.equal(await client.evaluate("document.getElementById('connect-leetcode').disabled"), true);
  await client.evaluate(`(async () => {
    const { 'crossdsa-tracker-v1': state } = await chrome.storage.local.get('crossdsa-tracker-v1');
    state.accounts.leetcode = window.originalTestAccount;
    delete window.originalTestAccount;
    await chrome.storage.local.set({'crossdsa-tracker-v1':state});
  })()`);
  await until(client, "document.getElementById('goalCount').textContent === '1'");
  assert.equal(await client.evaluate("document.getElementById('syncSummary').hidden"), true);

  await client.evaluate("location.hash = 'done'");
  await until(client, "!document.getElementById('view-done').hidden");
  assert.equal(await client.evaluate("document.querySelectorAll('#doneList .recent-row').length"), 1);
  await client.evaluate("document.getElementById('doneSearch').value = 'missing'; document.getElementById('doneSearch').dispatchEvent(new Event('input'))");
  assert.equal(await client.evaluate("document.querySelectorAll('#doneList .recent-row').length"), 0);
  await client.evaluate("document.getElementById('doneSearch').value = ''; document.getElementById('doneSearch').dispatchEvent(new Event('input'))");
  await client.evaluate(`(async () => {
    const { 'crossdsa-tracker-v1': state } = await chrome.storage.local.get('crossdsa-tracker-v1');
    window.originalDoneRecords = structuredClone(state.accounts.leetcode.snapshot.recent);
    const base = state.accounts.leetcode.snapshot.recent[0];
    state.accounts.leetcode.snapshot.recent = [...Array.from({length:51}, (_,i) => ({...base,id:'test:'+i,key:'leetcode:done-'+i,title:'Done question '+i,timestamp:base.timestamp-i*1000})), {...base,id:'duplicate',key:'leetcode:done-0',timestamp:base.timestamp-100000}];
    await chrome.storage.local.set({'crossdsa-tracker-v1':state});
  })()`);
  await until(client, "document.getElementById('doneMeta').textContent.includes('51 tracked')");
  assert.equal(await client.evaluate("document.querySelectorAll('#doneList .recent-row').length"), 50);
  await client.evaluate("document.getElementById('doneNext').click()");
  assert.equal(await client.evaluate("document.querySelectorAll('#doneList .recent-row').length"), 1);
  assert.equal(await client.evaluate("document.getElementById('doneNext').disabled"), true);
  await client.evaluate(`(async () => {
    const { 'crossdsa-tracker-v1': state } = await chrome.storage.local.get('crossdsa-tracker-v1');
    state.accounts.leetcode.snapshot.recent = window.originalDoneRecords;
    delete window.originalDoneRecords;
    await chrome.storage.local.set({'crossdsa-tracker-v1':state});
  })()`);
  await until(client, "document.getElementById('doneMeta').textContent.includes('1 tracked')");
  assert.equal(await client.evaluate("document.getElementById('donePageLabel').textContent"), '1 / 1');
  await client.evaluate("location.hash = 'overview'");
  await until(client, "!document.getElementById('view-overview').hidden");

  assert.match(await client.evaluate("document.getElementById('platformCards').textContent"), /Partial history/);
  await screenshot('overview-populated-test.png');
  await client.evaluate(`(async () => {
    const { 'crossdsa-tracker-v1': state } = await chrome.storage.local.get('crossdsa-tracker-v1');
    const now = Date.now();
    state.accounts.geeksforgeeks = {handle:'chart-test',generation:'test',status:'ready',syncedAt:now,snapshot:{totalSolved:94,score:224,rank:651,breakdown:{Easy:50,Medium:40,Hard:4},recent:[],ratings:[],scoreHistory:[{timestamp:now-86400000*2,rating:180},{timestamp:now-86400000,rating:210},{timestamp:now,rating:224}],coverage:'Synthetic chart test data.'}};
    await chrome.storage.local.set({'crossdsa-tracker-v1':state});
  })()`);
  await until(client, "document.querySelectorAll('.platform-card').length === 2");
  assert.deepEqual(await client.evaluate("[...document.getElementById('progressPlatform').options].map(o => o.value)"), ['all', 'leetcode', 'geeksforgeeks']);
  await client.evaluate("document.getElementById('progressPlatform').value = 'geeksforgeeks'; document.getElementById('progressPlatform').dispatchEvent(new Event('change'))");
  assert.equal(await client.evaluate("document.querySelectorAll('#ratingPlot circle').length"), 3, 'Shared platform filter selects GFG score');
  assert.match(await client.evaluate("document.getElementById('activitySummary').textContent"), /^0 contributions/, 'Shared platform filter selects GFG activity');
  assert.equal(await client.evaluate("document.querySelectorAll('.progress-toolbar select').length"), 2);
  assert.equal(await client.evaluate("document.getElementById('ratingPlatform') === null"), true, 'Duplicate platform selector is removed');
  await client.evaluate("document.getElementById('progressPlatform').value = 'all'; document.getElementById('progressPlatform').dispatchEvent(new Event('change'))");
  assert.match(await client.evaluate("document.getElementById('activitySummary').textContent"), /^3 contributions/);
  assert.equal(await client.evaluate("document.querySelectorAll('#ratingPlot circle[data-platform=geeksforgeeks]').length"), 3, 'All connected includes the GFG score history');
  assert.equal(await client.evaluate("document.getElementById('ratingsTitle').textContent"), 'Rating & coding score');
  assert.match(await client.evaluate("document.getElementById('platformCards').querySelector('[aria-label=\"Disconnect GeeksforGeeks\"]').closest('.platform-card').textContent"), /224.*CODING SCORE.*#651.*INSTITUTE RANK/s);
  assert.equal(await client.evaluate("document.querySelectorAll('#ratingPlot polyline').length"), 2);
  assert.equal(await client.evaluate("document.querySelectorAll('#platformCards svg').length"), 0, 'Profile charts are removed');
  assert.equal(await client.evaluate("document.querySelectorAll('#ratingPlot circle').length"), 7);
  await client.send('Page.bringToFront');
  await client.evaluate("document.getElementById('progressPlatform').focus(); document.querySelector('#ratingPlot circle').focus()");
  assert.match(await client.evaluate("document.querySelector('.rating-tooltip').textContent"), /Weekly 1/);
  await client.evaluate("document.getElementById('rating-toggle-leetcode').click()");
  assert.equal(await client.evaluate("document.querySelectorAll('#ratingPlot circle').length"), 3);
  await client.evaluate("document.getElementById('rating-toggle-geeksforgeeks').click()");
  assert.equal(await client.evaluate("document.querySelectorAll('#ratingPlot circle').length"), 0);
  assert.equal(await client.evaluate("document.querySelectorAll('#ratingPlot .chart-grid').length"), 5, 'Hiding all series keeps the chart grid');
  assert.equal(await client.evaluate("document.querySelector('#ratingPlot .empty-state') === null"), true);
  await client.evaluate("document.getElementById('rating-toggle-leetcode').click()");
  await client.evaluate("document.getElementById('rating-toggle-geeksforgeeks').click()");
  const ratingSize = await client.evaluate("(() => { const {width,height} = document.querySelector('.ratings-panel').getBoundingClientRect(); return {width,height}; })()");
  const cellSize = await client.evaluate("(() => { const {width,height} = document.querySelector('.heatmap-cell:not(.blank)').getBoundingClientRect(); return {width,height}; })()");
  assert.ok(Math.abs(cellSize.width - cellSize.height) < 1, 'Heatmap cells are square on desktop');
  await client.evaluate("document.getElementById('progressYear').value = '2025'; document.getElementById('progressYear').dispatchEvent(new Event('change'))");
  assert.equal(await client.evaluate("document.querySelectorAll('#ratingPlot .chart-grid').length"), 5, 'An empty year keeps the chart grid');
  assert.equal(await client.evaluate("document.querySelectorAll('#ratingPlot circle, #ratingPlot polyline, #ratingPlot .empty-state').length"), 0);
  assert.match(await client.evaluate("document.getElementById('activitySummary').textContent"), /^0 contributions/, 'Year applies to both visuals');
  assert.deepEqual(await client.evaluate("(() => { const {width,height} = document.querySelector('.ratings-panel').getBoundingClientRect(); return {width,height}; })()"), ratingSize, 'Rating area stays the same size with no data');
  await client.evaluate("document.getElementById('progressYear').value = String(new Date().getFullYear()); document.getElementById('progressYear').dispatchEvent(new Event('change'))");
  await client.evaluate("document.getElementById('progressPlatform').value = 'geeksforgeeks'; document.getElementById('progressPlatform').dispatchEvent(new Event('change'))");
  assert.equal(await client.evaluate("document.querySelectorAll('#ratingPlot circle').length"), 3);
  assert.equal(await client.evaluate("document.getElementById('ratingsTitle').textContent"), 'Coding score');
  assert.deepEqual(await client.evaluate("(() => { const {width,height} = document.querySelector('.ratings-panel').getBoundingClientRect(); return {width,height}; })()"), ratingSize, 'Rating area stays the same size when switching platforms');
  await client.evaluate("document.getElementById('progressPlatform').value = 'all'; document.getElementById('progressPlatform').dispatchEvent(new Event('change'))");
  await client.evaluate(`(async () => {
    const { 'crossdsa-tracker-v1': state } = await chrome.storage.local.get('crossdsa-tracker-v1');
    const now = Date.now();
    state.accounts.codeforces = {handle:'chart-test',status:'ready',syncedAt:now,snapshot:{totalSolved:0,rating:362,ratings:[{timestamp:now-86400000*30,rating:300},{timestamp:now,rating:362}],recent:[],breakdown:{}}};
    await chrome.storage.local.set({'crossdsa-tracker-v1':state});
  })()`);
  await until(client, "document.querySelectorAll('#ratingPlot circle').length === 9");
  assert.equal(await client.evaluate("document.querySelectorAll('#ratingPlot polyline').length"), 3);
  assert.equal(await client.evaluate("document.querySelector('.ratings-panel').getBoundingClientRect().left > document.querySelector('.activity-panel').getBoundingClientRect().right"), true, 'Charts sit side by side on desktop');
  assert.equal(await client.evaluate("getComputedStyle(document.querySelector('.platform-card')).padding"), '10px');
  assert.equal(await client.evaluate("document.getElementById('platformCards').querySelector('[aria-label=\"Disconnect GeeksforGeeks\"]').closest('.platform-card').innerHTML.includes('NaN')"), false);
  await screenshot('overview-rating-charts.png');
  await client.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await sleep(200);
  assert.equal(await client.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, 'Mobile page does not overflow');
  const mobileCellSize = await client.evaluate("(() => { const {width,height} = document.querySelector('.heatmap-cell:not(.blank)').getBoundingClientRect(); return {width,height}; })()");
  assert.ok(Math.abs(mobileCellSize.width - mobileCellSize.height) < 1, 'Heatmap cells are square on mobile');
  await screenshot('overview-mobile.png');
  await client.evaluate("document.getElementById('connectTop').click()");
  assert.equal(await client.evaluate("document.getElementById('connectionsDialog').open"), true);
  assert.equal(await client.evaluate("document.querySelectorAll('.connection-form').length"), 6);
  assert.equal(await client.evaluate("document.querySelector('.ratings-panel').getBoundingClientRect().top >= document.querySelector('.activity-panel').getBoundingClientRect().bottom"), true, 'Charts stack on mobile');
  await client.evaluate("document.getElementById('progressPlatform').value = 'geeksforgeeks'; document.getElementById('progressPlatform').dispatchEvent(new Event('change'))");
  // One observation must render a real point without fabricating a line.
  await client.evaluate(`(async () => {
    document.getElementById('connectionsDialog').close();
    const { 'crossdsa-tracker-v1': state } = await chrome.storage.local.get('crossdsa-tracker-v1');
    state.accounts.geeksforgeeks.snapshot.scoreHistory = [{timestamp:Date.now(),rating:224}];
    state.accounts.geeksforgeeks.snapshot.rank = null;
    await chrome.storage.local.set({'crossdsa-tracker-v1':state});
  })()`);
  await until(client, "document.querySelectorAll('#ratingPlot circle').length === 1");
  assert.equal(await client.evaluate("document.querySelectorAll('#ratingPlot polyline').length"), 0);
  assert.match(await client.evaluate("document.getElementById('platformCards').querySelector('[aria-label=\"Disconnect GeeksforGeeks\"]').closest('.platform-card').textContent"), /—.*INSTITUTE RANK/s);

  await client.evaluate(`(async () => {
    const { 'crossdsa-tracker-v1': state } = await chrome.storage.local.get('crossdsa-tracker-v1');
    delete state.accounts.geeksforgeeks;
    delete state.accounts.codeforces;
    await chrome.storage.local.set({'crossdsa-tracker-v1':state});
  })()`);
  await until(client, "document.getElementById('solvedTotal').textContent === '120'");
  assert.equal(await client.evaluate("document.getElementById('progressPlatform').value"), 'leetcode', 'Disconnected heatmap selection resets to the remaining account');
  const exceptions = client.events.filter(e => e.method === 'Runtime.exceptionThrown');
  const errors = client.events.filter(e => e.method === 'Log.entryAdded' && e.params.entry.level === 'error');
  assert.deepEqual(exceptions, [], 'No uncaught browser exceptions');
  assert.deepEqual(errors, [], 'No browser console errors');
  await client.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 900, deviceScaleFactor: 1, mobile: false });
  await client.send('Page.navigate', { url: `chrome-extension://${extensionId}/popup.html` });
  await until(client, "document.getElementById('problemCount') && Number(document.getElementById('problemCount').textContent.replaceAll(',', '')) > 20000");
  await until(client, "document.getElementById('overviewTotal').textContent === '120'");
  assert.equal(await client.evaluate("document.getElementById('overviewToday').textContent"), '1');
  assert.equal(await client.evaluate("document.getElementById('overviewGoal').textContent"), 'OF 3 TODAY');
  assert.equal(await client.evaluate("document.getElementById('overviewStreakLabel').textContent"), 'STREAK - LEETCODE');
  assert.equal(await client.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true);
  await screenshot('popup-overview.png');
  const threshold = await client.evaluate("chrome.runtime.sendMessage({action:'getSimilarityThreshold'})");
  assert.equal(threshold.value, 0.4, 'Existing matching settings still work with the module worker');
  await client.evaluate("document.getElementById('openDashboard').click()");
  const pages = await (await fetch(`${root}/json/list`)).json();
  assert.ok(pages.some(t => t.url === `chrome-extension://${extensionId}/dashboard.html`), 'Popup opens a dashboard tab');
  await client.send('Page.navigate', { url: `chrome-extension://${extensionId}/dashboard.html` });
  await until(client, "document.querySelector('[aria-label=\"Disconnect LeetCode\"]')");
  await client.evaluate("document.querySelector('[aria-label=\"Disconnect LeetCode\"]').click()");
  await until(client, "document.querySelectorAll('.platform-card').length === 0");
  assert.equal(await client.evaluate("document.getElementById('progressPlatform').disabled"), true);
  assert.equal(await client.evaluate("document.getElementById('progressPlatform').selectedOptions[0].textContent"), 'No platforms');
  assert.equal(await client.evaluate("document.getElementById('syncAll').disabled"), true);
  assert.equal(await client.evaluate("document.querySelectorAll('.workspace-row').length > 0"), true, 'Disconnect keeps question lists');
  console.log('PASS: empty state, index/search, multiple lists, safe text rendering, list persistence, settings, activity counters, six connections, mobile layout, original popup/settings, dashboard launch.');
} finally { client?.close(); }
