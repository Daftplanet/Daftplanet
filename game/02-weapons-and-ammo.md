# 02 — Weapons & Ammunition

## The split

A weapon is a **delivery system**. It has no inherent lethality — what it fires
decides that. Every weapon carries two loaded chambers and the player swaps between
them with a single tap (default: long-press the fire button, or a dedicated toggle
on the left thumb).

- **Chamber A — Lethal.** Damage. Kills. Drops materials.
- **Chamber B — Capture.** Builds Restraint. Subdues. Enables tagging.

Swapping has a **0.6 s cost** and cancels any charge. That delay is deliberate: the
moment you realise "this one is rare" should carry a real risk.

Not every weapon accepts every round. A bow cannot fire a net shell; a scattergun
cannot fire a rune arrow. The compatibility grid below is where weapon identity lives.

## Weapon roster

Eight weapons, four tiers. `DMG` is per-projectile lethal damage before modifiers.
`RES` is Restraint per capture projectile before modifiers. `Noise` drives whether a
monster is alerted or enraged (see [03](03-combat-and-capture.md)).

| # | Weapon | Class | Tier | DMG | RES | RPM | Range | Mag | Reload | Noise | Identity |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **Marker Pistol** | Sidearm | 1 | 18 | 14 | 180 | 18 m | 8 | 1.4 s | Med | Starter. Never bad, never best. Fast swap. |
| 2 | **Splitbore** | Scattergun | 2 | 12 ×7 | 9 ×7 | 65 | 9 m | 4 | 2.6 s | High | Close range. Pellets spread Restraint wide. |
| 3 | **Longtooth** | Marksman | 2 | 62 | 30 | 45 | 70 m | 5 | 2.2 s | High | Weak-point sniping. ×2.5 crit multiplier. |
| 4 | **Sylvan Bow** | Bow | 2 | 40 | 34 | 50 | 40 m | 1 | 1.1 s | **Silent** | Never alerts. Draw to charge. Best opener. |
| 5 | **Sting Crossbow** | Crossbow | 3 | 55 | 58 | 28 | 45 m | 2 | 2.9 s | Low | Heavy sedative delivery. The capture specialist. |
| 6 | **Lattice Launcher** | Launcher | 3 | 45 (AoE) | 40 (AoE) | 22 | 30 m | 3 | 3.4 s | High | Area denial. Can snare a whole pack at once. |
| 7 | **Arcbrand Coil** | Coilgun | 3 | 26 chain | 20 chain | 120 | 22 m | 40 cells | 2.0 s | Med | Chains to 3 targets. Applies `Stunned` reliably. |
| 8 | **Tether Harpoon** | Harpoon | 4 | 90 | 25 + anchor | 18 | 35 m | 1 | 4.0 s | Med | **The only way to hold a Colossus or Titan still.** |

### Notes on identity

- **Marker Pistol** is the balance floor. If a new weapon isn't clearly better than
  the pistol at *something*, it doesn't ship.
- **Sylvan Bow** being silent is its whole reason to exist. Skittish species flee on
  noise; the bow lets you open on them at all. It trades magazine size for that.
- **Sting Crossbow** is the dedicated capture tool — highest raw Restraint per shot,
  poor DPS. A capture-focused Warden lives here.
- **Tether Harpoon** is a key, not a gun. Colossus and Titan monsters have an
  `anchor_required: true` flag and simply cannot be subdued without one.

## Ammunition

### Lethal rounds (Chamber A)

| Round | Tier | Effect | Fits |
| --- | --- | --- | --- |
| **Ball Round** | 1 | Baseline. ×1.0 damage. Cheap, craftable from scrap. | 1, 2, 3 |
| **Slug** | 2 | ×1.6 damage, tightens Splitbore to a single projectile. | 2, 3 |
| **Piercing Round** | 2 | Ignores 50% of armour. Poor vs unarmoured. | 1, 3, 8 |
| **Incendiary** | 3 | ×0.8 impact + `Burning` (8 dmg/s, 6 s). Ember-immune. | 2, 3, 6 |
| **Cryo Round** | 3 | ×0.7 impact + `Chilled` (−40% move speed, 5 s). | 1, 3, 6 |
| **Arc Cell** | 3 | Coil ammo. Chains, applies `Stunned` on 3rd hit. | 7 |
| **Broadhead** | 2 | Arrow. ×1.3 damage, causes `Bleeding` (5 dmg/s, 8 s). | 4, 5 |

