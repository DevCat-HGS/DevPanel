"""Project inspector for DevPanel (standard library only).

Reads a project folder (and, with deep=True, asks Flutter about devices and emulators) and reports:
  - which package manager / runtime it uses (npm, pnpm, yarn, bun, deno, flutter, python, go...)
  - what is installed on this machine and whether it matches what the project asks for
  - problems found BEFORE they hurt, each with a suggested fix (an action id the app maps to a fixed command)
"""
import json
import os
import re
import shutil
import subprocess

LOCKS = {
    "pnpm-lock.yaml": "pnpm", "yarn.lock": "yarn", "bun.lockb": "bun", "bun.lock": "bun",
    "package-lock.json": "npm", "npm-shrinkwrap.json": "npm", "deno.lock": "deno",
}


def run(cmd: list, cwd: str | None = None, timeout: int = 25) -> str | None:
    exe = shutil.which(cmd[0])
    if not exe:
        return None
    try:
        r = subprocess.run([exe, *cmd[1:]], cwd=cwd, capture_output=True, text=True, timeout=timeout, check=False)
    except (OSError, subprocess.SubprocessError):
        return None
    return (r.stdout or "") + (r.stderr or "") if r.returncode == 0 else None


def version_of(cmd: list) -> str | None:
    out = run(cmd, timeout=15)
    m = re.search(r"\d+\.\d+(?:\.\d+)?", out or "")
    return m.group(0) if m else None


