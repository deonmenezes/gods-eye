#!/usr/bin/env bash
# Launch broker + orchestrator together. Ctrl-C stops both.
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "[sentinel] .env not found — copying from .env.example"
  cp .env.example .env
fi

if [ ! -d .venv ]; then
  echo "[sentinel] creating venv"
  python3 -m venv .venv
fi

# shellcheck disable=SC1091
source .venv/bin/activate
python -m pip install --quiet -r requirements.txt

python -m orchestrator.register_agents

echo "[sentinel] starting broker on http://127.0.0.1:8000"
uvicorn broker.server:app --host 127.0.0.1 --port 8000 --log-level warning &
BROKER_PID=$!

cleanup() {
  echo
  echo "[sentinel] shutting down"
  kill $BROKER_PID 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

# Give the broker a beat to bind.
sleep 1

echo "[sentinel] starting orchestrator"
python -m orchestrator.main
