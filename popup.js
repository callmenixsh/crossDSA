import { mountContestStrip } from './tracker/contests/contest-ui.mjs';
import { STORAGE_KEY, PLATFORMS, normalizeState, practiceOverview, orderedPlatformIds } from './tracker/core.mjs';
import { appendTodayIncrease, solvedToday, appendTufActivityToday } from './tracker/ui/daily-count-ui.mjs';
import { DAILY_PAGES, dailyProblem, dailySolved, dailyDay, savedDailyStatus } from './tracker/daily.mjs';

const DEFAULT_PLATFORMS = ["leetcode", "geeksforgeeks", "codeforces", "codechef", "code360", "atcoder"];
const SEARCH_ENABLED_KEY = 'dsa-helper-visibility-enabled';
const PLATFORM_NAMES = {
  leetcode: "LeetCode",
  geeksforgeeks: "GeeksforGeeks",
  codeforces: "Codeforces",
  codechef: "CodeChef",
  code360: "Code 360",
  atcoder: "AtCoder",
};

function showStatus(message, type, duration = 2000) {
  const statusMessage = document.getElementById("statusMessage");
  if (!statusMessage) return;
  statusMessage.textContent = message;
  setTimeout(() => {
    if (statusMessage.isConnected && statusMessage.textContent === message) {
      statusMessage.textContent = "";
    }
  }, duration);
}

