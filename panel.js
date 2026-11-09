const stage = document.getElementById('stage');
const sctx = stage.getContext('2d');
const stageEmpty = document.getElementById('stageEmpty');
const statusPill = document.getElementById('statusPill');
const targetName = document.getElementById('targetName');
const warningBox = document.getElementById('warningBox');
const actionDot = document.getElementById('actionDot');
const actionLabel = document.getElementById('actionLabel');
const telemetry = document.getElementById('telemetry');
const calorieValue = document.getElementById('calorieValue');
const timeValue = document.getElementById('timeValue');
const startStopBtn = document.getElementById('startStopBtn');
const recalBtn = document.getElementById('recalBtn');
const profileSelect = document.getElementById('profileSelect');
const customKeysBox = document.getElementById('customKeys');
const advToggle = document.getElementById('advToggle');
const jumpSlider = document.getElementById('jumpSlider');
const duckSlider = document.getElementById('duckSlider');
const leanSlider = document.getElementById('leanSlider');
const jumpVal = document.getElementById('jumpVal');
const duckVal = document.getElementById('duckVal');
const leanVal = document.getElementById('leanVal');

let settings = { ...DEFAULT_SETTINGS };
let running = false;
let calories = 0;
let sessionStart = null;
let lastLandmarks = null;
let everStarted = false;

const LABELS = { JUMP: 'Jump!', DUCK: 'Duck!', LEFT: 'Left', RIGHT: 'Right', CENTER: 'Standing' };

// ------------------------------------------------------------- populate UI
for (const [id, profile] of Object.entries(GAME_PROFILES)) {
  const opt = document.createElement('option');
  opt.value = id; opt.textContent = profile.label;
  profileSelect.appendChild(opt);
}
document.querySelectorAll('#customKeys select').forEach((sel) => {
  for (const keyId of Object.keys(KEY_TABLE)) {
    const opt = document.createElement('option');
    opt.value = keyId; opt.textContent = keyId.replace(/^Key/, '').replace(/^Arrow/, '');
    sel.appendChild(opt);
  }
});

function applySettingsToUI() {
  profileSelect.value = settings.profile;
  customKeysBox.hidden = settings.profile !== 'custom';
  document.querySelectorAll('#customKeys select').forEach((sel) => {
    sel.value = settings.customKeys[sel.dataset.action];
  });
  jumpSlider.value = settings.thresholds.jump;
  duckSlider.value = settings.thresholds.duck;
  leanSlider.value = settings.thresholds.left;
  jumpVal.textContent = settings.thresholds.jump.toFixed(3);
  duckVal.textContent = settings.thresholds.duck.toFixed(3);
  leanVal.textContent = settings.thresholds.left.toFixed(3);
  advToggle.checked = settings.advancedMode;
}

function pushSettings(patch) {
  settings = { ...settings, ...patch };
  applySettingsToUI();
  chrome.runtime.sendMessage({ type: 'update-settings', settings });
}

// ---------------------------------------------------------------- wiring
profileSelect.addEventListener('change', () => pushSettings({ profile: profileSelect.value }));

document.querySelectorAll('#customKeys select').forEach((sel) => {
  sel.addEventListener('change', () => {
    const customKeys = { ...settings.customKeys, [sel.dataset.action]: sel.value };
    pushSettings({ customKeys });
  });
});

function sliderPatch() {
  return {
    thresholds: {
      ...settings.thresholds,
      jump: parseFloat(jumpSlider.value),
      duck: parseFloat(duckSlider.value),
      left: parseFloat(leanSlider.value),
      right: parseFloat(leanSlider.value),
    },
  };
}
[jumpSlider, duckSlider, leanSlider].forEach((s) =>
  s.addEventListener('input', () => pushSettings(sliderPatch()))
);

advToggle.addEventListener('change', () => {
  pushSettings({ advancedMode: advToggle.checked });
});

startStopBtn.addEventListener('click', async () => {
  if (running) {
    chrome.runtime.sendMessage({ type: 'stop' }, () => setRunningUI(false));
    return;
  }
  everStarted = true;
  stageEmpty.hidden = true;
  calories = 0;
  calorieValue.textContent = '0.0';
  // The camera permission prompt can only be shown from a normal, visible
  // extension page like this one — the hidden offscreen document that does
  // the actual detection is not allowed to trigger it. Requesting it here
  // first means offscreen's own getUserMedia call reuses the same grant
  // (extension pages share one origin) instead of failing silently.
  try {
    const warm = await navigator.mediaDevices.getUserMedia({ video: true });
    warm.getTracks().forEach((t) => t.stop());
  } catch (e) {
    showWarning('Camera permission is needed to use Motion Game Controller: ' + e.message);
    return;
  }
  chrome.runtime.sendMessage({ type: 'start' }, () => {
    sessionStart = Date.now();
    setRunningUI(true);
  });
});
recalBtn.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'recalibrate' }));

// ----------------------------------------------------------------- render
function setRunningUI(isRunning) {
  running = isRunning;
  startStopBtn.textContent = running ? 'Stop' : 'Start';
  startStopBtn.classList.toggle('stop', running);
  recalBtn.hidden = !running;
  statusPill.textContent = running ? 'Live' : 'Idle';
  statusPill.className = 'pill' + (running ? ' live' : '');
}

