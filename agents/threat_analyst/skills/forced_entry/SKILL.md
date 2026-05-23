# forced_entry

## Purpose
Detect attempts to defeat a physical barrier — door, window, gate, vehicle, ATM faceplate — by force or tool.

## Fires when
At least one of the following is observed:
- Repeated impacts on a door, lock, or window (kick, shoulder, hammer, crowbar).
- Tool insertion at a lock, hinge, or seam (lock-pick, screwdriver, pry bar).
- Glass breakage with a subject reaching through the opening.
- Vehicle window smash or door-handle defeat (jiggler, slim-jim).
- ATM faceplate prying or skimmer installation with visible tools.

## Does not fire on
- Maintenance work with appropriate gear and uniformed personnel.
- A subject using a key that visibly does not work, with no escalation to tools.
- Couriers operating standard delivery latches.

## Confidence guidance
- ≥ 0.85 — visible tool in contact with the barrier and resulting damage / opening.
- 0.7–0.85 — tool visible and used but no clear damage yet.
- 0.6–0.7 — suspicious manipulation, ambiguous tool.
- < 0.6 — record but expect downgrade.

## Skill-local severity
If fired, contributes severity `high`. Raises to `critical` if combined with `weapon_detection` firing.

## Evidence
Return `evidence_timestamps[]` for the most diagnostic frames (tool first visible, impact, opening achieved).
