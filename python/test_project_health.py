import os
import subprocess
import tempfile
import unittest

import project_health as ph


class RepoHealth(unittest.TestCase):
    def test_healthy_repo_scores_a(self):
        r = ph.check_repo({
            "name": "x", "description": "d", "license": {"spdx_id": "MIT"}, "topics": ["a"],
            "pushed_at": ph.datetime.now(ph.timezone.utc).isoformat(), "open_issues_count": 2,
            "archived": False, "last_run": {"conclusion": "success"},
        })
        self.assertEqual(r["score"], 100)
        self.assertEqual(r["grade"], "A")

    def test_failing_build_and_archived_lower_the_score(self):
        r = ph.check_repo({"name": "x", "archived": True, "last_run": {"conclusion": "failure"}, "pushed_at": "2020-01-01T00:00:00Z"})
        self.assertLess(r["score"], 40)
        self.assertIn("ci_pass", r["brief"])


class LocalHealth(unittest.TestCase):
    def test_missing_folder(self):
        self.assertFalse(ph.check_local(os.path.join(tempfile.gettempdir(), "no-such-dir-xyz"))["ok"])

    def test_plain_folder_without_git(self):
        with tempfile.TemporaryDirectory() as d:
            open(os.path.join(d, "README.md"), "w").close()
            r = ph.check_local(d)
            checks = {c["id"]: c["ok"] for c in r["checks"]}
            self.assertFalse(checks["git"])
            self.assertTrue(checks["readme"])
            self.assertLess(r["score"], 60)

    def test_tracked_env_file_is_flagged(self):
        with tempfile.TemporaryDirectory() as d:
            run = lambda *a: subprocess.run(["git", *a], cwd=d, capture_output=True, check=True)
            run("init", "-q")
            open(os.path.join(d, ".env"), "w").write("X=1")
            run("add", ".env")
            run("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init")
            checks = {c["id"]: c["ok"] for c in ph.check_local(d)["checks"]}
            self.assertFalse(checks["no_env"])
            self.assertTrue(checks["git"])


if __name__ == "__main__":
    unittest.main()
