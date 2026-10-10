// Observe explicit status on problem pages. Never infer acceptance from Submit.
// Page observations supply solved identity only, never a fabricated activity date.
(() => {
  if (globalThis.__crossdsaSolvedBrowser) return;
  globalThis.__crossdsaSolvedBrowser = true;
  const sites = {
    'leetcode.com': ['leetcode', /^\/u\/([^/]+)\/?$/],
    'codeforces.com': ['codeforces', /^\/profile\/([^/]+)\/?$/],
    'www.codechef.com': ['codechef', /^\/users\/([^/]+)\/?$/],
    'www.geeksforgeeks.org': ['geeksforgeeks', /^\/profile\/([^/]+)\/?$/],
    'www.naukri.com': ['code360', /^\/code360\/profile\/([^/]+)\/?$/],
    'atcoder.jp': ['atcoder', /^\/users\/([^/]+)\/?$/],
  };
  const site = sites[location.hostname];
  if (!site) return;
  const [platform, profilePath] = site;
  let timer, scanning = false, rerun = false, lastUrl = '', lastGeneration = '', sent = '';
  let sessionHandles = null;
  function identityMatches(handle) {
    // The authenticated API response is available even when Code360's menu is
    // closed, and exposes both UUID and screen-name aliases for the same user.
    if (platform === 'code360' && sessionHandles !== null) return sessionHandles.includes(handle.toLowerCase());
    const handles = new Set();
    // Restrict identity to navigation/user menus, never statement/profile mentions.
    const navigation = 'header a[href], nav a[href], [data-testid="user-menu"] a[href]';
    // Code360 uses custom Angular navigation elements and detached menu overlays.
    const code360Navigation = ', codingninjas-header a[href], codingninjas-codestudio-navbar a[href], .mat-menu-panel a[href], .mat-mdc-menu-panel a[href]';
    for (const anchor of document.querySelectorAll(navigation + (platform === 'code360' ? code360Navigation : ''))) {
      try {
        const url = new URL(anchor.href, location.href), match = url.pathname.match(profilePath);
        if (url.origin === location.origin && match) handles.add(decodeURIComponent(match[1]).toLowerCase());
      } catch { /* Ignore malformed links. */ }
    }
    return handles.size === 1 && handles.has(handle.toLowerCase());
  }
  function evidence() {
    // Status elements only: "accepted" in an editorial or statement proves nothing.
    // Only the current submission's verdict: sample-run test cases and other
    // users' submissions also display "Correct Answer" on Code360.
    const selector = platform === 'code360'
      ? 'ninjas-problems-ui-code-current-submission .status-header'
      : '[data-testid="submission-result"], [data-testid="submission-status"], [data-testid="problem-status"], [data-e2e-locator="submission-result"], .submission-result, .submission-status, .verdict, .result-status, .problem-status, .problem-solved, [aria-label="Solved"], [title="Solved"]';
    for (const node of document.querySelectorAll(selector)) {
      if (node.closest('#dsa-helper-container') || node.closest('table') || !node.getClientRects().length) continue;
      const text = (node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent || '').trim();
      if (platform === 'code360' && /^(?:correct answer|passed)$/i.test(text)) return 'accepted';
      if (/^(?:accepted|correct answer|all test cases passed)(?:\s*[!✓✔])?$/i.test(text)) return 'accepted';
      if (/^(?:solved|problem solved|already solved)(?:\s*[!✓✔])?$/i.test(text)) return 'solved';
    }
    return null;
  }
  async function scan() {
    if (scanning) { rerun = true; return; }
    if (!chrome.runtime?.id) return;
    scanning = true;
    try {
      const stored = await chrome.storage.local.get('crossdsa-tracker-v1');
      const state = stored['crossdsa-tracker-v1'], account = state?.accounts?.[platform];
      if (!account) return;
      const url = location.href;
      if (url !== lastUrl || account.generation !== lastGeneration) {
        lastUrl = url; lastGeneration = account.generation; sent = '';
        await chrome.runtime.sendMessage({ action: 'tracker:page', platform });
      }
      // LeetCode uses account-verified API reads and its dedicated acceptance watcher.
      if (platform === 'leetcode' || !identityMatches(account.handle)) return;
      const status = evidence();
      if (!status || sent === `${url}:${account.generation}`) return;
      const current = (await chrome.storage.local.get('crossdsa-tracker-v1'))['crossdsa-tracker-v1']?.accounts?.[platform];
      if (location.href !== url || current?.generation !== account.generation || !identityMatches(account.handle)) return;
      const title = document.querySelector('h1')?.textContent?.trim() || document.title;
      const result = await chrome.runtime.sendMessage({ action: 'tracker:solved-observed', handle: account.handle, generation: account.generation, evidence: status, entry: { platform, url, title } });
      if (result?.ok) sent = `${url}:${account.generation}`;
    } catch { /* Missing identity/status is unknown; a later scan may succeed. */ }
    finally { scanning = false; if (rerun) { rerun = false; schedule(); } }
  }
  const schedule = () => { if (!timer) timer = setTimeout(() => { timer = null; return scan(); }, 750); };
  if (platform === 'code360') {
    addEventListener('message', event => {
      if (event.source !== window || event.origin !== location.origin || event.data?.source !== 'crossdsa:code360-session' || !Array.isArray(event.data.handles)) return;
      sessionHandles = event.data.handles.filter(v => typeof v === 'string' && /^[a-zA-Z0-9_.-]{1,100}$/.test(v)).map(v => v.toLowerCase());
      schedule();
    });
    window.postMessage({ source: 'crossdsa:code360-session-request' }, location.origin);
  }
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label', 'title', 'data-status', 'class'], characterData: true });
  addEventListener('popstate', schedule);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { lastUrl = ''; schedule(); } });
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes['crossdsa-tracker-v1']) schedule(); });
  document.addEventListener('click', event => {
    const control = event.target?.closest?.('button, [role="button"], input[type="submit"]');
    if (!control || control.closest('#dsa-helper-container') || !/\bsubmit\b/i.test(`${control.textContent || ''} ${control.getAttribute('aria-label') || ''} ${control.value || ''}`)) return;
    // These checks only refresh provider data. Acceptance still needs evidence.
    setTimeout(() => chrome.runtime.sendMessage({ action: 'tracker:page', platform, submitted: true }).catch(() => {}), 3000);
  }, true);
  schedule();
})();
