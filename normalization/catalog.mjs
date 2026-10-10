import { createHash } from 'node:crypto';
import { problemKey, safeProblemUrl } from '../tracker/core.mjs';
import { canonicalCompanyId, splitCode360Tags } from '../tracker/companies/code360-companies.mjs';

export const SCHEMA_VERSION = 1;
export const NORMALIZER_VERSION = 2;
export const PLATFORMS = ['leetcode', 'geeksforgeeks', 'codeforces', 'codechef', 'code360', 'atcoder'];
export const hash = text => createHash('sha256').update(text).digest('hex');
const sorted = values => [...new Set(values)].sort();
const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', le: '≤', ge: '≥', times: '×', minus: '−' };

export function cleanText(value) {
  return String(value ?? '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<sup\b[^>]*>([\s\S]*?)<\/sup>/gi, '^($1)')
    .replace(/<sub\b[^>]*>([\s\S]*?)<\/sub>/gi, '_($1)')
    .replace(/<\/?(?:p|div|span|br|pre|code|strong|b|em|i|ul|ol|li|sub|sup|h[1-6]|table|tr|td|th|a)\b[^>]*>/gi, ' ')
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, entity) => {
      if (entity.startsWith('#')) { const n = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1)); return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : whole; }
      return entities[entity.toLowerCase()] ?? whole;
    }).normalize('NFKC').replace(/\s+/g, ' ').trim();
}
export const textKey = value => cleanText(value).toLowerCase();
export function titleKey(title, platform) {
  let value = textKey(title);
  // Strip presentation labels, but retain numbered variants such as D1/D2.
  if (platform === 'codeforces') value = value.replace(/^[a-z]\.\s+/, '');
  return value.replace(/\b(a|an|the)\b/g, ' ').replace(/[^\p{L}\p{N}+<>=-]+/gu, ' ').replace(/\s+/g, ' ').trim();
}
export function statementFingerprint(version, texts) {
  // Case can distinguish mathematical variables. Only presentation whitespace is ignored.
  return `sha256:${hash(JSON.stringify([cleanText(texts[version.descriptionRef] || ''), cleanText(texts[version.constraintsRef] || '')]))}`;
}
export function pairKey(a, b) { return JSON.stringify([a, b].sort()); }
export const pairs = members => members.flatMap((a, i) => members.slice(i + 1).map(b => [a, b]));
const topicAliases = { arrays: 'Array', array: 'Array', strings: 'String', string: 'String', graphs: 'Graph', graph: 'Graph', trees: 'Tree', tree: 'Tree', dp: 'Dynamic Programming', 'dynamic programming': 'Dynamic Programming', hashing: 'Hash Table', 'hash table': 'Hash Table', 'binary search': 'Binary Search', 'linked list': 'Linked List' };
const assert = (condition, message) => { if (!condition) throw new Error(message); };

