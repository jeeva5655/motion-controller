# Motion Game Controller (Chrome extension)

Play browser games with your body — jump, duck and lean in front of your
webcam, and it sends the matching key presses to whatever game tab you point
it at. This is the Chrome-extension version of your `main.py` body
controller: same pose model, same calibration logic, generalized to work on
*any* browser game instead of one hard-coded key set.

## Quick start (works today, before you publish anywhere)

1. **Get the web runtime files** — one-time, needs internet:
   ```
   cd motion-controller
   python download_web_libs.py
   ```
   This pulls the MediaPipe Wasm/JS runtime into `libs/mediapipe/`. Your
   pose model (`pose_landmarker_lite.task`) is already sitting there — it's
   the exact file your Python script downloaded, reused as-is.
2. Open `chrome://extensions`, turn on **Developer mode** (top right).
3. Click **Load unpacked**, select the `motion-controller` folder.
4. Pin the extension (puzzle-piece icon in the toolbar → pin).
5. Open your game in a tab (e.g. a Subway Surfers web version), click that
   tab so it's focused, then **click the extension icon**. A small control
   window opens and is now targeting that tab.
6. Pick the matching **game profile** (Arrow keys / Chrome Dino / WASD /
   Custom), hit **Start**, allow camera access when Chrome asks, and stand
   still for the calibration countdown.
7. Play. A small heads-up badge stays pinned to the top-right of the game
   page itself, so you get feedback even with the control window closed.

To control a *different* tab later, click that tab to focus it, then click
the toolbar icon again — it retargets to whatever tab is active.

## How it works

- `offscreen.html`/`offscreen.js` — an invisible page (Chrome's
  `chrome.offscreen` API) that owns the webcam and runs MediaPipe
  PoseLandmarker on every frame. Same math as `main.py`: it averages 20
  frames to set a baseline nose/shoulder position, then watches how far you
  move from it, with the same cooldown so one movement doesn't fire twice.
- `panel.html`/`panel.js` — the visible control window: a live skeleton/
  telemetry view instead of a mirrored camera feed (simpler, and avoids
  piping video between extension contexts), calibration, game profile,
  and sensitivity sliders.
- `background.js` — the service worker. Tracks which tab you're
  controlling, turns detected actions into key presses, and opens the
  offscreen document and control window.
- `content.js` — injected into your game tab only. Simulates the key
  presses there, and draws the small on-page status badge.

## Which games this actually works with — please read this part

A Chrome extension can only affect **web pages open in a Chrome tab**. If
the "Subway Surfers" your Python script was controlling was the native
mobile app, an emulator window, or a desktop build, this extension
categorically can't reach it — that's outside any browser extension's
reach. It works with browser-based endless-runner games (Subway Surfers /
Temple Run web ports, Chrome's own Dino game, and similar sites).

Within the browser, there's one more wrinkle. Key presses simulated by a
script are flagged by Chrome as "not from a real keyboard"
(`event.isTrusted = false`). Most simple HTML5/JS games don't check for
that and respond completely normally. Some games — often ones built with
Unity/WebGL, or anything with anti-bot logic — specifically ignore
untrusted key events. That's what **Advanced compatibility mode** (a
toggle in the panel) is for: it routes key presses through Chrome's
debugger protocol instead, which behaves like a real key press to almost
any game. The trade-off is a permanent yellow **"[extension] started
debugging this browser"** banner on the tab while it's on — Chrome shows
this for any extension using that API, and it can't be hidden. Leave it
off unless a game doesn't respond to the normal mode.

## Publishing it

I can't publish this to the Chrome Web Store for you from here — that
needs your own Google account, a one-time $5 developer registration, and
Google's identity/review process, all outside what I can do in this chat.
What's ready now:

- The extension already follows the Manifest V3 rule that all code must
  ship inside the package — that's exactly what `download_web_libs.py`
  is for, so there's no "loads code from a CDN" rejection waiting for you.
- Permissions are kept minimal on purpose: `activeTab` + `scripting`
  (only touches a tab when you click the icon on it — no blanket access to
  "all websites"), `offscreen`, and `storage`. `debugger` is requested only
  if/when someone turns on Advanced mode, not on install.

When you're ready to submit:
1. Zip the folder's *contents* (not the folder itself) into one `.zip`.
2. Create a one-time Chrome Web Store developer account (developer.chrome.com/webstore, $5 fee).
3. Upload the zip, add a listing description, icon/screenshots, and a short
   privacy note covering camera use (processing is 100% on-device — see
   below) and why the extension can act on the active tab.
4. Submit for review. Typical turnaround is hours to a few days.

## Known limitations

- **No native "always on top."** Chrome extensions can't pin a window above
  others the way `cv2`'s topmost flag did. The in-page badge (`content.js`)
  is the workaround — it's part of the game page itself, so it's always
  visible over the game regardless of window layering.
- **Service worker resets.** Chrome can put the background service worker
  to sleep after ~30s idle; it wakes up on the next click/message, but the
  calorie counter and target tab can reset if you leave it stopped and idle
  for a long stretch. Settings (profile, keys, sensitivity) are saved to
  `chrome.storage` and always survive this.
- Only one tab is controlled at a time, by design (re-target by clicking
  the icon on a different tab).

## Privacy

All pose detection runs on-device, in your browser — video frames never
leave your computer, and the extension makes no network requests at
runtime (only `download_web_libs.py`, which you run once yourself, touches
the network).

## File map

| File | Role |
|---|---|
| `manifest.json` | Extension config and permissions |
| `common.js` | Shared key table + game profiles |
| `background.js` | Service worker: targeting, key dispatch, lifecycle |
| `offscreen.html` / `offscreen.js` | Camera + pose detection (invisible) |
| `panel.html` / `panel.css` / `panel.js` | Control window UI |
| `content.js` | Injected into the game tab: key simulation + on-page badge |
| `libs/mediapipe/` | Pose model + web runtime (filled in by the setup script) |
| `download_web_libs.py` | One-time setup script for the web runtime |
