import { normalizeState, PLATFORMS, cleanHandle, safeProblemUrl, problemKey } from './core.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const strings = value => Array.isArray(value) && value.every(item => typeof item === 'string');
function requireValid(condition) {
  if (!condition) throw new Error('Invalid backup. Choose a JSON file exported from crossDSA.');
}

// Validate before normalization: malformed files must never silently reset data.
export function validateBackup(value) {
  requireValid(object(value) && value.version === 1);
  const inspect = (node, depth = 0) => {
    requireValid(depth < 40);
    if (!node || typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node)) {
      requireValid(!['__proto__', 'prototype', 'constructor'].includes(key));
      inspect(child, depth + 1);
    }
  };
  inspect(value);
  for (const key of ['accounts', 'workspace', 'lists', 'settings']) requireValid(object(value[key]));
  requireValid(value.disconnectedAccounts === undefined || object(value.disconnectedAccounts));
  const settings = value.settings;
  requireValid(Number.isInteger(settings.dailyGoal) && settings.dailyGoal >= 1 && settings.dailyGoal <= 50);
  requireValid(typeof settings.timeZone === 'string' && settings.timeZone.length > 0);
  try { new Intl.DateTimeFormat('en', { timeZone: settings.timeZone }).format(); } catch { requireValid(false); }
  for (const key of ['autoSync', 'contestsEnabled', 'contestReminders']) requireValid(settings[key] === undefined || typeof settings[key] === 'boolean');
  if (settings.platformOrder !== undefined) requireValid(strings(settings.platformOrder) && settings.platformOrder.every(id => Object.hasOwn(PLATFORMS, id)));
  const question = (entry, platform = entry?.platform) => {
    requireValid(object(entry) && Object.hasOwn(PLATFORMS, platform) && entry.platform === platform);
    requireValid(typeof entry.title === 'string' && safeProblemUrl(entry.url, platform) && entry.key === problemKey(platform, entry.url));
    requireValid(entry.timestamp == null || Number.isFinite(entry.timestamp) && Number.isFinite(new Date(entry.timestamp).getTime()));
    requireValid(entry.topics === undefined || strings(entry.topics));
  };
  for (const accounts of [value.accounts, value.disconnectedAccounts || {}]) {
    for (const [platform, account] of Object.entries(accounts)) {
      requireValid(Object.hasOwn(PLATFORMS, platform) && object(account) && typeof account.handle === 'string');
      requireValid(cleanHandle(platform, account.handle) === account.handle);
      if (account.dailyHistory !== undefined) {
        requireValid(object(account.dailyHistory) && Object.keys(account.dailyHistory).length <= 366);
        for (const [day, record] of Object.entries(account.dailyHistory)) {
          requireValid(/^\d{4}-\d{2}-\d{2}$/.test(day) && object(record) && record.handle === account.handle.toLowerCase() && typeof record.done === 'boolean' && Number.isFinite(record.verifiedAt));
        }
      }
      if (account.snapshot != null) {
        const snapshot = account.snapshot;
        requireValid(object(snapshot));
        requireValid(snapshot.recent === undefined || Array.isArray(snapshot.recent));
        for (const record of snapshot.recent || []) question(record, platform);
        requireValid(snapshot.solved === undefined || object(snapshot.solved));
        for (const [key, record] of Object.entries(snapshot.solved || {})) { question(record, platform); requireValid(key === record.key); }
        for (const field of ['ratings', 'scoreHistory']) if (snapshot[field] !== undefined) requireValid(Array.isArray(snapshot[field]) && snapshot[field].every(point => object(point) && Number.isFinite(point.timestamp) && Number.isFinite(point.rating)));
        for (const field of ['calendar', 'breakdown']) if (snapshot[field] !== undefined) requireValid(object(snapshot[field]) && Object.values(snapshot[field]).every(Number.isFinite));
      }
      requireValid(account.historyImport == null || object(account.historyImport));
    }
  }
  for (const [id, list] of Object.entries(value.lists)) requireValid(object(list) && list.id === id && typeof list.name === 'string' && list.name.trim().length > 0);
  for (const [key, entry] of Object.entries(value.workspace)) {
    question(entry); requireValid(key === entry.key && strings(entry.listIds) && entry.listIds.every(id => Object.hasOwn(value.lists, id)));
  }
  return normalizeState(structuredClone(value));
}

export function prepareBackup(value) {
  const state = validateBackup(value);
  for (const accounts of [state.accounts, state.disconnectedAccounts]) for (const account of Object.values(accounts)) {
    // A restored account must not accept results from a previous in-flight sync.
    account.generation = crypto.randomUUID();
    account.status = 'idle';
    account.error = null;
    delete account.recoveryAttemptedAt;
    if (account.historyImport) account.historyImport = { ...account.historyImport, id: crypto.randomUUID(), status: 'paused', error: null };
  }
  return state;
}
