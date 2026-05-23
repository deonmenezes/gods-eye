# Sentinel

Global security surveillance command center where every part of the loop is AI:

- **Interface** — Google Photorealistic 3D Tiles. The operator orbits a real Earth and sees camera pins anchored to real lat/lon.
- **Footage** — Veo 3.1 generates synthetic CCTV clips. No real footage in v0.
- **Detection** — One Gemini Managed Agent per camera, each running in its own ephemeral Linux sandbox via the Antigravity harness.

Pins are **red** (active crime), **yellow** (suspicious), or **green** (clear), driven by per-camera agent output. Click a pin to see the Veo clip, the agent's reasoning trace, and the recommended action.

---

## Quick start (stub mode, no API keys required)

```bash
cp .env.example .env       # defaults already work for stub mode
./run.sh                   # boots broker + orchestrator
# then open http://127.0.0.1:8000
```

The 8 San Francisco demo cameras start flipping between red/yellow/green within a few seconds. Click any pin to open the detail panel.

## Wiring real Google APIs

1. Edit `.env`:
   ```
   GOOGLE_MAPS_API_KEY=...   # Map Tiles API + Maps JavaScript API
   GOOGLE_AI_API_KEY=...     # Gemini + Veo
   SENTINEL_MODE=real
   ```
2. In Google Cloud Console: enable **Map Tiles API**, **Maps JavaScript API**, and the **Generative Language API** for the project. Add an HTTP-referrer restriction to the Maps key (e.g. `http://localhost:8000/*`).
3. `python -m orchestrator.register_agents` (one-time) — registers one Managed Agent per camera from `agents/threat_analyst/`.
4. `./run.sh` — now drives Veo + the per-camera agents end-to-end.

> **API drift caveat.** Managed Agents and Veo 3.1 are in preview. The runner falls back to stub mode automatically if the SDK shape doesn't match.

## Repo layout

```
sentinel/
  orchestrator/
    main.py            # tick loop: scenario -> Veo -> agent -> broker
    veo_client.py      # Veo 3.1 with scenario-hash cache
    agent_runner.py    # Managed Agents interaction runner (+ stub)
    register_agents.py # one-time per-camera agent registration
    severity.py        # severity rules from AGENTS.md, kept testable
  earth/
    index.html         # Photorealistic 3D Tiles command center
    app.js             # pins + SSE + detail panel
    styles.css
  agents/threat_analyst/
    AGENTS.md
    skills/
      weapon_detection/SKILL.md
      loitering/SKILL.md
      forced_entry/SKILL.md
      incident_report/SKILL.md
  broker/
    server.py          # FastAPI + SSE + static earth/
  scenarios/
    scenarios.json
  data/
    cameras.json
  tests/
    test_severity.py   # unit tests for severity rules
    test_smoke.py      # end-to-end stub smoke test
```

## How the loop works

1. **Scheduler** picks a camera and a scenario from `scenarios/scenarios.json`.
2. **Veo client** generates (or returns cached) 8s 16:9 CCTV clip for the scenario+camera pair. Cache key is `sha256(scenario_id + zone + narrative + camera_zone)[:16]`.
3. **Agent runner** calls `managed_agents.interactions.create(agent_id=camera.agent_id, inputs=[clip, camera_meta])`. The Antigravity harness provisions an ephemeral sandbox, the agent applies its skills, writes `/outputs/incident.json`, sandbox terminates.
4. **Status broker** receives the incident, derives `red|yellow|green` from `severity`, pushes a `status` event over SSE.
5. **Earth canvas** repaints the pin and (if open) the detail panel.

## Severity rules (encoded in `agents/threat_analyst/AGENTS.md`)

- Base severity = highest individual fired-skill severity.
- 2+ skills fire → severity +1 (cap critical).
- `weapon_detection` fires with `confidence ≥ 0.8` → severity ≥ `high`.
- Any fired finding with `confidence < 0.6` → severity −1 and `requires_human_review = true`.

`tests/test_severity.py` validates all of these — run `python -m tests.test_severity`.

## Tests

```bash
python -m tests.test_severity     # rule unit tests
python -m tests.test_smoke        # end-to-end stub smoke (broker + orchestrator)
```

## Security notes

- `.env` is gitignored. Real keys never enter the repo.
- Restrict the Maps key by HTTP referrer and API set in Google Cloud Console.
- Restrict the AI key by IP/service account once you move out of localhost.
- All Veo clips are tagged `mode: stub|real` in their cache meta; production audits should ingest those tags.

## Milestones (per PRD)

| | Scope | Status |
|---|---|---|
| **M0** | Agent folder + orchestrator + end-to-end on one Veo clip | ✅ stub mode end-to-end, real-mode wiring in place |
| **M1** | 3D Tiles loaded, 1 city, 8 pins, static detail panel | ✅ |
| **M2** | Live status broker + SSE, 16 cities, 100+ cameras | partial — broker + SSE shipped; expand `data/cameras.json` |
| **M3** | PagerDuty + Slack, 500-camera load test, cost measured | not started |
| **M4** | First external design partner | not started |
