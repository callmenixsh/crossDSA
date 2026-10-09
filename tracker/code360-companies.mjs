// The legacy scraper appended company_list after practice_topics. These are the
// practice topics in the bundled Code360 index; newer records keep both fields.
const practiceTopics = new Set([
  'Arrays', 'Strings', 'Dynamic Programming', 'Math', 'Number Theory', 'Sorting',
  'Greedy', 'Recursion', 'Depth-first Search', 'Matrices (2D Arrays)', 'Binary Trees',
  'Linked List', 'Binary Search', 'Graph', 'SQL', 'Hash Table', 'Stacks & Queues',
  'Two Pointers', 'Trees', 'Bit Manipulation', 'Binary Search Trees',
  'Breadth-first Search', 'Ad-Hoc', 'Heap', 'Backtracking', 'Computational Geometry', 'Tries',
]);
const placeholders = new Set(['unknown', 'not available', 'faang']);
export const companySlug = name => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const aliases = {
  google: ['Google inc', 'Google.com', 'Goole'],
  microsoft: ['Micrososft'],
  amazon: ['Amazon Kindle', 'Amazon development services', 'Amazon transportation', 'AmazonWOW'],
  meta: ['Facebook'],
  tcs: ['Tata Consultancy Services', 'Tata Consulatnacy Services', 'Tata Consultancy Sevices', 'Tata Consultancy service (TCS)', 'TCS iON'],
  infosys: ['Infosys Technologies Limited', 'Infosys India Pvt. Ltd', 'Infosys Ltd', 'Infosys Pvt Limited', 'Infosys privite limited'],
  cognizant: ['Cognizant technology pvt ltd'],
  wipro: ['Wipro pvt', 'Wipro infotech'],
  accenture: ['Accenture India Pvt.Ltd', 'Accenture Solutions Pvt. Ltd.', 'Accenture Technology Solutions'],
  paytm: ['One97 Communications Limited'],
  'de-shaw': ['D.E.Shaw', 'The D. E. Shaw Group'],
  jpmorgan: ['JP Morgan Chase & Company', 'J P Morgan India PVT ltd'],
  'walmart-global-tech': ['Walmart'],
  samsung: ['Samsung R&D Institute', 'Samsung Electronics', 'Samsung(SRIB)'],
  vmware: ['VMware Inc', 'VMware Software India Pvt Ltd'],
  sap: ['SAP Labs', 'SAP India'],
  zoho: ['Zoho Corporation'],
  swiggy: ['Swiggy private limited'],
  myntra: ['Myntra pvt ltd'],
  mindtree: ['Mindtree private limited'],
  capgemini: ['Capegemini Consulting India Private Limited'],
  'info-edge': ['Info Edge India (Naukri.com)', 'InfoEdge India Private Limitied', 'Infoedge private limited'],
  'expedia': ['Expedia Group'],
  intel: ['Intel Corporation'],
  ibm: ['IBM Global Process Services Pvt. Ltd.', 'IBM Ind  PVT LTD'],
  paypal: ['PayPal India Pvt Lt'],
  phonepe: ['Phonepe pvt limited'],
  nagarro: ['Nagarro pvt limited'],
  'persistent-systems': ['Persistent Systems'],
  'global-logic': ['GLOBALLOGIC TECHNOLOGIES LIMITED'],
  hsbc: ['HSBC Global Banking and Markets', 'Hsbc Software Development Ind Pvt Ltd'],
  atlassian: ['Atlassion'],
  palantir: ['Palantir Technologies'],
  'zop-smart': ['Zopsmart', 'Zop Smart'],
  zscaler: ['Zscalar'],
};
const canonical = new Map(Object.entries(aliases).flatMap(([id, names]) => [id, ...names].map(name => [companySlug(name), id])));
const compoundTags = {
  'Amazon Microsoft': ['Amazon', 'Microsoft'],
  'Amazon, Google, microsoft,': ['Amazon', 'Google', 'Microsoft'],
  'google, microsoft, amazon': ['Google', 'Microsoft', 'Amazon'],
  'Microsoft,Google': ['Microsoft', 'Google'],
  'Infosys, Walmart': ['Infosys', 'Walmart'],
  'DE Shaw India , Amazon': ['D.E.Shaw', 'Amazon'],
};

export function canonicalCompanyId(name) { return canonical.get(companySlug(name)) || companySlug(name); }

export function splitCode360Tags(record) {
  const topics = [...new Set((record.topics || []).filter(t => typeof t === 'string'))];
  const separate = Array.isArray(record.companies);
  const raw = separate ? record.companies : topics.filter(tag => !practiceTopics.has(tag));
  const companies = [...new Set(raw.filter(t => typeof t === 'string' && t.trim() && !placeholders.has(t.trim().toLowerCase())).flatMap(t => compoundTags[t] || [t]))];
  return { topics: separate ? topics : topics.filter(tag => practiceTopics.has(tag)), companies };
}

export const COMPANY_DISPLAY_NAMES = {
  tcs: 'TCS', infosys: 'Infosys', cognizant: 'Cognizant', wipro: 'Wipro',
  paytm: 'Paytm', jpmorgan: 'JPMorgan', 'de-shaw': 'D. E. Shaw',
  vmware: 'VMware', sap: 'SAP', ibm: 'IBM', hsbc: 'HSBC',
  phonepe: 'PhonePe', paypal: 'PayPal', 'info-edge': 'Info Edge',
  'walmart-global-tech': 'Walmart Global Tech', meta: 'Meta',
  'global-logic': 'GlobalLogic', capgemini: 'Capgemini', 'zop-smart': 'ZopSmart',
};
