"""Head-turn liveness challenge (pure logic, no OpenCV needed, unit-testable).

A still photo cannot follow "turn your head to your LEFT, then look back at the screen". The check
uses the 5 landmarks YuNet already gives us (eyes, nose, mouth corners): how far the nose sits from the
middle of the eyes, relative to the distance between the eyes, is a cheap yaw estimate.

Honest limits: it stops casual attacks (a phone/printed photo held still or simply moved), not a
determined attacker with a video or a 3D model.
"""
from __future__ import annotations

import random

FRONTAL = 0.12  # |yaw| below this counts as "looking at the camera"
TURNED = 0.22   # yaw (in the requested direction) needed to count as a real turn


def yaw_ratio(landmarks) -> float:
    """landmarks: [(x, y) * 5] = right eye, left eye, nose, right mouth, left mouth (image coords).

    Positive yaw: the nose moved toward the image's right side, i.e. the user turned to THEIR left
    (the camera sees the user mirrored). Negative: the user turned to their right.
    """
    right_eye, left_eye, nose = landmarks[0], landmarks[1], landmarks[2]
    eye_dist = abs(left_eye[0] - right_eye[0])
    if eye_dist < 1e-3:
        return 0.0
    eye_mid_x = (right_eye[0] + left_eye[0]) / 2.0
    return (nose[0] - eye_mid_x) / eye_dist


class HeadTurnChallenge:
    """frontal -> turn to the requested side -> frontal again."""

    def __init__(self, direction: str | None = None, rng: random.Random | None = None):
        self.direction = direction or (rng or random).choice(["left", "right"])
        if self.direction not in ("left", "right"):
            raise ValueError("direction must be 'left' or 'right'")
        self.sign = 1 if self.direction == "left" else -1
        self.stage = "frontal"  # frontal -> turn -> back -> done

    def update(self, yaw: float) -> str:
        if self.stage == "frontal" and abs(yaw) < FRONTAL:
            self.stage = "turn"
        elif self.stage == "turn" and yaw * self.sign >= TURNED:
            self.stage = "back"
        elif self.stage == "back" and abs(yaw) < FRONTAL:
            self.stage = "done"
        return self.stage

    @property
    def done(self) -> bool:
        return self.stage == "done"
