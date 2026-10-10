import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { adaptDatasets, buildDatabase, cleanText, PLATFORMS, pairKey, hash } from '../normalization/catalog.mjs';
import { createQuestionSearch, duplicateCandidates, selectCandidates } from '../normalization/search.mjs';
import { evaluateRetrieval } from '../normalization/evaluation.mjs';
import { auditCoverage } from '../normalization/audit.mjs';

const statement = 'Given an array of integers, return the maximum sum of a nonempty contiguous subarray. Negative values are allowed in every input.';
const row = (id, overrides = {}) => ({ id, title: 'Maximum Subarray', url: `https://leetcode.com/problems/task-${id}/`, description: statement, constraints: '1 <= n <= 100000', topics: ['arrays'], difficulty: 'Medium', ...overrides });
const datasets = (rows, others = {}) => ({ ...Object.fromEntries(PLATFORMS.map(p => [p, []])), leetcode: rows, ...others });
const adapt = rows => adaptDatasets(datasets(rows));
const pins = (data, ids) => Object.fromEntries(ids.map(id => [id, data.byId.get(id).reviewFingerprint]));
const group = (data, members, extra = {}) => ({ id: 'q_11111111111111111111111111111111', title: 'Maximum Subarray', members, fingerprints: pins(data, members), ...extra });
const decide = (groups = [], pairs = []) => ({ schemaVersion: 1, groups, pairs });

test('saved LeetCode audit flags new and changed statements after scraping', () => {
  const data = adapt([row(1), row(2)]);
  const audit = { entries: [{ leetcodeId: 'leetcode:1', fingerprint: data.byId.get('leetcode:1').reviewFingerprint, status: 'reviewed' }] };
  assert.deepEqual(auditCoverage(data.versions, audit).pending, [{ id: 'leetcode:2', reason: 'new-source' }]);
  const changed = adapt([row(1, { constraints: 'n <= 2' })]);
  assert.deepEqual(auditCoverage(changed.versions, audit).pending, [{ id: 'leetcode:1', reason: 'changed-source' }]);
  assert.throws(() => auditCoverage(data.versions, { entries: [...audit.entries, ...audit.entries] }), /Duplicate audit entry/);
  const other = { ...data.versions[1], id: 'code360:2', platform: 'code360' };
  const decisions = { groups: [{ members: ['leetcode:1', 'code360:2'], fingerprints: { 'leetcode:1': audit.entries[0].fingerprint, 'code360:2': 'old-fingerprint' } }] };
  const drift = auditCoverage([data.versions[0], other], audit, { decisions });
  assert.deepEqual(drift.pending, [{ id: 'leetcode:1', reason: 'changed-equivalent-source', sources: ['code360:2'] }]);
  assert.equal(drift.accountedFor, 0);
  assert.equal(drift.counts.reviewed, 0);
});

test('candidate retrieval accepts numeric title spelling and inflections without merging', () => {
  const data = adapt([row(1, { title: '3Sum', description: 'Return the unique triples whose sum is zero.' }), row(2, { title: 'Three Sum', description: 'Enumerate triples adding to zero.' }), row(3, { title: 'Palindromic Partitioning', description: 'Split the word into valid pieces.' }), row(4, { title: 'Palindrome Partitioning', description: 'Produce partitions of the string.' })]);
  const candidates = duplicateCandidates({ questions: data.versions.map(v => ({ id: v.id, versions: [v] })), texts: data.texts }, { limit: Infinity });
  const pairs = new Set(candidates.candidates.map(p => pairKey(p.left, p.right)));
  assert.ok(pairs.has(pairKey('leetcode:1', 'leetcode:2')));
  assert.ok(pairs.has(pairKey('leetcode:3', 'leetcode:4')));
  assert.equal(buildDatabase(data).database.questions.length, 4);
});

test('normalization cleans presentation while preserving operators, negation and mathematical case', () => {
  assert.equal(cleanText('<p>A &lt; B and x<sup>2</sup> is not x<sub>2</sub>.</p>'), 'A < B and x^(2) is not x_(2).');
  assert.equal(cleanText('&#x110000; &#55296;'), '&#x110000; &#55296;');
  const data = adapt([row(1), row(2, { description: statement.toLowerCase() }), row(3, { description: statement.replace('nonempty', 'empty') })]);
  assert.equal(buildDatabase(data).database.questions.length, 3);
  for (const [left, right] of [['n < 5', 'n > 5'], ['x<sup>2</sup>', 'x<sub>2</sub>'], ['must be sorted', 'must not be sorted']]) {
    assert.equal(buildDatabase(adapt([row(1, { description: statement + left }), row(2, { description: statement + right })])).database.questions.length, 2);
  }
});