function showWarning(text, tone) {
  warningBox.textContent = text;
  warningBox.className = 'warning' + (tone === 'info' ? ' info' : '');
  warningBox.hidden = false;
  clearTimeout(showWarning._t);
  showWarning._t = setTimeout(() => { warningBox.hidden = true; }, tone === 'info' ? 3000 : 6000);
}

function drawStage(msg) {
  const W = stage.width, H = stage.height;
  sctx.clearRect(0, 0, W, H);

  if (msg.personDetected === false) {
    sctx.fillStyle = '#9aa1ac';
    sctx.font = '12px -apple-system, sans-serif';
    sctx.textAlign = 'center';
    sctx.fillText('No person detected — step into view', W / 2, H / 2);
    return;
  }

  if (msg.calibrating) {
    sctx.strokeStyle = '#2e333c';
    sctx.lineWidth = 6;
    sctx.beginPath(); sctx.arc(W / 2, H / 2, 28, 0, Math.PI * 2); sctx.stroke();
    sctx.strokeStyle = '#a6ff3f';
    sctx.beginPath();
    sctx.arc(W / 2, H / 2, 28, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (msg.progress || 0));
    sctx.stroke();
    sctx.fillStyle = '#e7e9ed';
    sctx.font = '12px -apple-system, sans-serif';
    sctx.textAlign = 'center';
    sctx.fillText('Calibrating — hold still', W / 2, H / 2 + 46);
    return;
  }

  if (!msg.calibrated) return;
  lastLandmarks = msg;

  const t = settings.thresholds;
  const jumpY = (msg.baseline.y - t.jump) * H;
  const duckY = (msg.baseline.y + t.duck) * H;
  const leftX = (msg.baseline.x - t.left) * W;
  const rightX = (msg.baseline.x + t.right) * W;

  sctx.setLineDash([4, 4]);
  sctx.strokeStyle = 'rgba(255,176,32,0.55)';
  sctx.lineWidth = 1;
  [jumpY, duckY].forEach((y) => { sctx.beginPath(); sctx.moveTo(0, y); sctx.lineTo(W, y); sctx.stroke(); });
  sctx.strokeStyle = 'rgba(166,255,63,0.4)';
  [leftX, rightX].forEach((x) => { sctx.beginPath(); sctx.moveTo(x, 0); sctx.lineTo(x, H); sctx.stroke(); });
  sctx.setLineDash([]);

  const active = msg.yState !== 'CENTER' || msg.xState !== 'CENTER';
  const color = active ? '#ffb020' : '#a6ff3f';

  const sx = msg.shoulderMid.x * W, sy = msg.shoulderMid.y * H;
  sctx.strokeStyle = color; sctx.lineWidth = 3;
  sctx.beginPath(); sctx.moveTo(sx - 22, sy); sctx.lineTo(sx + 22, sy); sctx.stroke();

  const nx = msg.nose.x * W, ny = msg.nose.y * H;
  sctx.fillStyle = color;
  sctx.beginPath(); sctx.arc(nx, ny, 7, 0, Math.PI * 2); sctx.fill();

  telemetry.textContent =
    'dx ' + (msg.shoulderMid.x - msg.baseline.x).toFixed(3) + '   dy ' + (msg.nose.y - msg.baseline.y).toFixed(3);
}

function flashAction(action) {
  actionLabel.textContent = LABELS[action] || 'Standing';
  actionDot.classList.toggle('hot', action !== 'CENTER');
  clearTimeout(flashAction._t);
  flashAction._t = setTimeout(() => {
    actionLabel.textContent = 'Standing';
    actionDot.classList.remove('hot');
  }, 400);
}

setInterval(() => {
  if (!running || !sessionStart) return;
  const s = Math.floor((Date.now() - sessionStart) / 1000);
  timeValue.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}, 500);

// -------------------------------------------------------------- messages
chrome.runtime.onMessage.addListener((msg) => {
  switch (msg.type) {
    case 'landmarks':
      drawStage(msg);
      break;
    case 'status':
      drawStage(msg);
      if (msg.justCalibrated) showWarning("Calibrated! That's your center position.", 'info');
      break;
    case 'action':
      if (msg.action !== 'CENTER') { calories += 0.5; calorieValue.textContent = calories.toFixed(1); }
      flashAction(msg.action);
      break;
    case 'engine-error':
      showWarning('Camera/model error: ' + msg.message);
      setRunningUI(false);
      break;
    case 'warning':
      showWarning(msg.text);
      break;
    case 'target-changed':
      targetName.textContent = msg.target ? msg.target.title : 'No tab selected';
      break;
    case 'settings':
      settings = msg.settings;
      applySettingsToUI();
      break;
  }
});

// ------------------------------------------------------------------ init
chrome.runtime.sendMessage({ type: 'panel-ready' }, (res) => {
  if (!res) return;
  settings = { ...DEFAULT_SETTINGS, ...res.settings };
  applySettingsToUI();
  targetName.textContent = res.target ? res.target.title : 'No tab selected';
  calories = res.calories || 0;
  calorieValue.textContent = calories.toFixed(1);
  sessionStart = res.sessionStart;
  setRunningUI(res.running);
  if (res.running) { stageEmpty.hidden = true; everStarted = true; }
});
