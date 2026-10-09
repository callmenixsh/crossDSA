import { registerContests } from './tracker/contest-service.mjs';
import { registerTracker } from './tracker/service.mjs';
import { registerBadge } from './tracker/badge.mjs';

registerTracker();
registerContests();
registerBadge();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const action = request?.action;
    if (!['getSimilarityThreshold', 'setSimilarityThreshold', 'getPreferredPlatforms', 'setPreferredPlatforms'].includes(action)) return;
    const isUI = sender.id === chrome.runtime.id && !sender.tab &&
        ['popup.html', 'dashboard.html'].some(path => sender.url?.split(/[?#]/)[0] === chrome.runtime.getURL(path));
    if (sender.id !== chrome.runtime.id || action.startsWith('set') && !isUI) {
        sendResponse({ success: false, error: 'Extension settings access required.' });
        return;
    }
    const platforms = ['leetcode', 'geeksforgeeks', 'codeforces', 'codechef', 'code360'];
    const threshold = value => {
        const number = typeof value === 'string' && value.trim() ? Number(value) : value;
        return typeof number === 'number' && Number.isFinite(number) && number >= 0.1 && number <= 1 ? number : null;
    };
    (async () => {
        if (action === 'getSimilarityThreshold') {
            const result = await chrome.storage.local.get('dsa-helper-similarity-threshold');
            return { value: threshold(result['dsa-helper-similarity-threshold']) ?? 0.4 };
        }
        if (action === 'setSimilarityThreshold') {
            const value = threshold(request.value);
            if (value === null) throw new Error('Threshold must be between 0.1 and 1.');
            await chrome.storage.local.set({ 'dsa-helper-similarity-threshold': value });
            return { success: true };
        }
        if (action === 'getPreferredPlatforms') {
            const result = await chrome.storage.local.get('dsa-preferred-platforms');
            const list = result['dsa-preferred-platforms'];
            const valid = Array.isArray(list) ? [...new Set(list.filter(p => platforms.includes(p)))] : [];
            return { platforms: valid.length ? valid : null };
        }
        if (!Array.isArray(request.platforms) || !request.platforms.length || request.platforms.some(p => !platforms.includes(p))) {
            throw new Error('Choose at least one supported platform.');
        }
        await chrome.storage.local.set({ 'dsa-preferred-platforms': [...new Set(request.platforms)] });
        return { success: true };
    })().then(sendResponse, error => sendResponse({ success: false, error: error.message }));
    return true;
});
