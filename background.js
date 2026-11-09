importScripts('common.js');

// ---- State -----------------------------------------------------------
// Note: MV3 service workers are killed after ~30s idle and respawn on the
// next event, which resets module-level variables. In practice the engine
// keeps this worker alive with a steady stream of messages while it's
// running, so this only bites if the panel sits open, stopped, untouched
// for a while — see README "Known limitations".
let settings = { ...DEFAULT_SETTINGS };
let running = false;
let targetTab = null;      // { id, title }
let panelWindowId = null;
let debuggerTabId = null;  // tab currently attached via chrome.debugger, if any
let calories = 0;
let sessionStart = null;
let offscreenReady = false;

const settingsReady = new Promise((resolve) => {
  chrome.storage.local.get('settings', (res) => {
    if (res.settings) settings = { ...DEFAULT_SETTINGS, ...res.settings };
    resolve();
  });
});

function saveSettings() {
  chrome.storage.local.set({ settings });
}

// ---------------------------------------------------------------- offscreen
async function ensureOffscreenDocument() {
  if (chrome.offscreen.hasDocument) {
    const has = await chrome.offscreen.hasDocument();
    if (has && offscreenReady) return;
  }
  try {
    offscreenReady = false;
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Reads the webcam and runs on-device pose detection to drive key presses.',
    });
    // Wait briefly for offscreen script initialization
    for (let i = 0; i < 20; i++) {
      if (offscreenReady) break;
      try {
        const resp = await chrome.runtime.sendMessage({ type: 'ping-offscreen' });
        if (resp && resp.ready) {
          offscreenReady = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
  } catch (e) {
    if (!/single offscreen/i.test(e.message || '')) throw e;
  }
}

// ------------------------------------------------------------- content inj.
async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
  } catch (e) {
    throw e;
  }
}

// ------------------------------------------------------------------ panel
async function openOrFocusPanel() {
  if (panelWindowId != null) {
    try {
      await chrome.windows.update(panelWindowId, { focused: true });
      return;
    } catch {
      panelWindowId = null; // window was already closed
    }
  }
  const win = await chrome.windows.create({
    url: chrome.runtime.getURL('panel.html'),
    type: 'popup',
    width: 372,
    height: 660,
    left: 40,
    top: 40,
  });
  panelWindowId = win.id;
}

chrome.windows.onRemoved.addListener((id) => {
  if (id === panelWindowId) panelWindowId = null;
});

function tellPanel(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

// --------------------------------------------------------------- targeting
chrome.action.onClicked.addListener(async (tab) => {
  await settingsReady;
  if (!tab.id || !tab.url || /^(chrome|edge|about|chrome-extension):/i.test(tab.url)) {
    await openOrFocusPanel();
    tellPanel({ type: 'warning', text: "Can't control this tab. Open your game, click on it to focus it, then click the toolbar icon again." });
    return;
  }
  targetTab = { id: tab.id, title: tab.title || tab.url };
  try {
    await ensureContentScript(tab.id);
  } catch (e) {
    tellPanel({ type: 'warning', text: "Couldn't attach to that tab: " + e.message });
  }
  await openOrFocusPanel();
  tellPanel({ type: 'target-changed', target: targetTab });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (targetTab && targetTab.id === tabId) {
    targetTab = null;
    tellPanel({ type: 'target-changed', target: null });
    tellPanel({ type: 'warning', text: 'Target tab was closed.' });
  }
});

// ------------------------------------------------------------- key dispatch
async function dispatchAction(action) {
  if (action === 'CENTER' || !targetTab) return;
  const keys = resolveKeysForProfile(settings);
  const keyId = keys[action];
  if (!keyId) return; // this profile has no key bound to this action
  const info = KEY_TABLE[keyId];
  if (!info) return;

  calories += 0.5;

  if (settings.advancedMode) {
    await debuggerPress(targetTab.id, info);
    chrome.tabs.sendMessage(targetTab.id, { type: 'hud-only', action, calories }).catch(() => {});
  } else {
    await sendKeyToContentScript(targetTab.id, info, action);
  }
}

async function sendKeyToContentScript(tabId, info, action) {
  const payload = { type: 'dispatch-key', info, action, calories };
  try {
    await chrome.tabs.sendMessage(tabId, payload);
  } catch {
    try {
      await ensureContentScript(tabId);
      await chrome.tabs.sendMessage(tabId, payload);
    } catch (e) {
      tellPanel({ type: 'warning', text: 'Lost connection to the game tab: ' + e.message });
    }
  }
}

async function debuggerPress(tabId, info) {
  try {
    if (debuggerTabId !== tabId) {
      if (debuggerTabId != null) await safeDetach(debuggerTabId);
      await chrome.debugger.attach({ tabId }, '1.3');
      debuggerTabId = tabId;
    }
    const base = { windowsVirtualKeyCode: info.keyCode, nativeVirtualKeyCode: info.keyCode, code: info.code, key: info.key };
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  } catch (e) {
    settings.advancedMode = false;
    saveSettings();
    tellPanel({ type: 'settings', settings });
    tellPanel({ type: 'warning', text: 'Advanced mode error (' + e.message + ') — turned it off.' });
  }
}

async function safeDetach(tabId) {
  try {
    if (chrome.debugger && chrome.debugger.detach) {
      await chrome.debugger.detach({ tabId });
    }
  } catch {}
  if (debuggerTabId === tabId) debuggerTabId = null;
}

if (chrome.debugger && chrome.debugger.onDetach) {
  chrome.debugger.onDetach.addListener((source) => {
    if (source.tabId === debuggerTabId) {
      debuggerTabId = null;
      settings.advancedMode = false;
      saveSettings();
      tellPanel({ type: 'settings', settings });
      tellPanel({ type: 'warning', text: 'Advanced mode turned off (debugger banner was dismissed).' });
    }
  });
}

// ------------------------------------------------------------------ engine
async function startEngine() {
  await ensureOffscreenDocument();
  running = true;
  calories = 0;
  sessionStart = Date.now();
  tellOffscreen({ type: 'start', thresholds: settings.thresholds });
}

function stopEngine() {
  running = false;
  tellOffscreen({ type: 'stop' });
  if (debuggerTabId != null) safeDetach(debuggerTabId);
}

// chrome.runtime.sendMessage is a broadcast; this name just documents intent
// (message is aimed at the offscreen document specifically).
function tellOffscreen(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

// -------------------------------------------------------------- messaging
// Offscreen and the panel both talk over the same extension-wide
// chrome.runtime bus. The panel also listens to offscreen's broadcasts
// ('landmarks' / 'status' / 'action' / 'engine-error') directly for live
// display — this listener only needs to handle what background itself must
// act on: performing the actual key press, and panel commands.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'offscreen-ready':
      offscreenReady = true;
      return;
    case 'action':
      dispatchAction(msg.action);
      return;
    case 'panel-ready':
      (async () => {
        await settingsReady;
        sendResponse({ settings, running, target: targetTab, calories, sessionStart });
      })();
      return true;
    case 'start':
      startEngine().then(() => sendResponse({ ok: true }));
      return true;
    case 'stop':
      stopEngine();
      sendResponse({ ok: true });
      return true;
    case 'recalibrate':
      tellOffscreen({ type: 'recalibrate' });
      return;
    case 'update-settings':
      settings = { ...settings, ...msg.settings };
      saveSettings();
      tellOffscreen({ type: 'thresholds-changed', thresholds: settings.thresholds });
      return;
  }
});
