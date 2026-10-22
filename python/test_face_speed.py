import unittest

import numpy as np

import face_auth as fa


class FakeDetector:
    """Returns one face as the real YuNet would for the (downscaled) image it was given."""

    def __init__(self):
        self.size = None

    def setInputSize(self, size):
        self.size = size

    def detect(self, img):
        w, h = self.size
        face = np.array([w * 0.25, h * 0.25, w * 0.5, h * 0.5] + [w * 0.5, h * 0.5] * 5 + [0.99], dtype=np.float32)
        return None, face.reshape(1, -1)


class DownscaledDetection(unittest.TestCase):
    def test_detection_runs_on_a_small_copy_and_maps_back_to_full_frame(self):
        det = FakeDetector()
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        face = fa.best_face(det, frame)
        self.assertEqual(det.size, (fa.DET_WIDTH, 240), "the detector must see the downscaled frame")
        self.assertAlmostEqual(face[0], 640 * 0.25, places=1)  # x back in 640-wide pixels
        self.assertAlmostEqual(face[3], 480 * 0.5, places=1)   # height too
        self.assertAlmostEqual(face[-1], 0.99, places=2)       # the score is not scaled

    def test_small_frames_are_left_alone(self):
        det = FakeDetector()
        face = fa.best_face(det, np.zeros((200, 300, 3), dtype=np.uint8))
        self.assertEqual(det.size, (300, 200))
        self.assertAlmostEqual(face[0], 75.0, places=1)

    def test_low_score_is_rejected(self):
        class Weak(FakeDetector):
            def detect(self, img):
                _, f = super().detect(img)
                f[0, -1] = 0.5
                return None, f

        self.assertIsNone(fa.best_face(Weak(), np.zeros((480, 640, 3), dtype=np.uint8)))


if __name__ == "__main__":
    unittest.main()
