// Regression evaluation on reviewed overlap labels. Unlabeled candidates cannot
// establish precision or estimate the number of duplicates in the whole corpus.
export function evaluateRetrieval(candidates, decisions) {
  const keys = new Set(candidates.map(p => JSON.stringify([p.left, p.right].sort())));
  const expected = new Map();
  for (const group of decisions.groups) for (let i = 0; i < group.members.length; i++) for (const right of group.members.slice(i + 1)) {
    const left = group.members[i];
    expected.set(JSON.stringify([left, right].sort()), { left, right, crossPlatform: left.split(':')[0] !== right.split(':')[0] });
  }
  const found = [...expected].filter(([key]) => keys.has(key)).length;
  const cross = [...expected].filter(([, pair]) => pair.crossPlatform);
  return { benchmark: 'Reviewed core-question overlaps; not an independent semantic-accuracy estimate',
    expectedPairs: expected.size, retrievedPairs: found, recall: expected.size ? Number((found / expected.size).toFixed(4)) : null,
    expectedCrossPlatformPairs: cross.length, retrievedCrossPlatformPairs: cross.filter(([key]) => keys.has(key)).length,
    misses: [...expected].filter(([key]) => !keys.has(key)).map(([, pair]) => pair),
    precision: null, precisionNote: 'Remaining candidates are unlabeled; similarity scores and candidate counts do not prove equivalence.' };
}
