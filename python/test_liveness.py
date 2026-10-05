import unittest

from liveness import FRONTAL, TURNED, HeadTurnChallenge, yaw_ratio


def face(nose_dx: float):
    """Landmarks for a face whose eyes are 40px apart; the nose is nose_dx pixels from the eye midpoint."""
    return [(80, 100), (120, 100), (100 + nose_dx, 125), (85, 150), (115, 150)]


class YawTests(unittest.TestCase):
    def test_frontal_is_zero(self):
        self.assertAlmostEqual(yaw_ratio(face(0)), 0.0)

    def test_sign_follows_the_nose(self):
        self.assertGreater(yaw_ratio(face(+12)), 0.2)  # nose toward image right = user's left
        self.assertLess(yaw_ratio(face(-12)), -0.2)

    def test_scale_invariant(self):
        far = [(x / 2, y / 2) for x, y in face(10)]
        self.assertAlmostEqual(yaw_ratio(face(10)), yaw_ratio(far))

    def test_degenerate_eyes(self):
        self.assertEqual(yaw_ratio([(5, 5), (5, 5), (9, 9), (0, 0), (0, 0)]), 0.0)


class ChallengeTests(unittest.TestCase):
    def run_seq(self, direction, seq):
        c = HeadTurnChallenge(direction)
        for y in seq:
            c.update(y)
        return c

    def test_left_turn_and_return_passes(self):
        c = self.run_seq("left", [0.0, 0.05, 0.15, 0.30, 0.2, 0.05])
        self.assertTrue(c.done)

    def test_right_turn_and_return_passes(self):
        c = self.run_seq("right", [0.0, -0.1, -0.3, -0.05])
        self.assertTrue(c.done)

    def test_wrong_direction_never_passes(self):
        c = self.run_seq("left", [0.0, -0.3, -0.4, 0.0, -0.3, 0.0])
        self.assertFalse(c.done)

    def test_a_still_photo_never_passes(self):
        c = self.run_seq("right", [0.01] * 200)
        self.assertFalse(c.done)
        self.assertEqual(c.stage, "turn")

    def test_turning_without_coming_back_is_not_enough(self):
        c = self.run_seq("left", [0.0, 0.3, 0.35, 0.3])
        self.assertFalse(c.done)
        self.assertEqual(c.stage, "back")

    def test_starting_already_turned_requires_a_frontal_first(self):
        c = self.run_seq("left", [0.4, 0.4, 0.4])
        self.assertEqual(c.stage, "frontal")

    def test_thresholds_are_sane(self):
        self.assertLess(FRONTAL, TURNED)

    def test_direction_is_random_but_valid(self):
        for _ in range(20):
            self.assertIn(HeadTurnChallenge().direction, ("left", "right"))
        with self.assertRaises(ValueError):
            HeadTurnChallenge("up")


if __name__ == "__main__":
    unittest.main()
