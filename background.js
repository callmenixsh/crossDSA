chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getSimilarityThreshold') {
        chrome.storage.local.get(['dsa-helper-similarity-threshold'], (result) => {
            const value = result['dsa-helper-similarity-threshold'] || 0.4;
            sendResponse({ value: parseFloat(value) });
        });
        return true;
    }

    if (request.action === 'setSimilarityThreshold') {
        chrome.storage.local.set({ 'dsa-helper-similarity-threshold': request.value });
        sendResponse({ success: true });
        return true;
    }

    if (request.action === 'getPreferredPlatforms') {
        chrome.storage.local.get(['dsa-preferred-platforms'], (result) => {
            const list = result['dsa-preferred-platforms'];
            sendResponse({ platforms: Array.isArray(list) ? list : null });
        });
        return true;
    }

    if (request.action === 'setPreferredPlatforms') {
        chrome.storage.local.set({ 'dsa-preferred-platforms': request.platforms });
        sendResponse({ success: true });
        return true;
    }
});