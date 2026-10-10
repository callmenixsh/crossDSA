export const TUF_HEADER_PERMISSION = 'declarativeNetRequestWithHostAccess';
export const TUF_HEADER_RULE_ID = 73001;

export function tufHeaderRule(extensionId) {
  return {
    id: TUF_HEADER_RULE_ID, priority: 1,
    action: { type: 'modifyHeaders', requestHeaders: [
      { header: 'Origin', operation: 'set', value: 'https://takeuforward.org' },
      { header: 'Referer', operation: 'set', value: 'https://takeuforward.org/' },
    ] },
    condition: {
      regexFilter: '^https://backend-go[.]takeuforward[.]org/api/v2/profile/[a-zA-Z0-9_.%~-]+(/heatmap([?]platform=TUF(&year=20[0-9]{2})?)?)?$',
      initiatorDomains: [extensionId], requestDomains: ['backend-go.takeuforward.org'],
      requestMethods: ['get'], resourceTypes: ['xmlhttprequest'],
    },
  };
}

export async function configureTufRequests(browser = chrome) {
  if (!browser.declarativeNetRequest?.updateSessionRules || !await browser.permissions.contains({ permissions: [TUF_HEADER_PERMISSION] })) return false;
  await browser.declarativeNetRequest.updateSessionRules({ removeRuleIds: [TUF_HEADER_RULE_ID], addRules: [tufHeaderRule(browser.runtime.id)] });
  return true;
}

export async function clearTufRequests(browser = chrome) {
  if (browser.declarativeNetRequest?.updateSessionRules && await browser.permissions.contains({ permissions: [TUF_HEADER_PERMISSION] })) await browser.declarativeNetRequest.updateSessionRules({ removeRuleIds: [TUF_HEADER_RULE_ID] });
}
