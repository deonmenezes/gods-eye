# loitering

## Purpose
Detect a subject lingering near a target of interest (ATM, doorway, vehicle, storefront) without a clear purpose, in a way that exceeds normal pedestrian behavior for the camera's `zone_type`.

## Fires when
All of the following hold:
- A subject is stationary or within a small radius (≈3 m) for the majority of the clip.
- Their orientation suggests observation of a target (head turned toward ATM/door/vehicle, repeated glances).
- Behavior is inconsistent with `expected_activity` for the zone and `time_of_day`.

## Does not fire on
- Subjects waiting in a clearly marked queue.
- Smoking areas, bus stops, designated waiting zones.
- Pedestrians stopped briefly for phone use or to consult a map.

## Confidence guidance
- ≥ 0.8 — clear casing behavior (repeated head turns, hand near pocket near ATM at night).
- 0.6–0.8 — lingering with ambiguous intent.
- < 0.6 — likely false positive; rely on downgrade rule.

## Skill-local severity
If fired, contributes severity `low` by default; raise to `medium` if combined with `time_of_day = night` AND `zone_type ∈ {atm, parking, alley, retail_after_hours}`.

## Evidence
Return `evidence_timestamps[]` marking the moments of clearest casing behavior.
