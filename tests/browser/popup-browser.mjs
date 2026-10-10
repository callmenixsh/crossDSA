// UI checks with real local datasets and mocked extension RPC, in an isolated browser.
// Launch a dedicated headless Edge profile with --remote-debugging-port=9334 first.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, sep, join } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '../..');
const server = createServer(async (req, res) => {
  const path = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
  try {
    const type = /\.(mjs|js)$/.test(path) ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.json') ? 'application/json' : 'text/html';
    const contents = await readFile(path);
    res.writeHead(200, { 'Content-Type': type }); res.end(contents);
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
    const now = Date.now();
    const day = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
    const dailyHistory = {[day]:{handle:'test',done:true,verifiedAt:now}};
    const state = {version:1, accounts:{
      leetcode:{handle:'test',syncedAt:now,status:'ready',snapshot:{totalSolved:243,recent:[1,2,3].map(id=>({key:'leetcode:'+id,timestamp:now}))}},
      codeforces:{handle:'test',syncedAt:now,status:'ready',snapshot:{totalSolved:81,recent:[{key:'codeforces:1',timestamp:now}]}},
      code360:{handle:'test',generation:'360',dailyHistory,syncedAt:now,status:'ready',snapshot:{totalSolved:50,recent:[],activityWarning:'Dated activity unavailable'}}
    },settings:{timeZone:'UTC',dailyGoal:5,autoSync:false,contestsEnabled:false}};
    window.openedTabs=[];window.allowAccess=true;
    const listeners=[];
    window.chrome={runtime:{getURL:path=>'/'+path,sendMessage:async message=>message.action==='tracker:daily-status'?{ok:false,error:'Site tab closed'}:message.action==='getPreferredPlatforms'?{platforms:['leetcode','codeforces']}:{value:.4}},
      storage:{onChanged:{addListener:fn=>listeners.push(fn)},local:{get:async()=>({'crossdsa-tracker-v1':state}),set:async values=>{window.lastWrite=values;}}},
      tabs:{create:async tab=>{openedTabs.push(tab);return tab;}},permissions:{request:async()=>window.allowAccess,contains:async()=>true}};
    window.notify=()=>listeners.forEach(fn=>fn({'crossdsa-tracker-v1':{newValue:state}},'local'));
    window.resetActivity=()=>{state.accounts.leetcode.snapshot.recent=[];notify();};
    window.cacheActivity=()=>{state.accounts.leetcode.snapshot.activityStatus='cached';notify();};
    window.solveDaily=()=>{state.accounts.leetcode.snapshot.recent.push({key:'leetcode:two-sum',timestamp:Date.now()});notify();};
    window.failSync=()=>{state.accounts.code360.error='Platform request failed (404). Try again later.';state.accounts.tuf.error='Open TakeUForward in a browser tab, then sync again. Its API requires requests from its own website.';notify();};
    window.connectGfg=()=>{state.accounts.geeksforgeeks={snapshot:{totalSolved:10,recent:[]}};notify();};
    window.connectTuf=()=>{state.accounts.tuf={handle:'test',generation:'tuf',dailyHistory,snapshot:{totalSolved:12,recent:[],calendar:{[day]:3}}};notify();};
    window.changeDailyAccount=()=>{state.accounts.code360={handle:'other',generation:'new',snapshot:{totalSolved:2,recent:[]}};notify();};
    window.reorder=()=>{state.settings.platformOrder=['code360','codeforces','leetcode'];notify();};
    window.disconnectAll=()=>{state.accounts={};notify();};
    const originalFetch=window.fetch;
    window.fetch=(url,options)=>url==='https://leetcode.com/graphql'?Promise.resolve({ok:true,json:async()=>({data:{activeDailyCodingChallengeQuestion:{link:'/problems/two-sum/'}}})}):String(url).includes('practiceapi.geeksforgeeks.org')?Promise.resolve({ok:false}):originalFetch(url,options);
  ` });
  await send('Emulation.setDeviceMetricsOverride', { width:336, height:800, deviceScaleFactor:1, mobile:false });
  await send('Page.navigate', { url:`http://127.0.0.1:${server.address().port}/popup.html` });
  await until("document.querySelectorAll('.platform-row').length===3 && !document.getElementById('randomPickBtn').disabled");
  assert.equal(await evaluate("document.getElementById('overviewTotal').firstChild.textContent"),'374');
  assert.equal(await evaluate("document.querySelector('#overviewTotal sup').textContent"),'\u21914');
  assert.deepEqual(await evaluate("[...document.querySelectorAll('#platformGrid strong')].map(n=>n.textContent)"),['243\u21913','81\u21911','50']);
  for (const scheme of ['light','dark']) {
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:scheme}]});
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,scheme+' popup fits');
    assert.equal(await evaluate("[...document.querySelectorAll('.platform-row')].every(row=>row.scrollWidth<=row.clientWidth)"),true);
    const {data}=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
    await writeFile(join(tmpdir(),`crossdsa-popup-counts-${scheme}.png`),Buffer.from(data,'base64'));
  }
  await evaluate("document.getElementById('leetcodeDaily').click()");
  await until('openedTabs.length===1');
  assert.equal(await evaluate('openedTabs[0].url'),'https://leetcode.com/problems/two-sum/');
  assert.equal(await evaluate("document.getElementById('gfgDaily')===null"),true, 'Disconnected GFG has no POTD');
  assert.equal(await evaluate("document.querySelectorAll('.search-settings input[type=checkbox]').length"),0);
  assert.equal(await evaluate("document.querySelector('[data-platform=leetcode] .platform-identity').nextElementSibling.id"),'leetcodeDaily');
  await evaluate("document.querySelector('[data-platform=leetcode] input').click()");
  assert.deepEqual(await evaluate('lastWrite["dsa-preferred-platforms"]'),['codeforces']);
  assert.equal(await evaluate("document.querySelectorAll('.platform-row').length"),3,'Unchecked platform retains its stats');
  await evaluate("document.getElementById('toggleBtn').click()");
  assert.equal(await evaluate("document.querySelector('[data-platform=leetcode] input').disabled"),true);
  assert.equal(await evaluate("document.getElementById('leetcodeDaily').disabled"),false,'POTD remains usable with Search off');
  await evaluate("connectGfg();document.getElementById('gfgDaily').click();document.getElementById('openSettings').click()");
  assert.equal(await evaluate('openedTabs[1].url'),'https://www.geeksforgeeks.org/problem-of-the-day');
  assert.equal(await evaluate('openedTabs[2].url'),'/dashboard.html#settings');
  await evaluate("window.allowAccess=false;document.getElementById('leetcodeDaily').click()");
  await until("document.getElementById('dailyStatus').textContent.includes('Allow LeetCode')");
  assert.equal(await evaluate('openedTabs.length'),3);
  await evaluate('resetActivity()');
  assert.equal(await evaluate("document.querySelector('#platformGrid strong').querySelector('sup')===null"),true);
  assert.equal(await evaluate("document.querySelector('#overviewTotal sup').textContent"),'\u21911');
  await evaluate('reorder()');
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.platform-row')].map(row=>row.dataset.platform)"),['code360','codeforces','leetcode','geeksforgeeks']);
  await evaluate("connectTuf();document.getElementById('tufDaily').click();document.getElementById('code360Daily').click()");
  assert.deepEqual(await evaluate('openedTabs.slice(-2).map(tab=>tab.url)'), ['https://takeuforward.org/potd','https://www.naukri.com/code360/problem-of-the-day']);
  assert.equal(await evaluate("document.querySelector('[data-platform=tuf] .platform-identity').nextElementSibling.id"), 'tufDaily');
  assert.equal(await evaluate("document.getElementById('dashboardLink')===null"), true);
  const checkedBefore = await evaluate("document.querySelector('[data-platform=leetcode] input').checked");
  await evaluate("document.querySelector('[data-platform=leetcode] .platform-link').click();document.getElementById('dashboardButton').click();document.getElementById('openGithub').click()");
  assert.deepEqual(await evaluate('openedTabs.slice(-3).map(tab=>tab.url)'), ['https://leetcode.com/u/test/','/dashboard.html','https://github.com/callmenixsh']);
  assert.equal(await evaluate("document.querySelector('[data-platform=leetcode] input').checked"), checkedBefore, 'Opening a platform preserves search selection');
  assert.equal(await evaluate("document.getElementById('leetcodeDaily').classList.contains('is-done')"), false);
  await evaluate('solveDaily()');
  assert.equal(await evaluate("document.getElementById('leetcodeDaily').textContent"), 'POTD \u2713');
  await until("document.getElementById('code360Daily').classList.contains('is-done')");
  await until("document.getElementById('tufDaily').classList.contains('is-done')");
  assert.equal(await evaluate("document.getElementById('overviewToday').textContent"), '5');
  assert.equal(await evaluate("document.querySelector('#overviewTotal sup').textContent"), '\u21915');
  await evaluate('cacheActivity()');
  assert.equal(await evaluate("document.getElementById('overviewToday').textContent"), '5', 'Cached LeetCode keeps a plain count');
  assert.match(await evaluate("document.getElementById('code360Daily').title"), /saved verification/);
  assert.equal(await evaluate("document.querySelector('[data-platform=tuf] .today-increase').textContent"), '\u21913');
  assert.match(await evaluate("document.querySelector('[data-platform=tuf] sup').title"), /TUF calendar activity/);
  assert.equal(await evaluate("document.getElementById('code360Daily').disabled"), false, 'Completed POTD can still be opened');
  await evaluate('changeDailyAccount()');
  await until("!document.getElementById('code360Daily').classList.contains('is-done')");
  await evaluate('failSync()');
  assert.equal(await evaluate("document.getElementById('overviewToday').textContent"), '5', 'Sync failures keep a plain count');
  assert.equal(await evaluate("document.getElementById('overviewStatus').textContent"), 'Sync issue: Code 360, TakeUForward');
  assert.match(await evaluate("document.getElementById('overviewStatus').title"), /404/);
  assert.ok(await evaluate("document.getElementById('overviewStatus').getBoundingClientRect().height<=15"), 'Sync errors stay on one line');
  await evaluate('disconnectAll()');
  assert.equal(await evaluate("document.querySelectorAll('.platform-row').length"),0);
  assert.equal(await evaluate("document.getElementById('connectPlatforms').hidden"),false);
  assert.equal(await evaluate("document.querySelector('.search-settings').hidden"),true);
  assert.equal(await evaluate("document.querySelector('.random-section').hidden"),true);
  assert.equal(await evaluate("document.getElementById('problemCount').textContent"),'0');
  await send('Page.reload');
  await until("document.getElementById('code360Daily')?.classList.contains('is-done')");
  assert.deepEqual(errors,[]);
  console.log('PASS: popup platform totals, today superscripts, live storage updates, light/dark sizing, POTD targets, permission decline and Settings navigation (mocked extension API).');
} finally {socket?.close();server.close();}
