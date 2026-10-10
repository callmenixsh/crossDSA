import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TUF_HEADER_PERMISSION, TUF_HEADER_RULE_ID, tufHeaderRule, configureTufRequests, clearTufRequests } from '../tracker/tuf-network.mjs';

test('TUF headers apply only to extension-initiated public profile GETs', () => {
  const rule = tufHeaderRule('extension-id'), match = new RegExp(rule.condition.regexFilter);
  assert.deepEqual(rule.condition.initiatorDomains, ['extension-id']);
  assert.deepEqual(rule.condition.requestDomains, ['backend-go.takeuforward.org']);
  assert.deepEqual(rule.condition.requestMethods, ['get']);
  assert.deepEqual(rule.condition.resourceTypes, ['xmlhttprequest']);
  for (const url of ['https://backend-go.takeuforward.org/api/v2/profile/sample', 'https://backend-go.takeuforward.org/api/v2/profile/sample/heatmap?platform=TUF&year=2026']) assert.equal(match.test(url), true);
  for (const url of ['https://evil.test/api/v2/profile/sample', 'https://backend-go.takeuforward.org/api/v2/submissions', 'https://backend-go.takeuforward.org/api/v2/profile/sample/heatmap?platform=All', 'https://backend-go.takeuforward.org/api/v2/profile/sample?token=secret']) assert.equal(match.test(url), false);
  assert.deepEqual(rule.action.requestHeaders.map(h => h.header), ['Origin', 'Referer']);
});

test('TUF network rules require permission and are removed on disconnect', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  assert.ok(manifest.permissions.includes(TUF_HEADER_PERMISSION), 'Existing connections receive the header capability on reload');
  assert.ok(!manifest.optional_permissions.includes(TUF_HEADER_PERMISSION));
  const changes = []; let allowed = false;
  const browser = { runtime: { id: 'extension-id' }, permissions: { contains: async request => { assert.deepEqual(request.permissions, [TUF_HEADER_PERMISSION]); return allowed; } }, declarativeNetRequest: { updateSessionRules: async options => changes.push(options) } };
  assert.equal(await configureTufRequests(browser), false); assert.equal(changes.length, 0);
  allowed = true;
  assert.equal(await configureTufRequests(browser), true);
  assert.deepEqual(changes[0].removeRuleIds, [TUF_HEADER_RULE_ID]);
  assert.deepEqual(changes[0].addRules, [tufHeaderRule('extension-id')]);
  await clearTufRequests(browser);
  assert.deepEqual(changes[1], { removeRuleIds: [TUF_HEADER_RULE_ID] });
  assert.equal(await configureTufRequests({ permissions: browser.permissions }), false);
});
