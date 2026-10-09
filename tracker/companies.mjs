import { filterLibrary } from './library.mjs';
import { canonicalCompanyId, splitCode360Tags, COMPANY_DISPLAY_NAMES } from './code360-companies.mjs';

// Editorial directory groups, independent of source company tags.
const groups = {
  'Big Tech': 'amazon|apple|facebook|meta|google|microsoft|linkedin|oracle|yahoo',
  Product: 'adobe|airbnb|atlassian|bytedance|cisco|databricks|docusign|doordash|dropbox|ebay|expedia|intel|intuit|lyft|netflix|nvidia|palantir-technologies|pinterest|qualcomm|reddit|roblox|salesforce|samsung|sap|servicenow|snapchat|snowflake|spotify|tesla|tiktok|twilio|uber|vmware|walmart-global-tech|zoom',
  Finance: 'affirm|american-express|aqr-capital-management|arcesium|barclays|blackrock|bloomberg|capital-one|citadel|de-shaw|deutsche-bank|goldman-sachs|hrt|imc|jane-street|jpmorgan|morgan-stanley|paypal|robinhood|square|stripe|two-sigma|visa',
  'Indian startups': 'acko|blinkit|cashfree|directi|dunzo|flipkart|hotstar|makemytrip|meesho|mindtickle|moengage|ola|paytm|phonepe|razorpay|rupeek|sprinklr|swiggy|zeta-suite|zoho|zomato|zopsmart',
  Services: 'accenture|accolite|amdocs|cognizant|fpt|ibm|infosys|mindtree|persistent-systems|sapient|tcs|tiger-analytics|toptal|wipro',
};
export const COMPANY_CATEGORIES = [...Object.keys(groups), 'Other'];
export const COMPANY_WINDOWS = { all: 'All time', '30d': 'Last 30 days', '3m': 'Last 3 months', '6m': 'Last 6 months', older: 'More than 6 months' };

export function companyCategory(id) {
  return Object.entries(groups).find(([, ids]) => ids.split('|').includes(id))?.[0] || 'Other';
}

export function buildCompanyIndex(data, library) {
  const bySlug = new Map(library.filter(p => p.platform === 'leetcode').map(p => [new URL(p.url).pathname.split('/')[2], p]));
  const index = new Map();
  const nameLookup = new Map();
  for (const company of data.companies || []) {
    const id = canonicalCompanyId(company.id);
    const windows = {};
    for (const [window, entries] of Object.entries(company.windows || {})) {
      windows[window] = Object.entries(entries).flatMap(([slug, frequency]) => bySlug.has(slug) ? [{ ...bySlug.get(slug), frequency }] : []);
    }
    index.set(id, { ...company, id, category: companyCategory(id), windows });
    for (const name of [company.id, company.name, ...(company.aliases || [])]) nameLookup.set(canonicalCompanyId(name), id);
  }
  for (const record of library.filter(p => p.platform === 'code360')) {
    const { topics, companies } = splitCode360Tags(record);
    const seen = new Set();
    for (const name of companies) {
      const canonical = canonicalCompanyId(name), id = nameLookup.get(canonical) || canonical;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      if (!index.has(id)) index.set(id, { id, name: COMPANY_DISPLAY_NAMES[id] || name, aliases: [], category: companyCategory(id), windows: { all: [] } });
      const company = index.get(id);
      if (name !== company.name && !company.aliases?.includes(name)) company.aliases = [...(company.aliases || []), name];
      (company.windows.all ||= []).push({ ...record, topics, frequency: null });
    }
  }
  return [...index.values()].filter(company => Object.values(company.windows).some(rows => rows.length));
}

export function companyQuestions(company, window = 'all', platform = 'all') {
  return (company.windows[window] || []).filter(p => platform === 'all' || platform === p.platform);
}

export function companyCounts(company, window = 'all', platform = 'all') {
  const rows = companyQuestions(company, window, platform);
  const counts = { total: rows.length, Easy: 0, Medium: 0, Hard: 0 };
  for (const row of rows) if (Object.hasOwn(counts, row.difficulty)) counts[row.difficulty]++;
  return counts;
}

export function filterCompanyQuestions(company, { window = 'all', platform = 'all', sort = 'frequency', ...options } = {}) {
  const rows = filterLibrary(companyQuestions(company, window, platform), { ...options, accounts: { leetcode: {}, code360: {} }, sort: sort === 'frequency' ? 'default' : sort });
  if (sort === 'frequency') rows.sort((a, b) => {
    const left = Number.isFinite(a.frequency), right = Number.isFinite(b.frequency);
    if (left !== right) return left ? -1 : 1;
    return left ? b.frequency - a.frequency || Number(a.id) - Number(b.id) : a.title.localeCompare(b.title);
  });
  return rows;
}
