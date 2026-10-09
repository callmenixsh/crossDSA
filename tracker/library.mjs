const difficultyOrder = { Basic: 0, Easy: 1, Medium: 2, Moderate: 2, Hard: 3, Difficult: 3, Ninja: 4, Expert: 4, Unknown: 5 };

export function filterLibrary(library, { accounts = {}, workspace = {}, solved = new Set(), query = '', platform = 'all', difficulty = 'all', topics = [], status = 'all', access = 'all', sort = 'default' } = {}) {
  const normalize = value => String(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const search = normalize(query), terms = search.split(/\s+/).filter(Boolean);
  const matches = library.filter(p => {
    if (!accounts[p.platform] || platform !== 'all' && p.platform !== platform || difficulty !== 'all' && p.difficulty !== difficulty) return false;
    if (topics.length && !topics.some(topic => p.topics.includes(topic))) return false;
    if (status === 'solved' && !solved.has(p.key) || status === 'unsolved' && solved.has(p.key) || status === 'starred' && !workspace[p.key]?.listIds?.includes('saved')) return false;
    if (access === 'free' && p.isPremium || access === 'premium' && !p.isPremium) return false;
    const fields = [p.title, p.id || '', p.topics.join(' ')].map(normalize);
    return fields.some(text => terms.every(term => text.includes(term)));
  });
  if (search && sort === 'default') {
    const relevance = p => {
      const title = normalize(p.title);
      if (title === search || normalize(p.id || '') === search) return 0;
      if (title.startsWith(search)) return 1;
      if (title.includes(search)) return 2;
      return terms.every(term => title.includes(term)) ? 3 : 4;
    };
    matches.sort((a, b) => relevance(a) - relevance(b));
  }
  if (sort === 'title') matches.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }));
  if (sort === 'easy' || sort === 'hard') matches.sort((a, b) => {
    const left = difficultyOrder[a.difficulty] ?? 5, right = difficultyOrder[b.difficulty] ?? 5;
    if (left === 5 || right === 5) return left === right ? 0 : left === 5 ? 1 : -1;
    return (left - right) * (sort === 'hard' ? -1 : 1);
  });
  return matches;
}
