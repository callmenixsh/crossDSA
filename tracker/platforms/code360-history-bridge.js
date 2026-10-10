// Same-origin, cookie-authenticated reads. Never read or return cookies/tokens.
(() => {
  if (globalThis.__crossdsaCode360History) return;
  globalThis.__crossdsaCode360History = true;
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!['code360:history', 'code360:daily'].includes(message?.action)) return;
    if (sender.id !== chrome.runtime.id || sender.tab || !sender.url?.startsWith(chrome.runtime.getURL(''))) return;
    (async () => {
      const page = message.page ?? 1;
      if (!Number.isSafeInteger(page) || page < 1 || page > 1000000) throw new Error('Invalid Code360 history page.');
      const request = async path => {
        const response = await fetch(`/code360/api/${path}`, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error(`Code360 session request failed (${response.status}).`);
        return response.json();
      };
      const identity = async () => {
        const data = await request('v2/users/auth_details?naukri_request=true');
        const aliases = [data.data?.uuid, data.data?.screen_name].filter(v => typeof v === 'string' && /^[a-zA-Z0-9_.-]{1,100}$/.test(v)).map(v => v.toLowerCase());
        if (!aliases.includes(String(message.handle).toLowerCase())) throw new Error('Sign in to Code360 as the connected account to import solved history.');
        return { uuid: data.data.uuid, aliases };
      };
      const before = await identity();
      if (message.action === 'code360:daily') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(message.day || '')) throw new Error('Invalid Code360 POTD date.');
        const data = (await request(`v3/public_section/potd/problem_list?date=${message.day}&naukri_request=true`)).data;
        if (!data?.details || typeof data.details !== 'object') throw new Error('Code360 POTD status unavailable.');
        const after = await identity();
        if (!before.uuid || before.uuid !== after.uuid) throw new Error('Code360 account changed during POTD check.');
        const coding = ['EASY', 'MODERATE', 'HARD', 'NINJA'].map(level => data.details[level]).filter(item => item?.problem && item.is_current === true);
        if (!coding.length) throw new Error('Today\'s Code360 coding POTDs are unavailable.');
        return { handles: after.aliases, day: message.day, done: coding.some(item => item.evaluated === true ||
          (Number.isFinite(item.problem.max_score) && item.problem.max_score > 0 && item.problem.user_score === item.problem.max_score)) };
      }
      const data = (await request(`v3/public_section/profile/view_solved_problems?page=${page}&naukri_request=true`)).data;
      if (!Array.isArray(data?.problem_submissions) || data.problem_submissions.length > 1000 || !Number.isSafeInteger(data.total_pages) || data.total_pages < 0 || data.total_pages > 1000000) throw new Error('Code360 did not return paginated solved history.');
      const after = await identity();
      if (!before.uuid || before.uuid !== after.uuid) throw new Error('Code360 account changed during import.');
      // Only metadata from the explicitly solved coding list crosses the bridge.
      return { handles: after.aliases, page, totalPages: data.total_pages, rows: data.problem_submissions.map(row => ({
        link: typeof row.link === 'string' ? row.link.slice(0, 2000) : null,
        title: typeof row.problem_name === 'string' ? row.problem_name.slice(0, 300) : '',
        solvedAt: typeof row.solved_at === 'string' ? row.solved_at.slice(0, 100) : null,
      })) };
    })().then(data => sendResponse({ ok: true, ...data }), error => sendResponse({ ok: false, error: error.message }));
    return true;
  });
})();
