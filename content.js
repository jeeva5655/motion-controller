// Injected on demand (see background.js ensureContentScript). Guarded so
// re-injection — e.g. as a reconnect retry — never double-registers the
// message listener, which would otherwise fire every key press twice.
if (!window.__motionControllerLoaded) {
  window.__motionControllerLoaded = true;

  const LABELS = { JUMP: 'Jump', DUCK: 'Duck', LEFT: 'Left', RIGHT: 'Right' };
  let flashTimer = null;

  function simulateKey(info) {
    // document + window covers the vast majority of games (they listen for
    // keydown on one or both). Only add the focused element itself when it's
    // something the game deliberately focused (e.g. a canvas) — dispatching
    // there too when nothing special is focused would just double-fire the
    // same event a second time as it bubbles back up to document.
    const active = document.activeElement;
    const targets = [document, window];
    if (active && active !== document.body && active !== document.documentElement) {
      targets.push(active);
    }

    function createEvent(type) {
      const ev = new KeyboardEvent(type, {
        key: info.key,
        code: info.code,
        bubbles: true,
        cancelable: true,
        composed: true,
        location: 0,
      });
      // Chrome leaves keyCode/which at 0 for constructed events; some older
      // or canvas-based games still read those instead of key/code.
      try {
        Object.defineProperty(ev, 'keyCode', { get: () => info.keyCode });
        Object.defineProperty(ev, 'which', { get: () => info.keyCode });
        Object.defineProperty(ev, 'charCode', { get: () => (type === 'keydown' || type === 'keyup' ? 0 : info.keyCode) });
      } catch { /* ignore */ }
      return ev;
    }

    // Dispatch keydown
    targets.forEach((t) => t.dispatchEvent(createEvent('keydown')));

    // Hold down for 60ms to span across game requestAnimationFrame ticks
    setTimeout(() => {
      targets.forEach((t) => t.dispatchEvent(createEvent('keyup')));
    }, 60);
  }

  function ensureHud() {
    let root = document.getElementById('mc-hud-root');
    if (root) return root;
    root = document.createElement('div');
    root.id = 'mc-hud-root';
    root.style.cssText =
      'position:fixed !important; top:16px !important; right:16px !important; z-index:2147483647 !important;' +
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif !important; font-size:13px !important;' +
      'background:rgba(17,19,23,0.88) !important; color:#EAF7DA !important; border-radius:12px !important;' +
      'padding:9px 14px !important; line-height:1.4 !important; box-shadow:0 6px 20px rgba(0,0,0,.35) !important;' +
      'border:1px solid rgba(166,255,63,.35) !important; min-width:118px !important; pointer-events:none !important;';
    root.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;">' +
      '<span id="mc-hud-dot" style="width:9px;height:9px;border-radius:50%;background:#A6FF3F;display:inline-block;flex:none;"></span>' +
      '<strong id="mc-hud-action" style="letter-spacing:.01em;">Ready</strong>' +
      '<span id="mc-hud-close" style="margin-left:auto;cursor:pointer;pointer-events:auto;opacity:.55;padding:0 2px;">\u00d7</span>' +
      '</div>' +
      '<div id="mc-hud-cal" style="opacity:.7;margin-top:2px;">0.0 kcal</div>';
    document.documentElement.appendChild(root);
    root.querySelector('#mc-hud-close').addEventListener('click', () => { root.style.display = 'none'; });
    return root;
  }

  function updateHud(action, calories) {
    const root = ensureHud();
    if (root.style.display === 'none') return;
    const label = root.querySelector('#mc-hud-action');
    const dot = root.querySelector('#mc-hud-dot');
    const cal = root.querySelector('#mc-hud-cal');
    label.textContent = LABELS[action] || 'Standing';
    cal.textContent = (calories ?? 0).toFixed(1) + ' kcal';
    dot.style.background = '#FFB020';
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      dot.style.background = '#A6FF3F';
      label.textContent = 'Standing';
    }, 400);
  }

  ensureHud();

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'dispatch-key') {
      simulateKey(msg.info);
      updateHud(msg.action, msg.calories);
    } else if (msg.type === 'hud-only') {
      updateHud(msg.action, msg.calories);
    }
  });
}
