# 03 — Combat & Capture

## Encounter flow

```
SPOTTED ──► APPROACH ──► ENGAGE ──► resolve
   │            │            ├── monster HP → 0        = CULLED
   │            │            ├── Restraint → full      = SUBDUED → tag → CATALOGUED
   │            │            ├── flee timer expires    = ESCAPED
   │            └── stealth window      └── Warden downed = DRIVEN OFF (no penalty but lost spawn)
   └── silhouette only until scanned
```

The **approach** phase is where the bow earns its keep. Monsters have an awareness
cone and a noise threshold; open with a silent weapon and you get a free
**Ambush** multiplier (×1.8 damage, ×1.5 Restraint) on the first projectile.

Firing anything louder than `silent` alerts a monster within earshot the moment you
pull the trigger — before the round lands. So a loud weapon never earns Ambush,
which is precisely what the Sylvan Bow is paying for with its one-arrow magazine.

## Damage

```
damage = base_damage
       × ammo_multiplier
       × element_multiplier      (see 04 — type chart, 0.5 / 1.0 / 2.0)
       × hit_zone_multiplier     (body 1.0, limb 0.7, weak point 2.5)
       × (1 - armour_reduction)  (Piercing rounds halve armour_reduction)
       × ambush_multiplier       (1.8 on an unaware target, else 1.0)
```

`armour_reduction` is a per-species 0.0–0.6 value. Stone-element monsters sit at the
top of that band, which is what makes Piercing rounds worth a slot.

## Weak points

Every species has 1–3 weak points — a Cragback's cracked shoulder plate, a
Tempestrix's eye, a Rotmatron's exposed gill cluster. They are:

