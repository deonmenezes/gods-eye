# weapon_detection

## Purpose
Detect a visible weapon being carried, drawn, or pointed by any subject in the clip.

## Fires when
At least one of the following is visible in at least one frame:
- A firearm (handgun, rifle, shotgun) held, drawn, holstered, or pointed.
- A knife with blade exposed and held in a grip consistent with intent.
- A blunt weapon (bat, pipe, crowbar) held in a swinging or threatening pose.

## Does not fire on
- Holstered law-enforcement sidearms on uniformed officers.
- Tools being used for their intended purpose (e.g. utility knife cutting a box).
- Toys, replicas obviously identified as such, or props in clearly marked contexts.

## Confidence guidance
- ≥ 0.9 — weapon clearly visible, in hand, multiple frames.
- 0.7–0.9 — weapon visible briefly or partially occluded.
- 0.6–0.7 — silhouette consistent with a weapon but inconclusive.
- < 0.6 — record but expect the global downgrade rule to apply.

## Skill-local severity
If fired, this skill contributes severity `high`. The agent-level rules (multi-skill escalation, weapon override at ≥ 0.8, low-confidence downgrade) apply on top.

## Evidence
Return `evidence_timestamps[]` as `mm:ss.fff` offsets from clip start where the weapon is most visible.
