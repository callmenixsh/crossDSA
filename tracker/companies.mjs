import { filterLibrary } from './library.mjs';

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
  return (data.companies || []).map(company => {
    const windows = {};
    for (const [window, entries] of Object.entries(company.windows || {})) {
      windows[window] = Object.entries(entries).flatMap(([slug, frequency]) => bySlug.has(slug) ? [{ ...bySlug.get(slug), frequency }] : []);
    }
    return { ...company, category: companyCategory(company.id), windows };
  }).filter(company => Object.values(company.windows).some(rows => rows.length));
}

export function companyCounts(company, window = 'all') {
  const rows = company.windows[window] || [];
  const counts = { total: rows.length, Easy: 0, Medium: 0, Hard: 0 };
  for (const row of rows) if (Object.hasOwn(counts, row.difficulty)) counts[row.difficulty]++;
  return counts;
}

export function filterCompanyQuestions(company, { window = 'all', sort = 'frequency', ...options } = {}) {
  const rows = filterLibrary(company.windows[window] || [], { ...options, accounts: { leetcode: {} }, sort: sort === 'frequency' ? 'default' : sort });
  if (sort === 'frequency') rows.sort((a, b) => b.frequency - a.frequency || Number(a.id) - Number(b.id));
  return rows;
}
