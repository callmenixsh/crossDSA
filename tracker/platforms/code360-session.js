// Observe Code360's own account lookup. Never read credentials or export the
// response: only the public UUID and screen name cross into the isolated script.
(() => {
  if (globalThis.__crossdsaCode360Session) return;
  globalThis.__crossdsaCode360Session = true;
  let handles = null, epoch = 0;
  const publish = () => window.postMessage({ source: 'crossdsa:code360-session', handles }, location.origin);
  function kind(input) {
    try {
      const url = new URL(input, location.href);
      if (url.origin !== location.origin) return null;
      if (/\/api\/v2\/users\/auth_details\/?$/.test(url.pathname)) return 'identity';
      if (/\/api\/v2\/users\/(?:logout|login)\/?$/.test(url.pathname)) return 'reset';
    } catch { /* Ignore unrelated requests. */ }
    return null;
  }
  function reset() { epoch++; handles = []; publish(); }
  function accept(data, requestEpoch) {
    if (requestEpoch !== epoch) return;
    const user = data?.data;
    handles = [...new Set([user?.uuid, user?.screen_name].filter(v => typeof v === 'string' && /^[a-zA-Z0-9_.-]{1,100}$/.test(v)).map(v => v.toLowerCase()))];
    publish();
  }
  window.addEventListener('message', event => {
    if (event.source === window && event.origin === location.origin && event.data?.source === 'crossdsa:code360-session-request') publish();
  });
  const originalFetch = window.fetch;
  if (originalFetch) window.fetch = function (...args) {
    const type = kind(typeof args[0] === 'string' || args[0] instanceof URL ? args[0] : args[0]?.url);
    if (type) reset();
    const requestEpoch = epoch;
    const result = Reflect.apply(originalFetch, this, args);
    if (type === 'identity') result.then(response => {
      if (response.ok) response.clone().json().then(data => accept(data, requestEpoch)).catch(() => {});
    }).catch(() => {});
    return result;
  };
  const requests = new WeakMap(), proto = window.XMLHttpRequest?.prototype;
  if (!proto) return;
  const originalOpen = proto.open, originalSend = proto.send;
  proto.open = function (method, url, ...rest) {
    requests.set(this, kind(url));
    return Reflect.apply(originalOpen, this, [method, url, ...rest]);
  };
  proto.send = function (...args) {
    const type = requests.get(this);
    if (type) reset();
    const requestEpoch = epoch;
    if (type === 'identity') this.addEventListener('load', () => {
      try {
        if (this.status < 200 || this.status >= 300) return;
        if (this.responseType === 'json') accept(this.response, requestEpoch);
        else if (!this.responseType || this.responseType === 'text') {
          if (this.responseText.length < 1000000) accept(JSON.parse(this.responseText), requestEpoch);
        }
      } catch { /* Leave identity unknown on malformed responses. */ }
    }, { once: true });
    return Reflect.apply(originalSend, this, args);
  };
})();
