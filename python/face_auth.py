"""Face enrollment / verification sidecar for DevPanel.

Uses OpenCV's YuNet (detection) + SFace (recognition) models, so no dlib is needed.
Protocol: progress is not streamed; the LAST line of stdout is a JSON result.

  enroll                      -> {"ok": true, "embeddings": [[...128 floats], ...]}
  verify  (embeddings on stdin) -> {"ok": true, "score": 0.61}
  serve                       -> stays alive with the models loaded; one JSON request per stdin line
                                 ({"id": 1, "cmd": "verify", "embeddings": [...], "liveness": true}) and one
                                 {"id": 1, "result": {...}} line per answer. Starting Python, OpenCV and the models is
                                 most of the wait, so the app starts this once and reuses it.

No images are ever written to disk; only embeddings leave this process.
"""
import argparse
import json
import sys
import time
import urllib.request
from pathlib import Path

import cv2
import numpy as np

from liveness import HeadTurnChallenge, yaw_ratio

ZOO = "https://github.com/opencv/opencv_zoo/raw/main/models"
MODELS = {
    "detector": ("face_detection_yunet_2023mar.onnx", f"{ZOO}/face_detection_yunet/face_detection_yunet_2023mar.onnx"),
    "recognizer": ("face_recognition_sface_2021dec.onnx", f"{ZOO}/face_recognition_sface/face_recognition_sface_2021dec.onnx"),
}

DET_WIDTH = 320  # faces are detected on a downscaled copy (several times faster), then mapped back
CAM_WIDTH, CAM_HEIGHT = 640, 480
ENROLL_SAMPLES = 5
ENROLL_TIMEOUT_S = 25
VERIFY_TIMEOUT_S = 10
MIN_DET_SCORE = 0.9
MATCH_THRESHOLD = 0.40  # SFace cosine; OpenCV's recommended default is 0.363
MATCHES_REQUIRED = 3
TURN_TIMEOUT_S = 9
RETURN_TIMEOUT_S = 6


class Done(Exception):
    """Ends one request in serve mode (the one-shot modes print the result and exit instead)."""

    def __init__(self, payload: dict):
        super().__init__("done")
        self.payload = payload


SERVER = False
_cap = None


def finish(payload: dict) -> None:
    if SERVER:
        raise Done(payload)
    print(json.dumps(payload), flush=True)
    sys.exit(0)


def ensure_models(models_dir: Path) -> tuple[str, str]:
    models_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    for filename, url in MODELS.values():
        p = models_dir / filename
        if not p.exists() or p.stat().st_size < 100_000:
            urllib.request.urlretrieve(url, p)
        paths.append(str(p))
    return paths[0], paths[1]


