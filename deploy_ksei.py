"""Deploy the KSEI ownership feature + per-key API tracking + whale Tier B to VPS.

Credentials are read from the environment, NEVER hardcoded:
    VPS_HOST       (default: 43.134.173.106)
    VPS_USER       (default: ubuntu)
    VPS_PASSWORD   (REQUIRED — no default)
    VPS_SERVICE    (default: tries common candidates: remora-backend, tradevelix, remora)

Usage:
    Windows PowerShell:
        $env:VPS_PASSWORD = 'your-password'
        python deploy_ksei.py

    Bash / WSL:
        VPS_PASSWORD='your-password' python deploy_ksei.py

What it does (in order):
    1. SFTP-uploads all backend files modified or added in this session.
    2. SFTP-uploads frontend/dist/* to /opt/remora/frontend/dist (overwriting).
    3. Runs `pip install -r requirements.txt` in the VPS venv.
    4. Runs `alembic upgrade head` to create ksei_ownership + ksei_sid_history.
    5. Creates /tmp/tradevelix_ksei upload directory.
    6. systemctl restarts the backend service.
    7. Tails the last 20 lines of journalctl for that service.

After it finishes, hit /admin → System tab to confirm per-key bars populate after
the next API call.
"""

from __future__ import annotations

import os
import pathlib
import sys

try:
    import paramiko
except ImportError:
    print("ERROR: paramiko is not installed. Run: pip install paramiko", file=sys.stderr)
    sys.exit(1)


HOST = os.environ.get("VPS_HOST", "43.134.173.106")
USER = os.environ.get("VPS_USER", "ubuntu")
PWD = os.environ.get("VPS_PASSWORD")
SERVICE = os.environ.get("VPS_SERVICE")  # auto-detect when None
BASE = pathlib.Path(__file__).resolve().parent

if not PWD:
    print(
        "\nERROR: VPS_PASSWORD env var is not set.\n\n"
        "  PowerShell:  $env:VPS_PASSWORD = 'your-password'; python deploy_ksei.py\n"
        "  Bash:        VPS_PASSWORD='your-password' python deploy_ksei.py\n",
        file=sys.stderr,
    )
    sys.exit(2)


# ─── Files to upload ────────────────────────────────────────────────────────
BACKEND_FILES = [
    # Modified
    "backend/app/clients/market_reaper.py",
    "backend/app/services/sync_service.py",
    "backend/app/services/calculation_engine.py",
    "backend/app/schemas/sync.py",
    "backend/app/main.py",
    "backend/app/models/__init__.py",
    "backend/requirements.txt",
    # New
    "backend/app/services/ksei_parser.py",
    "backend/app/services/alert_engine.py",
    "backend/app/api/v1/ownership.py",
    "backend/app/api/v1/alerts.py",
    "backend/app/models/ksei_ownership.py",
    "backend/alembic/versions/003_ksei_ownership.py",
    "backend/scripts/test_ksei_parser.py",
]

REMOTE_BACKEND = "/opt/remora/backend"
REMOTE_FRONTEND_DIST = "/opt/remora/frontend/dist"
LOCAL_FRONTEND_DIST = BASE / "frontend" / "dist"

SERVICE_CANDIDATES = ["remora-backend", "tradevelix", "tradevelix-backend", "remora", "uvicorn"]


# ─── Helpers ────────────────────────────────────────────────────────────────

def ssh_exec(client: paramiko.SSHClient, cmd: str, timeout: int = 180) -> tuple[int, str, str]:
    _, out, err = client.exec_command(cmd, timeout=timeout)
    o = out.read().decode("utf-8", errors="replace").strip()
    e = err.read().decode("utf-8", errors="replace").strip()
    rc = out.channel.recv_exit_status()
    return rc, o, e


def banner(msg: str):
    print(f"\n{'━' * 76}\n  {msg}\n{'━' * 76}")


def step(msg: str):
    print(f"  → {msg}")


def remote_mkdir_p(sftp: paramiko.SFTPClient, path: str):
    parts = [p for p in path.split("/") if p]
    cur = ""
    for p in parts:
        cur += "/" + p
        try:
            sftp.stat(cur)
        except FileNotFoundError:
            sftp.mkdir(cur)


def upload_file(sftp: paramiko.SFTPClient, local: pathlib.Path, remote: str) -> int:
    if not local.exists():
        print(f"    SKIP (not found): {local}")
        return 0
    remote_dir = "/".join(remote.split("/")[:-1])
    remote_mkdir_p(sftp, remote_dir)
    sftp.put(str(local), remote)
    return 1


