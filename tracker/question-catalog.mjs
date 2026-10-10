// Compact catalog metadata is joined to the existing source records. Stored
// tracker keys remain native; canonical IDs are used only for browsing.
export async function sourceDigest(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function attachQuestionCatalog(records, catalog, sourceHashes = {}) {
  if (catalog?.schemaVersion !== 1 || !Array.isArray(catalog.questions) || !Array.isArray(catalog.inputs)) throw new Error('Unsupported question catalog.');
  if (catalog.inputs.some(input => typeof input.platform !== 'string' || !/^[a-f\d]{64}$/.test(input.sha256))) throw new Error('Invalid catalog snapshot hashes.');
  const verified = new Set(catalog.inputs.filter(input => sourceHashes[input.platform] === input.sha256).map(input => input.platform));
  const sourceId = record => `${record.platform}:${encodeURIComponent(String(record.id).trim())}`;
  const byId = new Map(records.map(record => [sourceId(record), record])), attached = new Map(), seen = new Set();
  for (const question of catalog.questions) {
    if (typeof question.id !== 'string' || !Array.isArray(question.versions) || typeof question.title !== 'string') throw new Error('Invalid catalog question.');
    for (const version of question.versions) {
      if (seen.has(version.id)) throw new Error('Conflicting catalog source identity.');
      seen.add(version.id);
    }
    if (question.versions.length < 2 || question.versions.some(version => !byId.has(version.id) || !verified.has(byId.get(version.id).platform) || byId.get(version.id).title !== version.title)) continue;
    const versions = question.versions.map(version => ({ ...byId.get(version.id), canonicalId: question.id, canonicalTitle: question.title,
      titleAliases: question.titleAliases || [], ...(version.contract ? { contract: version.contract } : {}) }));
    for (const version of versions) attached.set(sourceId(version), { ...version, catalogVersions: versions });
  }
  return records.map(record => attached.get(sourceId(record)) || record);
}

export function collapseQuestions(records) {
  const rows = [], grouped = new Map();
  for (const record of records) {
    if (!record.canonicalId) { rows.push(record); continue; }
    if (!grouped.has(record.canonicalId)) {
      const row = { ...record, title: record.canonicalTitle || record.title, matchedVersions: [], versions: record.catalogVersions || [record] };
      grouped.set(record.canonicalId, row); rows.push(row);
    }
    grouped.get(record.canonicalId).matchedVersions.push(record);
  }
  for (const row of grouped.values()) {
    row.topics = [...new Set(row.matchedVersions.flatMap(version => version.topics))];
    const evidence = row.matchedVersions.filter(version => Number.isFinite(version.frequency));
    row.frequency = evidence.length ? Math.max(...evidence.map(version => version.frequency)) : null;
    row.frequencySources = evidence.map(version => ({ platform: version.platform, frequency: version.frequency }));
  }
  return rows;
}
