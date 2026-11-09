import { FilesetResolver, PoseLandmarker } from './libs/mediapipe/vision_bundle.mjs';

// Filter out harmless internal C++/Wasm status logs from MediaPipe so Chrome
// doesn't flag them under chrome://extensions Errors.
const origWarn = console.warn;
const origError = console.error;
const MP_LOG_FILTERS = [
  'gl_context.cc',
  'OpenGL error checking is disabled',
  'Graph successfully started running',
  'Created TensorFlow Lite',
  'landmark_projection_calculator',
  'feedback_manager'
];

function isHarmlessMediaPipeLog(args) {
  const msg = args.map((a) => String(a)).join(' ');
  return MP_LOG_FILTERS.some((pattern) => msg.includes(pattern));
}

console.warn = (...args) => {
  if (!isHarmlessMediaPipeLog(args)) origWarn.apply(console, args);
};

console.error = (...args) => {
  if (!isHarmlessMediaPipeLog(args)) origError.apply(console, args);
};

const video = document.getElementById('cam');
const canvas = document.getElementById('frame');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

let detector = null;
let stream = null;
let loopHandle = null;
let running = false;
let lastVideoTime = -1;

let thresholds = { jump: 0.04, duck: 0.06, left: 0.06, right: 0.06, cooldownMs: 250, calibrationFrames: 20 };

let isCalibrated = false;
let baselineY = 0, baselineX = 0, calibFrameCount = 0;
let currentYState = 'CENTER', currentXState = 'CENTER';
const lastActionTime = { JUMP: 0, DUCK: 0, LEFT: 0, RIGHT: 0 };

function resetCalibration() {
  isCalibrated = false;
  baselineY = 0;
  baselineX = 0;
  calibFrameCount = 0;
  currentYState = 'CENTER';
  currentXState = 'CENTER';
}

function send(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

async function initDetector() {
  if (detector) return detector;
  const vision = await FilesetResolver.forVisionTasks(chrome.runtime.getURL('libs/mediapipe/wasm'));
  const modelAssetPath = chrome.runtime.getURL('libs/mediapipe/pose_landmarker_lite.task');
  try {
    detector = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numPoses: 1,
    });
  } catch {
    detector = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath, delegate: 'CPU' },
      runningMode: 'VIDEO',
      numPoses: 1,
    });
  }
  return detector;
}

async function startCamera() {
  if (!stream) {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 }, audio: false });
    video.srcObject = stream;
    await video.play();
  }
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
    video.srcObject = null;
  }
}

function tick() {
  if (!running) return;

  if (video.readyState < 2) {
    loopHandle = setTimeout(tick, 33);
    return;
  }

  let now = Math.round(performance.now());
  if (now <= lastVideoTime) {
    now = lastVideoTime + 1;
  }
  lastVideoTime = now;

  ctx.save();
  ctx.scale(-1, 1);
  ctx.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
  ctx.restore();

  try {
    const result = detector.detectForVideo(canvas, now);
    const landmarks = result.landmarks && result.landmarks[0];

    if (!landmarks) {
      send({ type: 'status', personDetected: false });
    } else {
      const nose = landmarks[0];
      const ls = landmarks[11], rs = landmarks[12];
      const shoulderMidX = (ls.x + rs.x) / 2;
      const shoulderMidY = (ls.y + rs.y) / 2;

      if (!isCalibrated) {
        baselineY += nose.y;
        baselineX += shoulderMidX;
        calibFrameCount += 1;
        send({
          type: 'status',
          personDetected: true,
          calibrating: true,
          progress: calibFrameCount / thresholds.calibrationFrames,
        });
        if (calibFrameCount >= thresholds.calibrationFrames) {
          baselineY /= thresholds.calibrationFrames;
          baselineX /= thresholds.calibrationFrames;
          isCalibrated = true;
          send({ type: 'status', personDetected: true, calibrating: false, justCalibrated: true });
        }
      } else {
        const dy = nose.y - baselineY;
        const dx = shoulderMidX - baselineX;

        if (dy < -thresholds.jump && currentYState !== 'JUMP') {
          if (now - lastActionTime.JUMP > thresholds.cooldownMs) {
            currentYState = 'JUMP';
            lastActionTime.JUMP = now;
            send({ type: 'action', action: 'JUMP' });
          }
        } else if (dy > thresholds.duck && currentYState !== 'DUCK') {
          if (now - lastActionTime.DUCK > thresholds.cooldownMs) {
            currentYState = 'DUCK';
            lastActionTime.DUCK = now;
            send({ type: 'action', action: 'DUCK' });
          }
        } else if (dy >= -thresholds.jump && dy <= thresholds.duck) {
          currentYState = 'CENTER';
        }

        if (dx < -thresholds.left && currentXState !== 'LEFT') {
          if (now - lastActionTime.LEFT > thresholds.cooldownMs) {
            currentXState = 'LEFT';
            lastActionTime.LEFT = now;
            send({ type: 'action', action: 'LEFT' });
          }
        } else if (dx > thresholds.right && currentXState !== 'RIGHT') {
          if (now - lastActionTime.RIGHT > thresholds.cooldownMs) {
            currentXState = 'RIGHT';
            lastActionTime.RIGHT = now;
            send({ type: 'action', action: 'RIGHT' });
          }
        } else if (dx >= -thresholds.left && dx <= thresholds.right) {
          currentXState = 'CENTER';
        }

        send({
          type: 'landmarks',
          nose: { x: nose.x, y: nose.y },
          shoulderMid: { x: shoulderMidX, y: shoulderMidY },
          baseline: { x: baselineX, y: baselineY },
          yState: currentYState,
          xState: currentXState,
          calibrated: true,
        });
      }
    }
  } catch (err) {
    running = false;
    stopCamera();
    send({ type: 'engine-error', message: err.message });
    return;
  }

  if (running) {
    loopHandle = setTimeout(tick, 33);
  }
}

async function start(newThresholds) {
  if (newThresholds) thresholds = newThresholds;
  resetCalibration();
  try {
    await initDetector();
    await startCamera();
  } catch (e) {
    send({ type: 'engine-error', message: e.message });
    return;
  }
  running = true;
  lastVideoTime = -1;
  tick();
}

function stop() {
  running = false;
  if (loopHandle) {
    clearTimeout(loopHandle);
    loopHandle = null;
  }
  stopCamera();
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'ping-offscreen':
      sendResponse({ ready: true });
      break;
    case 'start':
      start(msg.thresholds);
      break;
    case 'stop':
      stop();
      break;
    case 'recalibrate':
      resetCalibration();
      break;
    case 'thresholds-changed':
      thresholds = msg.thresholds;
      break;
  }
});

// Announce presence
send({ type: 'offscreen-ready' });