def upload_dir(sftp: paramiko.SFTPClient, local: pathlib.Path, remote: str) -> int:
    remote_mkdir_p(sftp, remote)
    count = 0
    for item in local.iterdir():
        rpath = f"{remote}/{item.name}"
        if item.is_dir():
            count += upload_dir(sftp, item, rpath)
        else:
            sftp.put(str(item), rpath)
            count += 1
    return count


def detect_service(client: paramiko.SSHClient) -> str | None:
    if SERVICE:
        return SERVICE
    for name in SERVICE_CANDIDATES:
        rc, _, _ = ssh_exec(client, f"systemctl status {name} --no-pager -n 0", timeout=15)
        if rc in (0, 3):  # 0 active, 3 inactive — both mean unit exists
            step(f"detected systemd unit: {name}")
            return name
    return None


# ─── Main ───────────────────────────────────────────────────────────────────

def main():
    banner(f"Connecting to {USER}@{HOST}")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        HOST, username=USER, password=PWD, timeout=20,
        allow_agent=False, look_for_keys=False,
    )
    sftp = client.open_sftp()

    # 1. Upload backend files
    banner("Uploading backend files")
    backend_uploaded = 0
    for rel in BACKEND_FILES:
        local = BASE / rel
        remote = f"{REMOTE_BACKEND}/{rel.removeprefix('backend/')}"
        n = upload_file(sftp, local, remote)
        if n:
            print(f"    ✓ {rel}")
            backend_uploaded += n
    print(f"  uploaded {backend_uploaded} backend file(s)")

    # 2. Upload frontend dist
    if LOCAL_FRONTEND_DIST.exists():
        banner(f"Uploading frontend dist ({LOCAL_FRONTEND_DIST})")
        # Wipe remote dist first to avoid stale chunks
        ssh_exec(client, f"rm -rf {REMOTE_FRONTEND_DIST}/* {REMOTE_FRONTEND_DIST}/.[!.]*", timeout=15)
        n = upload_dir(sftp, LOCAL_FRONTEND_DIST, REMOTE_FRONTEND_DIST)
        print(f"  uploaded {n} frontend asset(s)")
    else:
        print(f"  WARN: {LOCAL_FRONTEND_DIST} not found — run `npx vite build` first")

    # 3. Install pdfplumber (and any other new requirements)
    banner("Installing requirements (pip)")
    rc, o, e = ssh_exec(
        client,
        f"cd {REMOTE_BACKEND} && (. venv/bin/activate || . .venv/bin/activate) && "
        f"pip install -q -r requirements.txt 2>&1 | tail -5",
        timeout=300,
    )
    print(f"    {o or '(no output)'}")
    if rc != 0:
        print(f"    pip exited {rc}: {e}")

    # 4. Run alembic migration
    banner("Running alembic upgrade head")
    rc, o, e = ssh_exec(
        client,
        f"cd {REMOTE_BACKEND} && (. venv/bin/activate || . .venv/bin/activate) && "
        f"alembic upgrade head 2>&1",
        timeout=60,
    )
    for line in (o + "\n" + e).splitlines()[-12:]:
        print(f"    {line}")

    # 5. Create upload dir
    banner("Ensuring KSEI upload directory exists")
    ssh_exec(client, "mkdir -p /tmp/tradevelix_ksei && chmod 755 /tmp/tradevelix_ksei", timeout=10)
    print("    ✓ /tmp/tradevelix_ksei")

    # 6. Restart service
    banner("Restarting backend service")
    service = detect_service(client)
    if not service:
        print("  ERROR: could not detect systemd unit; tried:", ", ".join(SERVICE_CANDIDATES))
        print("  Set VPS_SERVICE env var to your service name and re-run, or restart manually.")
    else:
        rc, o, e = ssh_exec(client, f"sudo -n systemctl restart {service} 2>&1", timeout=30)
        if rc != 0:
            print(f"    sudo -n failed (passwordless sudo not configured?): {o or e}")
            print(f"    Try manually:  ssh {USER}@{HOST} 'sudo systemctl restart {service}'")
        else:
            print(f"    ✓ restarted {service}")

        # 7. Tail logs
        banner(f"Last 20 lines of journalctl for {service}")
        rc, o, e = ssh_exec(client, f"sudo -n journalctl -u {service} -n 20 --no-pager 2>&1", timeout=15)
        for line in (o or e).splitlines():
            print(f"    {line}")

    sftp.close()
    client.close()
    banner("Done")
    print("  Verify: open /admin → System tab. After the next API call (trigger any sync),")
    print("  the per-key bars will populate from the X-RateLimit headers.")


if __name__ == "__main__":
    main()
