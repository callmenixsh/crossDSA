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
  const target = targets.find(t => t.type === 'page' && (t.url === 'about:blank' || /^http:\/\/127\.0\.0\.1:\d+\/dashboard.html#questions$/.test(t.url)));
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
  await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/dashboard.html#questions` });
  await until("document.querySelector('.question-details')");
  const checkTopicLayout = async () => {
    const layout = await evaluate(`(() => {
      const row=document.querySelector('.topic-choice'), input=row.querySelector('input'), text=row.querySelector('span'), count=row.querySelector('small');
      const r=row.getBoundingClientRect(), i=input.getBoundingClientRect(), t=text.getBoundingClientRect(), c=count.getBoundingClientRect();
      return {checkboxWidth:i.width, checkboxOffset:i.left-r.left, labelGap:t.left-i.right, countInside:c.right<=r.right, textWidth:t.width};
    })()`);
    assert.equal(layout.checkboxWidth, 14, 'Topic checkbox stays compact');
    assert.ok(layout.checkboxOffset < 10, 'Checkbox aligns with the left edge');
    assert.ok(layout.labelGap >= 8 && layout.labelGap <= 10, 'Label sits beside checkbox');
    assert.ok(layout.textWidth > 150 && layout.countInside, 'Topic label has room and count fits');
  };
  await evaluate("document.getElementById('topicPicker').open=true");
  await checkTopicLayout();
  await evaluate("document.getElementById('topicPicker').open=false");
  assert.equal(await evaluate("document.querySelector('.question-excerpt, .question-platform')"), null);
  await evaluate("document.querySelector('.question-details summary').click()");
  assert.ok(await evaluate("document.querySelector('.question-details[open]').textContent.includes('Constraints / input')"));
  await evaluate("document.querySelector('.question-star').click()");
  await until("document.querySelector('.question-star').getAttribute('aria-pressed')==='true'");
  assert.ok(await evaluate("!!document.querySelector('.question-details[open]')"), 'Open statement survives state updates');
  await evaluate("document.getElementById('questionStatus').value='starred';document.getElementById('questionStatus').dispatchEvent(new Event('change'))");
  assert.equal(await evaluate("document.querySelectorAll('.question-row').length"), 1);
  await evaluate("document.querySelector('.question-done input').click()");
  await until("document.querySelector('.question-tags').textContent.includes('Solved')");
  await evaluate("document.getElementById('questionStatus').value='unsolved';document.getElementById('questionStatus').dispatchEvent(new Event('change'))");
  assert.equal(await evaluate("!!document.querySelector('.question-row[data-key=\"leetcode:two-sum\"]')"), false);
  await evaluate("document.getElementById('resetQuestions').click();document.querySelector('.topic-tag').click()");
  assert.equal(await evaluate("document.querySelectorAll('#activeQuestionFilters button').length"), 1);
  await evaluate("document.getElementById('topicPicker').open=true;document.getElementById('topicSearch').value='hash';document.getElementById('topicSearch').dispatchEvent(new Event('input'))");
  assert.ok(await evaluate("[...document.querySelectorAll('.topic-choice')].every(n=>n.textContent.toLowerCase().includes('hash'))"));
  await evaluate("document.querySelector('.topic-choice input').focus();document.querySelector('.topic-choice input').click()");
  assert.equal(await evaluate("document.getElementById('topicSummary').textContent"), 'Topics · 2 selected');
  assert.ok(await evaluate("[...document.querySelectorAll('.question-row')].some(row=>[...row.querySelectorAll('.topic-tag')].some(tag=>tag.textContent==='Array') && ![...row.querySelectorAll('.topic-tag')].some(tag=>tag.textContent==='Hash Table'))"), 'Multiple topics include questions matching either selection');
  assert.ok(await evaluate("document.activeElement.matches('.topic-choice input')"), 'Topic selection keeps keyboard focus');
  await evaluate("document.getElementById('resetQuestions').click();document.getElementById('questionSearch').value='two sum';document.getElementById('questionSearch').dispatchEvent(new Event('input'))");
  await until("document.querySelector('#activeQuestionFilters button')?.textContent.includes('two sum')");
  assert.equal(await evaluate("document.querySelector('.question-title').textContent"), 'Two Sum');
  assert.ok(await evaluate("![...document.querySelectorAll('.question-title')].some(n=>['Add Two Numbers','3Sum','3Sum Closest','4Sum'].includes(n.textContent))"), 'Search excludes unrelated statement matches');
  await evaluate("document.getElementById('resetQuestions').click();document.getElementById('topicPicker').open=false");
  const screenshot = async name => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    const path = join(tmpdir(), name); await writeFile(path, Buffer.from(data, 'base64')); console.log(path);
  };
  await screenshot('crossdsa-library-desktop.png');
  for (const width of [1000, 768, 390]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'), `No page overflow at ${width}px`);
    if (width === 390) {
      await screenshot('crossdsa-library-mobile.png');
      await evaluate("document.getElementById('topicPicker').open=true");
      await checkTopicLayout();
      assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'), 'Open topic picker fits mobile');
    }
  }
  await evaluate("document.getElementById('resetQuestions').click();document.getElementById('questionPlatform').value='atcoder';document.getElementById('questionPlatform').dispatchEvent(new Event('change'));document.getElementById('questionSearch').value='dp_a';document.getElementById('questionSearch').dispatchEvent(new Event('input'));document.getElementById('topicPicker').open=false");
  await until("document.querySelector('.question-row')?.dataset.key==='atcoder:dp_a' && document.querySelector('.question-title').textContent==='Frog 1'");
  assert.match(await evaluate("document.querySelector('.question-details').textContent"), /frog/i);
  assert.doesNotMatch(await evaluate("document.querySelector('#questionList .question-tags').textContent"), /Estimated difficulty/, 'Tasks without an estimate do not invent one');
  await evaluate("document.querySelector('#questionList .question-star').click()");
  await until("document.querySelector('#questionList .question-star').getAttribute('aria-pressed')==='true'");
  await evaluate("document.querySelector('#questionList .question-done input').click()");
  await until("document.querySelector('#questionList .question-tags').textContent.includes('Solved')");
  await evaluate("location.hash='done'");
  await until("document.querySelector('#doneList .recent-row')?.textContent.includes('Frog 1')");
  assert.match(await evaluate("document.getElementById('doneList').textContent"), /AtCoder/);
  await evaluate(`location.hash='questions';document.getElementById('questionSearch').value=${JSON.stringify(estimatedTask.id)};document.getElementById('questionSearch').dispatchEvent(new Event('input'))`);
  await until(`document.querySelector('.question-row')?.dataset.key===${JSON.stringify('atcoder:' + estimatedTask.id)}`);
  assert.match(await evaluate("document.querySelector('#questionList .question-tags').textContent"), /Estimated difficulty/);
  assert.deepEqual(errors, []);
  console.log('PASS: statements, expansion, state updates, status, topic combinations, keyboard focus, search, responsive layout and AtCoder browse/star/done. RPC is mocked.');
} finally {
  socket?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
