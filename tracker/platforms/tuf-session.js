// Read only authenticated metadata; browser cookies remain inside the site tab.
(() => {
  if (globalThis.__crossdsaTufSession) return;
  globalThis.__crossdsaTufSession = true;
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.action !== 'tuf:daily') return;
    if (sender.id !== chrome.runtime.id || sender.tab || !sender.url?.startsWith(chrome.runtime.getURL(''))) return;
    (async () => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(message.day || '')) throw new Error('Invalid TUF POTD day.');
      const request = async path => {
        const response = await fetch(`https://backend-go.takeuforward.org/api${path}`, {
          credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw new Error(`TUF session request failed (${response.status}).`);
        const body = await response.json();
        if (body.success !== true || !body.data) throw new Error('TUF session data unavailable.');
        return body.data;
      };
      const identity = async () => {
        const user = await request('/v1/auth/me');
        if (user.logged_in !== true || typeof user.username !== 'string' || user.username.toLowerCase() !== String(message.handle).toLowerCase()) throw new Error('Sign in to TakeUForward as the connected account to check POTD.');
        return user.username.toLowerCase();
      };
      const before = await identity();
      const data = await request('/v1/potd/today?track=dsa');
      const dayId = Number(message.day.replaceAll('-', ''));
      if (data.day_id !== dayId || !Array.isArray(data.tracks)) throw new Error('TUF POTD is updating. Try again.');
      const target = data.tracks.find(item => item.track_slug === 'dsa' && item.day_id === dayId && item.problem?.type === 'dsa');
      if (!target || !['not_started', 'attempted', 'solved', 'missed'].includes(target.user_status)) throw new Error('Today\'s TUF DSA POTD status is unavailable.');
      if (await identity() !== before) throw new Error('TUF account changed during POTD check.');
      return { handles: [before], day: message.day, done: target.user_status === 'solved' };
    })().then(data => sendResponse({ ok: true, ...data }), error => sendResponse({ ok: false, error: error.message }));
    return true;
  });
})();
