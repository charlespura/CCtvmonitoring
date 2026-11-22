#!/usr/bin/env python3
"""
People detector worker for the CCTV monitoring server.

Protocol (line-delimited JSON over stdin/stdout):
  in : {"frame": "<base64 JPEG>", "zones": {"ENTER": {...}, "EXIT": {...}}}
  out: {"people": [...], "frame": "<base64 annotated JPEG>", "count": N, "timestamp": "..."}
       or {"error": "..."}

An optional JSON config object can be passed as the first CLI argument, e.g.
  python3 people_detector.py '{"DETECTION_CONFIDENCE": 0.3}'
"""

import base64
import json
import sys
from datetime import datetime

import cv2
import numpy as np

DEFAULT_CONFIG = {
    "DETECTION_CONFIDENCE": 0.3,  # Minimum HOG SVM weight to accept a detection
    "STREAM_SCALE_WIDTH": 640,    # Frames are resized to this width before detection
    "ZONE_BUFFER": 20,            # Extra pixels around each zone to reduce edge flicker
}

DEFAULT_ZONES = {
    "ENTER": {"x1": 0, "y1": 150, "x2": 320, "y2": 350},
    "EXIT": {"x1": 320, "y1": 150, "x2": 640, "y2": 350},
}

# BGR colours
GREEN = (94, 197, 34)
RED = (68, 68, 239)
AMBER = (36, 191, 251)


def load_config():
    config = dict(DEFAULT_CONFIG)
    if len(sys.argv) > 1:
        try:
            config.update(json.loads(sys.argv[1]))
        except json.JSONDecodeError as exc:
            print(f"Invalid config argument, using defaults: {exc}", file=sys.stderr)
    return config


def draw_zone(frame, zone, color, label):
    p1, p2 = (zone["x1"], zone["y1"]), (zone["x2"], zone["y2"])
    overlay = frame.copy()
    cv2.rectangle(overlay, p1, p2, color, -1)
    cv2.addWeighted(overlay, 0.15, frame, 0.85, 0, frame)
    cv2.rectangle(frame, p1, p2, color, 2)
    cv2.putText(frame, label, (zone["x1"] + 6, max(zone["y1"] - 8, 14)),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2, cv2.LINE_AA)


def in_zone(cx, cy, zone, buffer):
    return (zone["x1"] - buffer <= cx <= zone["x2"] + buffer
            and zone["y1"] - buffer <= cy <= zone["y2"] + buffer)


def detect_people(hog, frame_b64, zones, config):
    img = np.frombuffer(base64.b64decode(frame_b64), np.uint8)
    frame = cv2.imdecode(img, cv2.IMREAD_COLOR)
    if frame is None:
        return {"error": "Could not decode image"}

    # Resize for faster processing (zone coordinates are in this scaled space)
    height, width = frame.shape[:2]
    target_width = int(config.get("STREAM_SCALE_WIDTH", 640))
    if width != target_width:
        frame = cv2.resize(frame, (target_width, int(height * target_width / width)))

    annotated = frame.copy()
    draw_zone(annotated, zones["ENTER"], GREEN, "ENTER")
    draw_zone(annotated, zones["EXIT"], RED, "EXIT")

    rects, weights = hog.detectMultiScale(frame, winStride=(4, 4), padding=(8, 8), scale=1.05)
    weights = np.asarray(weights).reshape(-1)

    people = []
    buffer = int(config.get("ZONE_BUFFER", 20))
    for (x, y, w, h), weight in zip(rects, weights):
        if weight < config["DETECTION_CONFIDENCE"]:
            continue

        # Cast numpy types to plain Python types so json.dumps works
        x, y, w, h = int(x), int(y), int(w), int(h)
        cx, cy = x + w // 2, y + h // 2
        entering = in_zone(cx, cy, zones["ENTER"], buffer)
        exiting = in_zone(cx, cy, zones["EXIT"], buffer)

        color = GREEN if entering else RED if exiting else AMBER
        cv2.rectangle(annotated, (x, y), (x + w, y + h), color, 2)
        cv2.putText(annotated, f"{float(weight):.2f}", (x, max(y - 5, 10)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, color, 1, cv2.LINE_AA)

        people.append({
            "id": len(people),
            "x": cx,
            "y": cy,
            "width": w,
            "height": h,
            "confidence": float(weight),
            "in_enter_zone": entering,
            "in_exit_zone": exiting,
        })

    ok, buf = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 80])
    if not ok:
        return {"error": "Could not encode annotated frame"}

    return {
        "people": people,
        "frame": base64.b64encode(buf).decode("ascii"),
        "count": len(people),
        "timestamp": datetime.now().isoformat(),
    }


def main():
    config = load_config()
    zones = DEFAULT_ZONES
    hog = cv2.HOGDescriptor()
    hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())

    while True:
        line = sys.stdin.readline()
        if not line:
            break
        try:
            message = json.loads(line)
            zones = message.get("zones") or zones
            result = detect_people(hog, message["frame"], zones, config)
        except Exception as exc:  # keep the worker alive on bad frames
            result = {"error": str(exc)}
        sys.stdout.write(json.dumps(result) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
