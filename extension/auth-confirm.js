// SSO confirmation window — opened by Profile Stats background.js when
// Stats Editor requests {action: 'getProfileStatsToken'}.

const params = new URLSearchParams(location.search);
const requestId = params.get('id') || '';
const email = params.get('email') || '';

document.getElementById('email').textContent = email || '(unknown)';

let decisionSent = false;

function sendDecision(approved) {
  if (decisionSent) return;
  decisionSent = true;
  chrome.runtime.sendMessage(
    { action: 'sso-decision', id: requestId, approved },
    () => {
      // Close the popup window regardless of whether the runtime callback fires.
      window.close();
    }
  );
  // Hard fallback in case runtime callback never fires (e.g. service worker
  // unloaded). Close after 600ms anyway.
  setTimeout(() => window.close(), 600);
}

document.getElementById('allowBtn').addEventListener('click', () => sendDecision(true));
document.getElementById('denyBtn').addEventListener('click', () => sendDecision(false));

// If the user closes the window with the OS X button, treat as deny.
window.addEventListener('beforeunload', () => {
  if (!decisionSent) {
    chrome.runtime.sendMessage({ action: 'sso-decision', id: requestId, approved: false });
  }
});