### Capture rounds (Chamber B)

| Round | Tier | Restraint | Effect | Fits |
| --- | --- | --- | --- | --- |
| **Tranq Dart** | 1 | ×1.0 | The baseline dart. Applies `Sedated` at 3 stacks. | 1, 3, 5 |
| **Heavy Sedative Dart** | 3 | ×1.4 | Applies `Sedated` at 1 stack. Slow projectile, big drop. | 3, 5 |
| **Net Shell** | 2 | ×1.2 | Applies `Ensnared` on hit. Short range only. | 2, 6 |
| **Snare Grenade** | 3 | ×1.1 AoE | `Ensnared` in a 6 m radius. Multi-capture enabler. | 6 |
| **Rune Arrow** | 3 | ×1.5 | Highest per-shot Restraint. Silent. Bonus vs Gloom/Lumen. | 4, 5 |
| **Lullaby Bolt** | 4 | ×0.8 | Suppresses flee behaviour for 10 s. Doesn't enrage. | 4, 5 |
| **Anchor Tether** | 4 | ×1.1 | Applies `Anchored`. Required for Colossus/Titan capture. | 8 |

### Compatibility grid

Rows are weapons, columns are rounds. `L` = lethal chamber, `C` = capture chamber.

| | Ball | Slug | Pierce | Incend | Cryo | Arc | Broad | Tranq | HvySed | Net | Snare | Rune | Lull | Anchor |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **1 Marker Pistol** | L | — | L | — | L | — | — | C | — | — | — | — | — | — |
| **2 Splitbore** | L | L | — | L | — | — | — | — | — | C | — | — | — | — |
| **3 Longtooth** | L | L | L | L | L | — | — | C | C | — | — | — | — | — |
| **4 Sylvan Bow** | — | — | — | — | — | — | L | — | — | — | — | C | C | — |
| **5 Sting Crossbow** | — | — | — | — | — | — | L | C | C | — | — | C | C | — |
| **6 Lattice Launcher** | — | — | — | L | L | — | — | — | — | C | C | — | — | — |
| **7 Arcbrand Coil** | — | — | — | — | — | L | — | — | — | — | — | — | — | — |
| **8 Tether Harpoon** | — | — | L | — | — | — | — | — | — | — | — | — | — | C |

Read the grid as the loadout puzzle it is. The Arcbrand has **no capture round at
all** — it is pure setup, applying `Stunned` so a partner (or your other weapon)
can land the subdue. The Harpoon's only capture round is the Anchor, and it is the
only weapon that fires it.

## Loadout rules

- A Warden carries **two weapons**. This forces a real choice: two lethal profiles,
  two capture profiles, or one of each.
- Each weapon carries **one lethal round type and one capture round type**, chosen
  before leaving the Sanctuary. You cannot carry three kinds of dart.
- Ammo is **finite and crafted**. Lethal rounds are cheap; capture rounds are the
  expensive ones. This is the main reason culling has to keep paying out.
- Weapons have **3 mod slots** (Barrel, Core, Sight) — see below.

## Mods

| Slot | Example mods | Effect band |
| --- | --- | --- |
| **Barrel** | Choke, Long Barrel, Suppressor, Flechette | Range, spread, noise |
| **Core** | Fast Cycle, Extended Cell, Potency Coil, Stabiliser | RPM, mag, Restraint, recoil |
| **Sight** | Scope, Tracker Lens, Bio-Scanner, Thermal | Zoom, weak-point highlight, HP readout |

`Bio-Scanner` deserves a call-out: it shows the target's live **Restraint meter and
flee threshold** instead of a bare health bar. For a capture build it is close to
mandatory, which is exactly why it sits behind Codex research rank 2 rather than
being available at the start.

## Progression

Weapons unlock by **Warden rank** and are then upgraded with materials from culling:

```
Tier 1  Rank 1   Marker Pistol
Tier 2  Rank 4   Splitbore, Longtooth, Sylvan Bow
Tier 3  Rank 9   Sting Crossbow, Lattice Launcher, Arcbrand Coil
Tier 4  Rank 16  Tether Harpoon
```

Each weapon has 5 upgrade levels; a level costs materials that only drop from
species of a matching element, which routes the player back out onto the map to
hunt something specific.
