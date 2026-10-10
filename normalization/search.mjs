// A consumer API for the generated database. The extension is not switched over yet.
// No Node imports: this can also be imported by the extension during the later migration.
const normalize = text => String(text || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const stop = new Set('a an the and or of to in is are be for with given find return output input problem you your that this each from as on by it'.split(' '));
export const tokens = text => new Set((normalize(text).match(/[\p{L}\p{N}]+/gu) || []).filter(t => !stop.has(t)));
const overlap = (a, b) => { let n = 0; for (const token of a) if (b.has(token)) n++; return a.size + b.size ? 2 * n / (a.size + b.size) : 0; };

export function createQuestionSearch(database) {
  if (database.schemaVersion !== 1 || !Array.isArray(database.questions)) throw new Error('Unsupported normalized database schema.');
  const byId = new Map(), bySource = new Map(), aliases = new Map(), fields = new Map(), inverted = new Map();
  for (const question of database.questions) {
    if (byId.has(question.id)) throw new Error(`Duplicate canonical question: ${question.id}`);
    byId.set(question.id, question);
    const title = tokens(question.titleAliases.join(' ')), topics = tokens(question.topics.join(' '));
    const statement = tokens([...new Set(question.versions.map(v => v.descriptionRef).filter(Boolean))].map(ref => database.texts[ref] || '').join(' ').slice(0, 12000));
    fields.set(question.id, { title, topics, statement });
    for (const token of new Set([...title, ...topics, ...statement])) {
      if (!inverted.has(token)) inverted.set(token, new Set()); inverted.get(token).add(question.id);
    }
    for (const version of question.versions) {
      if (bySource.has(version.id)) throw new Error(`Duplicate source identity: ${version.id}`);
      bySource.set(version.id, { question, version });
      for (const alias of version.aliases) {
        if (aliases.has(alias) && aliases.get(alias) !== question.id) throw new Error(`Ambiguous historical alias: ${alias}`);
        aliases.set(alias, question.id);
      }
    }
  }
  function resolve(value) {
    let id = aliases.get(value) || value;
    const seen = new Set();
    while (!byId.has(id) && database.redirects?.[id]) {
      if (seen.has(id)) throw new Error('Canonical redirect cycle.'); seen.add(id); id = database.redirects[id];
    }
    return byId.get(id) || null;
  }
  function search(query, { platforms = [], limit = 20 } = {}) {
    const text = normalize(query), terms = tokens(query), candidates = new Set();
    if (!text) return [];
    for (const term of terms) for (const id of inverted.get(term) || []) candidates.add(id);
    const exact = resolve(query); if (exact) candidates.add(exact.id);
    // Native IDs can be ambiguous across platforms; return every matching question.
    for (const question of database.questions) if (question.versions.some(v => normalize(v.nativeId) === text) || question.titleAliases.some(t => normalize(t) === text)) candidates.add(question.id);
    return [...candidates].flatMap(id => {
      const question = byId.get(id), field = fields.get(id), versions = question.versions.filter(v => !platforms.length || platforms.includes(v.platform));
      if (!versions.length) return [];
      const evidence = [...terms].map(term => ({ term, title: field.title.has(term), topic: field.topics.has(term), statement: field.statement.has(term) }));
      const score = (exact?.id === id ? 100 : 0) + (question.titleAliases.some(t => normalize(t) === text) ? 30 : 0) + (versions.some(v => normalize(v.nativeId) === text) ? 25 : 0)
        + evidence.reduce((sum, item) => sum + Math.log(1 + database.questions.length / (inverted.get(item.term)?.size || 1)) * (item.title ? 5 : item.topic ? 2 : item.statement ? .5 : 0), 0);
      return score ? [{ question, versions, score, evidence }] : [];
    }).sort((a, b) => b.score - a.score || a.question.id.localeCompare(b.question.id)).slice(0, limit);
  }
  function matches(sourceOrAlias, { platforms = [], limit = 12 } = {}) {
    const question = resolve(sourceOrAlias);
    if (!question) return { equivalent: [], platformVariants: [], related: [] };
    const source = bySource.get(sourceOrAlias)?.version || question.versions.find(v => v.aliases.includes(sourceOrAlias));
    const alternatives = question.versions.filter(v => v.id !== source?.id && (!platforms.length || platforms.includes(v.platform)));
    const contract = (source || question.versions[0])?.contract?.variant || 'base';
    const equivalent = alternatives.filter(v => (v.contract?.variant || 'base') === contract).map(version => ({ questionId: question.id, version, relationship: 'equivalent', evidence: question.grouping.method }));
    const platformVariants = alternatives.filter(v => (v.contract?.variant || 'base') !== contract).map(version => ({ questionId: question.id, version, relationship: 'platform-variant', evidence: version.contract?.notes || question.grouping.notes }));
    const reviewed = question.related.flatMap(link => {
      const target = byId.get(link.questionId), versions = target?.versions.filter(v => !platforms.length || platforms.includes(v.platform)) || [];
      return versions.length ? [{ question: target, versions, relationship: 'variant', evidence: link.notes }] : [];
    });
    const reviewedIds = new Set(reviewed.map(result => result.question.id));
    const informative = [...fields.get(question.id).statement].filter(term => (inverted.get(term)?.size || 0) > 1)
      .sort((a, b) => inverted.get(a).size - inverted.get(b).size || a.localeCompare(b)).slice(0, 10);
    const related = [...reviewed, ...search([...question.titleAliases, ...informative].join(' '), { platforms, limit: limit + reviewed.length + 1 })
      .filter(result => result.question.id !== question.id && !reviewedIds.has(result.question.id)).map(result => ({ ...result, relationship: 'related-suggestion' }))].slice(0, limit);
    return { question, equivalent, platformVariants, related };
  }
  return { resolve, search, matches, bySource };
}

// Retrieval intentionally has higher recall than the equivalence policy. These
// substitutions never affect identities, review pins, or automatic grouping.
const synonyms = { loop: 'cycle', cyclic: 'cycle', detect: 'check', detection: 'check', checking: 'check', determine: 'check', largest: 'maximum', smallest: 'minimum', max: 'maximum', min: 'minimum', neighbouring: 'adjacent', neighboring: 'adjacent', consecutive: 'contiguous', duplicate: 'repeat', repeating: 'repeat', repeated: 'repeat', remove: 'delete', removal: 'delete' };
const boilerplate = new Set('integer integers task test case cases format example examples sample print printed line lines space separated denoting denotes function implement already care taken first second third following contains containing consists consist length size array arr nums str string input output note need given return find'.split(' '));
function retrievalTokens(text, statement = false) {
  const result = new Set();
  for (let term of tokens(text)) {
    if (term.length > 3 && term.endsWith('s') && !/(ss|us|is)$/.test(term)) term = term.slice(0, -1);
    term = synonyms[term] || term;
    if (/^\d+$/.test(term) || term.length < 2 || (statement && boilerplate.has(term))) continue;
    result.add(term);
  }
  return result;
}

export function duplicateCandidates(database, { blocked = new Set(), limit = 5000 } = {}) {
  const versions = database.questions.flatMap(q => q.versions.map(v => ({ ...v, questionId: q.id }))).sort((a, b) => a.id.localeCompare(b.id));
  const features = new Map(), titles = new Map(), statements = new Map(), exactTitles = new Map(), fingerprints = new Map(), seen = new Set(), candidates = [];
  const post = (index, term, version) => { if (!index.has(term)) index.set(term, []); index.get(term).push(version); };
  for (const v of versions) {
    const title = retrievalTokens(v.title.replace(v.platform === 'codeforces' ? /^[A-Z]\.\s+/ : /$^/, ''));
    // Judge boilerplate can overwhelm a short objective. Keep it out of scoring.
    const body = (database.texts[v.descriptionRef] || '').split(/\b(?:input\s*format|output\s*format|sample\s*input)\s*:/i)[0].slice(0, 10000);
    const statement = retrievalTokens(body, true), titleKey = [...title].sort().join(' ');
    features.set(v.id, { title, statement, titleKey });
    for (const term of title) post(titles, term, v);
    for (const term of statement) post(statements, term, v);
    if (titleKey) post(exactTitles, titleKey, v);
    if (v.descriptionRef) post(fingerprints, v.fingerprint, v);
  }
  const weights = new Map([...statements].map(([term, rows]) => [term, Math.log(1 + versions.length / rows.length)]));
  for (const f of features.values()) f.statementWeight = [...f.statement].reduce((sum, term) => sum + weights.get(term), 0);
  const weightedOverlap = (a, b) => {
    let weight = 0, shared = 0;
    for (const term of a.statement) if (b.statement.has(term)) { weight += weights.get(term); shared++; }
    return { score: a.statementWeight + b.statementWeight ? 2 * weight / (a.statementWeight + b.statementWeight) : 0, shared };
  };
  for (const a of versions) {
    const own = features.get(a.id), votes = new Map(), pool = new Set(exactTitles.get(own.titleKey) || []);
    for (const v of fingerprints.get(a.fingerprint) || []) pool.add(v);
    const vote = (rows, weight) => { for (const v of rows) if (v.id !== a.id) votes.set(v, (votes.get(v) || 0) + weight); };
    for (const term of [...own.title].sort((x, y) => titles.get(x).length - titles.get(y).length).slice(0, 6)) {
      const rows = titles.get(term); if (rows.length <= 600) vote(rows, 3 * Math.log(1 + versions.length / rows.length));
    }
    // This independent statement channel finds pairs even with no title overlap.
    const terms = [...own.statement].filter(term => statements.get(term).length > 1 && statements.get(term).length <= 250)
      .sort((x, y) => statements.get(x).length - statements.get(y).length || x.localeCompare(y)).slice(0, 12);
    for (const term of terms) vote(statements.get(term), weights.get(term));
    const perPlatform = new Map();
    for (const [v, score] of votes) { if (!perPlatform.has(v.platform)) perPlatform.set(v.platform, []); perPlatform.get(v.platform).push([v, score]); }
    // Each destination platform gets its own quota; Codeforces cannot crowd out AtCoder/GFG.
    for (const rows of perPlatform.values()) for (const [v] of rows.sort((x, y) => y[1] - x[1] || x[0].id.localeCompare(y[0].id)).slice(0, 16)) pool.add(v);
    for (const b of pool) {
      const [left, right] = a.id < b.id ? [a, b] : [b, a], key = JSON.stringify([left.id, right.id]);
      if (a.questionId === b.questionId || seen.has(key) || blocked.has(key)) continue;
      seen.add(key);
      const other = features.get(b.id), titleSimilarity = overlap(own.title, other.title), body = weightedOverlap(own, other);
      const exactEvidence = a.fingerprint === b.fingerprint && a.descriptionRef && b.descriptionRef;
      const exactTitle = own.titleKey && own.titleKey === other.titleKey;
      if (!exactEvidence && !exactTitle && !(titleSimilarity >= .6 && body.score >= .12) && !(body.score >= .38 && body.shared >= 4)) continue;
      const reasons = [];
      if (!a.descriptionRef || !b.descriptionRef) reasons.push('Missing statement: review originals');
      if (a.constraintsRef !== b.constraintsRef) reasons.push('Constraints differ: compare feasible solutions, not literal bounds');
      if (!exactEvidence) reasons.push('Verify objective, output contract and edge cases');
      if (/\b(easy|hard|version|dataset|subtask)\b/i.test(`${a.title} ${b.title}`) || /^[a-z]\d+\./i.test(a.title) || /^[a-z]\d+\./i.test(b.title)) reasons.push('Possible task variant');
      const score = exactEvidence ? 1 : .35 * titleSimilarity + .65 * body.score;
      candidates.push({ left: left.id, right: right.id, leftTitle: left.title, rightTitle: right.title, leftUrl: left.url, rightUrl: right.url,
        platformPair: [left.platform, right.platform].sort().join('/'), crossPlatform: left.platform !== right.platform,
        score: Number(score.toFixed(4)), titleSimilarity: Number(titleSimilarity.toFixed(4)), statementSimilarity: Number(body.score.toFixed(4)),
        discovery: exactEvidence ? 'exact-statement' : exactTitle ? 'title-alias' : titleSimilarity < .5 ? 'statement' : 'title-and-statement',
        fingerprints: { [left.id]: left.reviewFingerprint, [right.id]: right.reviewFingerprint }, reasons, action: 'review-only' });
    }
  }
  return selectCandidates(candidates, limit);
}

export function selectCandidates(candidates, limit = 5000) {
  const order = (a, b) => Number(b.crossPlatform) - Number(a.crossPlatform) || b.score - a.score || a.left.localeCompare(b.left) || a.right.localeCompare(b.right);
  candidates = [...candidates].sort(order);
  const strata = new Map();
  for (const p of candidates) { if (!strata.has(p.platformPair)) strata.set(p.platformPair, []); strata.get(p.platformPair).push(p); }
  const selected = new Set(), quota = Math.min(100, Math.floor(limit / Math.max(1, strata.size)));
  for (const rows of strata.values()) for (const p of rows.slice(0, quota)) selected.add(p);
  for (const p of candidates) { if (selected.size >= limit) break; selected.add(p); }
  const included = [...selected].sort(order);
  return { totalCandidates: candidates.length, crossPlatformCandidates: candidates.filter(p => p.crossPlatform).length,
    statementDiscoveredCandidates: candidates.filter(p => p.discovery === 'statement').length,
    includedCandidates: included.length, omittedCandidates: candidates.length - included.length,
    platformCoverage: Object.fromEntries([...strata].sort(([a], [b]) => a.localeCompare(b)).map(([pair, rows]) => [pair, { total: rows.length, included: rows.filter(p => selected.has(p)).length }])), candidates: included };
}
