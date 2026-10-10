// Optional, read-only smoke check against public sample accounts.
// Uses Windows curl's certificate store; no login, tokens, or local storage.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { collectors } from '../tracker/platforms.mjs';
const exec = promisify(execFile);
async function request(url, options = {}, text = false, origin) {
  const args = ['-sS', '--fail', '--compressed', '--max-time', '25', '-A', 'Mozilla/5.0', url];
  if (options.body) args.push('-H', 'Content-Type: application/json', '--data-raw', options.body);
  if (origin) args.push('-H', `Origin: ${origin}`, '-H', `Referer: ${origin}/`);
  const { stdout } = await exec('curl.exe', args, { maxBuffer: 12 * 1024 * 1024, windowsHide: true });
  return text ? stdout : JSON.parse(stdout);
}
const ctx = { json: (url, options) => request(url, options, false, url.startsWith('https://backend-go.takeuforward.org/') ? 'https://takeuforward.org' : undefined), text: (url, options) => request(url, options, true) };
const samples = { leetcode: 'lee215', codeforces: 'MikeMirzayanov', codechef: 'uwi', geeksforgeeks: 'arnoob16', code360: '1ccafe76-59cf-423a-8fe2-12c9deccb93f', tuf: 'vv73' };
let failed = false;
for (const [platform, handle] of Object.entries(samples)) {
  try {
    const data = await collectors[platform](handle, ctx);
    console.log(JSON.stringify({ platform, totalSolved: data.totalSolved, acceptedRecords: data.recent.length, calendarDays: Object.keys(data.calendar || {}).length, partial: data.partial, rating: data.rating }));
  } catch (error) { failed = true; console.error(`${platform}: ${error.message}`); }
}
if (failed) process.exitCode = 1;
