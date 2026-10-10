# Shared question catalog

This is the shared question catalog used by the extension. The six scraped datasets remain the source snapshots. `data/normalized/questions.json` contains canonical questions with all their platform versions and title aliases. The extension joins the compact runtime catalog to these source snapshots. Confirmed equivalents appear once in the question library and company lists, with Solve on links for their platform versions. Search includes original title aliases, and the page matcher prioritizes confirmed copies using the current problem URL.

Run from the repository root with Node 22 or newer:

```sh
node normalization/build.mjs
node normalization/build.mjs --check
node normalization/audit.mjs
node --test --test-isolation=none tests/unit/*.test.mjs
```

The build uses local files, with no API calls or model dependencies. Finish a scraper run before building. `--check` verifies that all generated files match the current source snapshots, decisions, and identity registry byte for byte. It fails if a scraper has changed an input. Generated files have no wall-clock timestamps.

## LeetCode review record

`reviews/leetcode-audit.json` records individual screening of every LeetCode entry in the reviewed snapshot. Each entry retains its source fingerprint, review status, rationale, confirmed counterpart IDs, rejected matches and candidate evidence. `reviewed` means the entry was screened and proposed matches were compared semantically; it does not prove that every equivalent in the other datasets has been found. `missing-statement` and `needs-source-verification` identify incomplete evidence and unresolved candidates. Confirmed matches can coexist with an unresolved additional candidate.

`reviews/leetcode-resolution-1-1500.json` and `reviews/leetcode-resolution-1501-2750.json` preserve review batch outcomes and supporting notes. They are reference records; the build consumes `decisions.json`, and the audit command checks `reviews/leetcode-audit.json`.

Run `node normalization/audit.mjs` after future scraping. It reads the current source snapshots directly, reports new, changed and removed LeetCode entries, and exits unsuccessfully if any require an updated audit. It also counts the unchanged reviewed, missing-statement and deferred entries. Keep the ledger and decisions: unchanged reviews remain reusable. A previously missing statement becoming available is a changed source that needs review. This command checks review coverage; the normal build separately validates every confirmed mapping and its statement pins.

## Data contract

- `questions.json`: schema version, source snapshot hashes, company provenance, retired-ID redirects, canonical questions, and an interned `texts` table.
- Each question has a permanent opaque `q_…` ID, preferred title, title aliases, topic union, evidenced company IDs, platform versions, grouping evidence, and separately reviewed related tasks. The canonical unit is the core question: indexing, sentinels, tie-breaking and output ordering may vary by platform.
- For such differences, a version's `contract` names its variant and explains the required adaptation. Grouping has `scope: "core-task"`. These versions share a canonical ID, but matching does not claim their outputs are interchangeable. A changed objective remains a separate canonical task.
- Each version retains its platform/native ID, exact original title and URL, old tracker key and URL aliases, platform difficulty, premium status, original topics, normalized topics, metadata, and company associations. `descriptionRef` / `constraintsRef` reference cleaned text. Original text is retained under `originalDescriptionRef` / `originalConstraintsRef` when presentation cleaning changes it. Mathematical case, comparison operators, superscripts, subscripts, and negation are preserved.
- Company associations belong to individual source versions. Their evidence retains source, time window, and frequency. A canonical question collects those company IDs; other platform versions do not gain invented interview frequency. Code360 tags have no numeric frequency or snapshot date.
- `runtime.json`: compact confirmed groups, title aliases, platform contract notes, and source snapshot hashes. The browser loads this instead of the full offline corpus. A missing or changed source snapshot leaves affected questions separate. Existing saved, list, note, and solved keys stay platform-specific.
- `identities.json`: persistent source-to-canonical assignments, historical URL/key aliases, and retired-ID redirects. **Keep this file across refreshes**; deleting it discards continuity from earlier curation. IDs never derive from question titles. A merge redirects retired IDs. After a split, the old canonical ID stays with the first deterministic partition; resolve source IDs/URLs when a specific platform task is needed.
- `report.md`: readable counts, examples, retrieval coverage and regression results. `review-report.json`: issues and up to 5,000 ranked candidate pairs, with explicit included/omitted counts and pinned review fingerprints. Review sampling reserves coverage for every platform pair, then prioritizes cross-platform candidates. These pairs are suggestions, not merges or an exhaustive duplicate list.
- `manifest.json`: SHA-256 and byte counts for the generated files. Files are staged before replacement and the manifest is replaced last. A consumer should verify this manifest to detect an interrupted build.

