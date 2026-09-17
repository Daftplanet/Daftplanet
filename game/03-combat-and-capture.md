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

- **×2.5 damage** with lethal rounds.
- **×2.0 Restraint** with capture rounds.
- **Hidden until researched.** At Codex research rank 1 the entry names them; at
  rank 2 the `Tracker Lens` / `Bio-Scanner` sight highlights them live in AR.

This is the strongest pull from the Codex back into moment-to-moment play: research
is not a trophy screen, it is a damage upgrade.

## Restraint — the capture meter

Capture is **not** a random roll. Each capture projectile adds to a Restraint meter
that decays over time. Fill it and the monster is subdued.

```
restraint_gain = ammo_restraint
               × weapon_restraint_rating
               × hit_zone_multiplier        (weak point = ×2.0)
               × status_multiplier          (product of active statuses, capped ×2.5)
               × wound_multiplier           (see below)
               ÷ size_resistance            (see 04 — size classes)

wound_multiplier = 1.0 + 2.0 × (1 − current_hp ÷ max_hp)
```

`wound_multiplier` is the heart of the system. A monster at full health takes
Restraint at ×1.0; one at 10% health takes it at ×2.8. **Softening a target with
lethal rounds first, then swapping to darts, is the intended expert play** — and it
is genuinely risky, because overshooting kills the thing you wanted.

### Restraint decay

```
decay_rate = 4.0 + (0.35 × species_tier) Restraint/second
```

Decay pauses entirely while the target is `Sedated` or `Anchored`. Stop shooting a
Colossus for six seconds and you start over; that is the pressure.

### The subdue threshold

```
restraint_required = species_base_restraint × size_multiplier × (1 + 0.15 × evolution_stage)
```

When Restraint ≥ `restraint_required`, the monster collapses into a **Subdued**
state lasting 5 seconds. Tap it in that window to tag it. Miss the window and it
recovers at 50% Restraint and is now `Enraged`.

That 5-second tap is the only twitch moment in the capture flow, and it is
deliberately generous — the game is played while walking.

## Status effects

| Status | Source | Effect | Restraint multiplier |
| --- | --- | --- | --- |
| `Sedated` | Tranq ×3, Heavy Sedative ×1 | Slows monster 50%, **halts Restraint decay** | ×1.8 |
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
flee_chance_per_second = skittishness × (1 − restraint ÷ restraint_required)
```

So a half-filled Restraint meter halves the flee chance. Committing to a capture
actively holds the monster in place, which is a nice bit of self-reinforcing design.

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
