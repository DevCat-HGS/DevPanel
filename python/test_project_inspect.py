import json
import os
import tempfile
import unittest

import project_inspect as pi


def make(files: dict) -> tempfile.TemporaryDirectory:
    d = tempfile.TemporaryDirectory()
    for name, content in files.items():
        full = os.path.join(d.name, name)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as f:
            f.write(content if isinstance(content, str) else json.dumps(content))
    return d


def ids(r):
    return {p["id"] for p in r["problems"]}


class Managers(unittest.TestCase):
    def test_pnpm_lock_wins_and_missing_modules_offers_install(self):
        with make({"package.json": {"scripts": {"dev": "x"}}, "pnpm-lock.yaml": ""}) as _:
            pass
        d = make({"package.json": {"scripts": {"dev": "x"}}, "pnpm-lock.yaml": ""})
        r = pi.inspect_project(d.name)
        self.assertEqual(r["manager"], "pnpm")
        self.assertIn("no_modules", ids(r))
        self.assertEqual(next(p for p in r["problems"] if p["id"] == "no_modules")["fix"], "install")
        self.assertEqual(r["scripts"], ["dev"])
        d.cleanup()

    def test_package_manager_field_beats_lockfile(self):
        d = make({"package.json": {"packageManager": "yarn@4.1.0"}, "package-lock.json": ""})
        self.assertEqual(pi.inspect_project(d.name)["manager"], "yarn")
        d.cleanup()

    def test_two_lockfiles_warn(self):
        d = make({"package.json": {}, "package-lock.json": "", "yarn.lock": ""})
        self.assertIn("multi_lock", ids(pi.inspect_project(d.name)))
        d.cleanup()

    def test_deno_project(self):
        d = make({"deno.json": {"tasks": {"start": "deno run main.ts"}}})
        r = pi.inspect_project(d.name)
        self.assertEqual(r["manager"], "deno")
        self.assertEqual(r["tasks"], ["start"])
        d.cleanup()

    def test_env_example_without_env(self):
        d = make({"package.json": {}, ".env.example": "A=1"})
        self.assertIn("env_missing", ids(pi.inspect_project(d.name)))
        d.cleanup()

    def test_unsafe_script_names_are_dropped(self):
        d = make({"package.json": {"scripts": {"ok": "x", "a;b": "x", "$(evil)": "x"}}})
        self.assertEqual(pi.inspect_project(d.name)["scripts"], ["ok"])
        d.cleanup()


class Versions(unittest.TestCase):
    def test_simple_ranges(self):
        self.assertTrue(pi.satisfies_major(">=18", "22.1.0"))
        self.assertFalse(pi.satisfies_major(">=24", "22.1.0"))
        self.assertTrue(pi.satisfies_major("^20", "20.5.0"))
        self.assertFalse(pi.satisfies_major("20", "22.0.0"))
        self.assertTrue(pi.satisfies_major("18 || 20", "20.1.0"))
        self.assertIsNone(pi.satisfies_major(">=18 <23", "20.0.0"))  # unknown, not a false alarm

    def test_missing_folder(self):
        self.assertFalse(pi.inspect_project(os.path.join(tempfile.gettempdir(), "nope-xyz"))["ok"])


class Flutter(unittest.TestCase):
    def test_flutter_project_reports_kind(self):
        d = make({"pubspec.yaml": "environment:\n  sdk: '>=3.8.0 <4.0.0'\n"})
        r = pi.inspect_project(d.name)
        self.assertIn("flutter", r["kinds"])
        self.assertEqual(r["flutter"]["constraint"], ">=3.8.0 <4.0.0")
        self.assertTrue({"flutter_missing", "no_pub"} & ids(r))
        d.cleanup()


if __name__ == "__main__":
    unittest.main()