def read_json(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def read_text(path: str) -> str:
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return ""


def major(v: str | None) -> int | None:
    m = re.match(r"\D*(\d+)", v or "")
    return int(m.group(1)) if m else None


def satisfies_major(required: str, installed: str | None) -> bool | None:
    """Only the simple, common ranges (>=18, ^20, 20.x, 18 || 20): anything else is 'unknown' instead of a false alarm."""
    inst = major(installed)
    if inst is None:
        return None
    mins = []
    for part in required.split("||"):
        part = part.strip()
        m = re.match(r"^(?:>=|\^|~)?\s*v?(\d+)(?:\.[\dx*]+)*$", part)
        if not m:
            return None
        op = re.match(r"^(>=|\^|~)", part)
        mins.append((int(m.group(1)), op.group(1) if op else "="))
    for n, op in mins:
        if (op == ">=" and inst >= n) or (op in ("^", "~", "=") and inst == n):
            return True
    return False


def problem(pid: str, severity: str, message: str, fix: str | None = None, label: str | None = None) -> dict:
    return {"id": pid, "severity": severity, "message": message, "fix": fix, "label": label}


def detect_manager(path: str, pkg: dict, has_pkg: bool) -> tuple[str | None, list]:
    found = [m for f, m in LOCKS.items() if os.path.exists(os.path.join(path, f))]
    found = list(dict.fromkeys(found))
    declared = str(pkg.get("packageManager", "")).split("@")[0]
    if declared in ("npm", "pnpm", "yarn", "bun"):
        return declared, found
    if found:
        return found[0], found
    if os.path.exists(os.path.join(path, "deno.json")) or os.path.exists(os.path.join(path, "deno.jsonc")):
        return "deno", found
    if has_pkg:
        return "npm", found
    return None, found


def inspect_node(path: str, pkg: dict, has_pkg: bool, out: dict) -> None:
    manager, locks = out["manager"], out["lockfiles"]
    if manager is None:
        return
    out["scripts"] = [k for k in (pkg.get("scripts") or {}) if re.fullmatch(r"[A-Za-z0-9:_.-]{1,64}", k)]
    if not out["scripts"]:
        out["problems"].append(problem("no_scripts", "info", "package.json no define scripts"))
    installed = out["tools"].get(manager)
    if manager != "deno" and installed is None:
        out["problems"].append(problem("manager_missing", "error", f"{manager} no está instalado en este equipo"))
    if len(locks) > 1:
        out["problems"].append(problem("multi_lock", "warn", f"Hay lockfiles de varios gestores ({', '.join(locks)}): elige uno"))
    if has_pkg and not os.path.isdir(os.path.join(path, "node_modules")):
        out["problems"].append(problem("no_modules", "error", "Faltan las dependencias (no existe node_modules)", "install", f"Instalar con {manager}"))
    engines = (pkg.get("engines") or {}).get("node")
    nvmrc = read_text(os.path.join(path, ".nvmrc")).strip() or read_text(os.path.join(path, ".node-version")).strip()
    want = engines or nvmrc
    node_v = out["tools"].get("node")
    if want and node_v:
        ok = satisfies_major(want, node_v)
        out["node"] = {"required": want, "installed": node_v, "ok": ok}
        if ok is False:
            out["problems"].append(problem("node_version", "warn", f"El proyecto pide Node {want} y tienes {node_v}"))
    elif want and not node_v:
        out["problems"].append(problem("node_missing", "error", f"El proyecto pide Node {want} y Node no está instalado"))
    if os.path.exists(os.path.join(path, ".env.example")) and not os.path.exists(os.path.join(path, ".env")):
        out["problems"].append(problem("env_missing", "warn", "Existe .env.example pero falta .env"))
    if manager in ("npm", "pnpm", "yarn", "bun") and has_pkg:
        out["actions"].append({"id": "install", "label": f"{manager} install"})
        if manager != "bun":
            out["actions"].append({"id": "audit", "label": f"{manager} audit"})


def inspect_deno(path: str, out: dict) -> None:
    cfg = read_json(os.path.join(path, "deno.json")) or read_json(os.path.join(path, "deno.jsonc"))
    tasks = [k for k in (cfg.get("tasks") or {}) if re.fullmatch(r"[A-Za-z0-9:_.-]{1,64}", k)]
    out["tasks"] = tasks
    if out["tools"].get("deno") is None:
        out["problems"].append(problem("manager_missing", "error", "Deno no está instalado en este equipo"))


def inspect_flutter(path: str, out: dict, deep: bool) -> None:
    pubspec = read_text(os.path.join(path, "pubspec.yaml"))
    sdk = re.search(r"^\s*sdk:\s*['\"]?([^'\"\n#]+)", pubspec, re.M)
    info = {"constraint": sdk.group(1).strip() if sdk else None, "installed": None, "channel": None, "devices": [], "emulators": []}
    out["flutter"] = info
    if shutil.which("flutter") is None:
        out["problems"].append(problem("flutter_missing", "error", "Flutter no está instalado o no está en el PATH"))
        return
    if not os.path.isdir(os.path.join(path, ".dart_tool")) or not os.path.exists(os.path.join(path, "pubspec.lock")):
        out["problems"].append(problem("no_pub", "error", "Faltan las dependencias de Dart (.dart_tool / pubspec.lock)", "flutter-pub-get", "flutter pub get"))
    for action, label in (("flutter-analyze", "flutter analyze"), ("flutter-test", "flutter test"), ("flutter-doctor", "flutter doctor"), ("flutter-clean", "flutter clean")):
        out["actions"].append({"id": action, "label": label})
    if not deep:
        return
    raw = run(["flutter", "--version", "--machine"], cwd=path, timeout=40)
    try:
        v = json.loads(raw or "{}")
        info["installed"], info["channel"] = v.get("frameworkVersion"), v.get("channel")
    except ValueError:
        pass
    if info["constraint"] and info["installed"]:
        dart = None
        try:
            dart = json.loads(raw or "{}").get("dartSdkVersion", "")
        except ValueError:
            pass
        lo = re.search(r">=\s*(\d+)\.(\d+)", info["constraint"])
        dv = re.match(r"(\d+)\.(\d+)", str(dart or ""))
        if lo and dv and (int(dv.group(1)), int(dv.group(2))) < (int(lo.group(1)), int(lo.group(2))):
            out["problems"].append(problem("dart_version", "error", f"El proyecto pide Dart {info['constraint']} y Flutter trae {dart}", "flutter-upgrade", "flutter upgrade"))
    devices = run(["flutter", "devices", "--machine"], cwd=path, timeout=60)
    try:
        for d in json.loads(devices or "[]"):
            if re.fullmatch(r"[A-Za-z0-9._:-]{1,64}", str(d.get("id", ""))):
                info["devices"].append({"id": d["id"], "name": d.get("name", d["id"]), "platform": d.get("targetPlatform", "")})
    except ValueError:
        pass
    emus = run(["flutter", "emulators"], cwd=path, timeout=40) or ""
    for line in emus.splitlines():
        parts = [p.strip() for p in re.split(r"\s+[•·]\s+", line)]
        if len(parts) >= 3 and re.fullmatch(r"[A-Za-z0-9._:-]{1,64}", parts[0]) and parts[0] != "Id":
            info["emulators"].append({"id": parts[0], "name": parts[1], "platform": parts[-1]})
    if not info["devices"] and not info["emulators"]:
        out["problems"].append(problem("no_devices", "warn", "No hay dispositivos ni emuladores disponibles para ejecutar la app"))


def inspect_other(path: str, out: dict) -> None:
    if os.path.exists(os.path.join(path, "go.mod")):
        out["kinds"].append("go")
        if out["tools"].get("go") is None:
            out["problems"].append(problem("go_missing", "error", "Go no está instalado"))
    if any(os.path.exists(os.path.join(path, f)) for f in ("requirements.txt", "pyproject.toml", "Pipfile")):
        out["kinds"].append("python")
        if not any(os.path.isdir(os.path.join(path, d)) for d in (".venv", "venv", "env")):
            out["problems"].append(problem("no_venv", "warn", "No encontré un entorno virtual (.venv)"))


def inspect_project(path: str, deep: bool = False) -> dict:
    path = os.path.abspath(path)
    if not os.path.isdir(path):
        return {"ok": False, "error": "La carpeta no existe"}
    pkg = read_json(os.path.join(path, "package.json"))
    has_pkg = os.path.exists(os.path.join(path, "package.json"))
    manager, locks = detect_manager(path, pkg, has_pkg)
    kinds = []
    if has_pkg:
        kinds.append("node")
    if os.path.exists(os.path.join(path, "pubspec.yaml")):
        kinds.append("flutter")
    if os.path.exists(os.path.join(path, "firebase.json")):
        kinds.append("firebase")
    if manager == "deno":
        kinds.append("deno")
    tools = {}
    for name, cmd in (("node", ["node", "--version"]), ("npm", ["npm", "--version"]), ("pnpm", ["pnpm", "--version"]),
                      ("yarn", ["yarn", "--version"]), ("bun", ["bun", "--version"]), ("deno", ["deno", "--version"]),
                      ("go", ["go", "version"]), ("git", ["git", "--version"])):
        if name == "node" or name == manager or name in ("git",) or (name == "go" and os.path.exists(os.path.join(path, "go.mod"))):
            tools[name] = version_of(cmd)
    out = {"ok": True, "path": path, "kinds": kinds, "manager": manager, "lockfiles": locks, "tools": tools,
           "scripts": [], "tasks": [], "problems": [], "actions": [], "node": None, "flutter": None}
    if "node" in kinds or manager == "deno":
        if manager == "deno":
            inspect_deno(path, out)
        else:
            inspect_node(path, pkg, has_pkg, out)
    if "flutter" in kinds:
        inspect_flutter(path, out, deep)
    inspect_other(path, out)
    order = {"error": 0, "warn": 1, "info": 2}
    out["problems"].sort(key=lambda p: order.get(p["severity"], 3))
    errors = sum(1 for p in out["problems"] if p["severity"] == "error")
    warns = sum(1 for p in out["problems"] if p["severity"] == "warn")
    out["brief"] = (
        f"{os.path.basename(path)}: {', '.join(kinds) or 'project'}"
        + (f", manager {manager}" if manager else "")
        + f". {errors} errors, {warns} warnings"
        + (": " + "; ".join(p["message"] for p in out["problems"][:4]) if out["problems"] else "")
        + "."
    )
    return out
