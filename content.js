const PROBLEM_DATA_FILES = [
    'data/leetcode-data.json',
    'data/geeksforgeeks-data.json',
    'data/codeforces-data.json',
    'data/codechef-data.json',
    'data/code360-data.json',
    'data/atcoder-data.json'
];

const FILE_SOURCES = {
    'data/leetcode-data.json': 'leetcode',
    'data/geeksforgeeks-data.json': 'geeksforgeeks',
    'data/codeforces-data.json': 'codeforces',
    'data/codechef-data.json': 'codechef',
    'data/code360-data.json': 'code360',
    'data/atcoder-data.json': 'atcoder'
};

const DEFAULT_PLATFORMS = ['leetcode', 'geeksforgeeks', 'codeforces', 'codechef', 'code360', 'atcoder'];

let preferredPlatforms = [];
let platformPreferences = DEFAULT_PLATFORMS.slice();
const DEFAULT_PLATFORM_ORDER = ['leetcode', 'codeforces', 'codechef', 'geeksforgeeks', 'code360', 'atcoder'];
let platformDisplayOrder = DEFAULT_PLATFORM_ORDER.slice();
let connectedAccounts = {};
function updatePreferredPlatforms() {
    preferredPlatforms = platformDisplayOrder.filter(id => platformPreferences.includes(id) && connectedAccounts[id]);
}
let problemsData = [];
let buttonContainer = null;
let isSearching = false;
let searchRequestId = 0;
let currentFloatingPosition = null;
const FLOATING_POSITION_PREFIX = 'dsa-helper-floating-position:';
const FLOATING_EDGE_MARGIN = 12;
const DRAG_START_DISTANCE = 5;

async function loadProblemsData() {
    try {
        const hashes = {};
        let catalogModule;
        try { catalogModule = await import(chrome.runtime.getURL('tracker/question-catalog.mjs')); } catch { /* Source matching remains available. */ }
        const results = await Promise.all(PROBLEM_DATA_FILES.map(async (file) => {
            try {
                const response = await fetch(chrome.runtime.getURL(file));
                if (!response.ok) {
                    console.log(`${file} not available (${response.status})`);
                    return [];
                }
                const text = await response.text(), data = JSON.parse(text);
                if (!Array.isArray(data)) return [];
                const source = FILE_SOURCES[file];
                if (catalogModule) hashes[source] = await catalogModule.sourceDigest(text);
                return data.map(p => {
                    if (!p || typeof p !== 'object') return p;
                    return { ...p, source, platform: source };
                });
            } catch (fileError) {
                console.log(`Failed to load ${file}:`, fileError);
                return [];
            }
        }));

        problemsData = results.flat();
        if (catalogModule) {
            try {
                const response = await fetch(chrome.runtime.getURL('data/normalized/runtime.json'));
                if (response.ok) problemsData = catalogModule.attachQuestionCatalog(problemsData.filter(p => p && typeof p === 'object'), await response.json(), hashes);
            } catch { /* Missing/stale metadata cannot create confirmed matches. */ }
        }
        console.log('Loaded problems data:', problemsData.length, 'problems across', PROBLEM_DATA_FILES.length, 'platforms');
    } catch (error) {
        console.log('Failed to load problems data:', error);
        problemsData = [];
    }
}

const STOPWORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
    'he', 'i', 'in', 'is', 'it', 'its', 'of', 'on', 'or', 'that',
    'the', 'their', 'them', 'these', 'they', 'this', 'to', 'was',
    'were', 'will', 'with', 'would', 'about', 'above', 'after',
    'again', 'against', 'all', 'also', 'am', 'any', 'because',
    'been', 'before', 'being', 'below', 'between', 'both', 'but',
    'can', 'could', 'did', 'do', 'does', 'doing', 'down', 'during',
    'each', 'few', 'further', 'had', 'has', 'have', 'her', 'hers',
    'herself', 'him', 'himself', 'his', 'how', 'into', 'itself',
    'just', 'more', 'most', 'much', 'must', 'my', 'myself', 'nor',
    'not', 'now', 'off', 'once', 'only', 'other', 'our', 'ours',
    'ourselves', 'out', 'own', 'same', 'she', 'should', 'so', 'some',
    'such', 'than', 'then', 'there', 'therefore', 'those', 'through',
    'under', 'until', 'up', 'very', 'what', 'when', 'where', 'which',
    'while', 'who', 'whom', 'why', 'you', 'your', 'yours', 'yourself',
    'yourselves', 'given', 'input', 'output', 'print', 'return',
    'find', 'found', 'take', 'taken', 'using', 'use', 'write',
    'written', 'implement', 'function', 'method', 'complete',
    'task', 'called', 'call', 'example', 'sample', 'expected',
    'follow', 'following', 'follows', 'assume', 'contain', 'means',
    'mean', 'end', 'ends', 'equal', 'equals', 'greater', 'less',
    'total', 'note', 'first', 'last', 'every', 'eachother', 'asked',
    'specified'
]);

const STEP2_MAP = [
    ['ational', 'ate'], ['tional', 'tion'], ['enci', 'ence'],
    ['anci', 'ance'], ['izer', 'ize'], ['abli', 'able'],
    ['alli', 'al'], ['entli', 'ent'], ['eli', 'e'], ['ousli', 'ous'],
    ['ization', 'ize'], ['ation', 'ate'], ['ator', 'ate'],
    ['alism', 'al'], ['iveness', 'ive'], ['fulness', 'ful'],
    ['ousness', 'ous'], ['aliti', 'al'], ['iviti', 'ive'],
    ['biliti', 'ble'], ['logi', 'log']
];

const STEP3_MAP = [
    ['icate', 'ic'], ['ative', ''], ['alize', 'al'], ['iciti', 'ic'],
    ['ical', 'ic'], ['ful', ''], ['ness', '']
];

const STEP4_SUFFIXES = [
    'ement', 'ance', 'ence', 'able', 'ible', 'ment', 'al', 'er',
    'ic', 'ant', 'ent', 'ou', 'ism', 'ate', 'iti', 'ous', 'ive', 'ize'
];

function containsVowel(s) {
    return /[aeiou]/.test(s);
}

function measure(s) {
    let m = 0;
    let vowelSeq = false;
    let consonantSeq = false;
    for (let i = 0; i < s.length; i++) {
        const v = /[aeiou]/.test(s[i]);
        if (v) {
            if (consonantSeq) {
                vowelSeq = true;
                consonantSeq = false;
            } else {
                vowelSeq = true;
            }
        } else {
            if (vowelSeq) {
                m++;
                vowelSeq = false;
                consonantSeq = true;
            } else {
                consonantSeq = true;
            }
        }
    }
    return m;
}

function cvcEnding(s) {
    if (s.length < 3) return false;
    const last = s[s.length - 1];
    if (last === 'w' || last === 'x' || last === 'y') return false;
    return !/[aeiou]/.test(s[s.length - 3]) &&
        /[aeiou]/.test(s[s.length - 2]) &&
        !/[aeiou]/.test(s[s.length - 1]);
}

function step1b(sw) {
    if (sw.endsWith('at') || sw.endsWith('bl') || sw.endsWith('iz')) return sw + 'e';
    if (/(.)\1$/.test(sw) && !/[aeiou]/.test(sw[sw.length - 1]) && !/[lsz]$/.test(sw)) {
        return sw.slice(0, -1);
    }
    if (measure(sw) === 1 && cvcEnding(sw)) return sw + 'e';
    return sw;
}

function stem(word) {
    if (word.length <= 2) return word;

    // Step 1a
    if (word.endsWith('sses')) word = word.slice(0, -2);
    else if (word.endsWith('ies')) word = word.slice(0, -2);
    else if (word.endsWith('ss')) { /* unchanged */ }
    else if (word.endsWith('s')) word = word.slice(0, -1);

    // Step 1b
    if (word.endsWith('eed')) {
        if (measure(word.slice(0, -3)) > 0) word = word.slice(0, -1);
    } else if (word.endsWith('ed')) {
        const stemmed = word.slice(0, -2);
        if (containsVowel(stemmed)) word = step1b(stemmed);
    } else if (word.endsWith('ing')) {
        const stemmed = word.slice(0, -3);
        if (containsVowel(stemmed)) word = step1b(stemmed);
    }

    // Step 1c
    if (word.endsWith('y') && containsVowel(word.slice(0, -1))) {
        word = word.slice(0, -1) + 'i';
    }

    // Step 2
    for (const [suf, rep] of STEP2_MAP) {
        if (word.endsWith(suf) && measure(word.slice(0, -suf.length)) > 0) {
            word = word.slice(0, -suf.length) + rep;
            break;
        }
    }

    // Step 3
    for (const [suf, rep] of STEP3_MAP) {
        if (word.endsWith(suf) && measure(word.slice(0, -suf.length)) > 0) {
            word = word.slice(0, -suf.length) + rep;
            break;
        }
    }

    // Step 4
    for (const suf of STEP4_SUFFIXES) {
        if (word.endsWith(suf) && measure(word.slice(0, -suf.length)) > 1) {
            word = word.slice(0, -suf.length);
            break;
        }
    }
    if (word.endsWith('ion')) {
        const base = word.slice(0, -3);
        if (/[st]/.test(word[word.length - 4] || '') && measure(base) > 1) {
            word = base;
        }
    }

    // Step 5a
    if (word.endsWith('e')) {
        const base = word.slice(0, -1);
        const m = measure(base);
        if (m > 1 || (m === 1 && !cvcEnding(base))) word = base;
    }

    // Step 5b
    if (measure(word) > 1 && word.endsWith('ll')) word = word.slice(0, -1);

    return word;
}

