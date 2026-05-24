# assault

## Purpose
Detect a physical altercation between subjects — pushing, grabbing, striking, or wrestling. The actor and victim may be hard to distinguish initially.

## Fires when
At least one of the following is observed:
- Two or more subjects in physical contact in a way inconsistent with a hug or playful interaction (pushing, shoving, grabbing clothing aggressively).
- A subject striking another subject (punching, slapping, kicking).
- A subject restraining another against their will (chokehold, headlock, pinning).
- A subject being forcefully dragged or pulled by another.

## Does not fire on
- Hugs, handshakes, friendly contact between people who appear to know each other.
- Sports activity or rehearsal contexts.
- Medical or law-enforcement responders restraining someone (uniformed, in a clear official context).
- Crowd-pressure incidents where contact is incidental (use the crowd-related judgement instead).

## Confidence guidance
- ≥ 0.85 — clear and sustained altercation with multiple aggressive contacts.
- 0.7–0.85 — brief altercation, single push or grab.
- 0.6–0.7 — ambiguous contact that could be horseplay or argument escalation.
- < 0.6 — record but expect the global downgrade rule.

## Skill-local severity
If fired, contributes severity `high`. Combined with `weapon_detection` → `critical` (multi-skill escalation).

## Evidence
Return `evidence_timestamps[]` marking the moments of clearest aggressive contact.