test('exact grouping needs substantive statements, matching constraints and complete pair agreement', () => {
  assert.equal(buildDatabase(adapt([row(1), row(2)])).database.questions.length, 1);
  for (const override of [{ constraints: '1 <= n <= 10' }, { description: '' }, { title: 'Maximum Subarray Hard' }, { description: statement + ' Return the indices.' }]) {
    assert.equal(buildDatabase(adapt([row(1), row(2, override)])).database.questions.length, 2);
  }
  assert.equal(buildDatabase(adapt([row(1, { description: 'Add numbers.' }), row(2, { description: 'Add numbers.' })])).database.questions.length, 2);
  assert.equal(buildDatabase(adapt([row(1, { description: statement + ' For' }), row(2, { description: statement + ' For' })])).database.questions.length, 2);
  const data = adapt([row(1), row(2), row(3)]);
  const pair = { left: 'leetcode:1', right: 'leetcode:3', relation: 'different', fingerprints: pins(data, ['leetcode:1', 'leetcode:3']) };
  assert.equal(buildDatabase(data, { decisions: decide([], [pair]) }).database.questions.length, 3, 'no transitive union around a rejected pair');
});

test('same-contest and numbered Codeforces variants never auto-merge from duplicated cached text', () => {
  const cf = (id, contest, letter, title) => row(id, { url: `https://codeforces.com/problemset/problem/${contest}/${letter}`, title });
  const data = adaptDatasets(datasets([], { codeforces: [cf('1639A', 1639, 'A', 'A. Treasure Hunt'), cf('1639B', 1639, 'B', 'B. Treasure Hunt'), cf('1970D2', 1970, 'D2', 'D2. Arithmancy'), cf('1971D2', 1971, 'D2', 'D2. Arithmancy')] }));
  assert.equal(buildDatabase(data).database.questions.length, 4);
});

test('reviewed aliases improve search without changing native difficulties, company evidence or source data', () => {
  const lc = row(1), gfg = row(7, { title: "Kadane's Algorithm", url: 'https://www.geeksforgeeks.org/problems/kadane/1', difficulty: 'Easy', topics: ['dp'], description: '<p>' + statement + '</p>' });
  const input = datasets([lc], { geeksforgeeks: [gfg] }), before = JSON.stringify(input);
  const data = adaptDatasets(input, { source: { revision: 'pinned' }, companies: [{ id: 'amazon', name: 'Amazon', windows: { '6m': { 'task-1': 42 } } }] });
  const result = buildDatabase(data, { decisions: decide([group(data, ['leetcode:1', 'geeksforgeeks:7'])]) });
  const search = createQuestionSearch(result.database), canonical = search.resolve('leetcode:1');
  assert.equal(search.search("Kadane's Algorithm")[0].question.id, canonical.id);
  assert.deepEqual(search.search('Maximum Subarray', { platforms: ['geeksforgeeks'] })[0].versions.map(v => v.platform), ['geeksforgeeks']);
  assert.equal(search.matches(gfg.url).equivalent[0].version.id, 'leetcode:1');
  assert.deepEqual(canonical.versions.map(v => v.difficulty), ['Medium', 'Easy']);
  assert.deepEqual(canonical.companyIds, ['amazon']);
  assert.deepEqual(canonical.versions[0].companyAssociations[0].evidence, [{ sourceRef: 'leetcodeCompanies', window: '6m', frequency: 42 }]);
  assert.deepEqual(canonical.versions[1].companyAssociations, []);
  assert.equal(result.database.texts[canonical.versions[1].originalDescriptionRef], gfg.description);
  assert.equal(JSON.stringify(input), before);
});

test('review pins invalidate on statement, constraints or title changes and absent sources do not break builds', () => {
  const data = adapt([row(1), row(2)]), decisions = decide([group(data, ['leetcode:1', 'leetcode:2'])]);
  for (const changed of [{ description: statement + ' Extra output.' }, { constraints: 'n < 5' }, { title: 'Maximum Subarray Hard' }]) {
    const result = buildDatabase(adapt([row(1), row(2, changed)]), { decisions });
    assert.equal(result.stats.staleReviews, 1);
    assert.equal(result.database.questions.length, 2);
  }
  const pair = { left: 'leetcode:1', right: 'leetcode:2', relation: 'variant', fingerprints: pins(data, ['leetcode:1', 'leetcode:2']) };
  const absent = buildDatabase(adapt([row(1)]), { decisions: decide([], [pair]) });
  assert.equal(absent.stats.staleReviews, 1);
  assert.deepEqual(absent.database.questions[0].related, []);
  assert.throws(() => buildDatabase(data, { decisions: decide(decisions.groups, [pair]) }), /conflicts/);
});

