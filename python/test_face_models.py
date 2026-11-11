import hashlib
import tempfile
import unittest
from pathlib import Path

import face_auth


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class DownloadTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.src = self.dir / "src.onnx"
        self.src.write_bytes(b"model-bytes" * 1000)
        self.url = self.src.resolve().as_uri()

    def tearDown(self):
        self.tmp.cleanup()

    def test_a_matching_file_is_moved_into_place(self):
        dest = self.dir / "m.onnx"
        face_auth.download(self.url, dest, sha(self.src.read_bytes()))
        self.assertEqual(dest.read_bytes(), self.src.read_bytes())
        self.assertFalse((self.dir / "m.onnx.part").exists())

    def test_a_wrong_hash_leaves_nothing_behind(self):
        dest = self.dir / "m.onnx"
        with self.assertRaises(ValueError):
            face_auth.download(self.url, dest, "0" * 64)
        self.assertFalse(dest.exists())
        self.assertFalse((self.dir / "m.onnx.part").exists())

    def test_models_are_pinned_to_a_commit_with_a_hash(self):
        for _name, url, digest in face_auth.MODELS.values():
            self.assertNotIn("/raw/main/", url)
            self.assertRegex(digest, r"^[0-9a-f]{64}$")


class EnsureModelsTests(unittest.TestCase):
    def test_a_truncated_or_unknown_file_is_downloaded_again(self):
        good = {name: (name * 50).encode() for name, _u, _d in face_auth.MODELS.values()}
        fetched = []

        def fake_fetch(url, dest, digest):
            fetched.append(dest.name)
            dest.write_bytes(good[dest.name])

        original = face_auth.MODELS
        face_auth.MODELS = {k: (n, u, sha(good[n])) for k, (n, u, _d) in original.items()}
        try:
            with tempfile.TemporaryDirectory() as d:
                models = Path(d)
                det, rec = (n for n, _u, _d in face_auth.MODELS.values())
                (models / det).write_bytes(good[det][:10] + b"x" * 200_000)  # big enough for the old size check
                (models / rec).write_bytes(good[rec])
                face_auth.ensure_models(models, fetch=fake_fetch)
                self.assertEqual(fetched, [det], "only the corrupt model is fetched again")
                fetched.clear()
                face_auth.ensure_models(models, fetch=fake_fetch)
                self.assertEqual(fetched, [], "verified models are not downloaded again")
        finally:
            face_auth.MODELS = original


if __name__ == "__main__":
    unittest.main()