function updateToggleUI(isEnabled) {
  const toggleBtn = document.getElementById("toggleBtn");
  if (!toggleBtn) return;
  toggleBtn.classList.toggle("enabled", isEnabled);
  toggleBtn.setAttribute("aria-pressed", isEnabled.toString());
  const stateLabel = toggleBtn.querySelector(".toggle-state");
  if (stateLabel) stateLabel.textContent = isEnabled ? "On" : "Off";
  const card = toggleBtn.closest('.search-settings');
  card?.classList.toggle('search-disabled', !isEnabled);
  card?.querySelectorAll('.platform-check, #similaritySlider').forEach(control => {
    control.disabled = !isEnabled;
  });
  const platforms = document.getElementById('platformGrid');
  if (platforms) {
    platforms.querySelectorAll('.platform-check').forEach(control => { control.disabled = !isEnabled; });
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  mountContestStrip(document.getElementById('contestStrip')).catch(console.error);
  let trackerState = normalizeState();
  const dailyTargets = {}, dailyAttempts = new Set();
  const automaticDaily = {};
  function loadDailyStatus(platform) {
    const account = trackerState.accounts[platform];
    const day = dailyDay(platform), attempt = `${platform}:${day}`;
    if (['code360', 'tuf'].includes(platform)) {
      const key = `${platform}:${account.generation}:${account.handle}:${day}`;
      if (!dailyAttempts.has(key)) {
        dailyAttempts.add(key);
        chrome.runtime.sendMessage({ action: 'tracker:daily-status', platform }).then(result => {
          if (trackerState.accounts[platform]?.generation !== account.generation || trackerState.accounts[platform]?.handle !== account.handle || day !== dailyDay(platform)) return;
          automaticDaily[key] = result?.ok ? result.state : { ...savedDailyStatus(platform, trackerState.accounts[platform]), error: result?.error || `Could not check ${PLATFORMS[platform].name} POTD.` };
          renderChips();
        }).catch(() => {
          if (trackerState.accounts[platform]?.generation !== account.generation || trackerState.accounts[platform]?.handle !== account.handle || day !== dailyDay(platform)) return;
          automaticDaily[key] = { ...savedDailyStatus(platform, trackerState.accounts[platform]), error: `Open ${PLATFORMS[platform].name} signed in as the connected account to check POTD.` }; renderChips();
        });
      }
      return;
    }
    if (['leetcode', 'geeksforgeeks'].includes(platform) && !dailyAttempts.has(attempt)) {
      dailyAttempts.add(attempt);
      (async () => {
        const origin = platform === 'leetcode' ? 'https://leetcode.com/*' : 'https://practiceapi.geeksforgeeks.org/*';
        if (!await chrome.permissions.contains?.({ origins: [origin] })) return;
        dailyTargets[platform] = await dailyProblem(platform);
        renderChips();
      })().catch(() => {});
    }
  }
  let selectedPlatforms = [...DEFAULT_PLATFORMS];
  let matchThreshold = 0.4;
  let indexedProblems = [];
  let currentRandomProblem = null;
  let platformSignature = '';
  function eligiblePlatforms() { return selectedPlatforms.filter(id => trackerState.accounts[id]); }
  const refresh = document.getElementById('refreshOverview');
  function renderOverview() {
    const summary = practiceOverview(trackerState);
    const number = value => Number(value).toLocaleString();
    document.getElementById('overviewToday').textContent = number(summary.today);
    document.getElementById('overviewGoal').textContent = `OF ${summary.goal} TODAY`;
    document.getElementById('overviewRing').style.setProperty('--progress', `${Math.min(100, summary.today / summary.goal * 100)}%`);
    document.getElementById('overviewTotal').textContent = summary.total == null ? '\u2014' : `${summary.lowerBound ? '\u2265 ' : ''}${number(summary.total)}`;
    appendTodayIncrease(document.getElementById('overviewTotal'), summary.today, Boolean(summary.warning || summary.cachedActivity));
    renderChips();
    document.getElementById('overviewStreak').textContent = summary.streak == null ? '\u2014' : `${number(summary.streak)}d`;
    document.getElementById('overviewStreakLabel').textContent = summary.streakLabel.toUpperCase();
    const accounts = Object.values(trackerState.accounts);
    const oldest = Math.min(...accounts.map(account => account.syncedAt || 0));
    const failed = Object.entries(trackerState.accounts).filter(([, account]) => account.error).map(([id]) => PLATFORMS[id].name);
    const status = document.getElementById('overviewStatus');
    status.textContent = summary.syncing ? 'Refreshing...' : failed.length ? `Sync issue: ${failed.join(', ')}` : summary.warning ? 'Activity needs attention' : summary.cachedActivity ? 'Using saved submission history' : (accounts.length ? `Updated ${oldest ? new Date(oldest).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'never'}` : 'Connect a platform.');
    status.title = summary.error || summary.warning || summary.notice || status.textContent;
    refresh.disabled = summary.syncing || !accounts.length;
    document.getElementById('openDashboard').title = summary.error || summary.warning || summary.notice || 'Open your DSA dashboard';
  }
  async function refreshActivity(manual = false) {
    refresh.disabled = true;
    try {
      const candidates = Object.entries(trackerState.accounts).filter(([, account]) => manual || Date.now() - (account.attemptedAt || account.syncedAt || 0) >= 30 * 60000);
      for (const [platform] of candidates) {
        const result = await chrome.runtime.sendMessage({ action: 'tracker:sync', platform });
        if (!result?.ok) throw new Error(result?.error || 'Could not refresh activity.');
        trackerState = normalizeState(result.state);
      }
      renderOverview();
    } catch (error) { renderOverview(); document.getElementById('overviewStatus').textContent = 'Could not refresh activity'; document.getElementById('overviewStatus').title = error.message; }
  }
  refresh.addEventListener('click', () => {
    for (const platform of ['code360', 'tuf']) {
      const account = trackerState.accounts[platform];
      if (!account) continue;
      const key = `${platform}:${account.generation}:${account.handle}:${dailyDay(platform)}`;
      dailyAttempts.delete(key); delete automaticDaily[key];
    }
    renderChips();
    refreshActivity(true);
  });
  setInterval(renderOverview, 60000);
  const dailyStatus = document.getElementById('dailyStatus');
  async function openDaily(platform, button) {
    if (!trackerState.accounts[platform]) return;
    button.disabled = true;
    dailyStatus.textContent = '';
    try {
      if (platform === 'leetcode') {
        const granted = await chrome.permissions.request({ origins: ['https://leetcode.com/*'] });
        if (!granted) throw new Error('Allow LeetCode access to open its daily problem.');
        dailyTargets[platform] = await dailyProblem(platform);
        renderChips();
        await chrome.tabs.create({ url: dailyTargets[platform].url });
      } else {
        await chrome.tabs.create({ url: DAILY_PAGES[platform] });
      }
    } catch (error) {
      dailyStatus.textContent = error.name === 'TimeoutError' ? 'LeetCode took too long to respond. Try again.' : error.message;
    } finally { button.disabled = false; }
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STORAGE_KEY]) { trackerState = normalizeState(changes[STORAGE_KEY].newValue); renderOverview(); }
    if (area === 'local' && changes['dsa-preferred-platforms']) {
      selectedPlatforms = Array.isArray(changes['dsa-preferred-platforms'].newValue) ? changes['dsa-preferred-platforms'].newValue.filter(id => DEFAULT_PLATFORMS.includes(id)) : [...DEFAULT_PLATFORMS];
      renderChips();
    }
    if (area === 'local' && changes[SEARCH_ENABLED_KEY]) updateToggleUI(changes[SEARCH_ENABLED_KEY].newValue !== false);
  });
  chrome.storage.local.get(SEARCH_ENABLED_KEY).then(value => {
    updateToggleUI(value[SEARCH_ENABLED_KEY] !== false);
  }).catch(() => {});
  chrome.storage.local.get(STORAGE_KEY).then(value => {
    trackerState = normalizeState(value[STORAGE_KEY]); renderOverview();
    if (trackerState.settings.autoSync) refreshActivity();
  }).catch(error => { document.getElementById('overviewStatus').textContent = error.message; });

  for (const id of ['openDashboard', 'dashboardButton']) document.getElementById(id)?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
  });
  document.getElementById('openGithub')?.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://github.com/callmenixsh' });
  });
  document.getElementById('openSettings')?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html#settings') });
  });
  const similaritySlider = document.getElementById("similaritySlider");
  const similarityValue = document.getElementById("similarityValue");
  const thresholdLabel = document.getElementById("thresholdLabel");
  const thresholdMinLabel = document.getElementById("thresholdMinLabel");
  const thresholdMaxLabel = document.getElementById("thresholdMaxLabel");
  const toggleBtn = document.getElementById("toggleBtn");
  const problemCount = document.getElementById("problemCount");
  const platformGrid = document.getElementById("platformGrid");
  const randomPickBtn = document.getElementById("randomPickBtn");
  const randomResult = document.getElementById("randomResult");
  const randomTitle = document.getElementById("randomTitle");
  const randomMeta = document.getElementById("randomMeta");

  const requiredElements = [
    similaritySlider, similarityValue, toggleBtn, thresholdLabel,
    thresholdMinLabel, thresholdMaxLabel, problemCount, platformGrid,
    randomPickBtn, randomResult, randomTitle, randomMeta
  ];
  if (requiredElements.some((element) => !element)) return;

  const PROBLEM_DATA_FILES = {
    leetcode: "data/leetcode-data.json",
    geeksforgeeks: "data/geeksforgeeks-data.json",
    codeforces: "data/codeforces-data.json",
    codechef: "data/codechef-data.json",
    code360: "data/code360-data.json",
    atcoder: "data/atcoder-data.json",
  };

  // ---- Load total index size ------------------------------------------------
  async function loadProblemIndex() {
    problemCount.textContent = "…";
    try {
      const datasets = await Promise.all(
        Object.entries(PROBLEM_DATA_FILES).map(async ([source, file]) => {
          try {
            const response = await fetch(chrome.runtime.getURL(file));
            if (!response.ok) return [];
            const data = await response.json();
            if (!Array.isArray(data)) return [];
            return data
              .filter((problem) => problem?.title && problem?.url)
              .map((problem) => ({ ...problem, source: problem.source || source }));
          } catch {
            return [];
          }
        })
      );
      indexedProblems = datasets.flat();
      renderChips();
    } catch {
      problemCount.textContent = "—";
    }
  }

  // ---- Platform selection rendering ----------------------------------------
  function renderChips() {
    const ids = orderedPlatformIds(trackerState.settings).filter(id => trackerState.accounts[id]);
    const signature = ids.join(',');
    const grid = document.getElementById('platformGrid');
    if (signature !== platformSignature) {
      platformSignature = signature;
      grid.replaceChildren();
      for (const id of ids) {
        const row = document.createElement('div'); row.className = 'platform-row'; row.dataset.platform = id;
        const label = document.createElement('span'); label.className = 'platform-identity';
        if (DEFAULT_PLATFORMS.includes(id)) {
          const input = document.createElement('input'); input.type = 'checkbox'; input.className = 'platform-check';
          input.setAttribute('aria-label', `Search ${PLATFORMS[id].name}`);
          input.addEventListener('change', async () => {
            const previous = selectedPlatforms.slice();
            selectedPlatforms = input.checked ? [...new Set([...selectedPlatforms, id])] : selectedPlatforms.filter(p => p !== id);
            try { await persistPlatforms(); } catch { selectedPlatforms = previous; renderChips(); showStatus('Could not save platforms', 'error'); }
          });
          label.append(input);
        }
        const platformLink = document.createElement('a'); platformLink.className = 'platform-link';
        platformLink.textContent = PLATFORMS[id].name;
        platformLink.target = '_blank'; platformLink.rel = 'noopener noreferrer';
        platformLink.addEventListener('click', event => { event.preventDefault(); chrome.tabs.create({ url: platformLink.href }); });
        label.append(platformLink); row.append(label);
        if (DAILY_PAGES[id]) {
          const daily = document.createElement('button'); daily.className = 'daily-button'; daily.type = 'button';
          daily.id = id === 'geeksforgeeks' ? 'gfgDaily' : `${id}Daily`;
          daily.textContent = 'POTD \u2197'; daily.setAttribute('aria-label', `Open ${PLATFORMS[id].name} problem of the day`);
          daily.addEventListener('click', () => openDaily(id, daily)); row.append(daily);
        }
        const total = document.createElement('strong'); total.className = 'platform-total'; row.append(total); grid.append(row);
      }
    }
    for (const row of grid.children) {
      const id = row.dataset.platform, account = trackerState.accounts[id], total = row.querySelector('strong');
      const platformLink = row.querySelector('.platform-link');
      platformLink.href = PLATFORMS[id].profile(account.handle);
      platformLink.title = `Open ${account.handle}'s ${PLATFORMS[id].name} profile`;
      const daily = row.querySelector('.daily-button');
      if (daily) {
        loadDailyStatus(id);
        const usesAutomatic = ['code360', 'tuf'].includes(id);
        const automatic = usesAutomatic ? automaticDaily[`${id}:${account.generation}:${account.handle}:${dailyDay(id)}`] || savedDailyStatus(id, account) : null;
        const done = usesAutomatic ? automatic?.day === dailyDay(id) && automatic.done === true : dailySolved(id, trackerState, dailyTargets[id]);
        daily.classList.toggle('is-done', done);
        daily.textContent = done ? 'POTD \u2713' : 'POTD \u2197';
        daily.title = done ? 'Today\'s POTD is done' : 'Open today\'s problem of the day';
        if (id === 'code360') daily.title = automatic?.error || (done ? 'At least one of today\'s coding POTDs is complete (verified on Code360).' : automatic ? 'No coding POTD completed today (verified on Code360).' : 'Checking today\'s Code360 coding POTDs…');
        if (id === 'tuf') daily.title = automatic?.error || (done ? 'Today\'s DSA POTD is solved (verified on TakeUForward).' : automatic ? 'Today\'s DSA POTD is not solved yet (verified on TakeUForward).' : 'Checking today\'s TakeUForward DSA POTD…');
        if (usesAutomatic && done && automatic?.error) daily.title = `Today’s POTD is done (saved verification). ${automatic.error}`;
        daily.setAttribute('aria-label', `Open ${PLATFORMS[id].name} problem of the day${done ? ' (done)' : ''}`);

      }
      const input = row.querySelector('input');
      if (input) { input.checked = selectedPlatforms.includes(id); input.disabled = document.getElementById('toggleBtn').getAttribute('aria-pressed') !== 'true'; }
      row.classList.toggle('checked', Boolean(input?.checked));
      total.textContent = account.snapshot ? `${account.snapshot.totalIsLowerBound ? '\u2265 ' : ''}${Number(account.snapshot.totalSolved || 0).toLocaleString()}` : '\u2014';
      total.title = account.error || account.snapshot?.activityWarning || 'Solved questions';
      if (id === 'tuf') appendTufActivityToday(total, account);
      else appendTodayIncrease(total, solvedToday({ [id]: account }, trackerState.settings.timeZone), Boolean(account.snapshot?.activityWarning || account.snapshot?.activityStatus === 'cached'));
    }
    document.getElementById('connectPlatforms').hidden = ids.length > 0;
    document.querySelector('.search-settings').hidden = !ids.some(id => DEFAULT_PLATFORMS.includes(id));
    const eligible = eligiblePlatforms();
    problemCount.textContent = indexedProblems.filter(p => trackerState.accounts[p.source]).length.toLocaleString();
    randomPickBtn.disabled = !indexedProblems.some(p => eligible.includes(p.source));
    document.querySelector('.random-section').hidden = !eligible.length;
    if (currentRandomProblem && !eligible.includes(currentRandomProblem.source)) {
      currentRandomProblem = null; randomResult.hidden = true; randomPickBtn.textContent = 'Pick one';
    }
  }

  async function persistPlatforms() {
    await chrome.storage.local.set({ "dsa-preferred-platforms": selectedPlatforms });
    renderChips();
    showStatus("Platforms updated!", "success");
  }

  // ---- Match threshold ------------------------------------------------------
  function renderThreshold(value) {
    similarityValue.textContent = `${Math.round(value * 100)}%`;
    similaritySlider.setAttribute('aria-valuetext', `${Math.round(value * 100)} percent`);
    similaritySlider.style.setProperty('--match-progress', `${(value - Number(similaritySlider.min)) / (Number(similaritySlider.max) - Number(similaritySlider.min)) * 100}%`);
  }
  async function setThreshold(value) {
    await chrome.storage.local.set({ "dsa-helper-similarity-threshold": value });
    matchThreshold = value;
  }

  similaritySlider.addEventListener("input", (e) => {
    const value = parseFloat(e.target.value);
    renderThreshold(value);
  });

  similaritySlider.addEventListener("change", async (e) => {
    const value = parseFloat(e.target.value);
    try {
      await setThreshold(value);
      showStatus("Threshold updated!", "success");
    } catch (error) {
      similaritySlider.value = String(matchThreshold);
      renderThreshold(matchThreshold);
      showStatus("Could not save threshold", "error");
    }
  });

  randomPickBtn.addEventListener("click", () => {
    const eligibleProblems = indexedProblems.filter((problem) =>
      eligiblePlatforms().includes(problem.source)
    );
    if (!eligibleProblems.length) return;
    let nextProblem;
    do {
      nextProblem = eligibleProblems[Math.floor(Math.random() * eligibleProblems.length)];
    } while (eligibleProblems.length > 1 && nextProblem === currentRandomProblem);

    currentRandomProblem = nextProblem;
    randomTitle.textContent = nextProblem.title;
    randomMeta.textContent = [
      PLATFORM_NAMES[nextProblem.source] || nextProblem.source,
      nextProblem.difficulty || "Unknown",
      nextProblem.isPremium ? "Premium" : null,
    ].filter(Boolean).join(" · ");
    randomResult.hidden = false;
    randomResult.title = `Open ${nextProblem.title}`;
    randomPickBtn.textContent = "Pick another";
  });

  randomResult.addEventListener("click", () => {
    if (currentRandomProblem?.url) {
      try {
        const openTab = chrome.tabs.create({ url: currentRandomProblem.url });
        if (openTab?.catch) openTab.catch(() => {});
      } catch (e) {
      }
    }
  });

  // ---- Show/hide toggle -----------------------------------------------------
  toggleBtn.addEventListener("click", async () => {
    const enabled = toggleBtn.getAttribute('aria-pressed') !== 'true';
    toggleBtn.disabled = true;
    try {
      await chrome.storage.local.set({ [SEARCH_ENABLED_KEY]: enabled });
      updateToggleUI(enabled);
      showStatus(enabled ? "Search enabled everywhere" : "Search disabled everywhere", "success");
    } catch (e) {
      showStatus("Could not save search setting", "error");
    } finally {
      toggleBtn.disabled = false;
    }
  });

  // ---- Load persisted state ------------------------------------------------
  loadProblemIndex();

  try {
    const matchResponse = await chrome.runtime.sendMessage({ action: "getSimilarityThreshold" });
    if (typeof matchResponse?.value === "number") matchThreshold = matchResponse.value;
  } catch (e) {
  }
  similaritySlider.value = String(matchThreshold);
  renderThreshold(matchThreshold);

  try {
    const response = await chrome.runtime.sendMessage({ action: "getPreferredPlatforms" });
    if (response && Array.isArray(response.platforms)) {
      selectedPlatforms = response.platforms.filter((p) => DEFAULT_PLATFORMS.includes(p));
    }
  } catch (e) {
  }
  renderChips();

  showStatus("Extension ready!", "success");
});
