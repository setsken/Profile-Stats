// Profile Stats — service worker.
// Skeleton stage: keeps the extension alive, proxies side panel intents, and
// reserves a place for the eventual API client used by content scripts.

// Open the popup as a side panel when the extension icon is clicked, so the
// user can keep Profile Stats open alongside an OnlyFans tab.
chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  }
});

// Placeholder message handler. The Profile Stats content scripts (badge,
// trend, AI verdict) will route their backend calls through here later so the
// auth token never leaves the service worker.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request || !request.action) {
    sendResponse({ success: false, error: 'No action specified' });
    return false;
  }

  if (request.action === 'ping') {
    sendResponse({ success: true, pong: true });
    return false;
  }

  // Unknown action — surface explicitly so callers can fail fast during
  // development instead of waiting on a stalled promise.
  sendResponse({ success: false, error: `Unknown action: ${request.action}` });
  return false;
});
