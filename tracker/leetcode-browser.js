// Isolated-world listener: observe accepted metadata through the signed-in tab.
// Never read editor contents or pass credentials to the extension worker.
(() => {
  if (globalThis.__crossdsaBrowserAccepts) return;
  globalThis.__crossdsaBrowserAccepts = true;
  let active = null;
  const request = async path => {
    const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Submission status unavailable');
    return response.json();
  };
  const signedInUser = async () => {
    const data = await request('/graphql?query=' + encodeURIComponent('query { userStatus { isSignedIn username } }'));
    return data.data?.userStatus;
  };
  document.addEventListener('click', event => {
    const control = event.target?.closest?.('button, [role="button"], input[type="submit"]');
    if (!control || control.closest('#dsa-helper-container')) return;
    const label = `${control.textContent || ''} ${control.getAttribute('aria-label') || ''} ${control.value || ''}`;
    const slug = location.pathname.match(/^\/problems\/([^/]+)/)?.[1];
    if (!slug || !/\bsubmit\b/i.test(label)) return;
    const attempt = { slug, started: Date.now() };
    active = attempt;
    (async () => {
      const stored = await chrome.storage.local.get('crossdsa-tracker-v1');
      const account = stored['crossdsa-tracker-v1']?.accounts?.leetcode;
      if (!account) return;
      const user = await signedInUser();
      if (!user?.isSignedIn || user.username?.toLowerCase() !== account.handle.toLowerCase()) return;
      const known = new Set((account.snapshot?.recent || []).map(r => r.id));
      for (let poll = 0; poll < 45 && active === attempt; poll++) {
        await new Promise(resolve => setTimeout(resolve, poll ? 2000 : 800));
        if (active !== attempt) return;
        const data = await request('/api/submissions/?offset=0&limit=20&lastkey=');
        const accepted = (data.submissions_dump || []).filter(item =>
          item.title_slug === slug && (item.status_display === 'Accepted' || Number(item.status) === 10) &&
          Number(item.timestamp) >= Math.floor(attempt.started / 1000) && !known.has(`leetcode:${item.id}`));
        if (!accepted.length) continue;
        // Recheck identity before attributing the result, including account changes in another tab.
        const current = await signedInUser();
        if (!current?.isSignedIn || current.username?.toLowerCase() !== account.handle.toLowerCase()) return;
        for (const item of accepted) {
          await chrome.runtime.sendMessage({ action: 'tracker:accepted', platform: 'leetcode', handle: account.handle, generation: account.generation,
            submission: { id: String(item.id), title: item.title, slug, timestamp: Number(item.timestamp) * 1000 } });
        }
        return;
      }
    })().catch(() => { /* Existing scheduled sync remains the fallback. */ });
  }, true);
})();
