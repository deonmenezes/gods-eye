# incident_report

## Purpose
Produce the single canonical output of an agent run. This skill always "fires" — it writes `/outputs/incident.json` summarizing the run.

## Output schema (`/outputs/incident.json`)

```jsonc
{
  "incident_id": "string, uuidv4",
  "camera_id": "string, copied from camera_meta.json",
  "agent_id": "string, copied from camera_meta.json",
  "clip_uri": "string, path or URL of the analyzed clip",
  "clip_hash": "string, sha256 of the clip bytes",
  "scene_summary": "string, one-paragraph description of what is in the clip",
  "findings": [
    {
      "name": "weapon_detection | loitering | forced_entry",
      "fired": true,
      "confidence": 0.0,
      "evidence_timestamps": ["mm:ss.fff"],
      "notes": "optional string"
    }
  ],
  "severity": "info | low | medium | high | critical",
  "severity_reasoning": "string, why this severity after rules applied",
  "requires_human_review": false,
  "recommended_action": "log | notify | dispatch",
  "routing_target": "string, e.g. 'site_channel:store_42' or 'pagerduty:onsite' (optional)",
  "trace": [
    {"t_ms": 0, "event": "sandbox_init"},
    {"t_ms": 0, "event": "input_mount", "detail": {"clip_uri": "..."}},
    {"t_ms": 0, "event": "skill_evaluated", "detail": {"name": "weapon_detection", "fired": false}},
    {"t_ms": 0, "event": "severity_computed", "detail": {"severity": "info"}},
    {"t_ms": 0, "event": "routing_decided", "detail": {"recommended_action": "log"}},
    {"t_ms": 0, "event": "sandbox_terminate"}
  ],
  "notes": "string, optional, free-form caveats"
}
```

## Validation before write

- `findings[]` must contain one entry per skill evaluated (fired or not), excluding `incident_report` itself.
- `severity` must reflect the rule application in `AGENTS.md`, not the raw skill-local severity.
- `recommended_action` must agree with severity per the table in `AGENTS.md`.
- `trace[]` must have at least: `sandbox_init`, `input_mount`, one `skill_evaluated` per skill, `severity_computed`, `routing_decided`, `sandbox_terminate`.

## Status mapping (for the broker, informational)

| `severity` | pin color |
| --- | --- |
| `critical`, `high` | red |
| `medium`, `low` | yellow |
| `info` | green |

## Write

Write the JSON atomically (write to `/outputs/incident.json.tmp` then `os.rename`). Pretty-print with 2-space indent for human auditability.