// Tokenize: lowercase, strip punctuation, drop stopwords/numbers, stem, dedupe.
function tokenize(str) {
    if (!str) return [];
    const norm = str.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
    const seen = new Set();
    const out = [];
    for (const w of norm.split(' ')) {
        if (w.length < 2 || /^\d+$/.test(w)) continue;
        if (STOPWORDS.has(w)) continue;
        const s = stem(w);
        if (s.length < 2 || STOPWORDS.has(s) || seen.has(s)) continue;
        seen.add(s);
        out.push(s);
    }
    return out;
}

function toBigrams(tokens) {
    const set = new Set();
    for (let i = 1; i < tokens.length; i++) {
        set.add(tokens[i - 1] + ' ' + tokens[i]);
    }
    return set;
}

let TITLE_IDF = new Map();
const PROBLEM_TOKEN_CACHE = new WeakMap();

function computeTitleIdf() {
    const df = new Map();
    for (const p of problemsData) {
        const toks = new Set(tokenize(p.title));
        for (const t of toks) df.set(t, (df.get(t) || 0) + 1);
    }
    const n = Math.max(problemsData.length, 1);
    TITLE_IDF = new Map();
    for (const [t, c] of df) {
        TITLE_IDF.set(t, Math.log((n + 1) / (c + 1)) + 1);
    }
}

function getProblemTokens(problem) {
    let cached = PROBLEM_TOKEN_CACHE.get(problem);
    if (!cached) {
        const titleToks = tokenize(problem.title);
        const descToks = tokenize(problem.description);
        cached = {
            titleToks: titleToks,
            descToks: descToks,
            titleUniq: new Set(titleToks),
            descUniq: new Set(descToks),
            titleBgrams: toBigrams(titleToks),
            descBgrams: toBigrams(descToks),
            topics: normalizeTopics(problem.topics || []),
            concepts: extractConcepts(
                `${problem.title || ''} ${problem.description || ''} ${problem.constraints || ''}`,
                problem.topics || []
            )
        };
        PROBLEM_TOKEN_CACHE.set(problem, cached);
    }
    return cached;
}

// How much of the candidate's content appears on the page.
// Rare words (per title IDF) count more than boilerplate ones, and matches
// spanning several distinct tokens are far stronger evidence than a single
// common token (e.g. "array" appearing in most array problem statements).
function textOverlap(pageUniq, pageBgrams, tokens, bgrams) {
    if (!tokens.length) return 0;
    const uniq = new Set(tokens);
    let weightedHit = 0;
    let weightedTotal = 0;
    let matchedCount = 0;
    for (const t of uniq) {
        const w = TITLE_IDF.get(t) || 1;
        weightedTotal += w;
        if (pageUniq.has(t)) {
            weightedHit += w;
            matchedCount++;
        }
    }
    let score = weightedTotal > 0 ? weightedHit / weightedTotal : 0;
    score *= 1 - Math.exp(-matchedCount / 1.4);

    if (bgrams && bgrams.size && pageBgrams) {
        let bgHit = 0;
        if (bgrams.size <= pageBgrams.size) {
            for (const b of bgrams) if (pageBgrams.has(b)) bgHit++;
        } else {
            for (const b of pageBgrams) if (bgrams.has(b)) bgHit++;
        }
        score = score * 0.7 + (bgHit / bgrams.size) * 0.3;
    }
    return score;
}

// Dice coefficient between two token sets; used to collapse near-identical titles.
// Pure Dice (not containment) so a generic 2-token title like "Sort Array" does
// not swallow every other title that happens to contain those words.
function titleIsDuplicate(titleToks, seenToks) {
    if (!titleToks.length || !seenToks.length) return false;
    const sa = new Set(titleToks);
    const sb = new Set(seenToks);
    let common = 0;
    for (const t of sa) if (sb.has(t)) common++;
    return (2 * common) / (sa.size + sb.size) >= 0.9;
}

const TOPIC_ALIASES = new Map(Object.entries({
    'dp': 'Dynamic Programming',
    'dynamic programming': 'Dynamic Programming',
    'dfs': 'Depth-First Search',
    'dfs and similar': 'Depth-First Search',
    'depth first search': 'Depth-First Search',
    'bfs': 'Breadth-First Search',
    'breadth first search': 'Breadth-First Search',
    'binary search': 'Binary Search',
    'two pointers': 'Two Pointers',
    'sliding window': 'Sliding Window',
    'prefix sum': 'Prefix Sum',
    'prefix sums': 'Prefix Sum',
    'hash table': 'Hashing',
    'hashing': 'Hashing',
    'graphs': 'Graph',
    'graph': 'Graph',
    'trees': 'Tree',
    'tree': 'Tree',
    'binary trees': 'Binary Tree',
    'binary tree': 'Binary Tree',
    'linked list': 'Linked List',
    'recursion': 'Recursion',
    'backtracking': 'Backtracking',
    'greedy': 'Greedy',
    'sorting': 'Sorting',
    'heap': 'Heap',
    'heaps': 'Heap',
    'stack': 'Stack',
    'queues': 'Queue',
    'queue': 'Queue',
    'strings': 'String',
    'string': 'String',
    'arrays': 'Array',
    'array': 'Array',
    'bit manipulation': 'Bit Manipulation',
    'union find': 'Union Find',
    'disjoint set': 'Union Find',
    'shortest paths': 'Shortest Path',
    'shortest path': 'Shortest Path',
    'trie': 'Trie',
    'tries': 'Trie',
    'math': 'Math',
    'combinatorics': 'Combinatorics',
    'geometry': 'Geometry',
    'matrix': 'Matrix',
    'divide and conquer': 'Divide and Conquer'
}));

const CONCEPT_PATTERNS = [
    ['Dynamic Programming', /\b(dynamic programming|memoization|tabulation|dp)\b/i],
    ['Sliding Window', /\bsliding window\b/i],
    ['Two Pointers', /\btwo pointers?\b/i],
    ['Prefix Sum', /\bprefix sums?\b/i],
    ['Binary Search', /\bbinary search\b/i],
    ['Depth-First Search', /\b(depth[- ]first search|dfs)\b/i],
    ['Breadth-First Search', /\b(breadth[- ]first search|bfs)\b/i],
    ['Backtracking', /\bbacktrack(?:ing)?\b/i],
    ['Greedy', /\bgreedy\b/i],
    ['Union Find', /\b(union[ -]find|disjoint sets?)\b/i],
    ['Shortest Path', /\b(shortest path|dijkstra|bellman[ -]ford|floyd[ -]warshall)\b/i],
    ['Topological Sort', /\btopological sort\b/i],
    ['Heap', /\b(heap|priority queue)\b/i],
    ['Stack', /\bstacks?\b/i],
    ['Trie', /\btries?\b/i],
    ['Graph', /\b(graph|vertices|vertex|edges)\b/i],
    ['Binary Tree', /\b(binary tree|binary search tree|bst)\b/i],
    ['Linked List', /\blinked lists?\b/i],
    ['Matrix', /\b(matrix|grid)\b/i],
    ['String', /\b(strings?|substring|subsequence)\b/i],
    ['Array', /\barrays?|subarray\b/i]
];

function normalizeTopics(topics = []) {
    const normalized = new Set();
    for (const topic of topics) {
        const key = String(topic || '').trim().toLowerCase();
        if (TOPIC_ALIASES.has(key)) normalized.add(TOPIC_ALIASES.get(key));
    }
    return normalized;
}

function extractConcepts(text, topics = []) {
    const concepts = normalizeTopics(topics);
    for (const [name, pattern] of CONCEPT_PATTERNS) {
        if (pattern.test(text || '')) concepts.add(name);
    }
    return concepts;
}

function setSimilarity(a, b) {
    if (!a?.size || !b?.size) return 0;
    let intersection = 0;
    for (const item of a) if (b.has(item)) intersection++;
    return (2 * intersection) / (a.size + b.size);
}

function weightedTokenDice(a, b) {
    if (!a?.size || !b?.size) return 0;
    let intersection = 0;
    let totalA = 0;
    let totalB = 0;
    for (const token of a) totalA += TITLE_IDF.get(token) || 1;
    for (const token of b) totalB += TITLE_IDF.get(token) || 1;
    for (const token of a) {
        if (b.has(token)) intersection += TITLE_IDF.get(token) || 1;
    }
    return (2 * intersection) / (totalA + totalB);
}

function difficultySimilarity(a, b) {
    const ranks = { basic: 0, easy: 1, medium: 2, hard: 3 };
    const left = ranks[String(a || '').toLowerCase()];
    const right = ranks[String(b || '').toLowerCase()];
    if (left === undefined || right === undefined) return 0.5;
    return Math.max(0, 1 - Math.abs(left - right) / 2);
}

let SIMILARITY_THRESHOLD = 0.4;
function normalizeThreshold(value) {
    const number = typeof value === 'string' && value.trim() ? Number(value) : value;
    return typeof number === 'number' && Number.isFinite(number) && number >= 0.1 && number <= 1 ? number : 0.4;
}

function waitForNextFrame() {
    return new Promise(resolve => requestAnimationFrame(resolve));
}

