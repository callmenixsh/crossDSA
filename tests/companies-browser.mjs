// UI checks with real local datasets and mocked extension RPC, in an isolated browser.
// Launch a dedicated headless Edge profile with --remote-debugging-port=9341 first.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, sep, join } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '..');
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
  const targets = await (await fetch(process.env.CROSSDSA_COMPANIES_CDP || 'http://127.0.0.1:9341/json/list')).json();
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
    window.chrome = {runtime:{getURL:path=>'/'+path,sendMessage:async message=>{
      if(message.action==='tracker:list:create') state.lists.custom={id:'custom',name:message.name};
      if(message.action==='tracker:workspace') state.workspace[message.entry.key]={...state.workspace[message.entry.key],...message.entry,listIds:[...message.entry.listIds,...(state.workspace[message.entry.key]?.listIds?.includes('saved')?['saved']:[])]};
      if(message.action==='tracker:question-state') {
        const entry={...message.entry,...state.workspace[message.entry.key],updatedAt:Date.now()};
        if('done' in message.patch) entry.done=message.patch.done;
        if('starred' in message.patch) entry.listIds=message.patch.starred?['saved']:[];
        state.workspace[entry.key]=entry;
      }
      return {ok:true,state};
    }},storage:{onChanged:{addListener:()=>{}}}};
  ` });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/dashboard.html#companies` });
  await until("document.querySelectorAll('.company-card').length > 600");
  assert.ok(await evaluate("document.getElementById('companySnapshot').textContent.includes('2026-07-12')"));
  assert.equal(await evaluate("document.querySelector('[data-view=companies]').getAttribute('aria-current')"), 'page');
  await evaluate("document.querySelector('[data-category=\"Big Tech\"]').click()");
  assert.ok(await evaluate("[...document.querySelectorAll('.company-card')].some(c=>c.textContent.includes('Amazon'))"));
  assert.equal(await evaluate("document.querySelectorAll('.company-group').length"), 1);
  await evaluate("document.querySelector('[data-category=all]').click();document.getElementById('companySearch').value='facebook';document.getElementById('companySearch').dispatchEvent(new Event('input'))");
  assert.equal(await evaluate("document.querySelectorAll('.company-card').length"), 1);
  assert.ok(await evaluate("document.querySelector('.company-card').textContent.includes('Meta')"));
  await evaluate("document.getElementById('companySearch').value='amazon';document.getElementById('companySearch').dispatchEvent(new Event('input'));document.querySelector('.company-card').click()");
  await until("!document.getElementById('companyDetail').hidden && document.querySelector('#companyQuestionList .question-row')");
  assert.ok(await evaluate("document.getElementById('companyGrid').hidden"));
  assert.equal(await evaluate("document.getElementById('companyTitle').textContent"), 'Amazon');
  assert.ok(await evaluate("(() => {const scores=[...document.querySelectorAll('#companyQuestionList .company-frequency')].map(n=>parseFloat(n.textContent));return scores.every((n,i)=>i===0||scores[i-1]>=n)})()"));
  await evaluate("document.getElementById('companyQuestionSearch').value='two sum';document.getElementById('companyQuestionSearch').dispatchEvent(new Event('input'))");
  assert.ok(await evaluate("[...document.querySelectorAll('#companyQuestionList .question-title')].some(n=>n.textContent==='Two Sum')"));
  await evaluate("document.querySelector('#companyQuestionList [data-key=\"leetcode:two-sum\"] .question-star').click()");
  await until("document.querySelector('#companyQuestionList [data-key=\"leetcode:two-sum\"] .question-star').getAttribute('aria-pressed')==='true'");
  await evaluate("document.querySelector('#companyQuestionList [data-key=\"leetcode:two-sum\"] .question-done input').click()");
  await until("document.querySelector('#companyQuestionList [data-key=\"leetcode:two-sum\"] .solved-tag')");
  await evaluate("document.getElementById('companyProgress').value='unsolved';document.getElementById('companyProgress').dispatchEvent(new Event('change'))");
  assert.equal(await evaluate("document.querySelector('#companyQuestionList [data-key=\"leetcode:two-sum\"]')"), null);
  await evaluate("document.getElementById('companyProgress').value='starred';document.getElementById('companyProgress').dispatchEvent(new Event('change'))");
  assert.equal(await evaluate("document.querySelectorAll('#companyQuestionList .question-row').length"), 1);
  await evaluate("document.querySelector('#companyQuestionList .question-list-button').click();document.getElementById('inlineListName').value='Company practice';document.getElementById('inlineCreateList').click()");
  await until("document.querySelector('#problemLists input')");
  await evaluate("document.getElementById('practiceForm').requestSubmit(document.querySelector('#practiceForm button[type=submit]'))");
  await until("!document.getElementById('practiceDialog').open");
  assert.ok(await evaluate("document.querySelector('#companyQuestionList .question-star').getAttribute('aria-pressed')==='true'"));
  assert.equal(await evaluate("document.querySelector('#companyQuestionList .selected-list-count').textContent"), '1');
  await evaluate("document.querySelector('#companyDetail>a').click()");
  await until("!document.getElementById('companyDirectory').hidden");
  assert.equal(await evaluate("document.getElementById('companySearch').value"), 'amazon');
  assert.equal(await evaluate("document.querySelectorAll('.company-card').length"), 1);
  await evaluate("document.querySelector('.company-card').click()");
  await until("!document.getElementById('companyDetail').hidden");
  assert.equal(await evaluate("document.getElementById('companyProgress').value"), 'starred');
  await evaluate("document.getElementById('companyClear').click();document.getElementById('companyWindow').value='30d';document.getElementById('companyWindow').dispatchEvent(new Event('change'))");
  assert.ok(await evaluate("document.getElementById('companyDetailSummary').textContent.includes('Last 30 days')"));
  await evaluate("document.getElementById('companyWindow').value='all';document.getElementById('companyWindow').dispatchEvent(new Event('change'));document.getElementById('companyNext').click()");
  assert.ok(await evaluate("document.getElementById('companyPageLabel').textContent.startsWith('2 /')"));
  await evaluate("document.getElementById('companyDifficulty').value='Hard';document.getElementById('companyDifficulty').dispatchEvent(new Event('change'))");
  assert.ok(await evaluate("[...document.querySelectorAll('#companyQuestionList .question-row>.difficulty')].every(n=>n.textContent==='Hard')"));
  const screenshot = async name => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    const path = join(tmpdir(), name); await writeFile(path, Buffer.from(data, 'base64')); console.log(path);
  };
  for (const width of [1440, 1000, 768, 390]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'), `Detail fits at ${width}px`);
  }
  await screenshot('crossdsa-company-detail-mobile.png');
  await evaluate("location.hash='companies'"); await until("!document.getElementById('companyDirectory').hidden");
  await evaluate("document.getElementById('companySearch').value='';document.getElementById('companySearch').dispatchEvent(new Event('input'))");
  for (const width of [390, 768, 1000, 1440]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'), `Directory fits at ${width}px`);
    if (width === 390 || width === 1440) await screenshot(`crossdsa-companies-${width}.png`);
  }
  await evaluate("location.hash='questions'"); await until("!document.getElementById('view-questions').hidden");
  assert.ok(await evaluate("document.querySelector('#questionList [data-key=\"leetcode:two-sum\"] .question-done input').checked"));
  assert.ok(await evaluate("document.querySelector('#questionList [data-key=\"leetcode:two-sum\"] .question-star').getAttribute('aria-pressed')==='true'"));
  await evaluate("location.hash='companies/not-a-company'"); await until("!document.getElementById('companyMissing').hidden");
  await evaluate("location.hash='companies/amazon'"); await until("document.getElementById('companyTitle').textContent==='Amazon'");
  await evaluate("document.getElementById('companyPlatform').value='code360';document.getElementById('companyPlatform').dispatchEvent(new Event('change'));document.getElementById('companyClear').click()");
  assert.ok(await evaluate("document.getElementById('companyWindowLabel').hidden"));
  assert.equal(await evaluate("document.querySelectorAll('#companyQuestionList .company-frequency').length"), 0);
  assert.ok(await evaluate("[...document.querySelectorAll('#companyQuestionList .question-row')].every(n=>n.dataset.key.startsWith('code360:'))"));
  assert.ok(await evaluate("[...document.querySelectorAll('#companyQuestionList .topic-tag')].every(n=>!['Amazon','Microsoft','Google inc'].includes(n.textContent))"));
  assert.ok(await evaluate("[...document.querySelectorAll('#companyQuestionList .company-platform-tag')].every(n=>n.textContent==='Code360')"));
  const code360Key = await evaluate("document.querySelector('#companyQuestionList .question-row').dataset.key");
  await evaluate("document.querySelector('#companyQuestionList .question-done input').click()");
  await until("document.querySelector('#companyQuestionList .solved-tag')");
  await evaluate("document.querySelector('#companyQuestionList .question-star').click()");
  await until("document.querySelector('#companyQuestionList .question-star').getAttribute('aria-pressed')==='true'");
  await evaluate("document.getElementById('companyProgress').value='solved';document.getElementById('companyProgress').dispatchEvent(new Event('change'))");
  assert.equal(await evaluate("document.querySelectorAll('#companyQuestionList .question-row').length"), 1);
  assert.equal(await evaluate("document.querySelector('#companyQuestionList .question-row').dataset.key"), code360Key);
  await evaluate("document.getElementById('companyClear').click();document.getElementById('companyPlatform').value='all';document.getElementById('companyPlatform').dispatchEvent(new Event('change'))");
  assert.ok(await evaluate("document.getElementById('companyDetailSummary').textContent.includes('LeetCode + Code360')"));
  await evaluate("document.getElementById('companyWindow').value='30d';document.getElementById('companyWindow').dispatchEvent(new Event('change'))");
  assert.equal(await evaluate("document.getElementById('companyPlatform').value"), 'leetcode');
  assert.ok(await evaluate("[...document.querySelectorAll('#companyQuestionList .question-row')].every(n=>n.dataset.key.startsWith('leetcode:'))"));
  await evaluate("document.getElementById('companyPlatform').value='code360';document.getElementById('companyPlatform').dispatchEvent(new Event('change'));location.hash='companies'");
  await until("!document.getElementById('companyDirectory').hidden");
  assert.equal(await evaluate("document.getElementById('companyWindow').value"), 'all');
  await evaluate("document.getElementById('companySearch').value='Google inc';document.getElementById('companySearch').dispatchEvent(new Event('input'))");
  assert.equal(await evaluate("document.querySelectorAll('.company-card').length"), 1);
  assert.equal(await evaluate("document.querySelector('.company-card').getAttribute('href')"), '#companies/google');
  for (const width of [1440, 390]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'), `Code360 fits at ${width}px`);
  }
  assert.deepEqual(errors, []);
  console.log('PASS: company data, categories, aliases, time windows, sorting, pagination, shared Done/Star/lists, back navigation, unknown company, desktop and mobile. RPC is mocked.');
} finally {
  socket?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