test('native identities and historical URLs survive title changes, merges, splits and source reordering', () => {
  const separate = adapt([row(1), row(2, { title: "Kadane's Algorithm" })]);
  const first = buildDatabase(separate), firstSearch = createQuestionSearch(first.database), id1 = firstSearch.resolve('leetcode:1').id, id2 = firstSearch.resolve('leetcode:2').id;
  const decisions = decide([group(separate, ['leetcode:1', 'leetcode:2'])]);
  const merged = buildDatabase(separate, { decisions, identities: first.identities });
  const mergedSearch = createQuestionSearch(merged.database);
  assert.equal(mergedSearch.resolve(id1).id, decisions.groups[0].id);
  assert.equal(mergedSearch.resolve(id2).id, decisions.groups[0].id);
  const changed = adapt([row(2, { title: 'New label', url: 'https://leetcode.com/problems/new-label/' }), row(1)]);
  const split = buildDatabase(changed, { identities: merged.identities });
  const splitSearch = createQuestionSearch(split.database);
  assert.equal(split.database.questions.length, 2);
  assert.equal(splitSearch.resolve('https://leetcode.com/problems/task-2/').id, splitSearch.resolve('leetcode:2').id);
  assert.notEqual(splitSearch.resolve('leetcode:1').id, splitSearch.resolve('leetcode:2').id);
  const reordered = buildDatabase(adapt([row(1), row(2, { title: 'New label', url: 'https://leetcode.com/problems/new-label/' })]), { identities: merged.identities });
  assert.deepEqual(split.database, reordered.database);
});

test('candidate similarity remains review-only; reviewed variants are returned separately from equivalents', () => {
  const data = adapt([row(1), row(2, { description: statement + ' Return indices instead of the sum.' })]);
  const plain = buildDatabase(data), reviews = duplicateCandidates(plain.database);
  assert.equal(plain.database.questions.length, 2);
  assert.equal(reviews.candidates[0].action, 'review-only');
  const pair = { left: 'leetcode:1', right: 'leetcode:2', relation: 'variant', notes: 'Different output', fingerprints: pins(data, ['leetcode:1', 'leetcode:2']) };
  const result = buildDatabase(data, { decisions: decide([], [pair]) });
  const matches = createQuestionSearch(result.database).matches('leetcode:1');
  assert.equal(matches.equivalent.length, 0);
  assert.equal(matches.related[0].relationship, 'variant');
  assert.equal(duplicateCandidates(result.database, { blocked: new Set([pairKey(pair.left, pair.right)]) }).totalCandidates, 0);
});

test('invalid records are quarantined and conflicting native identities fail rather than discard data', () => {
  const result = buildDatabase(adapt([row(1), row(null), row(3, { url: 'https://evil.test/problem' }), row(4, { url: 'https://me@leetcode.com/problems/x/' })]));
  assert.equal(result.stats.sourceVersions, 1);
  assert.equal(result.stats.rejectedRecords, 3);
  assert.equal(result.stats.rawRecords, 4);
  assert.throws(() => adapt([row(1), row(1)]), /Duplicate native identity/);
});

test('one canonical core task retains platform-specific contracts without calling them interchangeable', () => {
  const description = 'Given a sorted integer array and a target, return two distinct one-based indices whose values sum to the target. A solution is guaranteed.';
  const data = adapt([row(1, { title: 'Two Sum Sorted', description }), row(2, { title: 'Two Sum Sorted', description: description.replace('one-based', 'zero-based') })]);
  const g = group(data, ['leetcode:1', 'leetcode:2'], { title: 'Two Sum Sorted', versionContracts: { 'leetcode:2': { variant: 'zero-based-indices', notes: 'Return zero-based indices; the base contract uses one-based indices.' } } });
  const result = buildDatabase(data, { decisions: decide([g]) }), search = createQuestionSearch(result.database);
  assert.equal(result.database.questions.length, 1);
  assert.equal(result.stats.coreTaskGroups, 1);
  assert.equal(search.search('Two Sum Sorted').length, 1);
  assert.equal(search.matches('leetcode:1').equivalent.length, 0);
  assert.equal(search.matches('leetcode:1').platformVariants[0].relationship, 'platform-variant');
  assert.match(search.matches('leetcode:1').platformVariants[0].evidence, /zero-based/);
  assert.equal(search.matches('leetcode:2').platformVariants[0].version.id, 'leetcode:1');
  assert.throws(() => buildDatabase(data, { decisions: decide([{ ...g, versionContracts: { 'leetcode:999': { variant: 'x', notes: 'Unknown source' } } }]) }), /platform contract/);
});