async function findMatchingProblems(pageText, pageTitle, requestId = searchRequestId) {
    console.log('Finding matches for:', pageText.substring(0, 100) + '...');

    const pageTokens = tokenize(pageText);
    const pageUniq = new Set(pageTokens);
    const pageBgrams = toBigrams(pageTokens);

    // Title region comparison: the candidate's title should agree with the
    // current problem's title, not just share words somewhere in the statement.
    const pageTitleTokens = tokenize(pageTitle);
    const pageTitleUniq = pageTitleTokens.length ? new Set(pageTitleTokens) : pageUniq;
    const pageTitleBgrams = pageTitleTokens.length ? toBigrams(pageTitleTokens) : pageBgrams;
    const minThreshold = SIMILARITY_THRESHOLD;

    const currentPlatform = getCurrentPlatform();
    const currentSource = (currentPlatform === 'tuf' || currentPlatform === null) ? null : currentPlatform;
    const catalogRecord = findCurrentCatalogRecord();

    const matches = [];
    let lastYield = performance.now();
    for (let i = 0; i < problemsData.length; i++) {
        // Tokenizing the full local index is CPU-heavy on the first search. Give
        // the browser a paint opportunity roughly once per frame so the loader,
        // scrolling, and the rest of the page remain responsive.
        if (performance.now() - lastYield >= 12) {
            await waitForNextFrame();
            if (requestId !== searchRequestId) return [];
            lastYield = performance.now();
        }

        const problem = problemsData[i];

        // Skip problems from the platform the user is currently on
        if (currentSource && problem.source === currentSource) {
            continue;
        }

        // Only search platforms the user enabled in settings
        if (!preferredPlatforms.includes(problem.source)) {
            continue;
        }

        if (catalogRecord?.canonicalId && problem.canonicalId === catalogRecord.canonicalId) {
            const sameContract = (catalogRecord.contract?.variant || 'base') === (problem.contract?.variant || 'base');
            matches.push({ ...problem, combinedScore: 1, confidence: 1, matchType: sameContract ? 'confirmed' : 'platform-variant', titleMatch: 0, descMatch: 0 });
            continue;
        }

        const t = getProblemTokens(problem);

        // Fast pre-filter: candidate must share at least one meaningful token
        let sharesToken = false;
        for (const w of t.titleUniq) {
            if (pageUniq.has(w)) { sharesToken = true; break; }
        }
        if (!sharesToken) {
            for (const w of t.descUniq) {
                if (pageUniq.has(w)) { sharesToken = true; break; }
            }
        }
        if (!sharesToken) continue;

        const titleSimilarity = textOverlap(pageTitleUniq, pageTitleBgrams, t.titleToks, t.titleBgrams);
        let descSimilarity = 0;
        if (t.descToks.length) {
            descSimilarity = textOverlap(pageUniq, pageBgrams, t.descToks, t.descBgrams);
        }

        // Title agreement is the strongest signal; description corroborates.
        // A single shared generic token is weak evidence on its own.
        const combinedScore = Math.min(1, titleSimilarity * 0.75 + descSimilarity * 0.5);

        if (combinedScore >= minThreshold || titleSimilarity >= minThreshold || descSimilarity >= minThreshold) {
            matches.push({
                ...problem,
                titleMatch: titleSimilarity,
                descMatch: descSimilarity,
                combinedScore: combinedScore,
                matchType: combinedScore > 0.6 ? 'exact' : 'similar',
                confidence: combinedScore
            });
        }
    }

    await waitForNextFrame();
    matches.sort((a, b) => Number(b.matchType === 'confirmed') - Number(a.matchType === 'confirmed') || b.combinedScore - a.combinedScore);

    // Preserve equivalents on different platforms when deduplicating titles.
    const uniqueMatches = [];
    const seenTitles = [];
    const seenCatalog = new Set();
    for (const match of matches) {
        const catalogKey = match.canonicalId ? `${match.source}:${match.canonicalId}` : null;
        if (catalogKey && seenCatalog.has(catalogKey)) continue;
        const titleToks = tokenize(match.title);
        let isRedundant = false;
        for (const seen of seenTitles) {
            if (seen.source === match.source && titleIsDuplicate(titleToks, seen.tokens)) {
                isRedundant = true;
                break;
            }
        }
        if (!isRedundant) {
            uniqueMatches.push(match);
            if (catalogKey) seenCatalog.add(catalogKey);
            seenTitles.push({ source: match.source, tokens: titleToks });
        }
        if (uniqueMatches.length >= 30) break;
    }

    console.log('Found', uniqueMatches.length, 'unique matches');
    return uniqueMatches.slice(0, 20);
}

function findCurrentCatalogRecord() {
    const source = getCurrentPlatform();
    const identity = value => {
        try {
            const path = new URL(value, window.location.href).pathname;
            if (source === 'codeforces') {
                const match = path.match(/\/problemset\/problem\/(\d+)\/([a-z\d]+)/i) || path.match(/\/(?:contest|gym)\/(\d+)\/problem\/([a-z\d]+)/i);
                return match ? `${match[1]}:${match[2].toUpperCase()}` : null;
            }
            if (source === 'atcoder') return path.match(/\/tasks\/([^/]+)/)?.[1] || null;
            return path.match(/\/problems\/([^/]+)/)?.[1] || null;
        } catch { return null; }
    };
    const key = identity(window.location.href);
    return key ? problemsData.find(p => p.source === source && p.canonicalId && identity(p.url) === key) || null : null;
}

function findCurrentProblemRecord(pageTitle) {
    const source = getCurrentPlatform();
    if (!source || source === 'tuf') return null;
    const titleTokens = tokenize(pageTitle);
    let best = null;
    let bestScore = 0;

    for (const problem of problemsData) {
        if (problem.source !== source) continue;
        const score = weightedTokenDice(new Set(titleTokens), new Set(tokenize(problem.title)));
        if (score > bestScore) {
            best = problem;
            bestScore = score;
        }
    }
    return bestScore >= 0.8 ? best : null;
}

function sharedLabels(a, b) {
    const labels = [];
    for (const item of a) if (b.has(item)) labels.push(item);
    return labels;
}

const GENERIC_CONCEPTS = new Set(['Array', 'String', 'Matrix', 'Graph', 'Tree', 'Binary Tree', 'Linked List']);

function filteredSet(values, predicate) {
    return new Set([...values].filter(predicate));
}

function canonicalTitleTokens(title) {
    const aliases = new Map([
        ['pair', 'two'],
        ['pairs', 'two'],
        ['maximum', 'largest'],
        ['minimum', 'smallest']
    ]);
    return tokenize(title).map(token => aliases.get(token) || token);
}

async function findRelatedProblems(pageText, pageTitle, excludedUrls = new Set()) {
    const pageTitleTokens = canonicalTitleTokens(pageTitle);
    const pageTitleSet = new Set(pageTitleTokens);
    const pageDescSet = new Set(tokenize(pageText));
    const confirmedCurrent = findCurrentCatalogRecord();
    const currentRecord = confirmedCurrent || findCurrentProblemRecord(pageTitle);
    const currentTopics = normalizeTopics(currentRecord?.topics || []);
    const currentConcepts = extractConcepts(
        `${pageTitle || ''} ${pageText || ''}`,
        currentRecord?.topics || []
    );
    const candidates = [];
    let lastYield = performance.now();

    for (const problem of problemsData) {
        if (performance.now() - lastYield >= 12) {
            await waitForNextFrame();
            lastYield = performance.now();
        }
        if (!preferredPlatforms.includes(problem.source)) continue;
        if (excludedUrls.has(problem.url)) continue;
        if (problem === currentRecord) continue;
        if (confirmedCurrent?.canonicalId && problem.canonicalId === confirmedCurrent.canonicalId) continue;
        const features = getProblemTokens(problem);
        const candidateTitleTokens = canonicalTitleTokens(problem.title);
        const candidateTitleSet = new Set(candidateTitleTokens);
        const titleScore = weightedTokenDice(pageTitleSet, candidateTitleSet);
        const descriptionScore = weightedTokenDice(pageDescSet, features.descUniq);

        // Related mode intentionally removes copies of the same problem; those
        // belong in Match mode and otherwise crowd out useful practice options.
        if (titleIsDuplicate(pageTitleTokens, candidateTitleTokens) ||
            descriptionScore >= 0.82 ||
            (titleScore >= 0.35 && descriptionScore >= 0.68)) {
            continue;
        }

        const topicScore = setSimilarity(currentTopics, features.topics);
        const currentTechniques = filteredSet(currentConcepts, concept => !GENERIC_CONCEPTS.has(concept));
        const candidateTechniques = filteredSet(features.concepts, concept => !GENERIC_CONCEPTS.has(concept));
        const currentStructures = filteredSet(currentConcepts, concept => GENERIC_CONCEPTS.has(concept));
        const candidateStructures = filteredSet(features.concepts, concept => GENERIC_CONCEPTS.has(concept));
        const conceptScore = setSimilarity(currentTechniques, candidateTechniques);
        const structureScore = setSimilarity(currentStructures, candidateStructures);
        const difficultyScore = difficultySimilarity(currentRecord?.difficulty, problem.difficulty);
        const evidenceCount = [
            conceptScore >= 0.2,
            topicScore >= 0.25,
            descriptionScore >= 0.08,
            titleScore >= 0.18
        ].filter(Boolean).length;
        if (evidenceCount < 2 || descriptionScore < 0.045) continue;

        const rawScore = conceptScore * 0.3 +
            topicScore * 0.2 +
            descriptionScore * 0.25 +
            titleScore * 0.15 +
            structureScore * 0.05 +
            difficultyScore * 0.05;
        if (rawScore < RELATED_THRESHOLD) continue;

        const sharedConcepts = sharedLabels(currentTechniques, candidateTechniques);
        const sharedTopics = sharedLabels(currentTopics, features.topics)
            .filter(topic => !sharedConcepts.includes(topic));
        const reasons = [...sharedConcepts, ...sharedTopics].slice(0, 3);

        candidates.push({
            ...problem,
            titleMatch: titleScore,
            descMatch: descriptionScore,
            combinedScore: rawScore,
            relationReasons: reasons.length ? reasons : ['Similar problem structure'],
            matchType: 'related',
            confidence: rawScore
        });
    }

    await waitForNextFrame();
    candidates.sort((a, b) => b.confidence - a.confidence);

    const results = [];
    const seenTitles = [];
    const perPlatform = new Map();
    for (const candidate of candidates) {
        const titleTokens = tokenize(candidate.title);
        if (seenTitles.some(seen => titleIsDuplicate(titleTokens, seen))) continue;
        const platformCount = perPlatform.get(candidate.source) || 0;
        if (platformCount >= 6) continue;
        results.push(candidate);
        seenTitles.push(titleTokens);
        perPlatform.set(candidate.source, platformCount + 1);
        if (results.length >= 20) break;
    }
    return results;
}

