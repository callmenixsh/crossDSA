import { mountContestStrip } from './tracker/contest-ui.mjs';
import { CONTEST_ORIGINS } from './tracker/contests.mjs';
import { ratingSeries } from './tracker/ratings.mjs';
import { filterLibrary } from './tracker/library.mjs';
import { mountCompanies } from './tracker/company-ui.mjs';
import { splitCode360Tags } from './tracker/code360-companies.mjs';
import { STORAGE_KEY, PLATFORMS, emptyState, normalizeState, cleanHandle, problemKey, dateKey, shiftDay, dailyActivity, streaks, acceptedToday, practiceOverview, safeProblemUrl, doneQuestions, questionIsDone } from './tracker/core.mjs';

const $ = id => document.getElementById(id);
let state = emptyState(), library = [], filtered = [], page = 0, activeProblem = null, indexReady = false;
const PAGE_SIZE = 50;
let toastTimer;
let donePage = 0;
let listDraft = new Set();
const selectedTopics = new Set();
function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== '') node.textContent = String(text);
  return node;
}
function link(text, href, className = '') {
  const node = el('a', className, text); node.href = href; node.target = '_blank'; node.rel = 'noopener noreferrer'; return node;
}
function button(text, className, handler) {
  const node = el('button', className, text); node.type = 'button'; node.addEventListener('click', handler); return node;
}
function empty(title) {
  const node = el('div', 'empty-state'); node.append(el('strong', '', title)); return node;
}
function format(value) { return Number(value || 0).toLocaleString(); }
function today() { return dateKey(Date.now(), state.settings.timeZone); }
function displayDate(timestamp, options = {}) {
  return new Intl.DateTimeFormat(undefined, { timeZone: state.settings.timeZone, month: 'short', day: 'numeric', ...options }).format(new Date(timestamp));
}
function timeAgo(timestamp) {
  if (!timestamp) return 'Not synced yet';
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  return minutes < 1 ? 'Updated just now' : minutes < 60 ? `Updated ${minutes}m ago` : minutes < 1440 ? `Updated ${Math.floor(minutes / 60)}h ago` : `Updated ${Math.floor(minutes / 1440)}d ago`;
}
function toast(message, error = false) {
  $('toast').textContent = message; $('toast').classList.toggle('error', error); $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 9000 : 4000);
}
async function rpc(action, payload = {}) {
  const result = await chrome.runtime.sendMessage({ action: `tracker:${action}`, ...payload });
  if (!result?.ok) throw new Error(result?.error || 'The extension is unavailable. Reload the extension and this page.');
  if (result.state) state = normalizeState(result.state);
  return state;
}
function route() {
  const view = location.hash.slice(1).split('/')[0] || 'overview';
  const known = ['overview', 'questions', 'companies', 'done', 'workspace', 'contests', 'settings'].includes(view) ? view : 'overview';
  for (const node of document.querySelectorAll('.view')) node.hidden = node.id !== `view-${known}`;
  for (const node of document.querySelectorAll('[data-view]')) { node.classList.toggle('active', node.dataset.view === known); if (node.dataset.view === known) node.setAttribute('aria-current', 'page'); else node.removeAttribute('aria-current'); }
  $('breadcrumb').textContent = { overview: 'Overview', questions: 'Question library', companies: 'Companies', done: 'Done Questions', workspace: 'My lists', contests: 'Contests', settings: 'Settings' }[known];
  if (known === 'done') renderDone();
  if (known === 'workspace') renderWorkspace();
  if (known === 'questions') renderQuestions();
  if (known === 'companies') companyPage.render();
}
function render() {
  if (indexReady) updateLibraryCount();
  $('savedCount').textContent = format(Object.values(state.workspace).filter(v => v.listIds?.length).length);
  $('todayLabel').textContent = displayDate(Date.now(), { weekday: 'short', year: 'numeric' });
  const accounts = Object.values(state.accounts), snapshots = accounts.filter(a => a.snapshot);
  $('solvedTotal').textContent = snapshots.length ? `${snapshots.some(a => a.snapshot.totalIsLowerBound) ? '≥ ' : ''}${format(snapshots.reduce((sum, a) => sum + a.snapshot.totalSolved, 0))}` : '—';
  $('solvedTotal').title = 'Total across platforms';
  const accepted = acceptedToday(state.accounts, today(), state.settings.timeZone);
  const activityWarning = practiceOverview(state).warning;
  $('goalCount').textContent = activityWarning ? accepted ? `${accepted}+` : '—' : accepted;
  $('goalRing').title = activityWarning || 'Accepted problems today, including browser-observed accepts';
  $('goalRing').style.setProperty('--progress', `${Math.min(100, accepted / state.settings.dailyGoal * 100)}%`);
  $('goalCaption').textContent = `of ${state.settings.dailyGoal} accepted problems`;
  const counts = dailyActivity(state.accounts, state.settings.timeZone);
  const streak = streaks(counts, today());
  $('currentStreak').textContent = streak.current;
  $('longestStreak').textContent = `Best: ${streak.longest} days`;
  const busy = accounts.filter(a => a.status === 'syncing').length;
  const failures = accounts.filter(a => a.status === 'error').length;
  $('syncSummary').textContent = busy ? `Syncing ${busy} platform${busy === 1 ? '' : 's'}…` : failures ? `${failures} connection${failures === 1 ? '' : 's'} need attention` : '';
  $('syncSummary').hidden = !busy && !failures;
  $('syncAll').disabled = Boolean(busy) || !accounts.length;
  $('syncAll').textContent = busy ? `↻ Syncing ${busy}…` : '↻ Sync activity';
  updateProgressPlatforms(); updateQuestionPlatforms(); renderHeatmap(); renderRatings(); renderPlatforms(); renderRecent(); renderDone(); renderWorkspace();
  if (!$('view-questions').hidden) renderQuestions();
  companyPage.render();
  // Do not overwrite settings the user is editing while sync updates arrive.
  if (!$('settingsForm').contains(document.activeElement)) {
    $('dailyGoal').value = state.settings.dailyGoal; $('timeZone').value = state.settings.timeZone; $('autoSync').checked = state.settings.autoSync;
  }
  if (!$('contestSettingsForm').contains(document.activeElement)) {
    $('contestsEnabled').checked = state.settings.contestsEnabled;
    $('contestReminders').checked = state.settings.contestReminders;
  }
  updateConnectionResults();
}
function updateProgressPlatforms() {
  const select = $('progressPlatform'), selected = select.value;
  const connected = Object.keys(PLATFORMS).filter(id => state.accounts[id]);
  const options = connected.map(id => option(id, PLATFORMS[id].name));
  if (connected.length > 1) options.unshift(option('all', 'All connected'));
  if (!connected.length) options.push(option('all', 'No platforms'));
  select.replaceChildren(...options);
  select.value = options.some(o => o.value === selected) ? selected : options[0].value;
  select.disabled = connected.length < 2;
}
function updateQuestionPlatforms() {
  const connected = Object.keys(PLATFORMS).filter(id => state.accounts[id]);
  for (const id of ['questionPlatform', 'donePlatform']) {
    const select = $(id), selected = select.value;
    select.replaceChildren(option('all', connected.length ? 'All connected' : 'No platforms connected'), ...connected.map(id => option(id, PLATFORMS[id].name)));
    select.value = connected.includes(selected) ? selected : 'all';
    select.disabled = !connected.length;
  }
}
function questionActions(problem) {
  const key = problem.key || problemKey(problem.platform, problem.url);
  const entry = { ...defaultPractice(problem), key }, actions = el('div', 'question-actions');
  const starred = Boolean(state.workspace[key]?.listIds?.includes('saved'));
  const star = button(starred ? '★' : '☆', `question-star${starred ? ' active' : ''}`, () => update({ starred: !starred }));
  star.setAttribute('aria-label', `${starred ? 'Unstar' : 'Star'} ${problem.title}`);
  star.setAttribute('aria-pressed', String(starred));
  star.title = starred ? 'Unstar' : 'Star';
  const label = el('label', 'question-done'), checkbox = el('input');
  checkbox.type = 'checkbox'; checkbox.checked = questionIsDone(state.accounts, state.workspace, key);
  checkbox.setAttribute('aria-label', `Mark ${problem.title} as done`);
  checkbox.addEventListener('change', () => update({ done: checkbox.checked }));
  label.append(checkbox);
  label.title = 'Mark as done';
  const customCount = (state.workspace[key]?.listIds || []).filter(id => id !== 'saved').length;
  const add = button('+ Add to list', `question-list-button${customCount ? ' has-lists' : ''}`, () => editProblem(problem));
  if (customCount) add.append(el('span', 'selected-list-count', customCount));
  add.setAttribute('aria-label', `Add ${problem.title} to list`);
  actions.append(star, add);
  async function update(patch) {
    star.disabled = true; checkbox.disabled = true;
    try { await rpc('question-state', { entry, patch }); render(); }
    catch (error) { checkbox.checked = questionIsDone(state.accounts, state.workspace, key); toast(error.message, true); }
    finally { star.disabled = false; checkbox.disabled = false; }
  }
  return { done: label, actions };
}
function appendQuestionRow(row, problem, ...content) {
  const controls = questionActions(problem);
  row.classList.toggle('is-done', controls.done.querySelector('input').checked);
  row.append(controls.done, ...content, controls.actions);
}
function renderHeatmap() {
  const counts = dailyActivity(state.accounts, state.settings.timeZone, $('progressPlatform').value);
  const year = Number($('progressYear').value);
  if (!year) return;
  const first = `${year}-01-01`, last = `${year}-12-31`, now = today();
  const days = Object.entries(counts).filter(([day]) => day >= first && day <= last && day <= now);
  const sum = days.reduce((total, [, n]) => total + n, 0);
  $('activitySummary').textContent = `${format(sum)} contributions · ${days.length} active days`;
  const fragment = document.createDocumentFragment();
  const weekday = new Date(`${first}T12:00:00Z`).getUTCDay();
  for (let i = 0; i < weekday; i++) fragment.append(el('span', 'heatmap-cell blank'));
  for (let day = first; day <= last; day = shiftDay(day, 1)) {
    const count = counts[day] || 0, level = count === 0 ? 0 : count < 3 ? 1 : count < 6 ? 2 : count < 10 ? 3 : 4;
    const cell = el('span', `heatmap-cell${level ? ` level-${level}` : ''}${day > now ? ' future' : ''}`);
    const label = `${day}: ${day > now ? 'future date' : `${count} recorded contribution${count === 1 ? '' : 's'}`}`;
    cell.title = label; cell.dataset.tooltip = label; cell.setAttribute('aria-label', label);
    if (count) cell.tabIndex = 0;
    fragment.append(cell);
  }
  $('heatmap').replaceChildren(fragment);
}
const hiddenRatingSeries = new Set();
function renderRatings() {
  const selected = $('progressPlatform').value;
  const series = ratingSeries(state.accounts, Number($('progressYear').value), state.settings.timeZone, selected);
  const isScore = selected === 'geeksforgeeks' || (series.length > 0 && series.every(s => s.score));
  const hasScore = series.some(s => s.score);
  $('ratingsTitle').textContent = isScore ? 'Coding score' : hasScore ? 'Rating & coding score' : 'Rating over time';
  const legend = document.createDocumentFragment();
  for (const item of series) {
    const platform = PLATFORMS[item.id], visible = !hiddenRatingSeries.has(item.id);
    const toggle = button(platform.name, 'rating-legend-item', () => {
      if (hiddenRatingSeries.has(item.id)) hiddenRatingSeries.delete(item.id); else hiddenRatingSeries.add(item.id);
      renderRatings();
      $(`rating-toggle-${item.id}`)?.focus();
    });
    toggle.id = `rating-toggle-${item.id}`;
    toggle.style.setProperty('--series', platform.color);
    toggle.setAttribute('aria-pressed', String(visible));
    legend.append(toggle);
  }
  $('ratingLegend').replaceChildren(legend);
  const node = (tag, attrs, text) => {
    const result = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) result.setAttribute(key, String(value));
    if (text !== undefined) result.textContent = text;
    return result;
  };
  // Both axes are shared, and remain stable while legend items are toggled.
  const points = series.flatMap(s => s.points);
  const times = points.map(p => p.timestamp), values = points.map(p => p.rating);
  const first = times.length ? Math.min(...times) : null, last = times.length ? Math.max(...times) : null;
  const maximum = Math.max(100, Math.ceil(Math.max(0, ...values) / 100) * 100);
  const x = timestamp => first === last ? 224 : 40 + (timestamp - first) / (last - first) * 368;
  const y = rating => 140 - rating / maximum * 124;
  const svg = node('svg', { viewBox: '0 0 440 164', class: 'ratings-svg', role: 'group', 'aria-label': `${isScore ? 'Tracked coding score' : hasScore ? 'Contest ratings and coding score' : 'Contest ratings'} in ${$('progressYear').value}` });
  for (let i = 0; i <= 4; i++) {
    const value = maximum / 4 * i, position = y(value);
    svg.append(node('line', { x1: 40, x2: 408, y1: position, y2: position, class: 'chart-grid' }), node('text', { x: 34, y: position + 3, 'text-anchor': 'end', class: 'chart-label' }, format(Math.round(value))));
  }
  if (points.length) {
    svg.append(node('text', { x: first === last ? 224 : 40, y: 159, 'text-anchor': first === last ? 'middle' : 'start', class: 'chart-label' }, displayDate(first)));
    if (first !== last) svg.append(node('text', { x: 408, y: 159, 'text-anchor': 'end', class: 'chart-label' }, displayDate(last)));
  }
  const tooltip = el('div', 'rating-tooltip'); tooltip.hidden = true; tooltip.setAttribute('role', 'status');
  for (const item of series.filter(s => !hiddenRatingSeries.has(s.id))) {
    const platform = PLATFORMS[item.id];
    if (item.points.length > 1) svg.append(node('polyline', { points: item.points.map(p => `${x(p.timestamp)},${y(p.rating)}`).join(' '), fill: 'none', stroke: platform.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'data-platform': item.id }));
    for (const point of item.points) {
      const description = `${platform.name} · ${displayDate(point.timestamp, { year: 'numeric' })} · ${item.score ? 'Coding score' : 'Rating'} ${format(Math.round(point.rating))}${point.title ? ` · ${point.title}` : ''}`;
      const dot = node('circle', { cx: x(point.timestamp), cy: y(point.rating), r: 4, fill: platform.color, tabindex: 0, role: 'img', 'aria-label': description, 'data-platform': item.id });
      dot.append(node('title', {}, description));
      const show = () => { tooltip.textContent = description; tooltip.hidden = false; };
      const hide = () => { tooltip.hidden = true; };
      dot.addEventListener('mouseenter', show); dot.addEventListener('focus', show);
      dot.addEventListener('mouseleave', hide); dot.addEventListener('blur', hide);
      svg.append(dot);
    }
  }
  $('ratingPlot').replaceChildren(svg, tooltip);
}
function renderPlatforms() {
  const cards = document.createDocumentFragment();
  for (const [id, platform] of Object.entries(PLATFORMS)) {
    const account = state.accounts[id], snapshot = account?.snapshot;
    if (!account) continue;
    const card = el('article', 'platform-card'); card.style.setProperty('--platform', platform.color);
    const heading = el('div', 'platform-heading'), name = el('div', 'platform-name');
    name.append(el('span', 'platform-avatar', platform.short), el('h3', '', platform.name));
    const status = !account ? 'Not connected' : account.status === 'syncing' ? 'Syncing' : account.status === 'error' ? 'Needs attention' : snapshot?.activityWarning ? id === 'leetcode' ? 'Profile updated · Activity needs LeetCode' : 'Activity unavailable' : snapshot?.partial ? 'Partial history' : snapshot ? 'Synced' : 'Not synced';
    const statusPill = el('span', `status-pill ${account?.status || ''}`, status);
    if (snapshot?.coverage) statusPill.title = snapshot.coverage;
    if (snapshot?.activityWarning) statusPill.classList.add('warning');
    heading.append(name, statusPill); card.append(heading);
    if (!account) {
      card.append(el('p', 'platform-empty', `Bring your ${platform.name} progress into your workspace.`), button('＋ Connect account', 'button ghost', () => showConnections(id)));
    } else {
      const handle = el('div', 'platform-handle'); handle.append(link(`@${account.handle} ↗`, platform.profile(account.handle)), el('time', '', timeAgo(account.syncedAt))); card.append(handle);
      if (snapshot) {
        const stats = el('div', 'platform-stats');
        for (const [value, label] of [[`${snapshot.totalIsLowerBound ? '≥ ' : ''}${format(snapshot.totalSolved)}`, 'SOLVED'], [id === 'geeksforgeeks' ? snapshot.score == null ? '—' : format(snapshot.score) : snapshot.rating == null ? null : format(Math.round(snapshot.rating)), id === 'geeksforgeeks' ? 'CODING SCORE' : 'CONTEST RATING'], [snapshot.rank ? `#${format(snapshot.rank)}` : id === 'geeksforgeeks' ? '—' : null, id === 'geeksforgeeks' ? 'INSTITUTE RANK' : 'RANK']]) {
          if (value === null) continue;
          const stat = el('div', 'platform-stat'); stat.append(el('strong', '', value), el('span', '', label)); stats.append(stat);
        }
        card.append(stats);
        const breakdown = el('div', 'breakdown');
        for (const [level, count] of Object.entries(snapshot.breakdown || {})) if (level !== 'All') breakdown.append(el('span', '', `${level} ${format(count)}`));
        if (breakdown.childNodes.length) card.append(breakdown);
        if (snapshot.providerStreak) card.append(el('p', 'rating-caption', `Platform streak: ${snapshot.providerStreak.current} days · best ${snapshot.providerStreak.longest}`));
      }
      if (account.error) card.append(el('p', 'platform-error', account.error));
      if (snapshot?.activityWarning) card.append(el('p', 'platform-error', snapshot.activityWarning));
      if (id === 'leetcode' && snapshot) {
        const freshness = el('p', 'rating-caption', `Profile: ${timeAgo(account.profileSyncedAt || account.syncedAt)} · Activity: ${account.activitySyncedAt ? timeAgo(account.activitySyncedAt) : 'Not synced yet'}`);
        card.append(freshness);
      }
      const actions = el('div', 'inline-controls platform-actions');
      const sync = button(account.status === 'syncing' ? 'Syncing…' : '↻ Refresh', 'text-button', () => syncAccounts(id)); sync.disabled = account.status === 'syncing'; actions.append(sync);
      if (id === 'tuf') actions.append(link('Open TUF ↗', platform.profile(account.handle), 'text-button'));
      if (id === 'leetcode' && snapshot?.activityWarning) actions.append(link('Open LeetCode ↗', platform.profile(account.handle), 'text-button'));
      const disconnect = button('Disconnect', 'text-button', () => disconnectPlatform(id));
      disconnect.setAttribute('aria-label', `Disconnect ${platform.name}`); actions.append(disconnect);
      card.append(actions);
    }
    cards.append(card);
  }
  if (!Object.keys(state.accounts).length) cards.append(empty('Connect a platform to get started.'));
  $('platformCards').replaceChildren(cards);
}
async function disconnectPlatform(platform) {
  try { await rpc('disconnect', { platform }); render(); toast(`${PLATFORMS[platform].name} disconnected.`); }
  catch (error) { toast(error.message, true); }
}
function allRecent() {
  return Object.values(state.accounts).flatMap(a => a.snapshot?.recent || []).sort((a, b) => b.timestamp - a.timestamp);
}
function renderRecent() {
  const recent = allRecent(), records = [], seen = new Set();
  for (const r of recent) if (!seen.has(r.key)) { seen.add(r.key); records.push(r); if (records.length === 12) break; }
  const fragment = document.createDocumentFragment();
  for (const r of records) {
    const row = el('div', 'recent-row'), copy = el('div'); copy.append(link(r.title, r.url));
    if (r.pending) copy.append(el('div', 'rating-caption', 'Pending verification'));
    appendQuestionRow(row, r, copy, el('span', '', PLATFORMS[r.platform].name), el('time', '', r.day || displayDate(r.timestamp))); fragment.append(row);
  }
  if (!records.length) fragment.append(empty(Object.values(state.accounts).some(a => a.snapshot?.activityWarning) ? 'Recent activity unavailable.' : 'No recent solves.'));
  $('recentList').replaceChildren(fragment);
}
function questionMatches(p, query) {
  return !query || query.split(/\s+/).every(term => `${p.title} ${(p.topics || []).join(' ')}`.toLowerCase().includes(term));
}
function renderDone() {
  const { total, records } = doneQuestions(state.accounts, { query: $('doneSearch').value, platform: $('donePlatform').value, from: $('doneFrom').value, to: $('doneTo').value, sort: $('doneSort').value, timeZone: state.settings.timeZone, workspace: state.workspace });
  const pages = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
  donePage = Math.max(0, Math.min(donePage, pages - 1));
  const fragment = document.createDocumentFragment();
  for (const r of records.slice(donePage * PAGE_SIZE, (donePage + 1) * PAGE_SIZE)) {
    const row = el('div', 'recent-row'), copy = el('div');
    copy.append(link(r.title, r.url));
    if (r.pending) copy.append(el('div', 'rating-caption', 'Accepted in browser · verification pending'));
    if (r.source === 'manual') copy.append(el('div', 'rating-caption', 'Marked done'));
    appendQuestionRow(row, r, copy, el('span', '', PLATFORMS[r.platform].name), el('time', '', r.day || displayDate(r.timestamp)));
    fragment.append(row);
  }
  if (!records.length) fragment.append(empty(total ? 'No matching done questions.' : 'No tracked solves yet. Connect a platform and sync.'));
  $('doneList').replaceChildren(fragment);
  $('doneMeta').textContent = `${format(total)} tracked questions · ${format(records.length)} matching`;
  $('donePageLabel').textContent = `${donePage + 1} / ${pages}`;
  $('donePrevious').disabled = donePage === 0;
  $('doneNext').disabled = donePage >= pages - 1;
}
function updateLibraryCount() {
  const total = library.filter(p => state.accounts[p.platform]).length;
  $('libraryCount').textContent = format(total);
  return total;
}
function getFilteredQuestions(topics = [...selectedTopics]) {
  return filterLibrary(library, { accounts: state.accounts, workspace: state.workspace, solved: solvedKeys(), query: $('questionSearch').value, platform: $('questionPlatform').value, difficulty: $('questionDifficulty').value, topics, status: $('questionStatus').value, access: $('questionAccess').value, sort: $('questionSort').value });
}
function renderQuestionFilters() {
  const focusedTopic = document.activeElement?.dataset.topic;
  const scope = library.filter(p => state.accounts[p.platform] && ($('questionPlatform').value === 'all' || p.platform === $('questionPlatform').value));
  const counts = new Map();
  for (const p of scope) counts.set(p.difficulty, (counts.get(p.difficulty) || 0) + 1);
  const select = $('questionDifficulty'), current = select.value;
  select.replaceChildren(option('all', 'Any difficulty'), ...[...new Set([...counts.keys(), ...(current !== 'all' ? [current] : [])])].sort().map(v => option(v, `${v} (${format(counts.get(v))})`)));
  select.value = current;
  const topicCounts = new Map();
  for (const p of getFilteredQuestions([])) for (const topic of new Set(p.topics)) topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1);
  const query = $('topicSearch').value.trim().toLowerCase(), fragment = document.createDocumentFragment();
  for (const topic of [...new Set([...topicCounts.keys(), ...selectedTopics])].sort((a, b) => a.localeCompare(b))) {
    if (!topic.toLowerCase().includes(query)) continue;
    const label = el('label', 'topic-choice'), input = el('input'); input.type = 'checkbox'; input.checked = selectedTopics.has(topic); input.dataset.topic = topic;
    input.addEventListener('change', () => { input.checked ? selectedTopics.add(topic) : selectedTopics.delete(topic); page = 0; renderQuestions(); });
    label.append(input, el('span', '', topic), el('small', '', format(topicCounts.get(topic)))); fragment.append(label);
  }
  if (!fragment.childNodes.length) fragment.append(el('p', '', 'No matching topics.'));
  $('questionTopics').replaceChildren(fragment);
  if (focusedTopic) [...$('questionTopics').querySelectorAll('input')].find(input => input.dataset.topic === focusedTopic)?.focus({ preventScroll: true });
  $('topicSummary').textContent = selectedTopics.size ? `Topics · ${selectedTopics.size} selected` : 'Topics · All';
  const chips = document.createDocumentFragment();
  for (const [id, title] of [['questionSearch', 'Search'], ['questionPlatform', 'Platform'], ['questionDifficulty', 'Difficulty'], ['questionStatus', 'Progress'], ['questionAccess', 'Access']]) {
    const field = $(id); if (!field.value || field.value === 'all') continue;
    const value = field.selectedOptions ? field.selectedOptions[0].textContent : field.value;
    const chip = button(`${title}: ${value} ×`, 'filter-chip', () => { field.value = id === 'questionSearch' ? '' : 'all'; page = 0; renderQuestions(); });
    chip.setAttribute('aria-label', `Remove ${title.toLowerCase()} filter`); chips.append(chip);
  }
  for (const topic of selectedTopics) {
    const chip = button(`${topic} ×`, 'filter-chip', () => { selectedTopics.delete(topic); page = 0; renderQuestions(); });
    chip.setAttribute('aria-label', `Remove topic ${topic}`); chips.append(chip);
  }
  $('activeQuestionFilters').replaceChildren(chips);
}
function solvedKeys() { return new Set(doneQuestions(state.accounts, { workspace: state.workspace }).records.map(r => r.key)); }
function createLibraryRow(p, { open = false, frequency = false, onTopic = topic => { selectedTopics.add(topic); page = 0; renderQuestions(); } } = {}) {
  const row = el('div', 'question-row'), copy = el('div', 'question-copy'); row.dataset.key = p.key;
  const heading = el('div', 'question-heading');
  if (p.id) heading.append(el('span', 'question-id', `#${p.id}`));
  heading.append(link(p.title, p.url, 'question-title')); copy.append(heading);
  const tags = el('div', 'question-tags');
  if (questionIsDone(state.accounts, state.workspace, p.key)) tags.append(el('span', 'tag solved-tag', 'Solved'));
  if (p.isPremium) tags.append(el('span', 'tag', 'Premium'));
  for (const topic of p.topics) {
    const tag = button(topic, 'tag topic-tag', () => onTopic(topic)); tags.append(tag);
  }
  copy.append(tags);
  if (frequency) {
    tags.append(el('span', 'tag company-platform-tag', p.platform === 'code360' ? 'Code360' : 'LeetCode'));
    if (Number.isFinite(p.frequency)) tags.append(el('span', 'tag company-frequency-tag', `Frequency ${p.frequency}%`));
  }
  const details = el('details', 'question-details'); details.open = open; details.append(el('summary', '', 'Read question'));
  details.append(el('p', 'question-statement', p.description || 'A question statement is not available in the local index. Open the problem to read it on the platform.'));
  if (p.constraints) details.append(el('h3', '', 'Constraints / input'), el('p', 'question-statement', p.constraints));
  details.append(link('Open problem ↗', p.url, 'text-link')); copy.append(details);
  appendQuestionRow(row, p, copy, frequency && Number.isFinite(p.frequency) ? el('span', 'muted company-frequency', `${p.frequency}%`) : el('span', 'muted', PLATFORMS[p.platform].short), el('span', `difficulty ${p.difficulty.toLowerCase()}`, p.difficulty)); return row;
}
function renderQuestions() {
  if (!indexReady) { $('questionList').replaceChildren(el('div', 'loading-note', 'Loading the local question index…')); return; }
  const openQuestions = new Set([...$('questionList').querySelectorAll('.question-row:has(.question-details[open])')].map(row => row.dataset.key));
  renderQuestionFilters();
  filtered = getFilteredQuestions(); page = Math.min(page, Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1));
  const fragment = document.createDocumentFragment();
  for (const p of filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
    fragment.append(createLibraryRow(p, { open: openQuestions.has(p.key) }));
  }
  if (!filtered.length) fragment.append(empty(Object.keys(state.accounts).length ? 'No matching questions. Try removing a filter or clearing your search.' : 'Connect a platform to browse its questions.'));
  $('questionList').replaceChildren(fragment);
  const total = updateLibraryCount();
  $('questionMeta').textContent = `${format(filtered.length)} of ${format(total)} questions · Showing ${filtered.length ? format(page * PAGE_SIZE + 1) : 0}–${format(Math.min((page + 1) * PAGE_SIZE, filtered.length))}`;
  $('pageLabel').textContent = filtered.length ? `${page + 1} / ${Math.ceil(filtered.length / PAGE_SIZE)}` : '0 results';
  $('previousPage').disabled = page === 0; $('nextPage').disabled = (page + 1) * PAGE_SIZE >= filtered.length;
}
function renderWorkspace() {
  const selected = $('workspaceFilter').value;
  $('workspaceFilter').replaceChildren(option('all', 'All lists'), ...Object.values(state.lists).map(list => option(list.id, list.name)));
  $('workspaceFilter').value = Object.hasOwn(state.lists, selected) ? selected : 'all';
  const all = Object.values(state.workspace).filter(p => p.listIds?.length), query = $('workspaceSearch').value.trim().toLowerCase(), filter = $('workspaceFilter').value;
  const summary = document.createDocumentFragment();
  for (const list of Object.values(state.lists)) {
    const count = all.filter(p => p.listIds.includes(list.id)).length;
    const item = button(`${list.id === 'saved' ? '★ ' : ''}${list.name} (${count})`, `button ghost${list.id === 'saved' ? ' starred-list' : ''}`, () => { $('workspaceFilter').value = list.id; renderWorkspace(); });
    item.setAttribute('aria-pressed', String(filter === list.id)); summary.append(item);
  }
  $('workspaceSummary').replaceChildren(summary);
  const entries = all.filter(p => questionMatches(p, query) && (filter === 'all' || p.listIds.includes(filter))).sort((a, b) => b.updatedAt - a.updatedAt);
  const fragment = document.createDocumentFragment();
  for (const p of entries) {
    const row = el('div', 'workspace-row'), copy = el('div'); copy.append(link(p.title, p.url, 'question-title'));
    const tags = el('div', 'question-tags');
    for (const id of p.listIds) tags.append(el('span', 'tag', state.lists[id].name));
    copy.append(tags);
    appendQuestionRow(row, p, copy, el('span', 'muted', PLATFORMS[p.platform].name), el('span', 'difficulty', p.difficulty)); fragment.append(row);
  }
  if (!entries.length) fragment.append(empty('No saved questions.'));
  $('workspaceList').replaceChildren(fragment);
}
function defaultPractice(p) {
  return { key: p.key || problemKey(p.platform, p.url), platform: p.platform, title: p.title, url: p.url, topics: p.topics || [], difficulty: p.difficulty || '', listIds: [] };
}
function editProblem(problem) {
  activeProblem = { ...defaultPractice(problem), ...state.workspace[problem.key || problemKey(problem.platform, problem.url)] };
  $('practicePlatform').textContent = PLATFORMS[activeProblem.platform].name;
  $('practiceTitle').textContent = activeProblem.title; $('practiceLink').href = activeProblem.url;
  listDraft = new Set(activeProblem.listIds.filter(id => id !== 'saved'));
  $('listSearch').value = ''; $('inlineListName').value = ''; $('listPickerStatus').textContent = '';
  renderListChoices();
  $('practiceDialog').showModal();
}
function renderListChoices() {
  const choices = document.createDocumentFragment();
  const custom = Object.values(state.lists).filter(list => list.id !== 'saved');
  const matching = custom.filter(list => list.name.toLowerCase().includes($('listSearch').value.trim().toLowerCase()));
  for (const list of matching) {
    const label = el('label', 'list-choice'), checkbox = el('input');
    checkbox.type = 'checkbox'; checkbox.value = list.id; checkbox.checked = listDraft.has(list.id);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) listDraft.add(list.id); else listDraft.delete(list.id);
      $('listSelectionCount').textContent = `${listDraft.size} selected`;
    });
    const count = Object.values(state.workspace).filter(p => p.listIds?.includes(list.id)).length;
    label.append(checkbox, el('span', 'list-choice-name', list.name), el('span', 'list-choice-count', count)); choices.append(label);
  }
  if (!matching.length) choices.append(empty(custom.length ? 'No matching lists.' : 'Create your first custom list below.'));
  $('problemLists').replaceChildren(choices);
  $('listSelectionCount').textContent = `${listDraft.size} selected`;
}
async function persistPractice(entry) { await rpc('workspace', { entry, customListsOnly: true }); render(); }
function showConnections(platform) {
  updateConnectionResults(); $('connectionsDialog').showModal();
  if (platform) $(`handle-${platform}`).focus();
}
function updateConnectionResults() {
  for (const id of Object.keys(PLATFORMS)) {
    const result = $(`connection-result-${id}`), input = $(`handle-${id}`), account = state.accounts[id];
    if (!result) continue;
    result.textContent = account ? account.status === 'syncing' ? 'Syncing…' : account.error || account.snapshot?.activityWarning || timeAgo(account.syncedAt) : '';
    if (input !== document.activeElement && !input.value && account) input.value = account.handle;
    $(`connect-${id}`).disabled = account?.status === 'syncing';
    $(`connect-${id}`).textContent = account?.status === 'syncing' ? 'Syncing…' : account ? 'Refresh' : 'Connect';
    $(`disconnect-${id}`).hidden = !account;
  }
}
function setupConnections() {
  const fragment = document.createDocumentFragment();
  for (const [id, p] of Object.entries(PLATFORMS)) {
    const form = el('form', 'connection-form'), label = el('label', '', p.name); label.htmlFor = `handle-${id}`;
    const controls = el('div', 'connection-inputs'), input = el('input'); input.id = `handle-${id}`; input.required = true; input.maxLength = 300; input.placeholder = id === 'code360' ? 'Public profile ID or profile URL' : 'Username or public profile URL'; input.autocomplete = 'off'; input.spellcheck = false;
    const connect = el('button', 'button', 'Connect / refresh'); connect.id = `connect-${id}`; connect.type = 'submit'; const disconnect = button('Disconnect', 'button ghost', () => disconnectPlatform(id)); disconnect.id = `disconnect-${id}`; disconnect.hidden = true; disconnect.setAttribute('aria-label', `Disconnect ${p.name} account`); controls.append(input, connect, disconnect); form.append(label, controls);
    const note = el('div', 'connection-description', id === 'tuf' ? 'Keep a TUF tab open to sync.' : id === 'leetcode' ? 'Sign in on LeetCode for private activity.' : id === 'code360' ? 'Totals only; no dated activity.' : '');
    if (id === 'tuf') note.append(document.createTextNode(' '), link('Open TakeUForward ↗', 'https://takeuforward.org/', 'text-link'));
    const result = el('div', 'connection-result'); result.id = `connection-result-${id}`; result.setAttribute('role', 'status'); if (note.childNodes.length) form.append(note); form.append(result);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      try {
        const handle = cleanHandle(id, input.value);
        // Called directly from the click/submit gesture, before other async work.
        const permission = chrome.permissions.request({ origins: p.origins, ...(['tuf', 'leetcode'].includes(id) ? { permissions: ['scripting'] } : {}) });
        connect.disabled = true; result.textContent = 'Connecting…';
        if (!await permission) throw new Error('Site access was declined. Your existing connection has been kept.');
        await rpc('connect', { platform: id, handle }); render();
        if (state.accounts[id]?.status === 'error') toast(state.accounts[id].error, true);
        else if (state.accounts[id]?.snapshot?.activityWarning) toast(`${p.name} profile updated; recent activity unavailable.`, true);
        else toast(`${p.name} activity updated.`);
      } catch (error) { result.textContent = error.message; toast(error.message, true); }
      finally { connect.disabled = false; }
    });
    fragment.append(form);
  }
  $('connectionForms').replaceChildren(fragment);
}
async function syncAccounts(platform) {
  $('syncAll').disabled = true; $('syncAll').textContent = '↻ Syncing…';
  try {
    await rpc('sync', platform ? { platform } : {}); render();
    const errors = Object.entries(state.accounts).filter(([id, a]) => (!platform || id === platform) && a.error);
    const warnings = Object.entries(state.accounts).filter(([id, a]) => (!platform || id === platform) && a.snapshot?.activityWarning);
    toast(errors.length ? `${errors.length} refresh failed. Previous data kept.` : warnings.length ? 'Profiles updated; some recent activity is unavailable.' : 'Activity refreshed.', Boolean(errors.length || warnings.length));
  } catch (error) { toast(error.message, true); render(); }
}
function option(value, text = value) { const o = el('option', '', text); o.value = value; return o; }
async function loadLibrary() {
  const sources = ['leetcode', 'geeksforgeeks', 'codeforces', 'codechef', 'code360'], failures = [];
  const datasets = await Promise.all(sources.map(async platform => {
    try {
      const response = await fetch(chrome.runtime.getURL(`data/${platform}-data.json`));
      if (!response.ok) throw new Error();
      const records = await response.json();
      return records.filter(p => p.title && safeProblemUrl(p.url, platform)).map(p => ({ key: problemKey(platform, p.url), platform, id: p.id, title: p.title, url: p.url, description: typeof p.description === 'string' ? p.description : '', constraints: typeof p.constraints === 'string' ? p.constraints : '', isPremium: Boolean(p.isPremium), difficulty: p.difficulty || 'Unknown', ...(platform === 'code360' ? splitCode360Tags(p) : { topics: Array.isArray(p.topics) ? [...new Set(p.topics.filter(v => typeof v === 'string'))] : [] }) }));
    } catch { failures.push(PLATFORMS[platform].name); return []; }
  }));
  library = datasets.flat(); indexReady = true;
  companyPage.setLibrary(library);
  renderQuestions();
  if (failures.length) toast(`Some local indexes could not load: ${failures.join(', ')}. Reload the extension.`, true);
}