## Merge policy

Automatic grouping requires matching normalized titles, substantive case-sensitive statements, identical constraints, and agreement across every pair in the group. It excludes explicit variants, numbered Codeforces variants, different tasks in the same Codeforces contest, empty/short statements, and obvious truncation. It never builds groups from connected fuzzy matches.

Different wording or constraints require semantic review of the objective, inputs, outputs, edge cases, and whether the same algorithm meets each source's bounds. Literal constraint equality is not required for reviewed groups. Same-core questions can have explicit platform contract variants: one-based versus zero-based indices, different overflow sentinels, earliest versus rightmost palindrome ties, or ordered versus unordered results. Retain those differences on the versions. Different objectives stay separate: Two Sum returning indices, enumerating all value pairs, and a YES/NO existence verdict; coin minimization versus counting combinations; Sudoku validation versus deciding solvability; or four-neighbor versus eight-neighbor island connectivity.

`decisions.json` is repository-maintained semantic curation, not a user-facing grouping feature. Its reviewed groups and negative decisions are pinned to the current statements; the generated report gives current counts. To curate another candidate:

1. Read the original source statements and constraints, including output contracts. A missing statement cannot justify a merge. A cached dangling example heading is not useful evidence; accept only when the preceding text specifies the full task, otherwise leave it for source verification.
2. For equivalence, add a group with a newly allocated permanent `q_` UUID, preferred `title`, all `members` as platform/native IDs, each version's `reviewFingerprint` in `fingerprints`, review date, and a rationale. Existing reviewed groups keep their IDs when adding members.
3. For a platform contract difference within a group, add `versionContracts` keyed by source ID, each with `variant` and explanatory `notes`. Matching compares those variant names within the group, using `base` when unspecified. For a related task with a different objective, add a pair with `left`, `right`, `relation: "variant"`, pins and notes. Use `different` for unrelated tasks. Related-task links are symmetric and do not merge canonical questions.
4. Rebuild, inspect the report and diff, then run checks. A changed title/statement/constraint invalidates its review. Stale groups are left separate and reported; negative decisions continue blocking automatic merging until reviewed. Missing sources are reported. Do not blindly regenerate review fingerprints to silence stale reviews.

Unsupported schemas, duplicate source identities, conflicting URL aliases, overlapping reviewed groups, and contradictory decisions fail the build. Invalid source records are quarantined in the report instead of silently lost. Resolve reported issues before distributing a refreshed runtime catalog.

## Search and matching API

`search.mjs` has no Node dependencies and is available for offline catalog exploration:

```js
import { createQuestionSearch } from './normalization/search.mjs';
const catalog = createQuestionSearch(database);
catalog.search("Kadane's Algorithm", { platforms: ['leetcode', 'geeksforgeeks'] });
catalog.resolve('leetcode:53');       // native source ID, URL, old key, or canonical ID
catalog.matches('leetcode:53');       // equivalent, platformVariants, and related results
```

Search ranks title aliases, native IDs, topics, and statements with inverse-frequency token weights. It returns one result per canonical question with the available platform versions. Matching also uses informative statement terms to retrieve related questions. Equivalent versions, platform contract variants, reviewed related tasks, and heuristic suggestions have distinct labels. Source IDs and URLs disambiguate numeric IDs.

Offline discovery independently retrieves by title aliases, exact statements, and rare statement terms. It strips judge boilerplate, uses lightweight stemming/synonyms and inverse-frequency-weighted statement overlap, and gives each destination platform a candidate quota. It can propose matches with zero title overlap. These lexical features improve recall; they do not provide general semantic understanding or authorize a merge.

The build runs discovery before grouping and measures recall on all reviewed core-question pairs, including misses. This is a regression benchmark on the curated labels, not an independent test set. Precision and total undiscovered overlap remain unknown. Unlabeled candidate counts must never be presented as duplicate counts.

Future work: improve candidate retrieval with semantic embeddings and a larger independent labeled evaluation set, then review high-confidence cross-platform candidates. Keep embeddings/scores as replaceable evidence behind this schema, rather than using them as IDs or automatically merging transitive clusters. Review new mappings before rebuilding the runtime catalog; preserve native tracker keys and source-backed metadata.
