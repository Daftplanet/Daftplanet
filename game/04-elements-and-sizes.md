# 04 — Elements & Size Classes

## The eight elements

Plus **Rift**, which is not a normal element — it belongs to things that came
through wrong.

| Element | Feel | Signature status | Common biome |
| --- | --- | --- | --- |
| **Ember** | Heat, ash, slow burn | `Burning` | Industrial, urban heat islands |
| **Tide** | Water, brine, pressure | `Chilled` | Rivers, coast, rain |
| **Verdant** | Growth, rot, roots | `Bleeding` | Parks, woodland, gardens |
| **Stone** | Mass, armour, patience | armour bonus | Construction, quarries, hills |
| **Gale** | Wind, speed, distance | knockback | Open ground, high places, bridges |
| **Volt** | Charge, arcs, noise | `Stunned` | Powerlines, rail, dense urban |
| **Gloom** | Shadow, dread, absence | fear / accuracy loss | Night, tunnels, alleys |
| **Lumen** | Light, clarity, exposure | reveals stealth | Daylight, landmarks, open squares |
| **Rift** | Wrongness | unpredictable | Rift events only |

Elements do three jobs: they drive the type chart, they gate which crafting
materials drop, and they decide where and when a species spawns.

## Type chart

Rows are the **attacker's** element (from the ammo or the monster's attack), columns
are the **defender's**. Values multiply damage and are applied to Restraint too.

| ATK ↓ / DEF → | Ember | Tide | Verdant | Stone | Gale | Volt | Gloom | Lumen |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Ember** | 0.5 | 0.5 | **2.0** | 0.5 | 1.0 | 1.0 | **2.0** | 1.0 |
| **Tide** | **2.0** | 0.5 | 0.5 | **2.0** | 1.0 | 1.0 | 1.0 | 1.0 |
| **Verdant** | 0.5 | **2.0** | 0.5 | **2.0** | 0.5 | 1.0 | 1.0 | 1.0 |
| **Stone** | 1.0 | 1.0 | 0.5 | 1.0 | **2.0** | **2.0** | 1.0 | 1.0 |
| **Gale** | 1.0 | 1.0 | **2.0** | 0.5 | 0.5 | 0.5 | **2.0** | 1.0 |
| **Volt** | 1.0 | **2.0** | 0.5 | 0.5 | **2.0** | 0.5 | 1.0 | 1.0 |
| **Gloom** | 0.5 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 0.5 | **2.0** |
| **Lumen** | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 | **2.0** | 0.5 |

### Structure behind it

Two rings and a duel, so it is learnable without a lookup table:

- **Ring A:** Ember → Verdant → Tide → Ember
- **Ring B:** Stone → Volt → Gale → Stone
- **Cross-links:** Tide → Stone, Verdant → Stone, Volt → Tide, Gale → Verdant
- **The duel:** Gloom ⇄ Lumen, mutually ×2.0. No defence, both sides hit hard —
  fights between them are short and swingy, which suits the theme.
- **Ember → Gloom ×2.0** and **Gale → Gloom ×2.0** give Gloom a real weakness so it
  isn't oppressive at night.

**Rift** is deliberately outside the chart: everything hits Rift for ×1.0, and Rift
hits everything for ×1.25. It cannot be countered, only out-played.

### Dual-element monsters

A monster with two elements multiplies both columns. A Tide/Gale monster hit by a
Volt round takes `2.0 × 2.0 = 4.0`. Dual-typing is therefore a **liability as often
as a strength**, and we use it to make otherwise-brutal high-tier species tractable
for a prepared Warden.

## Size classes

Size is the single biggest driver of how a fight feels. It sets hitbox, HP band,
Restraint requirement, and whether you need a Harpoon at all.

| Class | Height | HP band | Restraint × | `size_resistance` | Anchor required | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| **Mote** | 0.2–0.5 m | 40–90 | ×0.6 | 0.7 | No | Tiny, fast, hard to *hit*, easy to hold |
| **Whelp** | 0.5–1.2 m | 90–220 | ×0.8 | 0.85 | No | The common early-game body |
| **Strider** | 1.2–2.5 m | 220–520 | ×1.0 | 1.0 | No | The baseline. Most stage-2 monsters |
| **Brute** | 2.5–5 m | 520–1,100 | ×1.6 | 1.5 | No | Needs softening before darts land |
| **Colossus** | 5–12 m | 1,100–3,000 | ×2.4 | 2.2 | **Yes** | Group content. Multi-phase |
| **Titan** | 12 m+ | 3,000+ | ×4.0 | 3.5 | **Yes** | Apex only. Scheduled rift events |

`size_resistance` divides Restraint gain (see [03](03-combat-and-capture.md)). Note
that Motes are *easier* to restrain but harder to land shots on — the scattergun and
the Lattice Launcher exist largely for them.

### Size and AR presentation

Practical constraint worth designing around now: a Titan rendered at true scale does
not fit in a phone camera frame at the distances people actually stand. Rules:

- Mote → Strider render at **1:1 scale**, placed on the detected ground plane.
- Brute renders at 1:1 but auto-backs the virtual camera to 8 m.
- Colossus and Titan render at **1:2.5 scale** in AR mode, or full scale in the
  non-AR "field view" (a stylised 3D arena). Field view is the default for apexes.

Never force a player to physically walk backwards to see a boss. That is how people
step into roads.