async function init() {
  mountContestStrip($('contestStrip')).catch(console.error);
  $('contestSettingsForm').addEventListener('submit', async event => {
    event.preventDefault();
    const submit = event.submitter; submit.disabled = true;
    const enabled = $('contestsEnabled').checked, reminders = $('contestReminders').checked;
    try {
      if ((enabled || reminders) && !await chrome.permissions.request({ origins: CONTEST_ORIGINS, ...(reminders ? { permissions: ['notifications'] } : {}) })) throw new Error('Permission declined. Contest settings were not changed.');
      await rpc('contest-settings', { contestsEnabled: enabled, contestReminders: reminders });
      render(); toast('Contest settings saved.');
    } catch (error) { toast(error.message, true); } finally { submit.disabled = false; }
  });
  setupConnections();
  for (const id of ['doneSearch', 'donePlatform', 'doneFrom', 'doneTo', 'doneSort']) $(id).addEventListener(id === 'doneSearch' ? 'input' : 'change', () => { donePage = 0; renderDone(); });
  $('donePrevious').addEventListener('click', () => { donePage--; renderDone(); });
  $('doneNext').addEventListener('click', () => { donePage++; renderDone(); });
  const year = new Date().getFullYear();
  for (let y = year; y >= year - 5; y--) $('progressYear').append(option(String(y)));
  window.addEventListener('hashchange', route);
  for (const id of ['connectTop', 'connectCards']) $(id).addEventListener('click', () => showConnections());
  $('syncAll').addEventListener('click', () => syncAccounts());
  $('progressPlatform').addEventListener('change', () => { hiddenRatingSeries.clear(); renderHeatmap(); renderRatings(); });
  $('progressYear').addEventListener('change', () => { renderHeatmap(); renderRatings(); });
  for (const node of document.querySelectorAll('[data-close]')) node.addEventListener('click', () => $(node.dataset.close).close());
  for (const id of ['questionPlatform', 'questionDifficulty', 'questionStatus', 'questionAccess', 'questionSort']) $(id).addEventListener('change', () => { page = 0; renderQuestions(); });
  $('topicSearch').addEventListener('input', renderQuestionFilters);
  $('resetQuestions').addEventListener('click', () => {
    for (const id of ['questionPlatform', 'questionDifficulty', 'questionStatus', 'questionAccess']) $(id).value = 'all';
    $('questionSort').value = 'default'; $('questionSearch').value = ''; $('topicSearch').value = ''; selectedTopics.clear(); page = 0; renderQuestions();
  });
  let searchTimer;
  $('questionSearch').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { page = 0; renderQuestions(); }, 150); });
  $('previousPage').addEventListener('click', () => { page--; renderQuestions(); });
  $('nextPage').addEventListener('click', () => { page++; renderQuestions(); });
  $('workspaceSearch').addEventListener('input', renderWorkspace); $('workspaceFilter').addEventListener('change', renderWorkspace);
  $('randomQuestion').addEventListener('click', () => {
    const choices = getFilteredQuestions();
    if (!choices.length) return toast('No questions match the current filters.', true);
    window.open(choices[Math.floor(Math.random() * choices.length)].url, '_blank', 'noopener,noreferrer');
  });
  $('createListForm').addEventListener('submit', async event => {
    event.preventDefault(); const submit = event.submitter; submit.disabled = true;
    try { await rpc('list:create', { name: $('newListName').value }); $('newListName').value = ''; render(); toast('List created.'); }
    catch (error) { toast(error.message, true); } finally { submit.disabled = false; }
  });
  $('practiceForm').addEventListener('submit', async event => {
    event.preventDefault(); const submit = event.submitter; submit.disabled = true;
    try { await persistPractice({ ...activeProblem, listIds: [...listDraft] }); $('practiceDialog').close(); toast('Lists saved.'); }
    catch (error) { $('listPickerStatus').textContent = error.message; } finally { submit.disabled = false; }
  });
  $('listSearch').addEventListener('input', renderListChoices);
  $('inlineCreateList').addEventListener('click', async () => {
    const create = $('inlineCreateList'), name = $('inlineListName').value.trim();
    create.disabled = true; $('listPickerStatus').textContent = '';
    try {
      await rpc('list:create', { name });
      const list = Object.values(state.lists).find(list => list.id !== 'saved' && list.name === name);
      if (list) listDraft.add(list.id);
      $('inlineListName').value = ''; $('listSearch').value = '';
      renderListChoices(); render();
    } catch (error) { $('listPickerStatus').textContent = error.message; }
    finally { create.disabled = false; }
  });
  $('inlineListName').addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); $('inlineCreateList').click(); }
  });
  $('settingsForm').addEventListener('submit', async event => {
    event.preventDefault(); const submit = event.submitter; submit.disabled = true;
    try { await rpc('settings', { settings: { dailyGoal: Number($('dailyGoal').value), timeZone: $('timeZone').value.trim(), autoSync: $('autoSync').checked } }); render(); toast('Settings saved.'); }
    catch (error) { toast(error.message, true); } finally { submit.disabled = false; }
  });
  $('exportData').addEventListener('click', async () => {
    try {
      await rpc('get');
      const url = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
      const download = document.createElement('a'); download.href = url; download.download = `crossdsa-${today()}.json`; download.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { toast(error.message, true); }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STORAGE_KEY]) { state = normalizeState(changes[STORAGE_KEY].newValue); render(); }
  });
  async function refreshStaleActivity() {
    if (document.hidden || !state.settings.autoSync) return;
    for (const [platform, account] of Object.entries(state.accounts)) {
      if (account.status !== 'syncing' && Date.now() - (account.attemptedAt || account.syncedAt || 0) >= 30 * 60000) {
        try { await rpc('sync', { platform }); render(); } catch (error) { toast(error.message, true); }
      }
    }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshStaleActivity(); });
  window.addEventListener('focus', refreshStaleActivity);
  try { await rpc('get'); render(); route(); } catch (error) { toast(error.message, true); render(); route(); }
  refreshStaleActivity();
  await loadLibrary();
  // Rollover refreshes today's goal even when the dashboard stays open overnight.
  setInterval(() => { render(); refreshStaleActivity(); }, 60000);
}
const companyPage = mountCompanies($('view-companies'), { getState: () => state, solvedKeys, createRow: createLibraryRow });
init().catch(error => toast(error.message, true));
