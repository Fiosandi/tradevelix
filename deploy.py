"""Deploy current local tree to the Tradevelix VPS - self-bootstrapping.

Reads credentials from env (never hardcoded):
    VPS_HOST       (default: 43.134.173.106)
    VPS_USER       (default: ubuntu)
    VPS_PASSWORD   (REQUIRED)
    VPS_REPO       (default: /opt/remora)
    VPS_SERVICE    (optional override; otherwise auto-detected or fallback to manual uvicorn)

Usage:
    PowerShell:  $env:VPS_PASSWORD = '...'; python deploy.py
    Bash:        VPS_PASSWORD='...' python deploy.py

What it does (each step is idempotent and self-bootstraps if state is missing):
    1. Build frontend locally (npm run build).
    2. SSH to VPS, run discovery: list repo, detect git, venv, systemd unit.
    3. SFTP-sync backend/ source (skips venv, __pycache__, .env, logs).
    4. SFTP-sync frontend/dist/ (wipes remote first).
    5. Create venv if missing; pip install -r requirements.txt.
    6. alembic upgrade head.
    7. Restart backend: try systemctl restart <unit>; if that fails,
       pkill any running uvicorn and relaunch via nohup.
    8. Tail journalctl or the nohup log.
"""

from __future__ import annotations

import os
import pathlib
import shutil
import subprocess
import sys

try:
    import paramiko
except ImportError:
    print("ERROR: paramiko is not installed. Run: pip install paramiko", file=sys.stderr)
    sys.exit(1)


# ─── Config ─────────────────────────────────────────────────────────────────

HOST = os.environ.get("VPS_HOST", "43.134.173.106")
USER = os.environ.get("VPS_USER", "ubuntu")
PWD = os.environ.get("VPS_PASSWORD")
SERVICE_OVERRIDE = os.environ.get("VPS_SERVICE")
REMOTE_REPO = os.environ.get("VPS_REPO", "/opt/remora")
SKIP_BUILD = os.environ.get("SKIP_BUILD") == "1"

BASE = pathlib.Path(__file__).resolve().parent
LOCAL_BACKEND = BASE / "backend"
LOCAL_FRONTEND = BASE / "frontend"
LOCAL_DIST = LOCAL_FRONTEND / "dist"

REMOTE_BACKEND = f"{REMOTE_REPO}/backend"
REMOTE_DIST = f"{REMOTE_REPO}/frontend/dist"
# Probe these in order; reuse the first one that exists. If none exist, the
# first candidate is created. The systemd unit on this VPS uses /opt/remora/venv.
VENV_CANDIDATES = [f"{REMOTE_REPO}/venv", f"{REMOTE_BACKEND}/.venv", f"{REMOTE_BACKEND}/venv"]

SERVICE_CANDIDATES = ["tradevelix-backend", "tradevelix", "remora-backend", "remora", "uvicorn"]

# Skipped during backend SFTP sync - never overwrite remote secrets / build artifacts
SKIP_DIRS = {"__pycache__", ".venv", "venv", "node_modules", ".pytest_cache", "logs", ".mypy_cache", "tests", "alembic/__pycache__"}
SKIP_FILES = {".env", ".env.local", ".env.production", "*.pyc", "*.log", "*.sqlite", "*.db"}


if not PWD:
    print(
        "\nERROR: VPS_PASSWORD env var is not set.\n\n"
        "  PowerShell:  $env:VPS_PASSWORD = 'your-password'; python deploy.py\n"
        "  Bash:        VPS_PASSWORD='your-password' python deploy.py\n",
        file=sys.stderr,
    )
    sys.exit(2)


# ─── Output ─────────────────────────────────────────────────────────────────

def banner(msg: str):
    print(f"\n{'=' * 76}\n  {msg}\n{'=' * 76}")


def step(msg: str):
    print(f"  -> {msg}")


def warn(msg: str):
    print(f"  ! {msg}")


def fatal(msg: str, code: int = 1):
    print(f"\n  X {msg}", file=sys.stderr)
    sys.exit(code)


# ─── SSH / SFTP ─────────────────────────────────────────────────────────────

def ssh_exec(client, cmd: str, timeout: int = 180) -> tuple[int, str, str]:
    _, out, err = client.exec_command(cmd, timeout=timeout)
    o = out.read().decode("utf-8", errors="replace").strip()
    e = err.read().decode("utf-8", errors="replace").strip()
    rc = out.channel.recv_exit_status()
    return rc, o, e


def remote_exists(client, path: str) -> bool:
    rc, _, _ = ssh_exec(client, f"test -e {path}", timeout=10)
    return rc == 0


