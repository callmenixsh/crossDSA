import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, join } from 'node:path';
import { adaptDatasets, buildDatabase, PLATFORMS, hash, pairKey } from './catalog.mjs';
import { createQuestionSearch, duplicateCandidates, selectCandidates } from './search.mjs';
import { evaluateRetrieval } from './evaluation.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), output = join(root, 'data', 'normalized');
const check = process.argv.includes('--check');
if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('Usage: node normalization/build.mjs [--check]');
const datasets = {}, inputs = [];
for (const platform of PLATFORMS) {
  const path = `data/${platform}-data.json`, raw = await readFile(join(root, path), 'utf8');
  datasets[platform] = JSON.parse(raw); inputs.push({ platform, path, sha256: hash(raw), records: datasets[platform].length });
}
const companyRaw = await readFile(join(root, 'data', 'leetcode-companies.json'), 'utf8');
const decisionsRaw = await readFile(join(root, 'normalization', 'decisions.json'), 'utf8');
let identities;
try { identities = JSON.parse(await readFile(join(output, 'identities.json'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const adapted = adaptDatasets(datasets, JSON.parse(companyRaw));
const decisions = JSON.parse(decisionsRaw);
const result = buildDatabase(adapted, { decisions, identities, inputs });
// Validate consumers' alias resolution before writing any generated data.
createQuestionSearch(result.database);
// Discover before grouping so recall can be measured against the reviewed labels,
// rather than hiding already-normalized positives from the benchmark.
const discovery = duplicateCandidates({ questions: adapted.versions.map(v => ({ id: v.id, versions: [v] })), texts: adapted.texts }, { limit: Infinity });
const evaluation = evaluateRetrieval(discovery.candidates, decisions);
const reviews = selectCandidates(discovery.candidates.filter(p => result.identities.assignments[p.left] !== result.identities.assignments[p.right] && !result.blocked.has(pairKey(p.left, p.right))));
const report = { schemaVersion: 1, inputs, companyInputHash: hash(companyRaw), decisionsHash: hash(decisionsRaw), stats: result.stats, issues: result.issues, evaluation, ...reviews };
const markdown = `# Question normalization report\n\nGenerated offline from the six scraped datasets. The extension joins a compact runtime catalog to the source snapshots for shared question rows and confirmed matches.\n\n| Metric | Count |\n| --- | ---: |\n${Object.entries(result.stats).map(([name, count]) => `| ${name} | ${count.toLocaleString('en-US')} |`).join('\n')}\n\n${reviews.includedCandidates} of ${reviews.totalCandidates} candidate pairs are included in review-report.json (${reviews.omittedCandidates} omitted). Similarity is a retrieval heuristic, not an equivalence probability. Candidates are never merged automatically.\n\n${result.issues.length ? '## Issues\n\n' + result.issues.map(issue => '- ' + JSON.stringify(issue)).join('\n') : 'No rejected records or stale reviews.'}\n\n## Example canonical questions\n\n${result.database.questions.filter(q => q.versions.length > 1).slice(0, 12).map(q => `- **${q.title}** (${q.id}; ${q.grouping.method}): ${q.versions.map(v => `${v.platform}: ${v.title}`).join(' / ')}`).join('\n')}\n\n## First review candidates\n\n${reviews.candidates.slice(0, 20).map(p => `- ${p.left} (${p.leftTitle}) ↔ ${p.right} (${p.rightTitle}): ${p.score}; ${p.reasons.join('; ') || 'Exact cached evidence requires review'}`).join('\n')}\n`;
const coverage = `\n## Retrieval coverage\n\n${reviews.crossPlatformCandidates.toLocaleString('en-US')} candidate pairs cross platform boundaries. ${reviews.statementDiscoveredCandidates.toLocaleString('en-US')} pairs were discovered through statements despite low title overlap. These counts include unverified similarities and are not duplicate counts.\n\n| Platform pair | Candidates | Included for review |\n| --- | ---: | ---: |\n${Object.entries(reviews.platformCoverage).map(([pair, counts]) => `| ${pair} | ${counts.total} | ${counts.included} |`).join('\n')}\n\n## Reviewed-overlap regression benchmark\n\nRetrieval found ${evaluation.retrievedPairs} of ${evaluation.expectedPairs} reviewed core-question pairs (${evaluation.retrievedCrossPlatformPairs} of ${evaluation.expectedCrossPlatformPairs} across platforms). This checks the existing curated labels, not independent semantic accuracy. Precision over the unlabeled corpus is unknown.\n\n${evaluation.misses.length ? 'Missed pairs:\n' + evaluation.misses.map(p => `- ${p.left} / ${p.right}`).join('\n') : 'No reviewed overlaps missed.'}\n`;
const runtime = { schemaVersion: 1, normalizerVersion: result.database.normalizerVersion, inputs,
  questions: result.database.questions.filter(q => q.versions.length > 1).map(q => ({ id: q.id, title: q.title, titleAliases: q.titleAliases,
    versions: q.versions.map(v => ({ id: v.id, title: v.title, ...(v.contract ? { contract: v.contract } : {}) })) })) };
const files = { 'questions.json': JSON.stringify(result.database) + '\n', 'identities.json': JSON.stringify(result.identities) + '\n', 'review-report.json': JSON.stringify(report, null, 2) + '\n', 'report.md': markdown + coverage, 'runtime.json': JSON.stringify(runtime) + '\n' };
const manifest = { schemaVersion: 1, files: Object.fromEntries(Object.entries(files).map(([name, text]) => [name, { sha256: hash(text), bytes: Buffer.byteLength(text) }])) };
files['manifest.json'] = JSON.stringify(manifest, null, 2) + '\n';
if (check) {
  for (const [name, text] of Object.entries(files)) {
    const existing = await readFile(join(output, name), 'utf8');
    if (existing !== text) throw new Error(`Generated ${name} is stale. Run node normalization/build.mjs.`);
  }
  console.log('Normalized artifacts are current and reproducible.');
} else {
  await mkdir(output, { recursive: true });
  const pending = [];
  try {
    for (const [name, text] of Object.entries(files)) {
      const temporary = join(output, `${name}.${process.pid}.tmp`); pending.push(temporary); await writeFile(temporary, text, 'utf8');
    }
    // Manifest is replaced last so consumers can detect an interrupted multi-file build.
    for (const name of Object.keys(files)) await rename(join(output, `${name}.${process.pid}.tmp`), join(output, name));
  } finally { for (const path of pending) await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  console.log(JSON.stringify({ ...result.stats, reviewCandidates: reviews.totalCandidates, output: 'data/normalized/' }, null, 2));
}
