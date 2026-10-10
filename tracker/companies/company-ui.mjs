import { buildCompanyIndex, companyCounts, companyQuestions, filterCompanyQuestions, COMPANY_CATEGORIES, COMPANY_WINDOWS } from './companies.mjs';
import { orderedPlatformIds } from '../core.mjs';

export function mountCompanies(root, { getState, solvedKeys, createRow }) {
  const $ = id => root.querySelector(`#${id}`);
  const node = (tag, className = '', text = '') => {
    const element = document.createElement(tag); element.className = className; element.textContent = text; return element;
  };
  const option = (value, title) => { const element = node('option', '', title); element.value = value; return element; };
  let data, library = [], libraryReady = false, companies = [], loading = false, error = '', selectedId = '', page = 0;
  let connectionSignature = null;
  const size = 50;
  const select = (id, entries) => $(id).replaceChildren(...entries.map(([value, title]) => option(value, title)));
  select('companyCategory', [['all', 'All categories'], ...COMPANY_CATEGORIES.map(name => [name, name])]);
  select('companyWindow', Object.entries(COMPANY_WINDOWS));
  const chips = $('companyCategories');
  for (const name of ['All', ...COMPANY_CATEGORIES]) {
    const chip = node('button', 'company-category', name); chip.type = 'button';
    chip.dataset.category = name === 'All' ? 'all' : name;
    chip.addEventListener('click', () => { $('companyCategory').value = chip.dataset.category; render(); });
    chips.append(chip);
  }
  // A hidden select keeps the category value stable while chip buttons are rebuilt visually.
  $('companySearch').addEventListener('input', render);
  $('companyWindow').addEventListener('change', () => {
    if ($('companyWindow').value !== 'all' && getState().accounts.leetcode) $('companyPlatform').value = 'leetcode';
    page = 0; render();
  });
  $('companyPlatform').addEventListener('change', () => { $('companyWindow').value = 'all'; page = 0; render(); });
  for (const id of ['companyQuestionSearch', 'companyDifficulty', 'companyProgress', 'companyTopic', 'companyAccess', 'companySort']) {
    $(id).addEventListener(id === 'companyQuestionSearch' ? 'input' : 'change', () => { page = 0; render(); });
  }
  $('companyClear').addEventListener('click', () => { resetFilters(); render(); });
  $('companyPrevious').addEventListener('click', () => { page--; render(); });
  $('companyNext').addEventListener('click', () => { page++; render(); });
  $('companyRetry').addEventListener('click', () => { error = ''; load(); });

  function resetFilters() {
    $('companyQuestionSearch').value = '';
    for (const id of ['companyDifficulty', 'companyProgress', 'companyTopic', 'companyAccess']) $(id).value = 'all';
    $('companySort').value = 'frequency'; page = 0;
  }
  async function load() {
    if (loading) return;
    loading = true; render();
    try {
      const response = await fetch(chrome.runtime.getURL('data/leetcode-companies.json'));
      if (!response.ok) throw new Error();
      data = await response.json();
      connectionSignature = null;
    } catch { error = 'Company data could not load. Reload the extension or try again.'; }
    finally { loading = false; render(); }
  }
  function render() {
    if (root.hidden) return;
    const connected = orderedPlatformIds(getState().settings, ['leetcode', 'code360']).filter(id => getState().accounts[id]);
    const previous = $('companyPlatform').value;
    select('companyPlatform', [...(connected.length > 1 ? [['all', 'All connected']] : []), ...connected.map(id => [id, id === 'leetcode' ? 'LeetCode' : 'Code360'])]);
    if (connected.includes(previous) || previous === 'all' && connected.length > 1) $('companyPlatform').value = previous;
    $('companyPlatform').disabled = connected.length < 2;
    if (!connected.includes('leetcode')) $('companyWindow').value = 'all';
    if (!connected.length) {
      $('companyContent').hidden = true; $('companyLoadStatus').hidden = false;
      $('companyLoadText').textContent = 'Connect LeetCode or Code360 in Settings to browse company questions.';
      $('companyRetry').hidden = true; return;
    }
    if (data && connectionSignature !== connected.join(',')) {
      companies = buildCompanyIndex(data, library.filter(p => getState().accounts[p.platform]));
      connectionSignature = connected.join(',');
    }

    if (!data && !loading && !error) { load(); return; }
    const status = $('companyLoadStatus');
    status.hidden = Boolean(data) && libraryReady;
    $('companyLoadText').textContent = error || 'Loading company questions…';
    $('companyRetry').hidden = !error;
    $('companyContent').hidden = !data || !libraryReady;
    if (!data || !libraryReady) return;
    $('companySource').href = data.source.url;
    $('companySource').textContent = 'LeetCode dataset';
    $('companySource').hidden = !getState().accounts.leetcode;
    $('companySnapshot').hidden = !getState().accounts.leetcode;
    $('companySnapshot').textContent = `Snapshot: ${data.source.snapshotDate}`;
    $('companySnapshot').title = 'LeetCode time windows and frequency use this snapshot. Code360 tags have no frequency or date data.';
    const requestedId = location.hash.split('/')[1] || '';
    const company = companies.find(c => c.id === requestedId);
    $('companyDirectory').hidden = Boolean(requestedId);
    $('companyGrid').hidden = Boolean(requestedId);
    $('companyDetail').hidden = !requestedId;
    $('companyWindowLabel').hidden = !getState().accounts.leetcode || $('companyPlatform').value === 'code360' || Boolean(requestedId) && !company;
    $('companySort').querySelector('[value="frequency"]').textContent = $('companyPlatform').value === 'code360' ? 'Title A–Z (frequency unavailable)' : 'Most asked first';
    if (requestedId) {
      $('companyDetailBody').hidden = !company;
      $('companyMissing').hidden = Boolean(company);
      $('companyTitle').textContent = company ? company.name : 'Company unavailable';
      if (!company) return;
      if (selectedId !== requestedId) { selectedId = requestedId; resetFilters(); }
      renderDetail(company);
    } else renderDirectory();
  }
  function renderDirectory() {
    const query = $('companySearch').value.trim().toLowerCase(), category = $('companyCategory').value, window = $('companyWindow').value, platform = $('companyPlatform').value;
    const countsByCompany = new Map(companies.map(c => [c.id, companyCounts(c, window, platform)]));
    for (const chip of chips.children) chip.setAttribute('aria-pressed', String(chip.dataset.category === category));
    const visible = companies.filter(c => (category === 'all' || category === c.category) && [c.name, c.id, ...(c.aliases || [])].some(name => name.toLowerCase().includes(query)) && countsByCompany.get(c.id).total);
    const unique = new Set(companies.flatMap(c => companyQuestions(c, window, platform).map(p => p.canonicalId || p.key)));
    $('companySummary').textContent = `${unique.size.toLocaleString()} questions · ${companies.filter(c => countsByCompany.get(c.id).total).length.toLocaleString()} companies`;
    const fragment = document.createDocumentFragment();
    for (const group of COMPANY_CATEGORIES) {
      const members = visible.filter(c => c.category === group).sort((a, b) => countsByCompany.get(b.id).total - countsByCompany.get(a.id).total || a.name.localeCompare(b.name));
      if (!members.length) continue;
      const section = node('section', 'company-group'), heading = node('h2', '', group);
      heading.append(node('span', 'muted', `${members.length} companies`)); section.append(heading);
      const grid = node('div', 'company-grid');
      for (const company of members) {
        const counts = countsByCompany.get(company.id), card = node('a', 'company-card'); card.href = `#companies/${company.id}`;
        card.setAttribute('aria-label', `${company.name}, ${counts.total} questions`);
        const header = node('div', 'company-card-heading'), mark = node('span', 'company-mark', company.name.split(/\s+/).map(w => w[0]).slice(0, 2).join(''));
        mark.setAttribute('aria-hidden', 'true');
        const title = node('div'); title.append(node('strong', '', company.name), node('small', 'muted', `${counts.total.toLocaleString()} questions`));
        header.append(mark, title, node('span', 'company-chevron', '›'));
        const breakdown = node('div', 'company-breakdown');
        for (const difficulty of ['Easy', 'Medium', 'Hard']) {
          const stat = node('div'); stat.append(node('span', `difficulty ${difficulty.toLowerCase()}`, difficulty), node('strong', '', counts[difficulty].toLocaleString())); breakdown.append(stat);
        }
        card.append(header, breakdown); grid.append(card);
      }
      section.append(grid); fragment.append(section);
    }
    if (!visible.length) fragment.append(node('div', 'empty-state', 'No companies match these filters.'));
    $('companyGrid').replaceChildren(fragment);
  }
  function renderDetail(company) {
    const window = $('companyWindow').value, platform = $('companyPlatform').value, sourceRows = companyQuestions(company, window, platform), currentTopic = $('companyTopic').value;
    const topics = [...new Set(sourceRows.flatMap(p => p.topics))].sort();
    select('companyTopic', [['all', 'All topics'], ...[...new Set([...topics, ...(currentTopic !== 'all' ? [currentTopic] : [])])].map(t => [t, t])]);
    $('companyTopic').value = currentTopic;
    const available = Object.hasOwn(company.windows, window);
    $('companyDetailSummary').textContent = available ? `${sourceRows.length.toLocaleString()} questions · ${$('companyPlatform').selectedOptions[0].textContent}${platform === 'code360' ? '' : ` · ${COMPANY_WINDOWS[window]}`}` : `No ${COMPANY_WINDOWS[window].toLowerCase()} data in this snapshot.`;
    const state = getState();
    const solved = new Set([...solvedKeys(), ...Object.entries(state.workspace).filter(([, entry]) => entry.done === true).map(([key]) => key)]);
    const rows = filterCompanyQuestions(company, { window, platform, query: $('companyQuestionSearch').value, difficulty: $('companyDifficulty').value, status: $('companyProgress').value, topics: currentTopic === 'all' ? [] : [currentTopic], access: $('companyAccess').value, sort: $('companySort').value, workspace: state.workspace, solved, platformOrder: state.settings.platformOrder });
    const pages = Math.max(1, Math.ceil(rows.length / size)); page = Math.max(0, Math.min(page, pages - 1));
    const open = new Set([...$('companyQuestionList').querySelectorAll('.question-row:has(.question-details[open])')].map(row => row.dataset.key));
    const rendered = rows.slice(page * size, (page + 1) * size).map(p => createRow(p, { open: open.has(p.canonicalId || p.key), frequency: true, onTopic: topic => { $('companyTopic').value = topic; page = 0; render(); } }));
    $('companyQuestionList').replaceChildren(...(rendered.length ? rendered : [node('div', 'empty-state', available ? 'No matching questions. Try clearing the filters.' : 'Choose another time window to browse this company.')]));
    $('companyQuestionMeta').textContent = `${rows.length.toLocaleString()} matching questions · Showing ${rows.length ? page * size + 1 : 0}–${Math.min((page + 1) * size, rows.length)}`;
    $('companyPageLabel').textContent = rows.length ? `${page + 1} / ${pages}` : '0 results';
    $('companyPrevious').disabled = page === 0; $('companyNext').disabled = page >= pages - 1;
  }
  return { render, setLibrary(value) { library = value; libraryReady = true; connectionSignature = null; render(); } };
}
