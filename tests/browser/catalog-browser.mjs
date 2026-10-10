// UI checks with real local datasets and mocked extension RPC, in an isolated browser.
// Launch a dedicated headless Chromium profile with --remote-debugging-port=9476 first.
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
    const type = path.endsWith('.mjs') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.json') ? 'application/json' : 'text/html';
    res.writeHead(200, { 'Content-Type': type }); res.end(await readFile(path));
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let socket;
try {
  const targets = await (await fetch(process.env.CROSSDSA_CATALOG_CDP || 'http://127.0.0.1:9476/json/list')).json();
  const target = targets.find(t => t.type === 'page' && (t.url === 'about:blank' || /^http:\/\/127\.0\.0\.1:\d+\/dashboard.html#(?:questions|companies.*)$/.test(t.url)));
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
    const state = {version:1,accounts:Object.fromEntries(['leetcode','geeksforgeeks','code360'].map(platform=>[platform,{handle:'catalog-test',status:'ready',syncedAt:Date.now(),snapshot:{totalSolved:0,recent:[]}}])),workspace:{},lists:{saved:{id:'saved',name:'Starred'}},settings:{dailyGoal:2,timeZone:'Asia/Calcutta',autoSync:false}};
    window.testState=state; window.chrome = {runtime:{onMessage:{addListener:()=>{}},getURL:path=>'/'+path,sendMessage:async message=>{
      if(message.action==='tracker:question-state') {
        const entry={...message.entry,...state.workspace[message.entry.key],updatedAt:Date.now()};
        if('done' in message.patch) throw new Error('Done is automatic');
        if('starred' in message.patch) entry.listIds=message.patch.starred?[...new Set([...(entry.listIds||[]),'saved'])]:(entry.listIds||[]).filter(id=>id!=='saved');
        state.workspace[entry.key]=entry;
      }
      return {ok:true,state};
    }},storage:{onChanged:{addListener:()=>{}}}};
  ` });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/dashboard.html#questions` });
  await until("document.querySelector('.question-row')");
  assert.match(await evaluate("document.getElementById('catalogSummary').textContent"), /[\d,]+ unique questions · [\d,]+ across platforms/);

  await evaluate("document.getElementById('questionSearch').value=\"Kadane's Algorithm\";document.getElementById('questionSearch').dispatchEvent(new Event('input'))");
  await until("document.querySelector('#questionList .question-title')?.textContent==='Maximum Subarray'");
  assert.equal(await evaluate("document.querySelectorAll('#questionList .question-row').length"),1);
  const libraryTagStyle = await evaluate("(()=>{const s=getComputedStyle(document.querySelector('#questionList .topic-tag'));return [s.padding,s.border,s.backgroundColor,s.fontSize]})()");
  assert.deepEqual(await evaluate("[...document.querySelectorAll('#questionList .solve-on-link')].map(n=>n.dataset.platform).sort()"), ['geeksforgeeks','leetcode']);
  assert.equal(await evaluate("document.querySelector('.question-details, .question-version-picker')"), null);
  const savedKey = await evaluate("document.querySelector('#questionList .solve-on-link[data-platform=leetcode]').href");
  await evaluate("document.querySelector('#questionList .question-star').click()");
  await until("document.querySelector('#questionList .question-star').getAttribute('aria-pressed')==='true'");
  assert.ok(await evaluate("Object.keys(testState.workspace).every(k=>!k.startsWith('q_'))"));
  assert.equal(await evaluate("document.querySelector('.question-done')"), null);
  assert.equal(await evaluate("document.querySelector('#questionList .question-row').classList.contains('is-done')"), false);
  await evaluate(`(async()=>{
    const {problemKey}=await import('/tracker/core.mjs');
    const anchor=document.querySelector('#questionList .solve-on-link[data-platform=geeksforgeeks]');
    const key=problemKey('geeksforgeeks',anchor.href);
    testState.accounts.geeksforgeeks.snapshot.solved={[key]:{key,platform:'geeksforgeeks',title:"Kadane's Algorithm",url:anchor.href,source:'provider'}};
    for(const p of Object.values(testState.workspace))p.done=false;
    document.getElementById('questionSearch').dispatchEvent(new Event('input'));
  })()`);
  await until("document.querySelector('#questionList .solved-tag')");
  assert.deepEqual(await evaluate("[...document.querySelectorAll('#questionList .solve-on-link.is-solved')].map(a=>a.dataset.platform)"), ['geeksforgeeks']);
  await evaluate("location.hash='workspace'");
  await until("document.querySelector('#workspaceList .workspace-row')?.classList.contains('is-done')");
  assert.equal(await evaluate("!!document.querySelector('#workspaceList .solved-tag')"), true, 'Saved native question follows its normalized sibling automatically');
  await evaluate("location.hash='questions'");
  await until("!document.getElementById('view-questions').hidden");
  await evaluate("document.getElementById('questionStatus').value='unsolved';document.getElementById('questionStatus').dispatchEvent(new Event('change'))");
  assert.equal(await evaluate("document.querySelectorAll('#questionList .question-row').length"),0);
  await evaluate("document.getElementById('questionStatus').value='all';document.getElementById('questionStatus').dispatchEvent(new Event('change'))");
  await evaluate("location.hash='done'");
  await until("document.querySelector('#doneList .solve-on-link')");
  assert.equal(await evaluate("document.querySelector('#doneList .solve-on-label').textContent"),'Also on');
  assert.ok(await evaluate("(()=>{const row=document.querySelector('#doneList .recent-row'),title=row.querySelector('.done-title').getBoundingClientRect(),links=row.querySelector('.solve-on').getBoundingClientRect();return Math.abs((title.top+title.bottom)/2-(links.top+links.bottom)/2)<2 && row.getBoundingClientRect().height<80})()"),'Done alternatives sit beside the title in a compact desktop row');
  assert.ok(await evaluate("(()=>{const platform='geeksforgeeks';return [...document.querySelectorAll('#doneList .solve-on-link')].every(a=>a.dataset.platform!==platform && a.href.startsWith('https://'))})()"));
  await evaluate("location.hash='questions'");
  for (const width of [1440,1000,768,390]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),`No overflow at ${width}px`);
    assert.ok(await evaluate("[...document.querySelectorAll('#questionList .solve-on-link')].every(n=>n.getBoundingClientRect().width>0)"));
    if(width===1440 || width===390) {
      const {data}=await send('Page.captureScreenshot',{format:'png'});
      const path=join(tmpdir(),`crossdsa-catalog-${width}.png`);await writeFile(path,Buffer.from(data,'base64'));console.log(path);
    }
  }
  await evaluate("location.hash='done'");
  await until("document.querySelector('#doneList .solve-on-link')");
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'Done alternatives fit mobile');
  const {data:donePreview}=await send('Page.captureScreenshot',{format:'png'});
  const donePath=join(tmpdir(),'crossdsa-done-alternatives.png');await writeFile(donePath,Buffer.from(donePreview,'base64'));console.log(donePath);
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await evaluate("location.hash='companies'");
  await until("document.querySelector('.company-card')");
  await evaluate("document.getElementById('companySearch').value='amazon';document.getElementById('companySearch').dispatchEvent(new Event('input'));document.querySelector('.company-card').click()");
  await until("document.querySelector('#companyQuestionList .question-row')");
  await evaluate("document.getElementById('companyQuestionSearch').value=\"Kadane's Algorithm\";document.getElementById('companyQuestionSearch').dispatchEvent(new Event('input'))");
  await until("document.querySelector('#companyQuestionList .question-title')?.textContent==='Maximum Subarray'");
  assert.equal(await evaluate("document.querySelectorAll('#companyQuestionList .question-row').length"),1);
  assert.equal(await evaluate("document.querySelectorAll('#companyQuestionList .solve-on-link').length"),2);
  assert.deepEqual(await evaluate("(()=>{const s=getComputedStyle(document.querySelector('#companyQuestionList .topic-tag'));return [s.padding,s.border,s.backgroundColor,s.fontSize]})()"),libraryTagStyle,'Company topic chips use the library styling');
  const contentSource = (await readFile(join(root, 'content.js'), 'utf8')).replace(/init\(\);\s*$/, '');
  const loaded = await evaluate(`(async()=>{${contentSource}\nawait loadProblemsData();window.testMatchCards=['confirmed','platform-variant','similar'].map(matchType=>createLeetCodeButton({title:'Add Two Numbers',difficulty:'Medium',topics:['Linked List'],url:'https://leetcode.com/problems/add-two-numbers/',combinedScore:1,matchType}));return {records:problemsData.length,shared:problemsData.filter(p=>p.canonicalId).length};})()`);
  assert.equal(loaded.records,30269);
  assert.ok(loaded.shared>300, 'The content script loads compact mappings through its real dynamic module import');
  await evaluate(`(async()=>{
    const frame=document.createElement('iframe');frame.id='match-preview';frame.style='position:fixed;right:20px;top:20px;width:480px;height:480px;z-index:20000;border:0';document.body.append(frame);
    const doc=frame.contentDocument,css=doc.createElement('link');css.rel='stylesheet';css.href=location.origin+'/content.css';
    await new Promise(resolve=>{css.onload=resolve;doc.head.append(css)});
    const container=doc.createElement('div');container.id='dsa-helper-container';container.style='position:static;width:100%;max-height:none;animation:none';
    container.append(...testMatchCards);doc.body.style='margin:0';doc.body.append(container);
  })()`);
  for(const theme of ['light','dark']) {
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});
    const cards=await evaluate("(()=>{const w=document.getElementById('match-preview').contentWindow;return [...w.document.querySelectorAll('.dsa-helper-btn')].map(n=>({background:w.getComputedStyle(n).backgroundColor,left:w.getComputedStyle(n).borderLeftWidth,label:n.querySelector('.confirmed-match-label')?.textContent||null}))})()");
    assert.notEqual(cards[0].background,cards[2].background,`Confirmed match stands out in ${theme} theme`);
    assert.equal(cards[0].left,'4px');
    assert.equal(cards[0].label,'✓ Same question');
    assert.equal(cards[1].label,'✓ Same question · Platform variant');
    assert.equal(cards[2].label,null,'Fuzzy suggestions never receive the confirmed label');
  }
  const {data:preview}=await send('Page.captureScreenshot',{format:'png'});
  const previewPath=join(tmpdir(),'crossdsa-confirmed-matches.png');await writeFile(previewPath,Buffer.from(preview,'base64'));console.log(previewPath);
  assert.deepEqual(errors,[]);
  console.log('PASS: catalog totals, library/company tag parity, Done alternatives, confirmed match emphasis in both themes, native saved/done keys and responsive Solve on links. RPC mocked.');
} finally {
  socket?.close(); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));
}