test('statement retrieval discovers renamed tasks with zero shared title words and never merges on similarity', () => {
  const data = adapt([row(1, { title: 'Redwood', description: 'Place cameras on binary tree nodes. Each camera covers its parent, itself, and its immediate children. Minimize the camera count needed to cover every node.' }),
    row(2, { title: 'Blue Oak', description: 'Install cameras on binary tree nodes. Each camera covers itself, its immediate children, and its parent. Calculate the minimum camera count to cover every node.' })]);
  const result = buildDatabase(data), candidates = duplicateCandidates(result.database);
  assert.equal(result.database.questions.length, 2);
  assert.equal(candidates.candidates.length, 1);
  assert.equal(candidates.candidates[0].titleSimilarity, 0);
  assert.equal(candidates.candidates[0].discovery, 'statement');
  assert.equal(candidates.candidates[0].action, 'review-only');
  const evaluation = evaluateRetrieval(candidates.candidates, decide([group(data, ['leetcode:1', 'leetcode:2'])]));
  assert.equal(evaluation.recall, 1);
  assert.equal(evaluation.precision, null);
  assert.equal(evaluateRetrieval([], decide([group(data, ['leetcode:1', 'leetcode:2'])])).misses.length, 1);
});

test('review sampling reserves coverage for smaller platform pairs and is deterministic', () => {
  const candidate = (i, pair, score) => ({ left: `a:${i}`, right: `b:${i}`, platformPair: pair, crossPlatform: true, score, discovery: 'statement' });
  const crowded = Array.from({ length: 50 }, (_, i) => candidate(i, 'code360/leetcode', .99 - i / 10000));
  const smaller = Array.from({ length: 3 }, (_, i) => candidate(i + 100, 'atcoder/leetcode', .5));
  const selected = selectCandidates([...crowded, ...smaller], 10);
  assert.equal(selected.includedCandidates, 10);
  assert.equal(selected.platformCoverage['atcoder/leetcode'].included, 3);
  assert.deepEqual(selectCandidates([...smaller, ...crowded].reverse(), 10), selected);
  assert.equal(selectCandidates(crowded, 0).includedCandidates, 0);
});

test('reviewed Two Sum copies share core tasks while preserving tie rules and distinct objectives', async () => {
  const db = JSON.parse(await readFile(new URL('../data/normalized/questions.json', import.meta.url), 'utf8'));
  const search = createQuestionSearch(db);
  const indices = search.resolve('leetcode:1'), existence = search.resolve('geeksforgeeks:703092');
  assert.equal(search.resolve('code360:8546').id, indices.id);
  assert.equal(search.resolve('code360:23516').id, existence.id);
  assert.equal(search.resolve('q_a5e23ddeb1d15491e6185f82e20e8fa8').id, indices.id, 'the former LeetCode canonical ID redirects after merging');
  assert.equal(search.resolve('q_911bce9ea3f2f2192940909d363d6c07').id, existence.id, 'the former Code360 canonical ID redirects after merging');
  assert.notEqual(indices.id, existence.id, 'returning indices and deciding existence remain different tasks');
  assert.notEqual(search.resolve('code360:8164').id, indices.id, 'enumerating all pairs remains a different task');
  assert.notEqual(search.resolve('leetcode:167').id, indices.id, 'sorted input remains a different task');
  const matches = search.matches('leetcode:1');
  assert.ok(!matches.equivalent.some(m => m.version.id === 'code360:8546'));
  const variant = matches.platformVariants.find(m => m.version.id === 'code360:8546');
  assert.match(variant.evidence, /lexicographically smallest/);
  assert.match(variant.evidence, /\[-1,-1\]/);
  assert.ok(matches.related.some(m => m.question.id === existence.id));
  assert.ok(search.search('2 Sum').some(m => m.question.id === indices.id));
});