function getProblemTitle() {
    if (getCurrentPlatform() === 'atcoder') {
        const heading = document.querySelector('#main-container .h2');
        if (heading) return heading.textContent.replace(/\s*Editorial\s*$/i, '').trim();
    }
    // Try multiple possible selectors to accommodate new UI frames
    const selectors = [
        '.text-2xl.font-bold.text-new_primary.dark\\:text-new_dark_primary',
        'h1.text-xl.font-bold',
        'h1.text-2xl.font-bold',
        'h1.font-bold',
        '[data-problem-title]',
    ];
    let titleElement = null;
    for (const sel of selectors) {
        titleElement = document.querySelector(sel);
        if (titleElement) break;
    }
    if (!titleElement) {
        // Fallback: first bold heading in main content
        const fallback = document.querySelector('main h1, section h1, article h1');
        titleElement = fallback || null;
    }
    return titleElement ? titleElement.textContent.replace(/🔍|<svg.*?<\/svg>/g, '').trim() : null;
}

function getPageTitle() {
    const t = getProblemTitle();
    if (t) return t;
    const og = document.querySelector('meta[property="og:title"]');
    if (og && og.content) return og.content;
    return null;
}

function getTUFProblemContent() {
    let content = '';
    
    const title = getProblemTitle();
    if (title) {
        content += title + ' ';
    }
    
    // Description container: support old and new UI structures
    const descSelectors = [
        '.mt-6.w-full.text-new_secondary.text-\\[14px\\].dark\\:text-zinc-200',
        '.tuf-text-14',
        '.tuf-example',
        '[data-problem-description]',
    ];
    let descriptionElement = null;
    for (const sel of descSelectors) {
        const el = document.querySelector(sel);
        if (el) { descriptionElement = el; break; }
    }
    if (!descriptionElement) {
        // Fallback: main content paragraphs
        descriptionElement = document.querySelector('main') || document.querySelector('article');
    }
    if (descriptionElement) {
        const paragraphs = descriptionElement.querySelectorAll('p, li');
        const descText = Array.from(paragraphs)
            .map(p => p.textContent.trim())
            .filter(text => text.length > 0)
            .join(' ');
        if (descText) {
            content += descText + ' ';
        }
    }
    
    // Constraints or bullets section
    const constraintsContainer = document.querySelector('.mt-4.flex.flex-col.gap-y-2.mb-24') ||
        document.querySelector('.tuf-dark-content-box') ||
        document.querySelector('[data-constraints]');
    if (constraintsContainer) {
        const constraintsList = constraintsContainer.querySelector('ul');
        if (constraintsList) {
            const constraints = Array.from(constraintsList.querySelectorAll('li'))
                .map(li => li.textContent.trim())
                .join(' ');
            
            if (constraints) {
                content += constraints;
            }
        }
    }
    
    const finalContent = content.trim();
    console.log('TUF Content extracted:', finalContent.substring(0, 200) + '...');
    return finalContent;
}

function getCurrentPlatform() {
    const host = window.location.hostname.replace(/^www\./, '');
    if (host.endsWith('takeuforward.org')) return 'tuf';
    if (host.endsWith('leetcode.com')) return 'leetcode';
    if (host.endsWith('geeksforgeeks.org')) return 'geeksforgeeks';
    if (host.endsWith('codeforces.com')) return 'codeforces';
    if (host.endsWith('codechef.com')) return 'codechef';
    if (host === 'atcoder.jp') return 'atcoder';
    if (host.endsWith('naukri.com') && window.location.pathname.includes('/code360/')) return 'code360';
    return null;
}

function isSupportedProblemPage() {
    const path = window.location.pathname.replace(/\/+$/, '');
    switch (getCurrentPlatform()) {
        case 'tuf': return /^\/practice\/dsa\/[^/]+$/i.test(path) || /^\/plus\/dsa\/problems\/[^/]+$/i.test(path);
        case 'leetcode': return /^\/problems\/[^/]+(?:\/.*)?$/i.test(path);
        case 'geeksforgeeks': return /^\/problems\/[^/]+(?:\/.*)?$/i.test(path);
        case 'codeforces': return /^\/problemset\/problem\/\d+\/[a-z0-9]+$/i.test(path) || /^\/(?:contest|gym)\/\d+\/problem\/[a-z0-9]+$/i.test(path);
        case 'codechef': return /^\/problems\/[^/]+$/i.test(path);
        case 'atcoder': return /^\/contests\/[a-zA-Z0-9_-]+\/tasks\/[a-zA-Z0-9_-]+$/.test(path);
        case 'code360': return /^\/code360\/problems\/[^/]+(?:\/.*)?$/i.test(path);
        default: return false;
    }
}

const PLATFORM_DISPLAY_NAMES = {
    'tuf': 'TakeUForward',
    'leetcode': 'LeetCode',
    'geeksforgeeks': 'GeeksforGeeks',
    'codeforces': 'Codeforces',
    'codechef': 'CodeChef',
    'code360': 'Code 360',
    'atcoder': 'AtCoder'
};

function platformDisplayName(source) {
    return PLATFORM_DISPLAY_NAMES[source] || capitalize(source);
}

function getCodeChefProblemCode() {
    const match = window.location.pathname.match(/^\/problems\/([A-Z0-9_]+)/i);
    return match ? match[1] : null;
}

async function getCodeChefContent() {
    const code = getCodeChefProblemCode();
    let content = '';

    if (code) {
        try {
            const response = await fetch(`https://www.codechef.com/api/contests/PRACTICE/problems/${code}`, { credentials: 'same-origin' });
            if (response.ok) {
                const data = await response.json();
                const comp = data.problemComponents || {};
                const text = [comp.statement, comp.inputFormat, comp.outputFormat, comp.constraints]
                    .filter(Boolean)
                    .join(' ')
                    .replace(/\s+/g, ' ');
                if (text.trim()) {
                    content = text.trim();
                }
                if (content === '' && data.body) {
                    content = htmlToText(data.body);
                }
                if (content !== '') return content;
            }
        } catch (e) {
            console.log('CodeChef API fetch failed:', e);
        }
    }

    const container = document.querySelector('#problem-statement') ||
        document.querySelector('.problem-statement') ||
        document.querySelector('[id*="problem-statement"]');
    if (container) {
        content = container.textContent.replace(/\s+/g, ' ').trim();
    } else {
        content = document.querySelector('meta[name="description"]')?.content || document.title;
    }
    return content;
}

function getLeetCodeContent() {
    let content = '';
    const titleLink = document.querySelector('a[href^="/problems/"]');
    if (titleLink) content += titleLink.textContent.replace(/\s+/g, ' ').trim() + ' ';

    const descEl = document.querySelector('[data-track-load="description_content"]');
    if (descEl) {
        content += descEl.textContent.replace(/\s+/g, ' ').trim();
    }

    if (!content.trim()) {
        const meta = document.querySelector('meta[name="description"]');
        if (meta) content = meta.content;
    }
    return content.trim();
}

function findProblemObject(obj) {
    if (!obj || typeof obj !== 'object') return null;
    if (typeof obj.problem_name === 'string' && typeof obj.problem_question === 'string') return obj;
    for (const value of Object.values(obj)) {
        const found = findProblemObject(value);
        if (found) return found;
    }
    return null;
}

function htmlToText(html) {
    const el = document.createElement('div');
    el.innerHTML = html;
    return el.textContent.replace(/\s+/g, ' ').trim();
}

function getGFGContent() {
    let title = '';
    let question = '';

    const nextData = document.getElementById('__NEXT_DATA__');
    if (nextData) {
        try {
            const data = JSON.parse(nextData.textContent);
            const problemObj = findProblemObject(data);
            if (problemObj) {
                title = problemObj.problem_name;
                question = problemObj.problem_question;
            }
        } catch (e) {
            console.log('Failed to parse GFG __NEXT_DATA__:', e);
        }
    }

    if (!title) {
        const og = document.querySelector('meta[property="og:title"]');
        if (og) title = og.content;
    }
    if (!title) title = document.title.replace(/\s*[|–-].*/, '');

    let content = '';
    if (title) content += title + ' ';
    if (question) content += htmlToText(question);
    return content.trim();
}

function getCodeforcesContent() {
    let content = '';
    const statement = document.querySelector('.problem-statement');
    if (!statement) return '';

    const header = statement.querySelector('.header');
    const title = header ? header.querySelector('.title') : null;
    if (title) content += title.textContent.replace(/\s+/g, ' ').trim() + ' ';

    for (const child of statement.children) {
        if (child.tagName === 'DIV' && !child.className) {
            content += child.textContent.replace(/\s+/g, ' ').trim();
            break;
        }
    }
    return content.trim();
}

