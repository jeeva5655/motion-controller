// Shared across background.js, content.js and panel.js (classic script — attaches
// to globalThis so it works the same in a service worker, a page and an injected
// content script, without needing a module loader in every context).

// Canonical key definitions. `code` is the KeyboardEvent.code value and doubles
// as the id we store in game profiles. `keyCode`/`which` are the legacy numeric
// values some older or canvas-based games still read instead of `.key`/`.code`.
const KEY_TABLE = {
  ArrowUp:    { key: 'ArrowUp',    code: 'ArrowUp',    keyCode: 38 },
  ArrowDown:  { key: 'ArrowDown',  code: 'ArrowDown',  keyCode: 40 },
  ArrowLeft:  { key: 'ArrowLeft',  code: 'ArrowLeft',  keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  Space:      { key: ' ',         code: 'Space',       keyCode: 32 },
  KeyW:       { key: 'w',         code: 'KeyW',        keyCode: 87 },
  KeyA:       { key: 'a',         code: 'KeyA',        keyCode: 65 },
  KeyS:       { key: 's',         code: 'KeyS',        keyCode: 83 },
  KeyD:       { key: 'd',         code: 'KeyD',        keyCode: 68 },
};

// Each profile maps the four logical actions this app detects to a key id
// above (or null, if the game has no control for that action). "custom" is
// filled in from chrome.storage by the caller.
const GAME_PROFILES = {
  arrows: {
    label: 'Arrow keys (Subway Surfers, Temple Run, most runners)',
    keys: { JUMP: 'ArrowUp', DUCK: 'ArrowDown', LEFT: 'ArrowLeft', RIGHT: 'ArrowRight' },
  },
  dino: {
    label: 'Chrome Dino (Space to jump)',
    keys: { JUMP: 'Space', DUCK: 'ArrowDown', LEFT: null, RIGHT: null },
  },
  wasd: {
    label: 'WASD',
    keys: { JUMP: 'KeyW', DUCK: 'KeyS', LEFT: 'KeyA', RIGHT: 'KeyD' },
  },
  custom: {
    label: 'Custom…',
    keys: { JUMP: 'ArrowUp', DUCK: 'ArrowDown', LEFT: 'ArrowLeft', RIGHT: 'ArrowRight' },
  },
};

const DEFAULT_THRESHOLDS = {
  jump: 0.04,
  duck: 0.06,
  left: 0.06,
  right: 0.06,
  cooldownMs: 250,
  calibrationFrames: 20,
};

const DEFAULT_SETTINGS = {
  profile: 'arrows',
  customKeys: { JUMP: 'ArrowUp', DUCK: 'ArrowDown', LEFT: 'ArrowLeft', RIGHT: 'ArrowRight' },
  thresholds: DEFAULT_THRESHOLDS,
  advancedMode: false,
};

function resolveKeysForProfile(settings) {
  const profile = GAME_PROFILES[settings.profile] || GAME_PROFILES.arrows;
  return settings.profile === 'custom' ? settings.customKeys : profile.keys;
}

// Node-less UMD-style export so this same file works when pulled in via
// importScripts() (service worker), a classic <script> tag (panel.html) and
// chrome.scripting.executeScript file injection (content script).
globalThis.KEY_TABLE = KEY_TABLE;
globalThis.GAME_PROFILES = GAME_PROFILES;
globalThis.DEFAULT_THRESHOLDS = DEFAULT_THRESHOLDS;
globalThis.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
globalThis.resolveKeysForProfile = resolveKeysForProfile;