def remote_mkdir_p(sftp, path: str):
    parts = [p for p in path.split("/") if p]
    cur = ""
    for p in parts:
        cur += "/" + p
        try:
            sftp.stat(cur)
        except FileNotFoundError:
            sftp.mkdir(cur)


def _should_skip(path: pathlib.Path) -> bool:
    name = path.name
    if name in SKIP_DIRS or name in SKIP_FILES:
        return True
    for pat in SKIP_FILES:
        if pat.startswith("*") and name.endswith(pat[1:]):
            return True
    if any(p in SKIP_DIRS for p in path.parts):
        return True
    return False


def upload_tree(sftp, local: pathlib.Path, remote: str, label: str = "") -> int:
    remote_mkdir_p(sftp, remote)
    count = 0
    for item in sorted(local.iterdir()):
        if _should_skip(item):
            continue
        rpath = f"{remote}/{item.name}"
        if item.is_dir():
            count += upload_tree(sftp, item, rpath, label)
        else:
            sftp.put(str(item), rpath)
            count += 1
            if label and count % 25 == 0:
                step(f"{label}: {count} files...")
    return count


# ─── Discovery ──────────────────────────────────────────────────────────────

def detect_service(client) -> str | None:
    if SERVICE_OVERRIDE:
        step(f"using VPS_SERVICE override: {SERVICE_OVERRIDE}")
        return SERVICE_OVERRIDE
    for name in SERVICE_CANDIDATES:
        rc, _, _ = ssh_exec(client, f"systemctl list-unit-files --no-pager --no-legend {name}.service 2>/dev/null", timeout=15)
        if rc == 0:
            rc2, o, _ = ssh_exec(client, f"systemctl list-unit-files --no-pager --no-legend {name}.service", timeout=10)
            if rc2 == 0 and o:
                step(f"detected systemd unit: {name}")
                return name
    return None


def discover_python(client) -> str:
    for cand in ["python3.12", "python3.11", "python3", "python"]:
        rc, _, _ = ssh_exec(client, f"command -v {cand}", timeout=10)
        if rc == 0:
            return cand
    return "python3"


# ─── Build ──────────────────────────────────────────────────────────────────

def build_frontend():
    if SKIP_BUILD:
        step("SKIP_BUILD=1 - using existing frontend/dist")
        if not LOCAL_DIST.exists():
            fatal(f"{LOCAL_DIST} does not exist; remove SKIP_BUILD or build first")
        return

    npm = shutil.which("npm") or shutil.which("npm.cmd")
    if not npm:
        fatal("npm not found on PATH. Install Node.js or set SKIP_BUILD=1.")

    step(f"running `npm run build` in {LOCAL_FRONTEND}")
    rc = subprocess.call([npm, "run", "build"], cwd=str(LOCAL_FRONTEND), shell=False)
    if rc != 0:
        fatal(f"frontend build failed (exit {rc})")
    if not LOCAL_DIST.exists():
        fatal(f"build succeeded but {LOCAL_DIST} not found")
    n = sum(1 for _ in LOCAL_DIST.rglob("*") if _.is_file())
    step(f"built {n} files in {LOCAL_DIST}")


# ─── Main ───────────────────────────────────────────────────────────────────