test('reviewed renamed equivalents resolve by original titles and native URLs', async () => {
  const db = JSON.parse(await readFile(new URL('../data/normalized/questions.json', import.meta.url), 'utf8'));
  const search = createQuestionSearch(db);
  for (const [left, right] of [
    ['leetcode:869', 'code360:12447'],
    ['leetcode:530', 'leetcode:783'],
    ['leetcode:530', 'geeksforgeeks:712351'],
    ['leetcode:721', 'geeksforgeeks:712507'],
    ['leetcode:721', 'code360:9744'],
    ['leetcode:930', 'geeksforgeeks:712151'],
    ['leetcode:994', 'code360:22981'],
  ]) {
    const question = search.resolve(left), version = search.bySource.get(right).version;
    assert.equal(search.resolve(right).id, question.id, `${left} / ${right}`);
    assert.equal(search.resolve(version.url).id, question.id);
    assert.ok(search.search(version.title).some(m => m.question.id === question.id));
  }
  const bridges = search.matches('leetcode:1192');
  assert.ok(bridges.platformVariants.some(m => m.version.id === 'code360:17361'));
  assert.ok(!bridges.equivalent.some(m => m.version.id === 'code360:17361'));
});

test('generated corpus retains every source, validates its manifest and meets the reviewed search/match examples', async () => {
  const base = new URL('../data/normalized/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', base), 'utf8'));
  for (const [name, expected] of Object.entries(manifest.files)) {
    const raw = await readFile(new URL(name, base), 'utf8');
    assert.equal(hash(raw), expected.sha256, name);
    assert.equal(Buffer.byteLength(raw), expected.bytes, name);
  }
  const db = JSON.parse(await readFile(new URL('questions.json', base), 'utf8'));
  const report = JSON.parse(await readFile(new URL('review-report.json', base), 'utf8'));
  const decisions = JSON.parse(await readFile(new URL('../normalization/decisions.json', import.meta.url), 'utf8'));
  const search = createQuestionSearch(db), seen = new Set();
  const audit = JSON.parse(await readFile(new URL('../normalization/leetcode-audit.json', import.meta.url), 'utf8'));
  const coverage = auditCoverage(db.questions.flatMap(q => q.versions), audit);
  assert.deepEqual(coverage.pending, []);
  assert.equal(coverage.accountedFor, coverage.total);
  for (const entry of audit.entries) {
    assert.ok(['reviewed', 'missing-statement', 'needs-source-verification'].includes(entry.status));
    const version = search.bySource.get(entry.leetcodeId).version;
    if (entry.status === 'missing-statement') assert.equal(version.descriptionRef, null);
    for (const match of entry.equivalents) assert.equal(search.resolve(entry.leetcodeId).id, search.resolve(match.id).id);
    for (const rejected of entry.rejected) assert.notEqual(search.resolve(entry.leetcodeId).id, search.resolve(rejected.id).id);
  }
  for (const platform of PLATFORMS) {
    const raw = await readFile(new URL(`../data/${platform}-data.json`, import.meta.url), 'utf8');
    const rows = JSON.parse(raw);
    assert.equal(hash(raw), db.inputs.find(input => input.platform === platform).sha256, `${platform} snapshot changed; rebuild`);
    for (const source of rows) {
      const id = `${platform}:${encodeURIComponent(String(source.id).trim())}`;
      assert.ok(search.bySource.has(id), id);
      assert.equal(search.bySource.get(id).version.title, source.title);
      assert.equal(search.resolve(source.url).id, search.resolve(id).id);
      assert.ok(!seen.has(id)); seen.add(id);
    }
  }
  assert.equal(seen.size, report.stats.sourceVersions);
  assert.equal(seen.size - db.questions.length, report.stats.removedDuplicateEntries);
  assert.deepEqual(report.issues, []);
  for (const g of decisions.groups) for (const id of g.members) assert.equal(search.resolve(id).id, g.id);
  for (const p of decisions.pairs) assert.notEqual(search.resolve(p.left).id, search.resolve(p.right).id);
  assert.ok(report.evaluation.expectedPairs >= 100);
  assert.ok(report.evaluation.recall >= .95, JSON.stringify(report.evaluation.misses));
  const palindrome = search.matches('leetcode:5');
  assert.ok(palindrome.platformVariants.some(p => p.version.id === 'code360:8506' && p.version.contract.variant === 'rightmost-longest'));
  assert.ok(!palindrome.equivalent.some(p => p.version.id === 'code360:8506'));
  assert.equal(search.search("Kadane's Algorithm")[0].question.id, search.resolve('leetcode:53').id);
  assert.equal(search.search('dp_a', { platforms: ['atcoder'] })[0].versions[0].nativeId, 'dp_a');
  assert.equal(new Set(search.search('reverse linked list').map(r => r.question.id)).size, search.search('reverse linked list').length);
});
