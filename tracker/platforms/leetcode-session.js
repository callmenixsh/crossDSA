// Fixed same-origin reads; credentials stay inside the LeetCode tab.
(() => {
if (globalThis.__crossdsaLeetcodeSessionInstalled) return;
globalThis.__crossdsaLeetcodeSessionInstalled = true;
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!['leetcode:recent', 'leetcode:history', 'leetcode:problem'].includes(message?.action)) return;
  if (sender.id !== chrome.runtime.id || sender.tab || (sender.url && !sender.url.startsWith(chrome.runtime.getURL('')))) return;
  (async () => {
    const request = async path => {
      const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`LeetCode session request failed (${response.status}).`);
      return response.json();
    };
    const status = await request('/graphql?query=' + encodeURIComponent('query { userStatus { isSignedIn username } }'));
    const user = status.data?.userStatus;
    if (!user?.isSignedIn) throw new Error('Sign in to LeetCode to import your accepted questions.');
    if (user.username?.toLowerCase() !== String(message.handle).toLowerCase()) throw new Error(`Sign in to LeetCode as @${message.handle} to import this account's accepted questions.`);
    if (message.action !== 'leetcode:recent') {
      const offset = message.offset ?? 0;
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000000) throw new Error('Invalid history offset.');
      if (message.action === 'leetcode:problem' && !/^[a-zA-Z0-9-]{1,200}$/.test(message.slug)) throw new Error('Invalid problem.');
      const path = message.action === 'leetcode:problem' ? `/api/submissions/${message.slug}/?offset=0&limit=20&lastkey=` : `/api/submissions/?offset=${offset}&limit=20&lastkey=`;
      const data = await request(path);
      if (!Array.isArray(data.submissions_dump)) throw new Error('LeetCode did not return submission history.');
      const current = (await request('/graphql?query=' + encodeURIComponent('query { userStatus { isSignedIn username } }'))).data?.userStatus;
      if (!current?.isSignedIn || current.username?.toLowerCase() !== user.username.toLowerCase()) throw new Error('LeetCode account changed during import.');
      const submissions = data.submissions_dump.filter(item => (item.status_display === 'Accepted' || Number(item.status) === 10) && (message.action !== 'leetcode:problem' || item.title_slug === message.slug)).map(item => ({ id: item.id, title: item.title, titleSlug: item.title_slug, timestamp: item.timestamp }));
      return { username: current.username, submissions, count: data.submissions_dump.length, hasNext: Boolean(data.has_next) };
    }
    const submissions = [];
    for (let page = 0; page < 5; page++) {
      const data = await request(`/api/submissions/?offset=${page * 20}&limit=20&lastkey=`);
      if (!Array.isArray(data.submissions_dump)) throw new Error('LeetCode did not return submission history.');
      // Return accepted metadata only; never return source code, cookies or tokens.
      for (const item of data.submissions_dump) {
        if (item.status_display === 'Accepted' || Number(item.status) === 10) submissions.push({
          id: item.id, title: item.title, titleSlug: item.title_slug, timestamp: item.timestamp,
        });
      }
      const oldest = data.submissions_dump.at(-1);
      if (!data.has_next || !oldest || Number(oldest.timestamp) * 1000 < Date.now() - 2 * 86400000) break;
    }
    return { username: user.username, submissions };
  })().then(data => sendResponse({ ok: true, ...data }), error => sendResponse({ ok: false, error: error.message }));
  return true;
});
})();