function getCode360Slug() {
    const match = window.location.pathname.match(/\/code360\/problems\/([^/]+)/);
    return match ? match[1] : null;
}

async function getCode360Content() {
    const slug = getCode360Slug();
    let content = '';

    if (slug) {
        try {
            const response = await fetch(`https://www.naukri.com/code360/api/v3/public_section/problem_detail?slug=${encodeURIComponent(slug)}`, { credentials: 'same-origin' });
            if (response.ok) {
                const data = await response.json();
                const problem = data?.data?.offerable?.problem;
                if (problem) {
                    const parts = [problem.name, htmlToText(problem.description || '')].filter(Boolean);
                    content = parts.join(' ').replace(/\s+/g, ' ').trim();
                }
                if (content !== '') return content;
            }
        } catch (e) {
            console.log('Code 360 API fetch failed:', e);
        }
    }

    const title = getPageTitle();
    if (title) content += title + ' ';

    const problemContainer = document.querySelector('[class*="problem-"]') ||
        document.querySelector('codestudio-single-problem') ||
        document.querySelector('pre')?.parentElement?.parentElement;
    if (problemContainer) {
        content += problemContainer.textContent.replace(/\s+/g, ' ').trim();
    }

    if (!content.trim()) {
        const meta = document.querySelector('meta[name="description"]');
        if (meta) content = meta.content;
    }
    return content.trim();
}

function getAtCoderContent() {
    const root = document.querySelector('#task-statement .lang-en') || document.querySelector('#task-statement');
    if (!root) return '';
    const sections = [...root.querySelectorAll('section')].filter(section =>
        /^(?:Problem Statement|Constraints|Input|Output)$/i.test(section.querySelector('h3')?.textContent.trim() || ''));
    // Some older English-only tasks have no section wrappers.
    if (!sections.length) {
        const heading = [...root.querySelectorAll('h3')].some(h => /^Problem Statement$/i.test(h.textContent.trim()));
        return heading ? root.textContent.replace(/\s+/g, ' ').trim() : '';
    }
    return sections.map(section => section.textContent.replace(/\s+/g, ' ').trim()).join(' ');
}

async function getProblemContent() {
    const platform = getCurrentPlatform();
    switch (platform) {
        case 'tuf':
            return getTUFProblemContent();
        case 'leetcode':
            return getLeetCodeContent();
        case 'geeksforgeeks':
            return getGFGContent();
        case 'codeforces':
            return getCodeforcesContent();
        case 'codechef':
            return await getCodeChefContent();
        case 'code360':
            return await getCode360Content();
        case 'atcoder':
            return getAtCoderContent();
        default:
            return getTUFProblemContent();
    }
}

function createButtonContainer() {
    if (buttonContainer) return buttonContainer;
    buttonContainer = document.createElement('div');
    buttonContainer.id = 'dsa-helper-container';
    buttonContainer.className = 'dsa-helper-floating';
    buttonContainer.style.display = 'none';
    document.body.appendChild(buttonContainer);
    makeResultsPanelDraggable(buttonContainer);
    return buttonContainer;
}

function makeResultsPanelDraggable(container) {
    let dragState = null;

    container.addEventListener('pointerdown', (event) => {
        const header = event.target.closest('.dsa-helper-header');
        if (!header || event.target.closest('button, a, input, select, textarea')) return;
        if (event.button !== 0 && event.pointerType === 'mouse') return;

        const rect = container.getBoundingClientRect();
        dragState = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            left: rect.left,
            top: rect.top
        };
        container.style.animation = 'none';
        container.style.left = `${Math.round(rect.left)}px`;
        container.style.top = `${Math.round(rect.top)}px`;
        container.style.right = 'auto';
        container.style.bottom = 'auto';
        container.classList.add('is-dragging');
        header.setPointerCapture(event.pointerId);
        event.preventDefault();
    });

    container.addEventListener('pointermove', (event) => {
        if (!dragState || event.pointerId !== dragState.pointerId) return;
        const margin = 8;
        const maxLeft = Math.max(margin, window.innerWidth - container.offsetWidth - margin);
        const maxTop = Math.max(margin, window.innerHeight - container.offsetHeight - margin);
        const left = Math.min(Math.max(margin, dragState.left + event.clientX - dragState.startX), maxLeft);
        const top = Math.min(Math.max(margin, dragState.top + event.clientY - dragState.startY), maxTop);
        container.style.left = `${Math.round(left)}px`;
        container.style.top = `${Math.round(top)}px`;
        event.preventDefault();
    });

    const finishDrag = (event) => {
        if (!dragState || event.pointerId !== dragState.pointerId) return;
        const header = container.querySelector('.dsa-helper-header');
        if (header?.hasPointerCapture(event.pointerId)) header.releasePointerCapture(event.pointerId);
        dragState = null;
        container.classList.remove('is-dragging');
    };

    container.addEventListener('pointerup', finishDrag);
    container.addEventListener('pointercancel', finishDrag);
}

function closeSearchResults() {
    // Invalidate any in-flight search so its eventual result cannot reopen a
    // panel that the user has already dismissed.
    searchRequestId += 1;
    isSearching = false;
    if (buttonContainer) {
        buttonContainer.style.display = 'none';
        buttonContainer.innerHTML = '';
    }
}

function positionContainer(titleButton) {
    const container = createButtonContainer();
    const rect = titleButton.getBoundingClientRect();
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const panelWidth = Math.min(480, vw - (margin * 2));
    const panelMaxHeight = vh * 0.8;

    const roomOnRight = vw - rect.right - margin;
    const roomOnLeft = rect.left - margin;
    let left;

    if (roomOnRight >= panelWidth) {
        left = rect.right + margin;
    } else if (roomOnLeft >= panelWidth) {
        left = rect.left - panelWidth - margin;
    } else {
        left = Math.min(Math.max(margin, rect.left), vw - panelWidth - margin);
    }

    // Align the panel's lower edge with the button where possible. This keeps a
    // bottom-positioned button from opening most of the panel off-screen.
    const top = Math.min(
        Math.max(margin, rect.bottom - panelMaxHeight),
        Math.max(margin, vh - panelMaxHeight - margin)
    );

    container.style.left = `${Math.round(left)}px`;
    container.style.right = 'auto';
    container.style.top = `${Math.round(top)}px`;
    container.style.bottom = 'auto';
}