export function adaptDatasets(datasets, companyData = { companies: [] }) {
  const texts = {}, versions = [], byId = new Map(), aliases = new Map(), issues = [];
  const intern = text => { if (!text) return null; const id = `t_${hash(text)}`; texts[id] = text; return id; };
  const companyNames = new Map(), companyLookup = new Map(), lcAssociations = new Map();
  for (const c of companyData.companies || []) {
    const id = canonicalCompanyId(c.id);
    companyNames.set(id, { id, name: c.name, aliases: sorted(c.aliases || []) });
    for (const name of [c.id, c.name, ...(c.aliases || [])]) companyLookup.set(canonicalCompanyId(name), id);
    for (const [window, questions] of Object.entries(c.windows || {})) for (const [slug, frequency] of Object.entries(questions)) {
      assert(Number.isFinite(frequency) && frequency >= 0 && frequency <= 100, `Invalid company frequency: ${id}/${slug}`);
      if (!lcAssociations.has(slug)) lcAssociations.set(slug, new Map());
      const associations = lcAssociations.get(slug);
      if (!associations.has(id)) associations.set(id, { companyId: id, evidence: [] });
      associations.get(id).evidence.push({ sourceRef: 'leetcodeCompanies', window, frequency });
    }
  }
  for (const platform of PLATFORMS) {
    const rows = datasets[platform];
    assert(Array.isArray(rows), `Missing or invalid ${platform} dataset.`);
    for (const [index, raw] of rows.entries()) {
      const reject = reason => issues.push({ platform, index, nativeId: raw?.id ?? null, reason });
      if (!raw || typeof raw.title !== 'string' || !raw.title.trim() || !safeProblemUrl(raw.url, platform)) { reject('Missing title or unsafe source URL'); continue; }
      const url = new URL(raw.url);
      if (url.username || url.password || url.port) { reject('Credentials or nonstandard port in URL'); continue; }
      const nativeId = typeof raw.id === 'string' || (typeof raw.id === 'number' && Number.isFinite(raw.id)) ? String(raw.id).trim() : '';
      if (!nativeId) { reject('Missing native ID; refusing to invent a title-based identity'); continue; }
      const id = `${platform}:${encodeURIComponent(nativeId)}`, key = problemKey(platform, raw.url);
      const tags = platform === 'code360' ? splitCode360Tags(raw) : { topics: Array.isArray(raw.topics) ? raw.topics.filter(t => typeof t === 'string') : [], companies: [] };
      const description = cleanText(typeof raw.description === 'string' ? raw.description : ''), constraints = cleanText(typeof raw.constraints === 'string' ? raw.constraints : '');
      const companyAssociations = [];
      if (platform === 'leetcode') companyAssociations.push(...(lcAssociations.get(url.pathname.split('/problems/')[1]?.split('/')[0])?.values() || []));
      for (const name of tags.companies) {
        const canonical = canonicalCompanyId(name), companyId = companyLookup.get(canonical) || canonical;
        if (!companyNames.has(companyId)) companyNames.set(companyId, { id: companyId, name, aliases: [] });
        if (!companyAssociations.some(a => a.companyId === companyId)) companyAssociations.push({ companyId, evidence: [{ sourceRef: 'code360Tags', window: null, frequency: null }] });
      }
      url.search = ''; url.hash = '';
      const version = { id, platform, nativeId, title: raw.title, url: raw.url, legacyKey: key, aliases: sorted([id, key, raw.url, url.href]),
        difficulty: raw.difficulty || 'Unknown', isPremium: raw.isPremium === true, topics: sorted(tags.topics.map(t => topicAliases[textKey(t)] || cleanText(t)).filter(Boolean)), originalTopics: Array.isArray(raw.topics) ? raw.topics : [],
        descriptionRef: intern(description), constraintsRef: intern(constraints), companyAssociations: companyAssociations.sort((a, b) => a.companyId.localeCompare(b.companyId)),
        metadata: Object.fromEntries(Object.entries(raw).filter(([field]) => !['id', 'title', 'url', 'difficulty', 'isPremium', 'topics', 'description', 'constraints'].includes(field))) };
      if (typeof raw.description === 'string' && raw.description !== description) version.originalDescriptionRef = intern(raw.description);
      if (typeof raw.constraints === 'string' && raw.constraints !== constraints) version.originalConstraintsRef = intern(raw.constraints);
      version.fingerprint = statementFingerprint(version, texts);
      version.reviewFingerprint = `sha256:${hash(JSON.stringify([version.title, version.fingerprint]))}`;
      assert(!byId.has(id), `Duplicate native identity ${id}; fix the source data before building.`);
      for (const alias of version.aliases) { assert(!aliases.has(alias) || aliases.get(alias) === id, `Conflicting source alias: ${alias}`); aliases.set(alias, id); }
      byId.set(id, version); versions.push(version);
    }
  }
  versions.sort((a, b) => a.id.localeCompare(b.id));
  return { versions, byId, texts, issues, companies: [...companyNames.values()].sort((a, b) => a.id.localeCompare(b.id)), sources: {
    leetcodeCompanies: companyData.source || null,
    code360Tags: { name: 'Scraped Code360 company tags', path: 'data/code360-data.json', frequency: null, snapshotDate: null },
  } };
}

