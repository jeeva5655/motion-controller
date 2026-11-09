"""
Run this once, on a machine with internet access, before loading the
extension in Chrome. It downloads the MediaPipe "tasks-vision" web runtime
(the JS/Wasm files Chrome Web Store policy requires every extension to bundle
locally rather than fetch from a CDN at runtime — see README.md) into
libs/mediapipe/.

The pose model itself (pose_landmarker_lite.task) is already included next
to this script — it's the same file your Python version downloaded, reused
as-is, so nothing needs to be fetched for that part.
"""

import os
import urllib.request
import urllib.error

VERSION = "0.10.14"  # known-good; edit if you want a newer release
BASE = f"https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@{VERSION}"
LATEST_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision"

OUT_DIR = os.path.join("libs", "mediapipe")
WASM_DIR = os.path.join(OUT_DIR, "wasm")

FILES = [
    ("vision_bundle.mjs", OUT_DIR),
    ("wasm/vision_wasm_internal.js", WASM_DIR),
    ("wasm/vision_wasm_internal.wasm", WASM_DIR),
    ("wasm/vision_wasm_nosimd_internal.js", WASM_DIR),
    ("wasm/vision_wasm_nosimd_internal.wasm", WASM_DIR),
]


def fetch(url, dest):
    print(f"  {url}")
    urllib.request.urlretrieve(url, dest)


def main():
    os.makedirs(WASM_DIR, exist_ok=True)
    for rel_path, out_dir in FILES:
        filename = os.path.basename(rel_path)
        dest = os.path.join(out_dir, filename)
        if os.path.exists(dest):
            print(f"Already have {dest}")
            continue
        print(f"Downloading {filename}...")
        try:
            fetch(f"{BASE}/{rel_path}", dest)
        except urllib.error.HTTPError:
            print(f"  pinned version {VERSION} missing that file, trying @latest...")
            fetch(f"{LATEST_BASE}/{rel_path}", dest)
    print("\nDone. libs/mediapipe/ now has everything the extension needs.")
    print("Load the extension folder in chrome://extensions (Developer mode > Load unpacked).")


if __name__ == "__main__":
    main()
