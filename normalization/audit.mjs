import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { adaptDatasets, PLATFORMS } from './catalog.mjs';

// Screening records are evidence of work performed, not proof of uniqueness.
// Keep their pins independent from the equivalence decisions used by the build.
export function auditCoverage(versions, audit, { decisions = { groups: [] } } = {}) {
  const all = new Map(versions.map(v => [v.id, v]));
  const current = new Map(versions.filter(v => v.platform === 'leetcode').map(v => [v.id, v]));
  const seen = new Set(), pending = [], counts = {};
  for (const entry of audit.entries) {
    if (seen.has(entry.leetcodeId)) throw new Error(`Duplicate audit entry: ${entry.leetcodeId}`);
    seen.add(entry.leetcodeId);
    const source = current.get(entry.leetcodeId);
    if (!source) { pending.push({ id: entry.leetcodeId, reason: 'removed-source' }); continue; }
    if (source.reviewFingerprint !== entry.fingerprint) {
      pending.push({ id: source.id, reason: 'changed-source' }); continue;
    }
    counts[entry.status] = (counts[entry.status] || 0) + 1;
  }
  for (const id of current.keys()) if (!seen.has(id)) pending.push({ id, reason: 'new-source' });
  const pendingIds = new Set(pending.map(p => p.id));
  for (const group of decisions.groups) {
    const changed = group.members.filter(id => !all.has(id) || all.get(id).reviewFingerprint !== group.fingerprints[id]);
    if (!changed.length) continue;
    for (const id of group.members.filter(id => current.has(id) && !pendingIds.has(id))) {
      pendingIds.add(id);
      const status = audit.entries.find(e => e.leetcodeId === id)?.status;
      if (status && counts[status]) counts[status]--;
      pending.push({ id, reason: 'changed-equivalent-source', sources: changed });
    }
  }
  return { total: current.size, accountedFor: current.size - pending.filter(p => p.reason !== 'removed-source').length, counts, pending };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = new URL('../', import.meta.url), datasets = {};
  for (const platform of PLATFORMS) datasets[platform] = JSON.parse(await readFile(new URL(`data/${platform}-data.json`, root), 'utf8'));
  const companies = JSON.parse(await readFile(new URL('data/leetcode-companies.json', root), 'utf8'));
  const audit = JSON.parse(await readFile(new URL('normalization/leetcode-audit.json', root), 'utf8'));
  const decisions = JSON.parse(await readFile(new URL('normalization/decisions.json', root), 'utf8'));
  const report = auditCoverage(adaptDatasets(datasets, companies).versions, audit, { decisions });
  console.log(JSON.stringify(report, null, 2));
  if (report.pending.length) process.exitCode = 1;
}
