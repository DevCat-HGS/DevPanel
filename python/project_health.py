"""Project health score for DevPanel (standard library only).

  project_health.py local <path>   inspects a folder on disk (files + git)
  project_health.py repo           reads a GitHub repo summary as JSON on stdin

Both print one JSON line:
  {"ok": true, "kind": ..., "score": 0-100, "grade": "A".."F", "checks": [...], "brief": "..."}
`brief` is a short plain-text summary meant to be handed to the AI assistant and the automations.
"""
import json
import os
import subprocess
import sys
from datetime import datetime, timezone

# (id, weight): a check passes or fails; the score is the weighted share of passed checks.
LOCAL_CHECKS = [
    ("git", 10), ("clean", 8), ("synced", 8), ("fresh", 10), ("readme", 10), ("license", 6),
    ("gitignore", 6), ("tests", 12), ("ci", 10), ("lockfile", 5), ("no_env", 10), ("docs", 5),
]
REPO_CHECKS = [
    ("description", 8), ("license", 10), ("topics", 5), ("active", 20), ("ci_pass", 25),
    ("issues", 10), ("not_archived", 12), ("readme", 10),
]

LOCKFILES = ("package-lock.json", "yarn.lock", "pnpm-lock.yaml", "pubspec.lock", "poetry.lock", "Pipfile.lock", "go.sum", "Cargo.lock")
TEST_DIRS = ("test", "tests", "__tests__", "spec", "e2e")
SKIP_DIRS = {".git", "node_modules", "dist", "build", ".dart_tool", "venv", ".venv", "__pycache__", "release"}


def grade(score: int) -> str:
    for floor, letter in ((90, "A"), (75, "B"), (60, "C"), (40, "D")):
        if score >= floor:
            return letter
    return "F"


def finish(kind: str, name: str, results: list, weights: list) -> dict:
    total = sum(w for _, w in weights)
    got = sum(w for (cid, w), r in zip(weights, results) if r[0])
    score = round(100 * got / total) if total else 0
    checks = [{"id": cid, "weight": w, "ok": bool(r[0]), "detail": "" if r[0] else r[1]} for (cid, w), r in zip(weights, results)]
    failing = [c for c in checks if not c["ok"]]
    failing.sort(key=lambda c: -c["weight"])
    brief = f"{name}: health {score}/100 ({grade(score)})."
    if failing:
        brief += " To improve: " + "; ".join(f"{c['id']} ({c['detail']})" for c in failing[:4]) + "."
    else:
        brief += " All checks pass."
    return {"ok": True, "kind": kind, "name": name, "score": score, "grade": grade(score), "checks": checks, "brief": brief}


def git(path: str, *args: str) -> str | None:
    try:
        r = subprocess.run(["git", *args], cwd=path, capture_output=True, text=True, timeout=30, check=False)
    except (OSError, subprocess.SubprocessError):
        return None
    return r.stdout if r.returncode == 0 else None


def has_any(path: str, names) -> bool:
    return any(os.path.exists(os.path.join(path, n)) for n in names)


def has_tests(path: str) -> bool:
    if has_any(path, TEST_DIRS):
        return True
    for root, dirs, files in os.walk(path):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        if root[len(path):].count(os.sep) > 2:
            dirs[:] = []
        if any(f.startswith("test_") or ".test." in f or ".spec." in f or f.endswith("_test.dart") or f.endswith("_test.go") for f in files):
            return True
    return False


def days_since(iso: str) -> float | None:
    try:
        when = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - when).total_seconds() / 86400


def check_local(path: str) -> dict:
    path = os.path.abspath(path)
    if not os.path.isdir(path):
        return {"ok": False, "error": "La carpeta no existe"}
    name = os.path.basename(path)
    status = git(path, "status", "--porcelain=v1", "-b")
    is_git = status is not None
    lines = (status or "").splitlines()
    dirty = [l for l in lines if not l.startswith("## ")]
    head = next((l for l in lines if l.startswith("## ")), "")
    behind = "behind" in head
    tracked = (git(path, "ls-files") or "").splitlines()
    last = (git(path, "log", "-1", "--format=%cI") or "").strip()
    age = days_since(last) if last else None
    env_tracked = [f for f in tracked if os.path.basename(f).lower() in (".env", ".env.local", ".env.production") or f.lower().endswith((".pem", ".p12", ".keystore"))]

    results = [
        (is_git, "no es un repositorio git"),
        (is_git and not dirty, f"{len(dirty)} cambios sin commitear" if dirty else "sin repo"),
        (is_git and not behind, "hay commits por bajar" if behind else "sin repo"),
        (age is not None and age <= 30, f"último commit hace {int(age)} días" if age is not None else "sin commits"),
        (has_any(path, ("README.md", "README", "readme.md", "README.rst")), "falta README"),
        (has_any(path, ("LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING")), "falta LICENSE"),
        (has_any(path, (".gitignore",)), "falta .gitignore"),
        (has_tests(path), "no encontré tests"),
        (os.path.isdir(os.path.join(path, ".github", "workflows")) or has_any(path, (".gitlab-ci.yml", "azure-pipelines.yml", "Jenkinsfile")), "sin CI configurado"),
        (has_any(path, LOCKFILES) or not has_any(path, ("package.json", "pubspec.yaml", "go.mod", "Cargo.toml")), "falta lockfile de dependencias"),
        (not env_tracked, f"archivos sensibles versionados: {', '.join(env_tracked[:3])}"),
        (os.path.isdir(os.path.join(path, "docs")) or has_any(path, ("CONTRIBUTING.md", "CLAUDE.md", "CHANGELOG.md")), "sin docs/CONTRIBUTING/CHANGELOG"),
    ]
    return finish("local", name, results, LOCAL_CHECKS)


def check_repo(data: dict) -> dict:
    name = str(data.get("name") or "repo")
    age = days_since(str(data.get("pushed_at") or ""))
    run = data.get("last_run") or {}
    issues = data.get("open_issues_count")
    results = [
        (bool((data.get("description") or "").strip()), "sin descripción"),
        (bool(data.get("license")), "sin licencia"),
        (bool(data.get("topics")), "sin topics"),
        (age is not None and age <= 90, f"sin actividad hace {int(age)} días" if age is not None else "sin fecha de actividad"),
        (run.get("conclusion") == "success", "el último build falló" if run.get("conclusion") else "sin builds (Actions)"),
        (isinstance(issues, int) and issues <= 25, f"{issues} issues abiertos" if isinstance(issues, int) else "sin dato de issues"),
        (not data.get("archived"), "repositorio archivado"),
        (data.get("has_readme") is not False, "falta README"),
    ]
    return finish("repo", name, results, REPO_CHECKS)


def main(argv: list) -> int:
    try:
        if len(argv) >= 3 and argv[1] == "local":
            out = check_local(argv[2])
        elif len(argv) >= 2 and argv[1] == "repo":
            out = check_repo(json.loads(sys.stdin.read() or "{}"))
        else:
            out = {"ok": False, "error": "uso: project_health.py local <ruta> | repo (JSON por stdin)"}
    except (ValueError, OSError) as e:
        out = {"ok": False, "error": f"No se pudo calcular la salud: {e}"}
    print(json.dumps(out))
    return 0 if out.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