export function exactMergeBlockers(a, b, texts) {
  const reasons = [];
  if (a.fingerprint !== b.fingerprint) reasons.push('Statements or constraints differ');
  if (titleKey(a.title, a.platform) !== titleKey(b.title, b.platform)) reasons.push('Titles need semantic review');
  const statement = texts[a.descriptionRef] || '';
  if (statement.length < 80 || (statement.match(/[\p{L}\p{N}]+/gu)?.length || 0) < 15) reasons.push('Insufficient statement evidence');
  if (/\b(?:for|note|example|input|output)\s*:?\s*$|(?:\.\.\.|…)\s*$/i.test(statement)) reasons.push('Possibly truncated cached statement');
  if (/\b(easy|medium|hard|version|subtask|dataset|interactive|output.only|small|large)\b/i.test(`${a.title} ${b.title}`)) reasons.push('Explicit task variant in title');
  if (a.platform === 'codeforces' && b.platform === 'codeforces') {
    const left = new URL(a.url).pathname.match(/\/(?:problemset\/problem|contest|gym)\/(\d+)/)?.[1];
    const right = new URL(b.url).pathname.match(/\/(?:problemset\/problem|contest|gym)\/(\d+)/)?.[1];
    if (left && left === right) reasons.push('Different tasks in the same contest');
    if (/^[a-z]\d+\./i.test(a.title) || /^[a-z]\d+\./i.test(b.title)) reasons.push('Numbered contest variants');
  }
  return reasons;
}