def open_camera() -> cv2.VideoCapture:
    global _cap
    cap = cv2.VideoCapture(0, cv2.CAP_DSHOW if sys.platform == "win32" else 0)
    if not cap.isOpened():
        finish({"ok": False, "error": "No se pudo abrir la cámara"})
    # MJPG at 640x480 opens and streams much faster than the camera's default (often 1080p raw), with a 1-frame buffer
    for prop, value in ((cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG")), (cv2.CAP_PROP_FRAME_WIDTH, CAM_WIDTH),
                        (cv2.CAP_PROP_FRAME_HEIGHT, CAM_HEIGHT), (cv2.CAP_PROP_BUFFERSIZE, 1)):
        cap.set(prop, value)
    _cap = cap
    return cap


def release_camera() -> None:
    global _cap
    if _cap is not None:
        _cap.release()
        _cap = None


def frames(cap: cv2.VideoCapture, timeout_s: float):
    end = time.time() + timeout_s
    while time.time() < end:
        ok, frame = cap.read()
        if ok:
            yield frame


def best_face(detector, frame):
    h, w = frame.shape[:2]
    scale = DET_WIDTH / w if w > DET_WIDTH else 1.0
    small = cv2.resize(frame, (DET_WIDTH, max(1, round(h * scale))), interpolation=cv2.INTER_AREA) if scale < 1.0 else frame
    detector.setInputSize((small.shape[1], small.shape[0]))
    _, faces = detector.detect(small)
    if faces is None:
        return None
    face = max(faces, key=lambda f: f[2] * f[3])  # largest face
    if face[-1] < MIN_DET_SCORE:
        return None
    if scale < 1.0:
        face = face.copy()
        face[:14] /= scale  # box + 5 landmarks back to full-frame pixels (the last value is the score)
    return face


def embed(recognizer, frame, face) -> np.ndarray:
    return recognizer.feature(recognizer.alignCrop(frame, face))


def enroll(detector, recognizer) -> None:
    cap = open_camera()
    samples: list[np.ndarray] = []
    last = 0.0
    for frame in frames(cap, ENROLL_TIMEOUT_S):
        face = best_face(detector, frame)
        # space the samples out so the user has time to shift pose slightly
        if face is not None and time.time() - last > 0.8:
            samples.append(embed(recognizer, frame, face)[0])
            # progress line for UIs; consumers read only the LAST line as the result
            print(json.dumps({"progress": len(samples), "total": ENROLL_SAMPLES}), flush=True)
            last = time.time()
            if len(samples) >= ENROLL_SAMPLES:
                break
    cap.release()
    if len(samples) < ENROLL_SAMPLES:
        finish({"ok": False, "error": "No pude ver tu rostro con claridad. Mejora la luz e intenta de nuevo."})
    finish({"ok": True, "embeddings": [s.tolist() for s in samples]})


def landmarks(face):
    return face[4:14].reshape(5, 2)


def say(**payload) -> None:
    """Progress/prompt line for UIs; consumers treat only the LAST line as the result."""
    print(json.dumps(payload), flush=True)


def verify(detector, recognizer, liveness: bool, embeddings=None) -> None:
    if embeddings is None:
        embeddings = json.loads(sys.stdin.read())
    stored = [np.array(e, dtype=np.float32).reshape(1, -1) for e in embeddings]

    def score_of(frame, face) -> float:
        probe = embed(recognizer, frame, face)
        return float(max(recognizer.match(probe, s, cv2.FaceRecognizerSF_FR_COSINE) for s in stored))

    cap = open_camera()
    best = 0.0

    def consecutive_matches(timeout_s: float, needed: int) -> bool:
        nonlocal best
        run = 0
        for frame in frames(cap, timeout_s):
            face = best_face(detector, frame)
            if face is None:
                continue
            score = score_of(frame, face)
            best = max(best, score)
            run = run + 1 if score >= MATCH_THRESHOLD else 0  # consecutive matches only
            if run >= needed:
                return True
        return False

    if not consecutive_matches(VERIFY_TIMEOUT_S, MATCHES_REQUIRED):
        cap.release()
        finish({"ok": False, "score": best, "error": "No te reconocí. Intenta de nuevo o usa el PIN."})

    if liveness:
        challenge = HeadTurnChallenge()
        say(challenge=challenge.direction)
        announced_back = False
        for frame in frames(cap, TURN_TIMEOUT_S):
            face = best_face(detector, frame)
            if face is None:
                continue
            stage = challenge.update(yaw_ratio(landmarks(face)))
            if stage == "back" and not announced_back:
                announced_back = True
                say(prompt="return")
            if challenge.done:
                break
        if not challenge.done:
            cap.release()
            finish({"ok": False, "score": best, "error": "No pude comprobar que eres una persona real. Gira la cabeza hacia el lado que se te pide."})
        # the same person must come back after the turn (a photo swap mid-challenge fails here)
        if not consecutive_matches(RETURN_TIMEOUT_S, 2):
            cap.release()
            finish({"ok": False, "score": best, "error": "No te reconocí. Intenta de nuevo o usa el PIN."})

    cap.release()
    finish({"ok": True, "score": best, "live": liveness})


def serve(detector, recognizer) -> None:
    """Long-lived worker: models stay loaded between logins."""
    global SERVER
    SERVER = True
    say(ready=True)
    for line in sys.stdin:
        try:
            req = json.loads(line)
        except ValueError:
            continue
        rid, cmd = req.get("id"), req.get("cmd")
        if cmd == "quit":
            break
        try:
            if cmd == "ping":
                payload = {"ok": True, "pong": True}
            elif cmd == "enroll":
                enroll(detector, recognizer)
            elif cmd == "verify":
                verify(detector, recognizer, bool(req.get("liveness")), req.get("embeddings") or [])
            else:
                payload = {"ok": False, "error": "Comando desconocido"}
        except Done as d:
            payload = d.payload
        except Exception as e:  # a bad frame or camera hiccup must not kill the worker
            payload = {"ok": False, "error": f"Error del módulo facial: {e}"}
        finally:
            release_camera()
        print(json.dumps({"id": rid, "result": payload}), flush=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["enroll", "verify", "selftest", "serve"])
    ap.add_argument("--models-dir", required=True)
    ap.add_argument("--liveness", action="store_true", help="verify: also require a head-turn challenge")
    args = ap.parse_args()

    try:
        det_path, rec_path = ensure_models(Path(args.models_dir))
    except Exception as e:  # network / disk
        finish({"ok": False, "error": f"No se pudieron descargar los modelos faciales: {e}"})

    detector = cv2.FaceDetectorYN.create(det_path, "", (320, 320), 0.9, 0.3, 5000)
    recognizer = cv2.FaceRecognizerSF.create(rec_path, "")
    if args.mode == "selftest":  # models load and OpenCV works; no camera involved (used by CI)
        finish({"ok": True, "selftest": True, "opencv": cv2.__version__})
    if args.mode == "serve":
        serve(detector, recognizer)
        return
    if args.mode == "enroll":
        enroll(detector, recognizer)
    verify(detector, recognizer, args.liveness)


if __name__ == "__main__":
    main()
