# theft_in_progress

## Purpose
Detect active theft — concealment of merchandise, snatching property from a person, removing items from a vehicle after a break-in, or running with goods that aren't theirs.

## Fires when
At least one of the following is observed:
- Subject inside a retail space conceals an item (slides it under clothing, into a bag without paying) and moves toward an exit.
- Subject swiftly grabs a bag, phone, or other item from another person and flees the scene.
- Subject reaches into an opened vehicle (window smashed or door forced) and removes items.
- Subject carries away large items from a property without consistent ownership cues (no receipt, no employee uniform, sneaky body language).

## Does not fire on
- Customers paying for items at the register before leaving.
- People retrieving their own belongings from their own vehicle.
- Couriers and delivery personnel handling parcels with appropriate uniforms or branded equipment.
- Children playfully grabbing things from family members.

## Confidence guidance
- ≥ 0.85 — clear theft act + flight (concealment + run, or grab + run).
- 0.7–0.85 — single diagnostic act (e.g. concealment without flight visible).
- 0.6–0.7 — suspicious manipulation of merchandise with ambiguous intent.
- < 0.6 — record but expect the global downgrade rule.

## Skill-local severity
If fired, contributes severity `high`. Combined with `forced_entry` → `critical`.

## Evidence
Return `evidence_timestamps[]` for the concealment / grab moment and the flight moment.