export function buildDatabase(adapted, { decisions = { schemaVersion: 1, groups: [], pairs: [] }, identities = { schemaVersion: 1, assignments: {}, aliases: {}, redirects: {} }, inputs = [] } = {}) {
  assert(decisions.schemaVersion === 1 && identities.schemaVersion === 1, 'Unsupported decisions or identity registry version.');
  const { versions, byId, texts } = adapted;
  const registry = structuredClone(identities), issues = [...adapted.issues], blocked = new Set(), reviewed = [], occupied = new Set();
  registry.assignments ||= {}; registry.aliases ||= {}; registry.redirects ||= {};
  for (const p of decisions.pairs || []) {
    assert(['variant', 'different'].includes(p.relation), 'Invalid reviewed pair relationship.');
    assert(typeof p.left === 'string' && typeof p.right === 'string' && p.left !== p.right, 'Invalid reviewed pair identities.');
    blocked.add(pairKey(p.left, p.right));
    if ([p.left, p.right].some(id => !byId.has(id) || p.fingerprints?.[id] !== byId.get(id).reviewFingerprint)) issues.push({ reason: 'Pair review is stale or a source is missing', left: p.left, right: p.right });
  }
  for (const group of decisions.groups || []) {
    assert(/^q_[a-f\d-]{16,64}$/.test(group.id) && typeof group.title === 'string' && group.title.trim(), 'Invalid canonical group ID or title.');
    assert(Array.isArray(group.members) && group.members.length >= 2 && new Set(group.members).size === group.members.length, 'A reviewed group needs distinct source members.');
    for (const [source, contract] of Object.entries(group.versionContracts || {})) assert(group.members.includes(source) && typeof contract.variant === 'string' && contract.variant.trim() && typeof contract.notes === 'string' && contract.notes.trim(), 'A platform contract needs a member identity, variant and explanation.');
    assert(group.members.every(id => !occupied.has(id)), 'A source belongs to multiple reviewed groups.');
    group.members.forEach(id => occupied.add(id));
    assert(!pairs(group.members).some(([a, b]) => blocked.has(pairKey(a, b))), 'Reviewed group conflicts with a variant/different decision.');
    if (group.members.some(id => !byId.has(id) || group.fingerprints?.[id] !== byId.get(id).reviewFingerprint)) {
      issues.push({ reason: 'Group review is stale or a source is missing; group was not applied', groupId: group.id, members: group.members });
      // Stale reviewed sources cannot be automatically regrouped in the same build.
      continue;
    }
    reviewed.push({ id: group.id, title: group.title.trim(), members: group.members, method: 'reviewed', notes: group.notes || '', versionContracts: group.versionContracts || {} });
  }
  const groups = [...reviewed], assigned = new Set(reviewed.flatMap(g => g.members)), buckets = new Map();
  for (const v of versions) {
    if (occupied.has(v.id)) continue;
    const key = `${v.fingerprint}:${titleKey(v.title, v.platform)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(v);
  }
  for (const bucket of buckets.values()) {
    // Complete pair agreement only. Never take connected components of fuzzy matches.
    if (bucket.length < 2 || pairs(bucket).some(([a, b]) => blocked.has(pairKey(a.id, b.id)) || exactMergeBlockers(a, b, texts).length)) continue;
    groups.push({ members: bucket.map(v => v.id), method: 'exact-evidence' }); bucket.forEach(v => assigned.add(v.id));
  }
  for (const v of versions) if (!assigned.has(v.id)) groups.push({ members: [v.id], method: 'single-source' });

  const claimed = new Set(), questions = [], activeIds = new Set(), assignmentsBefore = { ...registry.assignments };
  // An old ID stays with its first deterministic partition after a split. All old aliases survive.
  groups.sort((a, b) => (a.id ? 0 : 1) - (b.id ? 0 : 1) || [...a.members].sort()[0].localeCompare([...b.members].sort()[0]));
  for (const group of groups) {
    const members = group.members.map(id => byId.get(id)).sort((a, b) => PLATFORMS.indexOf(a.platform) - PLATFORMS.indexOf(b.platform) || a.id.localeCompare(b.id));
    const oldIds = sorted(members.map(v => assignmentsBefore[v.id]).filter(Boolean));
    const id = group.id || oldIds.find(old => !claimed.has(old)) || `q_${hash([...group.members].sort()[0]).slice(0, 32)}`;
    assert(!claimed.has(id), `Canonical identity collision: ${id}`); claimed.add(id); activeIds.add(id);
    const title = group.title || cleanText(members[0].title).replace(members[0].platform === 'codeforces' ? /^[A-Z]\.\s+/ : /$^/, '');
    for (const v of members) {
      registry.assignments[v.id] = id;
      registry.aliases[v.id] = sorted([...(registry.aliases[v.id] || []), ...v.aliases]);
    }
    questions.push({ id, title, titleAliases: sorted([title, ...members.map(v => v.title)]), topics: sorted(members.flatMap(v => v.topics)), platforms: sorted(members.map(v => v.platform)), companyIds: sorted(members.flatMap(v => v.companyAssociations.map(a => a.companyId))),
      grouping: { method: group.method, ...(Object.keys(group.versionContracts || {}).length ? { scope: 'core-task' } : {}), ...(group.notes ? { notes: group.notes } : {}) },
      versions: members.map(v => ({ ...v, aliases: registry.aliases[v.id], ...(group.versionContracts?.[v.id] ? { contract: group.versionContracts[v.id] } : {}) })), related: [] });
  }
  // Retired IDs may redirect only when every former member still maps to the same question.
  const destinations = new Map();
  for (const [source, oldId] of Object.entries(assignmentsBefore)) if (registry.assignments[source] && byId.has(source)) {
    if (!destinations.has(oldId)) destinations.set(oldId, new Set()); destinations.get(oldId).add(registry.assignments[source]);
  }
  for (const [oldId, ids] of destinations) if (!activeIds.has(oldId)) registry.redirects[oldId] = ids.size === 1 ? [...ids][0] : null;
  for (const id of activeIds) delete registry.redirects[id];
  const questionsById = new Map(questions.map(q => [q.id, q]));
  for (const p of decisions.pairs || []) if (p.relation === 'variant' && [p.left, p.right].every(id => byId.has(id) && p.fingerprints?.[id] === byId.get(id).reviewFingerprint)) {
    const left = registry.assignments[p.left], right = registry.assignments[p.right];
    assert(left !== right, 'Related variants were accidentally grouped.');
    for (const [a, b] of [[left, right], [right, left]]) if (!questionsById.get(a).related.some(r => r.questionId === b)) questionsById.get(a).related.push({ questionId: b, relationship: 'variant', notes: p.notes || '' });
  }
  questions.sort((a, b) => a.id.localeCompare(b.id));
  const database = { schemaVersion: SCHEMA_VERSION, normalizerVersion: NORMALIZER_VERSION, inputs, sources: adapted.sources, companies: adapted.companies, redirects: registry.redirects, questions, texts: Object.fromEntries(Object.entries(texts).sort(([a], [b]) => a.localeCompare(b))) };
  const stats = { rawRecords: inputs.reduce((n, input) => n + input.records, 0) || versions.length + adapted.issues.length, sourceVersions: versions.length, uniqueQuestions: questions.length, removedDuplicateEntries: versions.length - questions.length, groupedQuestions: questions.filter(q => q.versions.length > 1).length, exactGroups: groups.filter(g => g.method === 'exact-evidence').length, reviewedGroups: reviewed.length, missingStatements: versions.filter(v => !v.descriptionRef).length, rejectedRecords: adapted.issues.length, staleReviews: issues.length - adapted.issues.length, sharedTexts: Object.keys(texts).length };
  stats.coreTaskGroups = questions.filter(q => q.grouping.scope === 'core-task').length;
  stats.crossPlatformGroups = questions.filter(q => q.platforms.length > 1).length;
  return { database, identities: registry, stats, issues, blocked };
}
