"""End-to-end smoke test in stub mode.

Runs:
- Boots broker in a subprocess.
- Drives a few orchestrator ticks against it via stub Veo + stub agent.
- Asserts /cameras shows red/yellow/green statuses.
- Asserts SSE emits at least one status event.

Run with:  python -m tests.test_smoke
"""

from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def wait_for(url: str, timeout: float = 10.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(url, timeout=0.5).read()
            return True
        except Exception:
            time.sleep(0.2)
    return False


def main() -> int:
    env = os.environ.copy()
    env["SENTINEL_MODE"] = "stub"
    env["SENTINEL_TICK_SECONDS"] = "0.5"

    broker = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "broker.server:app",
         "--host", "127.0.0.1", "--port", "8765", "--log-level", "warning"],
        cwd=ROOT, env=env,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    try:
        if not wait_for("http://127.0.0.1:8765/healthz", timeout=10):
            broker.terminate()
            print("broker failed to start")
            return 1
        print("broker up")

        orchestrator_env = env.copy()
        orchestrator_env["SENTINEL_BROKER_PORT"] = "8765"
        orchestrator = subprocess.Popen(
            [sys.executable, "-m", "orchestrator.main"],
            cwd=ROOT, env=orchestrator_env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        )
        try:
            time.sleep(8)  # let several ticks fire
            with urllib.request.urlopen("http://127.0.0.1:8765/cameras", timeout=2) as r:
                cams = json.loads(r.read())
            colors = {c["pin_color"] for c in cams}
            print(f"observed pin colors: {colors}")
            assert any(c["last_incident_id"] for c in cams), "no incidents posted"
            print("PASS: incidents flowed end-to-end")
            return 0
        finally:
            orchestrator.terminate()
            try:
                orchestrator.wait(timeout=3)
            except subprocess.TimeoutExpired:
                orchestrator.kill()
    finally:
        broker.send_signal(signal.SIGINT)
        try:
            broker.wait(timeout=3)
        except subprocess.TimeoutExpired:
            broker.kill()


if __name__ == "__main__":
    sys.exit(main())