- **×2.5 damage** with lethal rounds (a weapon's own `crit_multiplier` overrides this).
- **×2.0 Restraint** with capture rounds.
- **Hidden until researched.** At Codex research rank 1 the entry names them; at
  rank 2 the `Tracker Lens` / `Bio-Scanner` sight highlights them live in AR.

This is the strongest pull from the Codex back into moment-to-moment play: research
is not a trophy screen, it is a damage upgrade.

## Restraint — the capture meter

Capture is **not** a random roll. Each capture projectile adds to a Restraint meter
that decays over time. Fill it and the monster is subdued.

```
restraint_gain = weapon_base_restraint
               × ammo_restraint_multiplier
               × hit_zone_multiplier        (weak point = ×2.0)
               × status_multiplier          (product of active statuses, capped ×2.5)
               × wound_multiplier           (see below)
               ÷ size_resistance            (see 04 — size classes)

wound_multiplier = 1.0 + 2.0 × (1 − current_hp ÷ max_hp) ^ 1.8
```

`wound_multiplier` is the heart of the system. A monster at full health takes
Restraint at ×1.0; one at 10% health takes it at ×2.66.

The **exponent** is what gives the chamber swap a gradient. Ramped linearly, the
difference between darting at 50% health and at 30% was 2.0 against 2.4 — too small
to be a decision, and "wound it halfway then dart" ended up costing the same per
capture as wounding it deeply while never risking the flee threshold. It strictly
dominated. Curved, softening further is genuinely cheaper and genuinely riskier. **Softening a target with
lethal rounds first, then swapping to darts, is the intended expert play** — and it
is genuinely risky, because overshooting kills the thing you wanted.

### Restraint decay

```
decay_rate = (4.0 + 0.35 × species_tier)
           × status_decay_multiplier
           × lerp(0.6 at 0% HP → 1.4 at full HP)
```

Decay also **scales with the target's health**: a healthy monster shakes off
sedative faster than a wounded one, which is the second half of why darting from
full is the hard road.

Decay pauses entirely while the target is `Anchored`, and drops to ×0.35 while it is
`Sedated`. Stop shooting a Colossus for six seconds and you start over; that is the
pressure. Sedation buys you time, it does not stop the clock — an early prototype
build where it did made darting a full-health monster the dominant strategy.

### The subdue threshold

```
restraint_required = species_base_restraint
                   × size_multiplier
                   × (1 + 0.15 × evolution_stage)
                   × restraint_required_scale      (global, currently 3.0)
```

`restraint_required_scale` converts between the weapon `RES` ladder and the species
`base_restraint` ladder, which were authored independently. It is the one global dial
for how long every capture in the game takes.

When Restraint ≥ `restraint_required`, the monster collapses into a **Subdued**
state lasting 5 seconds. Tap it in that window to tag it. Miss the window and it
recovers at 50% Restraint and is now `Enraged`.

That 5-second tap is the only twitch moment in the capture flow, and it is
deliberately generous — the game is played while walking.

## Status effects

| Status | Source | Effect | Restraint multiplier |
| --- | --- | --- | --- |
| `Sedated` | Tranq ×3, Heavy Sedative ×1 | Slows monster 50%, **Restraint decay ×0.35** | ×1.8 |
| `Ensnared` | Net Shell, Snare Grenade | Cannot move or flee, can still attack | ×1.5 |
| `Stunned` | Arcbrand 3rd chain hit | No actions for 2 s | ×1.3 |
| `Anchored` | Anchor Tether | Colossus/Titan held in place, halts decay | ×1.4 |
| `Chilled` | Cryo Round | −40% move speed | ×1.2 |
| `Burning` | Incendiary | 8 dmg/s for 6 s | ×0.9 |
| `Bleeding` | Broadhead | 5 dmg/s for 8 s | ×1.0 |
| `Enraged` | Failed subdue, loud damage | +40% damage dealt, will not flee | **×0.6** |
| `Calmed` | Lullaby Bolt | Will not flee for 10 s | ×1.1 |

Statuses multiply together and the product is **capped at ×2.5**, so stacking
everything is good but not degenerate. Note `Burning` and `Enraged` are *penalties*
to capture — fire is a culling tool, and making a monster angry makes it harder to
take alive.

## Flee behaviour

Every species has a `flee_threshold` (a fraction of max HP) and a `skittishness`
rating. On dropping below the threshold, the monster rolls to flee each second:

```
flee_chance_per_second = skittishness × flee_chance_scale × (1 − restraint ÷ restraint_required)
flee_speed             = species_speed × (0.85 + 0.5 × current_hp ÷ max_hp)
```

So a half-filled Restraint meter halves the flee chance. Committing to a capture
actively holds the monster in place, which is a nice bit of self-reinforcing design.

A fleeing monster **limps in proportion to its wounds**. At the flee threshold it
still outruns you; at single-digit health it does not. Without this, a monster that
decided to run was simply gone — a coin flip with no counterplay — and roughly a
quarter of straightforward culls ended in nothing. Letting the player run down
something they have nearly killed fixed that without blunting the flee roll itself,
which is why `flee_chance_scale` exists but sits at a neutral **1.0**.

`Ensnared`, `Anchored` and `Calmed` set flee chance to zero outright.

## Aggression and threat

Monsters are rated `Passive`, `Skittish`, `Territorial`, or `Aggressive`.

- **Passive / Skittish** will not attack unless cornered. The danger is losing them.
- **Territorial** attacks if you are inside its radius. Keep your distance and it
  ignores you — which is what makes the Longtooth and the bow strong here.
- **Aggressive** closes on sight. Culling is often just the correct call.

Warden health is a shared pool that regenerates between encounters. Being downed
costs you the spawn and a small Essence fee — never items, never Codex progress.
Losing to a monster should be annoying, not punishing.

## Multi-capture

A `Snare Grenade` that catches three monsters lets you subdue all three, but the
tag window is still 5 seconds total — you physically cannot tap three. The intent is
that **group play** solves this: one Warden snares, the others tag. This is the
main mechanical reason for Expedition sessions to exist.

## Apex encounters

Apex monsters (Titan class, see [05](05-bestiary.md)) break the normal rules:

- Multi-phase, with armour that must be broken off before weak points appear.
- Require an `Anchored` state to capture at all — so a Tether Harpoon must be in
  the group.
- Scale to party size (1–8 Wardens).
- **Cannot be culled and catalogued in the same fight by the same Warden** — the
  choice is final and public on the leaderboard.
