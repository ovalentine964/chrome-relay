/**
 * CoHusdex Extension — Background Service Worker
 * 
 * ⚠️ IMPORTANT: MV3 service workers are terminated after ~30s of inactivity.
 * They cannot maintain persistent WebSocket connections.
 * For the relay to work reliably, use the CDP-direct approach instead:
 *   google-chrome --remote-debugging-port=9222
 *   node index.js
 * 
 * This extension is a fallback for cases where Chrome can't be started with --remote-debugging-port.
 * For a more reliable relay, use the CDP-direct path described in the README.
 */

const RELAY_URL = 'ws://localhost:3131';
let relayWs = null;

// ── Connect to relay server ─────────────────────────────────────────────────

function connectRelay() {
  try {
    relayWs = new WebSocket(RELAY_URL);
    
    relayWs.onopen = () => {
      console.log('[CoHusdex Background] Connected to relay');
      chrome.action.setBadgeText({ text: 'ON' });
      chrome.action.setBadgeBackgroundColor({ color: '#00c853' });
    };
    
    relayWs.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        // Forward to content script(s)
        chrome.tabs.query({ url: ['https://twitter.com/*', 'https://x.com/*'] }, tabs => {
          tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
          });
        });
      } catch {}
    };
    
    relayWs.onclose = () => {
      chrome.action.setBadgeText({ text: 'OFF' });
      chrome.action.setBadgeBackgroundColor({ color: '#ff1744' });
      setTimeout(connectRelay, 5000);
    };
    
    relayWs.onerror = () => {
      relayWs.close();
    };
  } catch (e) {
    setTimeout(connectRelay, 5000);
  }
}

// ── Handle messages from content script ────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (relayWs && relayWs.readyState === WebSocket.OPEN) {
    relayWs.send(JSON.stringify({ ...msg, from: sender.tab?.id }));
    sendResponse({ success: true });
  } else {
    sendResponse({ success: false, error: 'Not connected to relay' });
  }
  return true; // async response
});

// ── Init ─────────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeText({ text: 'WAIT' });
  chrome.action.setBadgeBackgroundColor({ color: '#ff9800' });
  connectRelay();
});

// Keep alive ping (MV3 workaround — helps keep SW alive briefly)
chrome.alarms.create('ping', { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener(() => {
  // Just a wake-up ping to prevent immediate termination
  if (relayWs?.readyState === WebSocket.OPEN) {
    relayWs.send(JSON.stringify({ type: 'ping' }));
  }
});