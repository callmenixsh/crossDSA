const PROBLEM_DATA_FILES = [
    'data/leetcode-data.json',
    'data/geeksforgeeks-data.json',
    'data/codeforces-data.json',
    'data/codechef-data.json',
    'data/code360-data.json'
];

const FILE_SOURCES = {
    'data/leetcode-data.json': 'leetcode',
    'data/geeksforgeeks-data.json': 'geeksforgeeks',
    'data/codeforces-data.json': 'codeforces',
    'data/codechef-data.json': 'codechef',
    'data/code360-data.json': 'code360'
};

const DEFAULT_PLATFORMS = ['leetcode', 'geeksforgeeks', 'codeforces', 'codechef', 'code360'];

let preferredPlatforms = DEFAULT_PLATFORMS.slice();
let problemsData = [];
let buttonContainer = null;
let isSearching = false; 

async function loadProblemsData() {
    try {
        const results = await Promise.all(PROBLEM_DATA_FILES.map(async (file) => {
            try {
                const response = await fetch(chrome.runtime.getURL(file));
                if (!response.ok) {
                    console.log(`${file} not available (${response.status})`);
                    return [];
                }
                const data = await response.json();
                if (!Array.isArray(data)) return [];
                const source = FILE_SOURCES[file];
                return data.map(p => {
                    if (!p || typeof p !== 'object') return p;
                    return p.source ? p : { ...p, source };
                });
            } catch (fileError) {
                console.log(`Failed to load ${file}:`, fileError);
                return [];
            }
        }));

        problemsData = results.flat();
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
            descBgrams: toBigrams(descToks)
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

let SIMILARITY_THRESHOLD = 0.4;
if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem('dsa-helper-similarity-threshold');
    if (stored) SIMILARITY_THRESHOLD = parseFloat(stored);
}
// Also check chrome.storage for consistency with popup
try {
    chrome.storage.local.get(['dsa-helper-similarity-threshold'], (result) => {
        if (result['dsa-helper-similarity-threshold']) {
            SIMILARITY_THRESHOLD = parseFloat(result['dsa-helper-similarity-threshold']);
        }
    });
} catch (e) {
}

function findMatchingProblems(pageText, pageTitle) {
    console.log('Finding matches for:', pageText.substring(0, 100) + '...');

    const pageTokens = tokenize(pageText);
    const pageUniq = new Set(pageTokens);
    const pageBgrams = toBigrams(pageTokens);

    // Title region comparison: the candidate's title should agree with the
    // current problem's title, not just share words somewhere in the statement.
    const pageTitleTokens = tokenize(pageTitle);
    const pageTitleUniq = pageTitleTokens.length ? new Set(pageTitleTokens) : pageUniq;
    const pageTitleBgrams = pageTitleTokens.length ? toBigrams(pageTitleTokens) : pageBgrams;

    const minThreshold = Math.max(0.2, SIMILARITY_THRESHOLD);

    const currentPlatform = getCurrentPlatform();
    const currentSource = (currentPlatform === 'tuf' || currentPlatform === null) ? null : currentPlatform;

    const matches = [];
    for (let i = 0; i < problemsData.length; i++) {
        const problem = problemsData[i];

        // Skip problems from the platform the user is currently on
        if (currentSource && problem.source === currentSource) {
            continue;
        }

        // Only search platforms the user enabled in settings
        if (!preferredPlatforms.includes(problem.source)) {
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

    matches.sort((a, b) => b.combinedScore - a.combinedScore);

    // Deduplicate: drop near-identical titles
    const uniqueMatches = [];
    const seenTitles = [];
    for (const match of matches) {
        const titleToks = tokenize(match.title);
        let isRedundant = false;
        for (const seen of seenTitles) {
            if (titleIsDuplicate(titleToks, seen)) {
                isRedundant = true;
                break;
            }
        }
        if (!isRedundant) {
            uniqueMatches.push(match);
            seenTitles.push(titleToks);
        }
        if (uniqueMatches.length >= 30) break;
    }

    console.log('Found', uniqueMatches.length, 'unique matches');
    return uniqueMatches.slice(0, 20);
}

function getProblemTitle() {
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
    if (host.endsWith('naukri.com') && window.location.pathname.includes('/code360/')) return 'code360';
    return null;
}

const PLATFORM_DISPLAY_NAMES = {
    'tuf': 'TakeUForward',
    'leetcode': 'LeetCode',
    'geeksforgeeks': 'GeeksforGeeks',
    'codeforces': 'Codeforces',
    'codechef': 'CodeChef',
    'code360': 'Code 360'
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
    return buttonContainer;
}

function closeSearchResults() {
    if (buttonContainer) {
        buttonContainer.style.display = 'none';
        buttonContainer.innerHTML = '';
    }
}

function positionContainer(titleButton) {
    const container = createButtonContainer();
    const rect = titleButton.getBoundingClientRect();
    const margin = 8;
    const panelWidth = 480;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const panelMaxHeight = vh * 0.8;

    if (titleButton.classList.contains('dsa-helper-float-btn')) {
        // Button sits bottom-left: open the panel to its right, growing upwards
        const left = Math.max(margin, Math.round(rect.right + margin));
        container.style.left = `${left}px`;
        container.style.right = 'auto';
        container.style.top = 'auto';
        const bottom = Math.max(margin, Math.round(window.innerHeight - rect.top + margin));
        container.style.bottom = `${bottom}px`;
    } else {
        const left = Math.max(margin, Math.min(Math.round(rect.left), vw - panelWidth - margin));
        const top = Math.max(margin, Math.min(Math.round(rect.bottom + margin), vh - panelMaxHeight - margin));
        container.style.left = `${left}px`;
        container.style.right = 'auto';
        container.style.top = `${top}px`;
    }
}

function showLoadingScreen(titleButton) {
    const container = createButtonContainer();
    const enabledCount = problemsData.filter(p => preferredPlatforms.includes(p.source)).length;
    container.innerHTML = `
        <div class="dsa-helper-header">
            <span>Searching for matches...</span>
        </div>
        <div class="loading-container">
            <div class="loading-text">
                <p>Analyzing problem content...</p>
                <p class="loading-subtext">Checking ${enabledCount} problems across enabled platforms</p>
            </div>
        </div>
    `;
    // Position below button immediately, keeping the panel fully on-screen
    if (titleButton) {
        positionContainer(titleButton);
    }
    container.style.display = 'block';
}

function createLeetCodeButton(problem) {
    const button = document.createElement('button');
    button.className = 'dsa-helper-btn';
    
    if (problem.isPremium) {
        button.classList.add('premium-problem');
    }
    
    const sqlBadge = problem.is_sql ? '<span class="sql-badge">SQL</span>' : '';
    const premiumBadge = problem.isPremium ? '<span class="premium-badge">PREMIUM</span>' : '';
    
    const titlePercent = Math.round(problem.titleMatch * 100);
    const descPercent = Math.round(problem.descMatch * 100);
    const totalPercent = Math.round(problem.combinedScore * 100);
    
    const topicTags = problem.topics.slice(0, 4).map(topic => 
        `<span class="topic-tag">${topic}</span>`
    ).join('');
    
    button.innerHTML = `
    <div class="btn-content">
      <div class="btn-title">${problem.title} ${sqlBadge}</div>
      <div class="btn-meta">
        <span class="difficulty ${problem.difficulty.toLowerCase()}">${problem.difficulty}</span>
        <span class="match-percent total-match">${totalPercent}% Matched</span>
        <span class="match-percent desc-match">${descPercent}% Desc Match</span>
        <span class="match-percent title-match">${titlePercent}% Title Match</span>
        ${premiumBadge}
      </div>
      <div class="btn-topics-line">
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

    // Codeforces: the problem index + contest ID is the most reliable search key.
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
        emptyText.textContent = 'No matches found';
        const emptyActions = document.createElement('div');
        emptyActions.className = 'header-actions';
        emptyActions.appendChild(createYoutubeButton());
        const emptyClose = document.createElement('button');
        emptyClose.className = 'close-btn';
        emptyClose.innerHTML = '×';
        emptyClose.addEventListener('click', () => { container.style.display = 'none'; });
        emptyActions.appendChild(emptyClose);
        emptyHeader.appendChild(emptyText);
        emptyHeader.appendChild(emptyActions);

        const emptyContent = document.createElement('div');
        emptyContent.className = 'results-content';
        emptyContent.innerHTML = `
                <div class="no-matches">
                    <p>No similar problems found.</p>
                    <p class="no-matches-subtext">Try adjusting the similarity threshold in the popup.</p>
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
    const sourceKeys = [...groups.keys()];
    
    container.style.display = 'block';
    const header = document.createElement('div');
    header.className = 'dsa-helper-header';
    const headerText = document.createElement('span');
    headerText.textContent = `Found Match${matches.length > 1 ? 'es' : ''} on ${groups.size} platform${groups.size > 1 ? 's' : ''}!`;
    const headerActions = document.createElement('div');
    headerActions.className = 'header-actions';
    headerActions.appendChild(createYoutubeButton());
    const closeBtn = document.createElement('button');
    closeBtn.className = 'close-btn';
    closeBtn.innerHTML = '×';
    closeBtn.addEventListener('click', () => { container.style.display = 'none'; });
    headerActions.appendChild(closeBtn);
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

let currentUrl = window.location.href;

function createTitleButton() {
    const titleButton = document.createElement('button');
    titleButton.className = 'dsa-helper-title-btn';
    titleButton.style.marginLeft = '8px';
    titleButton.style.cursor = 'pointer';
    
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
    titleButton.title = 'Find similar problems (description-prioritized matching)';

    titleButton.addEventListener('click', async (e) => {
        e.stopPropagation();
        
        if (isSearching) return;
        
        isSearching = true;
        titleButton.style.opacity = '0.6';
        titleButton.style.pointerEvents = 'none';
        
        try {
            showLoadingScreen(titleButton);
            
            const content = await getProblemContent();
            if (content) {
                await new Promise(resolve => setTimeout(resolve, 800));
                
                const pageTitle = getPageTitle();
                const matches = await findMatchingProblems(content, pageTitle);
                updateUI(matches);
                
                // Position is already set by showLoadingScreen
                if (buttonContainer) {
                    buttonContainer.style.display = 'block';
                }
            }
        } catch (error) {
            console.error('Search error:', error);
            updateUI([]);
        } finally {
            isSearching = false;
            titleButton.style.opacity = '1';
            titleButton.style.pointerEvents = 'auto';
        }
    });
    return titleButton;
}

let visibilityEnabled = true;
if (typeof localStorage !== 'undefined') {
    const storedVisibility = localStorage.getItem('dsa-helper-visibility-enabled');
    if (storedVisibility !== null) {
        visibilityEnabled = storedVisibility === 'true';
    }
}

function getTitleElementForPlatform() {
    const platform = getCurrentPlatform();
    if (platform === 'leetcode') {
        // The navbar also has a "Problems" link (href="/problems/"). Only the
        // question title link carries a problem slug, so match ONLY that one to
        // avoid injecting the button into the navbar as well.
        const links = document.querySelectorAll('a[href^="/problems/"]');
        let titleLink = null;
        for (const link of links) {
            const href = (link.getAttribute('href') || '').replace(/^https?:\/\/[^/]+/i, '');
            if (/^\/problems\/?$/.test(href)) continue;               // navbar problems list
            if (!titleLink && /^\/problems\/[^/]+/.test(href)) {
                titleLink = link;                                      // first slug-bearing link (fallback)
            }
            if (href.match(/^\/problems\/[^/]+/) && link.querySelector('h1, h2, [class*="title"]')) {
                titleLink = link;                                      // prefer a heading-bearing title link
                break;
            }
        }
        if (!titleLink) return null;
        const container = titleLink.closest('div');
        return container || titleLink.parentElement;
    }
    if (platform === 'codeforces') {
        return document.querySelector('.problem-statement .header .title');
    }
    if (platform === 'code360') {
        return document.querySelector('h1, h1[class*="title"], [class*="problem-name"], [class*="problem-title"]');
    }
    return document.querySelector(
        '.text-2xl.font-bold.text-new_primary.dark\\:text-new_dark_primary, h1.text-xl.font-bold, h1.text-2xl.font-bold, h1.font-bold, [data-problem-title]'
    );
}

function removeTitleButton() {
    document.querySelectorAll('.dsa-helper-title-btn, .dsa-helper-float-btn').forEach(btn => btn.remove());
}

function injectFloatingButton() {
    if (document.querySelector('.dsa-helper-float-btn')) return;
    const titleButton = createTitleButton();
    titleButton.classList.add('dsa-helper-float-btn');
    titleButton.title = 'Find similar DSA problems across platforms';
    const label = document.createElement('span');
    label.className = 'dsa-helper-float-label';
    label.textContent = 'Similar';
    titleButton.appendChild(label);
    document.body.appendChild(titleButton);
}

function injectTitleButton() {
    if (!visibilityEnabled) {
        removeTitleButton();
        hidePopup();
        return;
    }
    const platform = getCurrentPlatform();
    if (platform === 'geeksforgeeks' || platform === 'codechef' || platform === 'code360') {
        injectFloatingButton();
        return;
    }
    const titleElement = getTitleElementForPlatform();
    if (titleElement && !titleElement.querySelector('.dsa-helper-title-btn')) {
        const titleButton = createTitleButton();
        titleElement.appendChild(titleButton);
    }
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
    try {
        const result = await chrome.storage.local.get(['dsa-preferred-platforms']);
        const stored = Array.isArray(result['dsa-preferred-platforms']) ? result['dsa-preferred-platforms'] : [];
        const valid = stored.filter(p => DEFAULT_PLATFORMS.includes(p));
        if (valid.length) {
            preferredPlatforms = valid;
        }
    } catch (e) {
    }
    await loadProblemsData();
    computeTitleIdf();
    createButtonContainer();

    // React to setting changes (platform toggles, threshold, visibility) from the
    // popup/background immediately, instead of waiting for the next page load.
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;

        if (changes['dsa-preferred-platforms']) {
            const stored = changes['dsa-preferred-platforms'].newValue;
            if (Array.isArray(stored)) {
                const valid = stored.filter(p => DEFAULT_PLATFORMS.includes(p));
                if (valid.length) preferredPlatforms = valid;
            }
        }

        if (changes['dsa-helper-similarity-threshold']) {
            const value = parseFloat(changes['dsa-helper-similarity-threshold'].newValue);
            if (!Number.isNaN(value)) SIMILARITY_THRESHOLD = value;
        }

        if (changes['dsa-helper-visibility-enabled']) {
            visibilityEnabled = changes['dsa-helper-visibility-enabled'].newValue === true;
            if (!visibilityEnabled) {
                removeTitleButton();
                hidePopup();
            } else {
                injectTitleButton();
            }
        }
    });

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
        if (e.key !== 'Tab') {
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

    const debouncedAnalyze = debounce(() => {
        injectTitleButton();
    }, 1000);

    const observer = new MutationObserver((mutations) => {
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
        visibilityEnabled = !visibilityEnabled;
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('dsa-helper-visibility-enabled', visibilityEnabled);
        }
        if (!visibilityEnabled) {
            removeTitleButton();
            hidePopup();
        } else {
            injectTitleButton();
        }
        sendResponse({ success: true, visible: visibilityEnabled });
    }
    if (request.action === 'setSimilarityThreshold') {
        SIMILARITY_THRESHOLD = parseFloat(request.value);
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('dsa-helper-similarity-threshold', SIMILARITY_THRESHOLD);
        }
        sendResponse({ success: true });
    }
    if (request.action === 'getSimilarityThreshold') {
        sendResponse({ value: SIMILARITY_THRESHOLD });
    }
    if (request.action === 'getPreferredPlatforms') {
        sendResponse({ platforms: preferredPlatforms.slice() });
    }
    if (request.action === 'setPreferredPlatforms') {
        if (Array.isArray(request.platforms) && request.platforms.length) {
            preferredPlatforms = request.platforms.filter(p => DEFAULT_PLATFORMS.includes(p));
            if (!preferredPlatforms.length) preferredPlatforms = DEFAULT_PLATFORMS.slice();
        } else {
            preferredPlatforms = DEFAULT_PLATFORMS.slice();
        }
        try {
            chrome.storage.local.set({ 'dsa-preferred-platforms': preferredPlatforms });
        } catch (e) {
        }
        sendResponse({ success: true, platforms: preferredPlatforms.slice() });
    }
    if (request.action === 'getToggleState') {
        sendResponse({ enabled: visibilityEnabled });
    }
    if (request.action === 'getProblemCount') {
        sendResponse({ count: problemsData.length });
    }
});

init();