def main():
    banner("Step 1 - Build frontend locally")
    build_frontend()

    banner(f"Step 2 - Connect & discover state on {USER}@{HOST}")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PWD, timeout=20, allow_agent=False, look_for_keys=False)

    repo_exists = remote_exists(client, REMOTE_REPO)
    backend_exists = remote_exists(client, REMOTE_BACKEND)
    venv_path = next((p for p in VENV_CANDIDATES if remote_exists(client, p)), VENV_CANDIDATES[0])
    venv_exists = any(remote_exists(client, p) for p in VENV_CANDIDATES)
    has_git = remote_exists(client, f"{REMOTE_REPO}/.git")
    py = discover_python(client)
    service = detect_service(client)

    step(f"{REMOTE_REPO}: {'EXISTS' if repo_exists else 'MISSING (will create)'}")
    step(f"{REMOTE_BACKEND}: {'EXISTS' if backend_exists else 'MISSING'}")
    step(f"git checkout: {'YES' if has_git else 'NO (using SFTP sync)'}")
    step(f"venv: {venv_path} {'EXISTS' if venv_exists else 'MISSING (will create)'}")
    step(f"python: {py}")
    step(f"systemd unit: {service or 'NOT FOUND (will fall back to nohup uvicorn)'}")

    if not repo_exists:
        ssh_exec(client, f"sudo -n mkdir -p {REMOTE_REPO} && sudo -n chown -R {USER}:{USER} {REMOTE_REPO}", timeout=15)
        if not remote_exists(client, REMOTE_REPO):
            ssh_exec(client, f"mkdir -p {REMOTE_REPO}", timeout=10)

    sftp = client.open_sftp()

    banner(f"Step 3 - SFTP backend -> {REMOTE_BACKEND}")
    n_be = upload_tree(sftp, LOCAL_BACKEND, REMOTE_BACKEND, label="backend")
    step(f"uploaded {n_be} backend files (skipped: venv, __pycache__, .env, logs)")

    banner(f"Step 4 - SFTP frontend/dist -> {REMOTE_DIST}")
    ssh_exec(client, f"rm -rf {REMOTE_DIST}/* {REMOTE_DIST}/.[!.]* 2>/dev/null", timeout=15)
    n_fe = upload_tree(sftp, LOCAL_DIST, REMOTE_DIST, label="frontend")
    step(f"uploaded {n_fe} frontend files")
    sftp.close()

    banner("Step 5 - Ensure venv & install requirements")
    if not venv_exists:
        step(f"creating {venv_path}")
        rc, o, e = ssh_exec(client, f"{py} -m venv {venv_path}", timeout=120)
        if rc != 0:
            warn(f"venv creation failed: {e or o}")
            warn("install python3-venv:  sudo apt-get install -y python3-venv")
            fatal("cannot continue without venv")
    rc, o, e = ssh_exec(
        client,
        f"cd {REMOTE_BACKEND} && . {venv_path}/bin/activate && "
        f"pip install -q --upgrade pip 2>&1 | tail -3 && "
        f"pip install -q -r requirements.txt 2>&1 | tail -10",
        timeout=600,
    )
    print(f"    {o or '(no output)'}")
    if rc != 0:
        warn(f"pip exited {rc}: {e}")

    banner("Step 6 - alembic upgrade head")
    # Note: do NOT set PYTHONPATH=<backend_root> here — it would make the
    # local alembic/ migrations dir shadow the installed alembic package.
    # env.py prepends the backend root to sys.path itself.
    rc, o, e = ssh_exec(
        client,
        f"cd {REMOTE_BACKEND} && . {venv_path}/bin/activate && "
        f"alembic upgrade head 2>&1",
        timeout=120,
    )
    for line in (o + "\n" + e).splitlines()[-12:]:
        if line.strip():
            print(f"    {line}")
    if rc != 0:
        warn(f"alembic exited {rc} - continuing (may be a no-op if up to date)")

    banner("Step 7 - Restart backend")
    restarted = False
    if service:
        rc, o, e = ssh_exec(client, f"sudo -n systemctl restart {service} 2>&1", timeout=30)
        if rc == 0:
            step(f"[OK] systemctl restart {service}")
            restarted = True
        else:
            warn(f"sudo systemctl failed (passwordless sudo not configured?): {o or e}")

    if not restarted:
        warn("falling back to manual uvicorn restart via nohup")
        kill_cmd = "pkill -f 'uvicorn app.main:app' 2>/dev/null; sleep 1"
        ssh_exec(client, kill_cmd, timeout=15)
        launch = (
            f"cd {REMOTE_BACKEND} && . {venv_path}/bin/activate && "
            f"mkdir -p logs && "
            f"nohup uvicorn app.main:app --host 0.0.0.0 --port 8000 "
            f">> logs/uvicorn.out 2>&1 & disown; sleep 2"
        )
        rc, o, e = ssh_exec(client, launch, timeout=30)
        if rc == 0:
            step("[OK] uvicorn relaunched via nohup (logs: backend/logs/uvicorn.out)")
            restarted = True
        else:
            warn(f"nohup launch exited {rc}: {o or e}")

    banner("Step 8 - Tail logs")
    if service:
        rc, o, e = ssh_exec(client, f"sudo -n journalctl -u {service} -n 25 --no-pager 2>&1", timeout=15)
        for line in (o or e).splitlines():
            print(f"    {line}")
    else:
        rc, o, e = ssh_exec(client, f"tail -n 25 {REMOTE_BACKEND}/logs/uvicorn.out 2>&1", timeout=15)
        for line in (o or e).splitlines():
            print(f"    {line}")

    rc, o, _ = ssh_exec(client, "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/api/v1/admin/sync/status 2>/dev/null || echo unreachable", timeout=10)
    step(f"backend health check: HTTP {o}")

    client.close()
    banner("Done")
    print(f"  Open http://{HOST}/admin -> API & System tab.")
    print("  Per-key bars populate from X-RateLimit-* headers on the next sync.")


if __name__ == "__main__":
    main()
