const DEFAULT_SETTINGS = {
  enabled: true,
  hideR18: false,
  dimInsteadOfHide: false,
  showCardButton: true,
  hiddenComics: {},
  blockedTags: [],
  blockedKeywords: []
};

/**
 * Initialize missing storage keys on install or update without overwriting existing user data.
 */
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS), (existing) => {
    const patch = {};
    for (const [key, defaultValue] of Object.entries(DEFAULT_SETTINGS)) {
      if (existing[key] === undefined) {
        patch[key] = defaultValue;
      }
    }
    if (Object.keys(patch).length > 0) {
      chrome.storage.local.set(patch);
    }
  });
});

/**
 * Update the per-tab extension action badge count when reported by content scripts.
 */
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== 'UPDATE_BADGE' || !sender?.tab?.id) {
    return;
  }

  const tabId = sender.tab.id;
  const count = Number(msg.count) || 0;
  const text = count > 0 ? String(count) : '';

  chrome.action.setBadgeText({ tabId, text });
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#e11d48' });
  if (typeof chrome.action.setBadgeTextColor === 'function') {
    chrome.action.setBadgeTextColor({ tabId, color: '#ffffff' });
  }
});