function showLoadingScreen(titleButton) {
    const container = createButtonContainer();
    const enabledCount = problemsData.filter(p => preferredPlatforms.includes(p.source)).length;
    container.innerHTML = `
        <div class="dsa-helper-header">
            <span>Finding cross-platform matches…</span>
        </div>
        <div class="loading-container">
            <div class="loading-text">
                <p>Comparing problem details…</p>
                <p class="loading-subtext">Comparing this problem with ${enabledCount.toLocaleString()} indexed problems</p>
            </div>
        </div>
    `;
    // Position below button immediately, keeping the panel fully on-screen
    if (titleButton) {
        positionContainer(titleButton);
    }
    container.style.display = 'block';
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function createLeetCodeButton(problem) {
    const button = document.createElement('button');
    button.className = 'dsa-helper-btn';
    const confirmed = problem.matchType === 'confirmed' || problem.matchType === 'platform-variant';
    if (confirmed) button.classList.add('confirmed-match');
    
    if (problem.isPremium) {
        button.classList.add('premium-problem');
    }
    
    const sqlBadge = problem.is_sql ? '<span class="sql-badge">SQL</span>' : '';
    const premiumBadge = problem.isPremium ? '<span class="premium-badge">PREMIUM</span>' : '';
    
    const totalPercent = Math.round(problem.combinedScore * 100);
    const isRelated = problem.matchType === 'related';
    const scoreBadges = isRelated
        ? `<span class="match-percent total-match">${totalPercent}% Related</span>`
        : '';
    const confirmedLabel = confirmed ? `<span class="confirmed-match-label">✓ Same question${problem.matchType === 'platform-variant' ? ' · Platform variant' : ''}</span>` : '';
    const relationBadges = isRelated
        ? (problem.relationReasons || []).map(reason => `<span class="relation-badge">${reason}</span>`).join('')
        : '';
    
    const topicTags = (problem.topics || []).slice(0, isRelated ? 2 : 3).map(topic =>
        `<span class="topic-tag">${topic}</span>`
    ).join('');
    
    button.innerHTML = `
    <div class="btn-content">
      ${confirmedLabel}
      <div class="btn-title">${escapeHtml(problem.title)} ${sqlBadge}</div>
      <div class="btn-meta">
        <span class="difficulty ${(problem.difficulty || 'unknown').toLowerCase()}">${problem.difficulty || 'Unknown'}</span>
        ${scoreBadges}
        ${premiumBadge}
      </div>
      <div class="btn-topics-line">
        ${relationBadges}
        ${topicTags}
      </div>
    </div>
    <div class="btn-arrow">→</div>
  `;
    button.addEventListener('click', () => {
        window.open(problem.url, '_blank');
    });
    return button;
}

function capitalize(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
}

function buildYoutubeQuery() {
    const platform = getCurrentPlatform();
    const title = getPageTitle();
    const baseTitle = (title || document.title || '')
        .replace(/🔍|<svg.*?<\/svg>/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    if (platform === 'atcoder') {
        const match = window.location.pathname.match(/^\/contests\/([a-zA-Z0-9_-]+)\/tasks\/([a-zA-Z0-9_-]+)/);
        if (match) return `AtCoder ${match[1]} ${match[2]} ${baseTitle} solution`;
    }
    // Codeforces: contest ID + problem index is the most reliable search key.
    // e.g. /contest/1878/problem/D or /problemset/problem/1878/D
    if (platform === 'codeforces') {
        const cfMatch = window.location.pathname.match(/^\/(?:contest|problemset\/problem|gym)\/(\d+)\/(?:problem\/)?([A-Z0-9]+)/i);
        if (cfMatch) {
            return `Codeforces ${cfMatch[1]}${cfMatch[2].toUpperCase()} DSA solution`;
        }
        const cleaned = baseTitle
            .replace(/^\s*[A-Za-z0-9]\.\s*/, '')      // strip "H. " index prefix
            .replace(/\s*\([^)]*\)\s*$/g, '')          // strip "(Easy Version)" style suffixes
            .trim();
        return cleaned ? `${cleaned} Codeforces DSA solution` : 'Codeforces DSA problem solution';
    }

    // CodeChef: problem code (optionally with contest) is the most reliable key.
    if (platform === 'codechef') {
        const path = window.location.pathname;
        // /START88A/problems/FOO (contest) and /problems/FOO (practice)
        const contestMatch = path.match(/\/([A-Z0-9]{4,})\/problems\/([A-Z0-9_]+)/i);
        const practiceMatch = path.match(/\/problems\/([A-Z0-9_]+)/i);
        if (contestMatch || practiceMatch) {
            const code = contestMatch ? contestMatch[2] : practiceMatch[1];
            const parts = [code];
            if (contestMatch && contestMatch[1].toUpperCase() !== 'PRACTICE') {
                parts.push(contestMatch[1].toUpperCase());
            }
            parts.push('CodeChef', 'DSA', 'solution');
            return parts.join(' ');
        }
        return `${baseTitle} CodeChef DSA solution`;
    }

    if (platform === 'geeksforgeeks') {
        return baseTitle ? `${baseTitle} geeksforgeeks DSA solution` : 'geeksforgeeks DSA problem solution';
    }

    if (platform === 'leetcode') {
        return baseTitle ? `${baseTitle} leetcode DSA solution` : 'leetcode DSA problem solution';
    }

    if (platform === 'code360') {
        const slug = baseTitle.replace(/_?\d+$/, '').replace(/[-_]+/g, ' ').trim();
        return slug ? `${slug} code 360 ninjas DSA solution` : `${baseTitle} code 360 DSA solution`;
    }

    return baseTitle ? `${baseTitle} DSA solution` : 'DSA problem solution';
}

function createYoutubeButton() {
    const query = buildYoutubeQuery();
    const btn = document.createElement('button');
    btn.className = 'youtube-solution-btn';
    btn.type = 'button';
    btn.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
            <path d="M23.5 6.19a3.02 3.02 0 0 0-2.12-2.14C19.5 3.55 12 3.55 12 3.55s-7.5 0-9.38.5A3.02 3.02 0 0 0 .5 6.19C0 8.07 0 12 0 12s0 3.93.5 5.81a3.02 3.02 0 0 0 2.12 2.14c1.88.5 9.38.5 9.38.5s7.5 0 9.38-.5a3.02 3.02 0 0 0 2.12-2.14C24 15.93 24 12 24 12s0-3.93-.5-5.81zM9.55 15.57V8.43L15.82 12l-6.27 3.57z"/>
        </svg>
        <span>Solution</span>
    `;
    btn.title = `Search "${query}" on YouTube`;
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        window.open('https://www.youtube.com/results?search_query=' + encodeURIComponent(query), '_blank', 'noopener');
    });
    return btn;
}

function createCloseButton(container) {
    const btn = document.createElement('button');
    btn.className = 'dsa-helper-close-btn';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Close results');
    btn.title = 'Close';
    btn.innerHTML = `
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" />
        </svg>
    `;
    btn.addEventListener('click', (event) => {
        event.stopPropagation();
        closeSearchResults();
    });
    return btn;
}

function switchPlatformTab(source) {
    if (!buttonContainer) return;
    buttonContainer.querySelectorAll('.platform-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.source === source);
        if (t.dataset.source === source) {
            t.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
    });
    buttonContainer.querySelectorAll('.platform-pane').forEach(p => {
        p.style.display = p.dataset.source === source ? 'block' : 'none';
    });
}

function updateUI(matches) {
    const container = createButtonContainer();
    
    // Stop border animation by adding loaded class
    const loadingContainer = container.querySelector('.loading-container');
    if (loadingContainer) {
        loadingContainer.classList.add('loaded');
    }
    
    // Store last search results count
    try {
        chrome.storage.local.set({ lastSearchResults: matches.length });
    } catch (e) {
    }
    
    container.innerHTML = '';
    
    if (matches.length === 0) {
        const emptyHeader = document.createElement('div');
        emptyHeader.className = 'dsa-helper-header';
        const emptyText = document.createElement('span');
        emptyText.textContent = 'No cross-platform matches found';
        const emptyActions = document.createElement('div');
        emptyActions.className = 'header-actions';
        emptyActions.appendChild(createYoutubeButton());
        emptyActions.appendChild(createCloseButton(container));
        emptyHeader.appendChild(emptyText);
        emptyHeader.appendChild(emptyActions);

        const emptyContent = document.createElement('div');
        emptyContent.className = 'results-content';
        emptyContent.innerHTML = `
                <div class="no-matches">
                    <p>This problem was not found on the enabled platforms.</p>
                    <p class="no-matches-subtext">Try using a broader match strictness setting.</p>
                </div>
            `;
        container.appendChild(emptyHeader);
        container.appendChild(emptyContent);
        container.style.display = 'block';
        return;
    }
    
    // Group matches by source platform
    const groups = new Map();
    matches.forEach(problem => {
        const source = problem.source || 'leetcode';
        if (!groups.has(source)) groups.set(source, []);
        groups.get(source).push(problem);
    });

    // Only platforms that actually have matches get a tab
    const sourceKeys = [...groups.keys()].sort((a, b) => platformDisplayOrder.indexOf(a) - platformDisplayOrder.indexOf(b));
    
    container.style.display = 'block';
    const header = document.createElement('div');
    header.className = 'dsa-helper-header';
    const headerText = document.createElement('span');
    headerText.textContent = `Found on ${groups.size} platform${groups.size === 1 ? '' : 's'}`;
    const headerActions = document.createElement('div');
    headerActions.className = 'header-actions';
    headerActions.appendChild(createYoutubeButton());
    headerActions.appendChild(createCloseButton(container));
    header.appendChild(headerText);
    header.appendChild(headerActions);
    
    // Platform tabs (scrollable when they don't all fit)
    const tabsWrap = document.createElement('div');
    tabsWrap.className = 'platform-tabs-wrap';

    const prevBtn = document.createElement('button');
    prevBtn.className = 'platform-tab-scroll-btn prev';
    prevBtn.innerHTML = '‹';
    prevBtn.title = 'Scroll tabs left';
    prevBtn.disabled = true;

    const tabs = document.createElement('div');
    tabs.className = 'platform-tabs';
    sourceKeys.forEach((source, idx) => {
        const tab = document.createElement('button');
        tab.className = 'platform-tab' + (idx === 0 ? ' active' : '');
        tab.dataset.source = source;
        tab.textContent = `${platformDisplayName(source)} (${groups.get(source).length})`;
        tab.addEventListener('click', () => switchPlatformTab(source));
        tabs.appendChild(tab);
    });

    const nextBtn = document.createElement('button');
    nextBtn.className = 'platform-tab-scroll-btn next';
    nextBtn.innerHTML = '›';
    nextBtn.title = 'Scroll tabs right';

    function updateTabScrollButtons() {
        const maxScroll = tabs.scrollWidth - tabs.clientWidth;
        prevBtn.disabled = tabs.scrollLeft <= 0;
        nextBtn.disabled = tabs.scrollLeft >= maxScroll - 1;
    }
    tabs.addEventListener('scroll', updateTabScrollButtons);
    prevBtn.addEventListener('click', () => tabs.scrollBy({ left: -160, behavior: 'smooth' }));
    nextBtn.addEventListener('click', () => tabs.scrollBy({ left: 160, behavior: 'smooth' }));

    // Mouse wheel scrolls the strip horizontally (only consumed when it can scroll)
    tabs.addEventListener('wheel', (e) => {
        const delta = e.deltaY || e.deltaX;
        const atLeft = tabs.scrollLeft <= 0;
        const atRight = tabs.scrollLeft >= tabs.scrollWidth - tabs.clientWidth - 1;
        if ((delta < 0 && !atLeft) || (delta > 0 && !atRight)) {
            e.preventDefault();
            tabs.scrollLeft += delta;
            updateTabScrollButtons();
        }
    }, { passive: false });

    tabsWrap.appendChild(prevBtn);
    tabsWrap.appendChild(tabs);
    tabsWrap.appendChild(nextBtn);
    container.appendChild(tabsWrap);

    const content = document.createElement('div');
    content.className = 'results-content';
    
    container.appendChild(header);
    container.appendChild(tabsWrap);
    container.appendChild(content);
    
    sourceKeys.forEach((source, idx) => {
        const pane = document.createElement('div');
        pane.className = 'platform-pane';
        pane.dataset.source = source;
        if (idx > 0) pane.style.display = 'none';
        groups.get(source).forEach(problem => {
            pane.appendChild(createLeetCodeButton(problem));
        });
        content.appendChild(pane);
    });

    // Bring the active tab fully into view once the panel is laid out
    const activeTab = tabs.querySelector('.platform-tab.active');
    if (activeTab) {
        activeTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        requestAnimationFrame(updateTabScrollButtons);
    }
}

function updateUnifiedUI(resultGroups) {
    const container = createButtonContainer();
    const matches = resultGroups.matches || [];
    const related = resultGroups.related || [];
    const total = matches.length + related.length;

    try {
        chrome.storage.local.set({ lastSearchResults: total });
    } catch (e) {
    }

    container.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'dsa-helper-header';
    const headerText = document.createElement('span');
    headerText.textContent = total
        ? `${matches.length} match${matches.length === 1 ? '' : 'es'} · ${related.length} related`
        : 'No problems found';
    const headerActions = document.createElement('div');
    headerActions.className = 'header-actions';
    headerActions.appendChild(createYoutubeButton());
    headerActions.appendChild(createCloseButton(container));
    header.appendChild(headerText);
    header.appendChild(headerActions);
    container.appendChild(header);

    if (!total) {
        const emptyContent = document.createElement('div');
        emptyContent.className = 'results-content';
        emptyContent.innerHTML = `
            <div class="no-matches">
                <p>No matches or related problems were found.</p>
                <p class="no-matches-subtext">Try enabling more platforms or using a broader relatedness setting.</p>
            </div>`;
        container.appendChild(emptyContent);
        container.style.display = 'block';
        return;
    }

    const categories = [];
    if (matches.length) categories.push({ key: 'matches', label: 'Matches', problems: matches });
    if (related.length) categories.push({ key: 'related', label: 'Related', problems: related });

    const tabsWrap = document.createElement('div');
    tabsWrap.className = 'platform-tabs-wrap result-category-tabs';
    const tabs = document.createElement('div');
    tabs.className = 'platform-tabs';
    const content = document.createElement('div');
    content.className = 'results-content';

    const activateCategory = (key) => {
        tabs.querySelectorAll('.platform-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.category === key);
        });
        content.querySelectorAll('.platform-pane').forEach(pane => {
            pane.style.display = pane.dataset.category === key ? 'block' : 'none';
        });
    };

    categories.forEach((category, index) => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = `platform-tab${index === 0 ? ' active' : ''}`;
        tab.dataset.category = category.key;
        tab.textContent = `${category.label} (${category.problems.length})`;
        tab.addEventListener('click', () => activateCategory(category.key));
        tabs.appendChild(tab);

        const pane = document.createElement('div');
        pane.className = 'platform-pane';
        pane.dataset.category = category.key;
        if (index > 0) pane.style.display = 'none';
        category.problems.forEach(problem => pane.appendChild(createLeetCodeButton(problem)));
        content.appendChild(pane);
    });

    tabsWrap.appendChild(tabs);
    container.appendChild(tabsWrap);
    container.appendChild(content);
    container.style.display = 'block';
}

let currentUrl = window.location.href;

function createTitleButton() {
    const titleButton = document.createElement('button');
    titleButton.className = 'dsa-helper-title-btn';
    titleButton.type = 'button';
    titleButton.setAttribute('aria-label', 'Find equivalent problems on other platforms');
    
    // Create SVG search icon
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', '20');
    svg.setAttribute('height', '20');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    
    const circle = document.createElementNS(svgNS, 'circle');
    circle.setAttribute('cx', '11');
    circle.setAttribute('cy', '11');
    circle.setAttribute('r', '8');
    svg.appendChild(circle);
    
    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('x1', '21');
    line.setAttribute('y1', '21');
    line.setAttribute('x2', '16.65');
    line.setAttribute('y2', '16.65');
    svg.appendChild(line);
    
    titleButton.appendChild(svg);
    titleButton.title = 'Find equivalent problems on other platforms';

    titleButton.addEventListener('click', async (e) => {
        e.stopPropagation();

        if (titleButton.dataset.dragged === 'true') return;

        if (buttonContainer?.style.display === 'block') {
            closeSearchResults();
            return;
        }
        
        if (isSearching) return;
        
        isSearching = true;
        const requestId = ++searchRequestId;
        titleButton.style.opacity = '0.6';
        
        try {
            showLoadingScreen(titleButton);

            // Ensure the loading UI gets painted before content extraction and
            // the local-index scan begin.
            await waitForNextFrame();
            const content = await getProblemContent();
            if (requestId !== searchRequestId) return;
            if (content) {
                const pageTitle = getPageTitle();
                const results = await findMatchingProblems(content, pageTitle, requestId);
                if (requestId !== searchRequestId) return;
                updateUI(results);
                
                // Position is already set by showLoadingScreen
                if (buttonContainer) {
                    buttonContainer.style.display = 'block';
                }
            } else {
                updateUI([]);
            }
        } catch (error) {
            console.error('Search error:', error);
            if (requestId === searchRequestId) updateUI([]);
        } finally {
            if (requestId === searchRequestId) isSearching = false;
            titleButton.style.opacity = '1';
        }
    });
    return titleButton;
}

let visibilityEnabled = true;

function removeTitleButton() {
    document.querySelectorAll('.dsa-helper-title-btn, .dsa-helper-float-btn').forEach(btn => btn.remove());
}

function floatingPositionKey() {
    return `${FLOATING_POSITION_PREFIX}${window.location.hostname}`;
}

function clampFloatingButton(button, left, top) {
    const maxLeft = Math.max(FLOATING_EDGE_MARGIN, window.innerWidth - button.offsetWidth - FLOATING_EDGE_MARGIN);
    const maxTop = Math.max(FLOATING_EDGE_MARGIN, window.innerHeight - button.offsetHeight - FLOATING_EDGE_MARGIN);
    return {
        left: Math.min(Math.max(FLOATING_EDGE_MARGIN, left), maxLeft),
        top: Math.min(Math.max(FLOATING_EDGE_MARGIN, top), maxTop)
    };
}

function placeFloatingButton(button, position) {
    const availableWidth = Math.max(1, window.innerWidth - button.offsetWidth - (FLOATING_EDGE_MARGIN * 2));
    const availableHeight = Math.max(1, window.innerHeight - button.offsetHeight - (FLOATING_EDGE_MARGIN * 2));
    const left = position
        ? FLOATING_EDGE_MARGIN + (Math.min(Math.max(position.x, 0), 1) * availableWidth)
        : FLOATING_EDGE_MARGIN;
    const top = position
        ? FLOATING_EDGE_MARGIN + (Math.min(Math.max(position.y, 0), 1) * availableHeight)
        : window.innerHeight - button.offsetHeight - 24;
    const clamped = clampFloatingButton(button, left, top);

    button.style.left = `${Math.round(clamped.left)}px`;
    button.style.top = `${Math.round(clamped.top)}px`;
    button.style.right = 'auto';
    button.style.bottom = 'auto';
}

function saveFloatingButtonPosition(button) {
    const availableWidth = Math.max(1, window.innerWidth - button.offsetWidth - (FLOATING_EDGE_MARGIN * 2));
    const availableHeight = Math.max(1, window.innerHeight - button.offsetHeight - (FLOATING_EDGE_MARGIN * 2));
    const rect = button.getBoundingClientRect();
    currentFloatingPosition = {
        x: Math.min(Math.max((rect.left - FLOATING_EDGE_MARGIN) / availableWidth, 0), 1),
        y: Math.min(Math.max((rect.top - FLOATING_EDGE_MARGIN) / availableHeight, 0), 1)
    };

    button.dataset.positionChanged = 'true';
    chrome.storage.local.set({ [floatingPositionKey()]: currentFloatingPosition });
}

function makeFloatingButtonDraggable(button) {
    let dragState = null;

    button.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 && event.pointerType === 'mouse') return;
        const rect = button.getBoundingClientRect();
        dragState = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            left: rect.left,
            top: rect.top,
            moved: false
        };
        button.setPointerCapture(event.pointerId);
    });

    button.addEventListener('pointermove', (event) => {
        if (!dragState || event.pointerId !== dragState.pointerId) return;
        const dx = event.clientX - dragState.startX;
        const dy = event.clientY - dragState.startY;

        if (!dragState.moved && Math.hypot(dx, dy) < DRAG_START_DISTANCE) return;
        dragState.moved = true;
        button.classList.add('is-dragging');
        const next = clampFloatingButton(button, dragState.left + dx, dragState.top + dy);
        button.style.left = `${Math.round(next.left)}px`;
        button.style.top = `${Math.round(next.top)}px`;
        closeSearchResults();
        event.preventDefault();
    });

    const finishDrag = (event) => {
        if (!dragState || event.pointerId !== dragState.pointerId) return;
        const moved = dragState.moved;
        dragState = null;
        button.classList.remove('is-dragging');

        if (button.hasPointerCapture(event.pointerId)) {
            button.releasePointerCapture(event.pointerId);
        }
        if (moved) {
            button.dataset.dragged = 'true';
            saveFloatingButtonPosition(button);
            setTimeout(() => {
                button.dataset.dragged = 'false';
            }, 0);
        }
    };

    button.addEventListener('pointerup', finishDrag);
    button.addEventListener('pointercancel', finishDrag);
}

function updateFloatingButtonMode(button = document.querySelector('.dsa-helper-float-btn')) {
    if (!button) return;
    const label = button.querySelector('.dsa-helper-float-label');
    if (label) label.textContent = 'Match';
    const description = 'Find equivalent problems on other platforms';
    button.title = description;
    button.setAttribute('aria-label', description);
}

function injectFloatingButton() {
    if (document.querySelector('.dsa-helper-float-btn')) return;
    const titleButton = createTitleButton();
    titleButton.classList.add('dsa-helper-float-btn');
    const label = document.createElement('span');
    label.className = 'dsa-helper-float-label';
    titleButton.appendChild(label);
    const dragHandle = document.createElement('span');
    dragHandle.className = 'dsa-helper-drag-handle';
    dragHandle.setAttribute('aria-hidden', 'true');
    titleButton.appendChild(dragHandle);
    document.body.appendChild(titleButton);
    updateFloatingButtonMode(titleButton);
    makeFloatingButtonDraggable(titleButton);

    requestAnimationFrame(() => {
        placeFloatingButton(titleButton, null);
        chrome.storage.local.get([floatingPositionKey()], (result) => {
            if (!titleButton.isConnected || titleButton.dataset.positionChanged === 'true') return;
            const saved = result[floatingPositionKey()];
            if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
                currentFloatingPosition = saved;
                placeFloatingButton(titleButton, saved);
            }
        });
    });
}

function injectTitleButton() {
    if (!visibilityEnabled || !preferredPlatforms.length || !isSupportedProblemPage()) {
        removeTitleButton();
        hidePopup();
        return;
    }
    injectFloatingButton();
}

function hidePopup() {
    if (buttonContainer) buttonContainer.style.display = 'none';
}

function showPopup() {
    if (buttonContainer && buttonContainer.innerHTML.trim() !== '') {
        buttonContainer.style.display = 'block';
    }
}

function handleUrlChange() {
    const newUrl = window.location.href;
    if (newUrl !== currentUrl) {
        currentUrl = newUrl;
        
        closeSearchResults();
        injectTitleButton();
        
        setTimeout(() => {
            injectTitleButton();
        }, 1000);
    }
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

async function init() {
    let visibilityRevision = 0;
    let platformsRevision = 0;
    let accountsRevision = 0;
    let thresholdRevision = 0;
    // React to setting changes (platform toggles, threshold, visibility) from the
    // popup/background immediately, instead of waiting for the next page load.
    const handleStorageChange = (changes, area) => {
        if (area !== 'local') return;

        if (changes['dsa-preferred-platforms']) {
            platformsRevision += 1;
            const stored = changes['dsa-preferred-platforms'].newValue;
            const valid = Array.isArray(stored) ? stored.filter(p => DEFAULT_PLATFORMS.includes(p)) : [];
            platformPreferences = Array.isArray(stored) ? valid : DEFAULT_PLATFORMS.slice();
        }
        if (changes['crossdsa-tracker-v1']) {
            accountsRevision += 1;
            connectedAccounts = changes['crossdsa-tracker-v1'].newValue?.accounts || {};
            const saved = changes['crossdsa-tracker-v1'].newValue?.settings?.platformOrder;
            platformDisplayOrder = [...new Set([...(Array.isArray(saved) ? saved : []), ...DEFAULT_PLATFORM_ORDER])].filter(id => DEFAULT_PLATFORMS.includes(id));
        }
        if (changes['dsa-preferred-platforms'] || changes['crossdsa-tracker-v1']) {
            updatePreferredPlatforms();
            closeSearchResults();
            if (buttonContainer) injectTitleButton();
        }

        if (changes['dsa-helper-similarity-threshold']) {
            thresholdRevision += 1;
            SIMILARITY_THRESHOLD = normalizeThreshold(changes['dsa-helper-similarity-threshold'].newValue);
        }


        if (changes['dsa-helper-visibility-enabled']) {
            visibilityRevision += 1;
            visibilityEnabled = changes['dsa-helper-visibility-enabled'].newValue !== false;
            if (!visibilityEnabled) {
                removeTitleButton();
                closeSearchResults();
            } else if (buttonContainer) {
                injectTitleButton();
            }
        }
    };
    try {
        chrome.storage.onChanged.addListener(handleStorageChange);
    } catch (e) {
        return;
    }

    try {
        const revision = visibilityRevision;
        const initialPlatformsRevision = platformsRevision;
        const initialAccountsRevision = accountsRevision;
        const initialThresholdRevision = thresholdRevision;
        const result = await chrome.storage.local.get([
            'dsa-preferred-platforms', 'dsa-helper-visibility-enabled', 'dsa-helper-similarity-threshold', 'crossdsa-tracker-v1'
        ]);
        if (revision === visibilityRevision) visibilityEnabled = result['dsa-helper-visibility-enabled'] !== false;
        if (initialPlatformsRevision === platformsRevision) {
            const stored = Array.isArray(result['dsa-preferred-platforms']) ? result['dsa-preferred-platforms'] : [];
            const valid = stored.filter(p => DEFAULT_PLATFORMS.includes(p));
            platformPreferences = Array.isArray(result['dsa-preferred-platforms']) ? valid : DEFAULT_PLATFORMS.slice();
        }
        if (initialAccountsRevision === accountsRevision) {
            connectedAccounts = result['crossdsa-tracker-v1']?.accounts || {};
            const saved = result['crossdsa-tracker-v1']?.settings?.platformOrder;
            platformDisplayOrder = [...new Set([...(Array.isArray(saved) ? saved : []), ...DEFAULT_PLATFORM_ORDER])].filter(id => DEFAULT_PLATFORMS.includes(id));
        }
        updatePreferredPlatforms();
        if (initialThresholdRevision === thresholdRevision) SIMILARITY_THRESHOLD = normalizeThreshold(result['dsa-helper-similarity-threshold']);
    } catch (e) {
    }
    await loadProblemsData();
    try {
        if (!chrome.runtime?.id) return;
    } catch (e) {
        return;
    }
    computeTitleIdf();
    createButtonContainer();

    // Schedule a public-data refresh after submitting, including SPA problem pages.
    document.addEventListener('click', event => {
        const control = event.target.closest('button, [role="button"], input[type="submit"]');
        if (!control || control.closest('#dsa-helper-container')) return;
        const label = `${control.textContent || ''} ${control.getAttribute('aria-label') || ''} ${control.value || ''}`;
        if (!/\bsubmit\b/i.test(label)) return;
        chrome.runtime.sendMessage({ action: 'tracker:submission', platform: getCurrentPlatform() }).catch(() => {});
    }, true);

    document.addEventListener('click', (e) => {
        if (buttonContainer && !buttonContainer.contains(e.target) &&
            !e.target.classList.contains('dsa-helper-title-btn')) {
            closeSearchResults();
        }
    });

    document.addEventListener('scroll', () => {
        closeSearchResults();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeSearchResults();
        }
    });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectTitleButton);
    } else {
        injectTitleButton();
    }

    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
        originalPushState.apply(this, args);
        handleUrlChange();
    };
    history.replaceState = function (...args) {
        originalReplaceState.apply(this, args);
        handleUrlChange();
    };

    window.addEventListener('popstate', handleUrlChange);

    window.addEventListener('resize', debounce(() => {
        const floatingButton = document.querySelector('.dsa-helper-float-btn');
        if (!floatingButton) return;
        placeFloatingButton(floatingButton, currentFloatingPosition);
        if (buttonContainer?.style.display === 'block') {
            positionContainer(floatingButton);
        }
    }, 100));

    const debouncedAnalyze = debounce(() => {
        injectTitleButton();
    }, 1000);

    const observer = new MutationObserver((mutations) => {
        // Page scripts run in another world, so their history calls can bypass
        // our wrappers. SPA renders still trigger this observer.
        handleUrlChange();
        let significantChange = false;
        mutations.forEach(mutation => {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                for (let node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE && 
                        (node.classList?.contains('mt-6') || 
                         node.classList?.contains('text-2xl') ||
                         node.tagName === 'MAIN' ||
                         node.tagName === 'SECTION')) {
                        significantChange = true;
                        break;
                    }
                }
            }
        });
        
        if (significantChange) {
            closeSearchResults();
        }
        
        debouncedAnalyze();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
    });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'refresh') {
        injectTitleButton();
        sendResponse({ success: true });
    }
    if (request.action === 'toggle') {
        const enabled = !visibilityEnabled;
        chrome.storage.local.set({ 'dsa-helper-visibility-enabled': enabled }).then(() => {
            sendResponse({ success: true, visible: enabled });
        }).catch(() => sendResponse({ success: false, visible: visibilityEnabled }));
        return true;
    }
    if (request.action === 'setSimilarityThreshold') {
        SIMILARITY_THRESHOLD = normalizeThreshold(request.value);
        sendResponse({ success: true });
    }
    if (request.action === 'getSimilarityThreshold') {
        sendResponse({ value: SIMILARITY_THRESHOLD });
    }
    if (request.action === 'getPreferredPlatforms') {
        sendResponse({ platforms: preferredPlatforms.slice() });
    }
    if (request.action === 'setPreferredPlatforms') {
        platformPreferences = Array.isArray(request.platforms) ? request.platforms.filter(p => DEFAULT_PLATFORMS.includes(p)) : DEFAULT_PLATFORMS.slice();
        updatePreferredPlatforms();
        closeSearchResults();
        injectTitleButton();
        try {
            chrome.storage.local.set({ 'dsa-preferred-platforms': platformPreferences });
        } catch (e) {
        }
        sendResponse({ success: true, platforms: preferredPlatforms.slice() });
    }
    if (request.action === 'getToggleState') {
        sendResponse({ enabled: visibilityEnabled });
    }
    if (request.action === 'getProblemCount') {
        sendResponse({ count: problemsData.filter(problem => connectedAccounts[problem.source]).length });
    }
});

init();
