// UI checks with real local datasets and mocked extension RPC, in an isolated browser.
// Launch a dedicated headless Edge profile with --remote-debugging-port=9334 first.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, sep, join } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '..');
const estimatedTask = JSON.parse(await readFile(join(root, 'data/atcoder-data.json'), 'utf8')).find(p => Number.isFinite(p.estimatedDifficulty));
const server = createServer(async (req, res) => {
  const path = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
  try {
    const type = path.endsWith('.mjs') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.json') ? 'application/json' : 'text/html';
    res.writeHead(200, { 'Content-Type': type }); res.end(await readFile(path));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let socket;
try {
  const targets = await (await fetch(process.env.CROSSDSA_LIBRARY_CDP || 'http://127.0.0.1:9334/json/list')).json();
  const target = targets.find(t => t.type === 'page');
  assert.ok(target, 'Use a dedicated browser profile with an about:blank tab');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  let id = 0; const pending = new Map(), errors = [];
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    if (message.id) { const task = pending.get(message.id); pending.delete(message.id); message.error ? task.reject(message.error) : task.resolve(message.result); }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); socket.send(JSON.stringify({ id: key, method, params })); });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until = async expression => {
    for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 100)); }
    throw new Error(`Timed out: ${expression}`);
  };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    const state = {version:1,accounts:{leetcode:{handle:'library-test',status:'ready',syncedAt:Date.now(),snapshot:{totalSolved:0,recent:[]}}},workspace:{},lists:{saved:{id:'saved',name:'Starred'}},settings:{dailyGoal:2,timeZone:'Asia/Calcutta',autoSync:false}};
    const storageListeners = [];
    window.chrome = {runtime:{getURL:path=>'/'+path,sendMessage:async message=>{
      if(message.action==='tracker:connect' && message.platform==='atcoder') {
        const {atcoder}=await import('/tracker/atcoder.mjs');
        const now=Math.floor(Date.now()/1000);
        const snapshot=await atcoder(message.handle,{wait:async()=>{},text:async()=>'<title>sample - AtCoder</title><th>Rating</th><td>1400</td><th>Rank</th><td>100th</td>',problemTitles:new Map([['dp_a','Frog 1'],['dp_b','Frog 2']]),json:async url=>url.includes('/history/json')?[{IsRated:true,NewRating:1400,ContestName:'ABC',EndTime:new Date().toISOString()}]:[1,2,3].map((id,i)=>({id,epoch_second:now-5,result:'AC',user_id:'sample',contest_id:'dp',problem_id:i===2?'dp_b':'dp_a'}))});
        state.accounts.atcoder={handle:message.handle,status:'ready',syncedAt:Date.now(),snapshot};
      }
      if(message.action==='tracker:platform-order') { state.settings.platformOrder=message.order; queueMicrotask(()=>storageListeners.forEach(fn=>fn({'crossdsa-tracker-v1':{newValue:state}},'local'))); }
      if(message.action==='tracker:disconnect') { delete state.accounts[message.platform]; queueMicrotask(()=>storageListeners.forEach(fn=>fn({'crossdsa-tracker-v1':{newValue:state}},'local'))); }
      if(message.action==='tracker:question-state') {
        const entry={...message.entry,...state.workspace[message.entry.key],updatedAt:Date.now()};
        if('done' in message.patch) entry.done=message.patch.done;
        if('starred' in message.patch) entry.listIds=message.patch.starred?['saved']:[];
        state.workspace[entry.key]=entry;
      }
      return {ok:true,state};
    }},permissions:{request:async request=>{window.lastPermission=request;return true;}},storage:{local:{get:async()=>({'crossdsa-tracker-v1':state})},onChanged:{addListener:fn=>storageListeners.push(fn)}}};
  ` });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/dashboard.html#overview` });
  await until("document.querySelector('#handle-atcoder')");
  await evaluate("document.getElementById('connectCards').click();document.getElementById('handle-atcoder').value='https://atcoder.jp/users/sample';document.getElementById('connect-atcoder').click()");
  await until("document.getElementById('connection-result-atcoder').textContent.includes('Synced') || document.getElementById('disconnect-atcoder').hidden===false");
  assert.deepEqual(await evaluate('window.lastPermission.origins'), ['https://atcoder.jp/*', 'https://kenkoooo.com/*']);
  await evaluate("location.hash='overview'");
  assert.equal(await evaluate("document.getElementById('solvedTotal').firstChild.textContent"), '2');
  assert.equal(await evaluate("document.querySelector('#solvedTotal .today-increase').textContent"), '\u21912');
  assert.equal(await evaluate("document.getElementById('goalCount').textContent"), '2');
  assert.match(await evaluate("document.getElementById('platformCards').textContent"), /AtCoder/);
  assert.match(await evaluate("document.getElementById('platformCards').textContent"), /1,400/);
  assert.ok(await evaluate("[...document.querySelectorAll('#progressPlatform option')].some(o=>o.value==='atcoder')"));
  await evaluate("document.getElementById('progressPlatform').value='atcoder';document.getElementById('progressPlatform').dispatchEvent(new Event('change'))");
  assert.match(await evaluate("document.getElementById('activitySummary').textContent"), /3 contributions/);
  assert.ok(await evaluate("document.querySelector('#ratingPlot [data-platform=atcoder]')"));
  await evaluate("location.hash='done'");
  await until("document.querySelectorAll('#doneList .recent-row').length===2");
  assert.match(await evaluate("document.getElementById('doneList').textContent"), /Frog 1/);
  await evaluate("document.getElementById('connectCards').click();document.getElementById('handle-code360').value='unsaved-draft';document.querySelector('[data-platform=atcoder] .order-handle').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',altKey:true,bubbles:true}))");
  await until("document.querySelectorAll('.connection-form')[4].dataset.platform==='atcoder'");
  assert.equal(await evaluate("document.querySelectorAll('.order-up,.order-down').length"), 0, 'Reordering uses the handle without arrow buttons');
  assert.equal(await evaluate("document.getElementById('handle-code360').value"),'unsaved-draft');
  await evaluate("(() => { const transfer=new DataTransfer(); document.querySelector('[data-platform=atcoder] .order-handle').dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:transfer})); document.querySelector('[data-platform=leetcode].connection-form').dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:transfer})); document.querySelector('[data-platform=atcoder] .order-handle').dispatchEvent(new DragEvent('dragend',{bubbles:true})); })()");
  await until("document.querySelector('.connection-form').dataset.platform==='atcoder'");
  assert.deepEqual(await evaluate("[...document.getElementById('questionPlatform').options].map(o=>o.value)"),['all','atcoder','leetcode']);
  assert.equal(await evaluate("document.querySelector('#platformCards .platform-name').textContent.includes('AtCoder')"),true);
  for (const width of [1440, 390]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'), `Done view fits ${width}px`);
    await evaluate("location.hash='overview';document.getElementById('connectCards').click()");
    assert.ok(await evaluate("document.querySelector('.connections-panel').scrollWidth<=document.querySelector('.connections-panel').clientWidth"), `Connection settings fit ${width}px`);
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(tmpdir(), `crossdsa-atcoder-connect-${width}.png`), Buffer.from(data, 'base64'));
    await evaluate("location.hash='overview'");
  }
  await evaluate("document.getElementById('disconnect-atcoder').click()");
  await until("document.getElementById('goalCount').textContent==='0'");
  assert.ok(await evaluate("![...document.querySelectorAll('#progressPlatform option')].some(o=>o.value==='atcoder')"));
  assert.ok(await evaluate("![...document.querySelectorAll('#questionPlatform option')].some(o=>o.value==='atcoder')"), 'Disconnected platform is removed from the library');
  await evaluate("location.hash='companies'");
  await until("document.querySelector('#companyGrid .company-card')");
  assert.deepEqual(await evaluate("[...document.getElementById('companyPlatform').options].map(o=>o.value)"), ['leetcode']);
  assert.equal(await evaluate("document.querySelectorAll('#contestCalendar [data-platform=codeforces]').length"), 0);
  await evaluate("document.getElementById('disconnect-leetcode').click()");
  await until("document.getElementById('companyContent').hidden && document.getElementById('companyLoadText').textContent.includes('Connect LeetCode')");
  assert.equal(await evaluate("document.getElementById('libraryCount').textContent"),'0');
  assert.match(await evaluate("document.getElementById('contestCalendar').textContent"), /Connect a contest platform/);
  assert.deepEqual(errors, []);
  console.log('PASS: AtCoder connection permission, actual collector with mock endpoints, ratings, totals, heatmap, daily count, Done, disconnect and responsive UI. Extension RPC is mocked.');
} finally {
  socket?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
