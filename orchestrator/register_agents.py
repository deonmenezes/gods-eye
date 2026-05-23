"""One-time agent registration.

Reads agents/threat_analyst/ (AGENTS.md + skills/*/SKILL.md), creates one
Managed Agent per camera via the Antigravity Managed Agents API, and writes
the resulting agent_id back into data/cameras.json.

Skipped in stub mode (agent_ids are synthesized at runtime).
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-5s %(message)s")
log = logging.getLogger("register_agents")

AGENT_FOLDER = ROOT / "agents" / "threat_analyst"
CAMERAS_PATH = ROOT / "data" / "cameras.json"


def _collect_markdown() -> dict:
    bundle = {"AGENTS.md": (AGENT_FOLDER / "AGENTS.md").read_text()}
    for skill_dir in (AGENT_FOLDER / "skills").iterdir():
        if not skill_dir.is_dir():
            continue
        skill_md = skill_dir / "SKILL.md"
        if skill_md.exists():
            bundle[f"skills/{skill_dir.name}/SKILL.md"] = skill_md.read_text()
    return bundle


def main() -> None:
    mode = os.environ.get("SENTINEL_MODE", "stub")
    cameras = json.loads(CAMERAS_PATH.read_text())

    if mode == "stub":
        for c in cameras:
            c.setdefault("agent_id", f"stub-agent-{c['camera_id']}")
        CAMERAS_PATH.write_text(json.dumps(cameras, indent=2) + "\n")
        log.info("stub mode: synthesized agent_ids for %d cameras", len(cameras))
        return

    try:
        from google import genai  # type: ignore
    except ImportError:
        log.error("google-genai not installed")
        return

    api_key = os.environ.get("GOOGLE_AI_API_KEY")
    if not api_key:
        log.error("GOOGLE_AI_API_KEY not set")
        return

    bundle = _collect_markdown()
    client = genai.Client(api_key=api_key)

    if not hasattr(client, "managed_agents"):
        log.error("managed_agents API not available in this SDK build; remaining in stub mode")
        return

    for c in cameras:
        if c.get("agent_id") and not c["agent_id"].startswith("stub-"):
            continue
        agent = client.managed_agents.create(  # type: ignore[attr-defined]
            display_name=f"sentinel-{c['camera_id']}",
            model=os.environ.get("GEMINI_MODEL", "gemini-2.5-flash"),
            files=bundle,
        )
        c["agent_id"] = agent.id
        log.info("registered %s -> %s", c["camera_id"], agent.id)

    CAMERAS_PATH.write_text(json.dumps(cameras, indent=2) + "\n")
    log.info("done")


if __name__ == "__main__":
    main()
