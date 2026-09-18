# 05 — Bestiary

**43 species:** 12 families of 3 stages, 4 branch evolutions, 3 apexes.

## How to read a stat block

| Field | Meaning |
| --- | --- |
| **HP / ATK** | Base health and attack at species level 1 |
| **ARM** | Armour reduction, 0.0–0.6. Piercing rounds halve it |
| **SPD** | Movement speed, 1–10 |
| **RES** | Base Restraint required, before size and stage multipliers |
| **SKT** | Skittishness, 0.0–1.0. Drives flee chance |
| **FLEE** | Fraction of max HP at which it starts trying to run |
| **Rarity** | Common / Uncommon / Rare / Very Rare / Apex |

Aggression is one of `Passive`, `Skittish`, `Territorial`, `Aggressive`.

---

## 01 — Cinder family · Ember

Ash-furred pack canids. They nest in warm concrete: substations, laundromat vents,
the south face of a car park. The pups are friendly right up until they aren't.

| Stage | Name | Size | HP | ATK | ARM | SPD | RES | SKT | FLEE | Aggression | Weak points | Rarity |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **Sootpup** | Whelp | 120 | 14 | 0.05 | 6 | 40 | 0.6 | 0.35 | Skittish | Muzzle | Common |
| 2 | **Cinderfang** | Strider | 310 | 34 | 0.15 | 7 | 95 | 0.4 | 0.25 | Territorial | Throat, hind joint | Uncommon |
| 3 | **Pyrecrown** | Brute | 720 | 66 | 0.25 | 6 | 190 | 0.2 | 0.15 | Aggressive | Crown vents, chest | Rare |
| 3b | **Ashenreaver** | Brute | 640 | 82 | 0.15 | 8 | 210 | 0.1 | 0.10 | Aggressive | Eyes, spine ridge | Rare |

*Ashenreaver* is the night branch — see [06-evolution.md](06-evolution.md).

## 02 — Slag family · Ember / Stone

Semi-molten lithovores. They eat rubble and excrete glass. Found wherever the ground
has recently been opened: roadworks, foundations, demolition sites.

| Stage | Name | Size | HP | ATK | ARM | SPD | RES | SKT | FLEE | Aggression | Weak points | Rarity |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **Slagmite** | Mote | 85 | 10 | 0.30 | 3 | 30 | 0.3 | 0.20 | Passive | Cooling seam | Common |
| 2 | **Magmaw** | Strider | 440 | 40 | 0.40 | 3 | 120 | 0.15 | 0.15 | Territorial | Open maw, underbelly | Uncommon |
| 3 | **Vulcarne** | Colossus | 1,450 | 95 | 0.55 | 2 | 340 | 0.05 | 0.10 | Aggressive | Vent stacks ×3 | Very Rare |

Vulcarne is the first Colossus most Wardens meet and the reason the Tether Harpoon
exists. Doubly weak to Tide (Ember ×2.0, Stone ×2.0 = ×4.0) — a prepared hunter with
Cryo rounds flips this fight completely.

## 03 — Brine family · Tide

Coil-bodied filter feeders. Follow storm drains inland during heavy rain and beach
themselves in car parks by morning.

| Stage | Name | Size | HP | ATK | ARM | SPD | RES | SKT | FLEE | Aggression | Weak points | Rarity |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **Brinelet** | Mote | 70 | 8 | 0.0 | 5 | 28 | 0.8 | 0.50 | Passive | Bell | Common |
| 2 | **Tidecoil** | Strider | 340 | 36 | 0.10 | 6 | 105 | 0.5 | 0.30 | Skittish | Siphon, eye cluster | Common |
| 3 | **Maelstrix** | Brute | 810 | 70 | 0.20 | 7 | 205 | 0.3 | 0.20 | Territorial | Core, mantle | Rare |

## 04 — Rime family · Tide / Gale

Frost-riding ambushers. They hold still and cold until something walks past. Spawn
rate spikes below 5 °C and in the hour before dawn.

| Stage | Name | Size | HP | ATK | ARM | SPD | RES | SKT | FLEE | Aggression | Weak points | Rarity |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **Frostnib** | Whelp | 100 | 16 | 0.05 | 7 | 38 | 0.7 | 0.40 | Skittish | Breath sac | Uncommon |
| 2 | **Rimeclaw** | Strider | 300 | 44 | 0.15 | 8 | 100 | 0.45 | 0.25 | Territorial | Foreclaws, throat | Uncommon |
| 3 | **Glaciarch** | Brute | 690 | 78 | 0.30 | 6 | 200 | 0.2 | 0.15 | Aggressive | Crest, heart-ice | Rare |
| 3b | **Hoarfell** | Brute | 760 | 70 | 0.40 | 5 | 225 | 0.15 | 0.12 | Territorial | Frost core, shoulder plate | Very Rare |

*Hoarfell* is the temperature branch — slower and far better armoured than a
Glaciarch, and only reachable in real-world sub-zero weather.

Quadruple-weak to Volt. A single Arcbrand burst does what a minute of ball rounds
won't — the clearest teaching example of dual-element liability in the game.

## 05 — Thorn family · Verdant

Ambulatory bramble. Docile, slow, and covered in things that will ruin your hands.
Parks, allotments, overgrown lots, railway embankments.

| Stage | Name | Size | HP | ATK | ARM | SPD | RES | SKT | FLEE | Aggression | Weak points | Rarity |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **Sporelet** | Mote | 65 | 7 | 0.05 | 2 | 25 | 0.5 | 0.45 | Passive | Cap | Common |
| 2 | **Thornhide** | Strider | 380 | 30 | 0.30 | 3 | 110 | 0.25 | 0.20 | Territorial | Root bundle | Common |
| 3 | **Bramblewarden** | Brute | 880 | 58 | 0.45 | 2 | 215 | 0.1 | 0.12 | Territorial | Heartwood, crown | Rare |

## 06 — Myco family · Verdant / Gloom

Fungal colonies wearing an animal shape. What you fight is the fruiting body; the
actual organism is under the pavement and does not care.

| Stage | Name | Size | HP | ATK | ARM | SPD | RES | SKT | FLEE | Aggression | Weak points | Rarity |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **Mycelid** | Mote | 75 | 9 | 0.10 | 3 | 30 | 0.4 | 0.40 | Passive | Stalk | Common |
| 2 | **Blightcap** | Strider | 360 | 38 | 0.20 | 4 | 115 | 0.3 | 0.25 | Territorial | Gill cluster | Uncommon |
| 3 | **Rotmatron** | Brute | 840 | 64 | 0.30 | 3 | 220 | 0.15 | 0.15 | Aggressive | Gill cluster, sac | Rare |
| 3b | **Sporeherald** | Strider | 520 | 72 | 0.10 | 6 | 185 | 0.5 | 0.30 | Skittish | Crown, spore vents | Very Rare |

*Sporeherald* is the capture-method branch — it only appears if the Blightcap was
catalogued with a Rune Arrow.

## 07 — Crag family · Stone

Sedentary armoured grazers. The single most common sight on a construction site and
the reason every Warden eventually crafts Piercing rounds.

| Stage | Name | Size | HP | ATK | ARM | SPD | RES | SKT | FLEE | Aggression | Weak points | Rarity |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **Pebblit** | Mote | 95 | 8 | 0.35 | 2 | 32 | 0.2 | 0.25 | Passive | Underside | Common |
| 2 | **Cragback** | Strider | 480 | 34 | 0.50 | 2 | 125 | 0.1 | 0.15 | Territorial | Cracked shoulder plate | Common |
| 3 | **Obelisc** | Colossus | 1,600 | 88 | 0.60 | 1 | 360 | 0.0 | 0.00 | Territorial | Keystone, base joints | Very Rare |

Obelisc never flees and never pursues. It is a fight you choose, entirely, and can
walk away from at any point — the game's quiet lesson that not every spawn is yours.

## 08 — Gale family · Gale

High-altitude skimmers. Bridges, rooftops, cliff paths, open water. They are the
hardest common family to hit and the easiest to hold once hit.

| Stage | Name | Size | HP | ATK | ARM | SPD | RES | SKT | FLEE | Aggression | Weak points | Rarity |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **Gustling** | Mote | 60 | 11 | 0.0 | 9 | 26 | 0.85 | 0.55 | Skittish | Wing root | Common |
| 2 | **Zephyrax** | Strider | 290 | 42 | 0.05 | 9 | 98 | 0.6 | 0.35 | Skittish | Wing root, keel | Uncommon |
| 3 | **Tempestrix** | Brute | 700 | 84 | 0.10 | 10 | 195 | 0.4 | 0.25 | Aggressive | Eye, storm core | Rare |

## 09 — Volt family · Volt

Charge parasites. They live on infrastructure — substations, rail lines, tram wires
— and their spawn density tracks real-world power draw, which makes city centres
hum with them at 6 pm on a weekday.

| Stage | Name | Size | HP | ATK | ARM | SPD | RES | SKT | FLEE | Aggression | Weak points | Rarity |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **Sparkmite** | Mote | 55 | 13 | 0.0 | 8 | 24 | 0.75 | 0.50 | Skittish | Core | Common |
| 2 | **Voltfang** | Whelp | 210 | 46 | 0.05 | 9 | 85 | 0.5 | 0.30 | Aggressive | Core, jaw coil | Common |
| 3 | **Thunderhelm** | Brute | 660 | 90 | 0.20 | 7 | 190 | 0.25 | 0.18 | Aggressive | Helm seam, core | Rare |
| 3b | **Railmane** | Strider | 480 | 104 | 0.05 | 10 | 175 | 0.35 | 0.22 | Aggressive | Mane nodes | Very Rare |

*Railmane* is the weather branch — evolve a Voltfang during a real-world thunderstorm.

## 10 — Gloom family · Gloom

Night-only. They are not hostile so much as *present*, and they get worse the longer
you look. Alleys, underpasses, tunnels, unlit parks after 22:00.

| Stage | Name | Size | HP | ATK | ARM | SPD | RES | SKT | FLEE | Aggression | Weak points | Rarity |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **Shadelet** | Whelp | 105 | 18 | 0.0 | 7 | 42 | 0.9 | 0.60 | Skittish | None (Lumen reveals) | Uncommon |
| 2 | **Nightmaw** | Strider | 330 | 56 | 0.10 | 8 | 108 | 0.65 | 0.35 | Territorial | Maw interior | Rare |
| 3 | **Umbrakhan** | Colossus | 1,250 | 112 | 0.25 | 7 | 330 | 0.3 | 0.20 | Aggressive | Eye ring ×5 | Very Rare |

Shadelet has **no weak point until illuminated** — a Lumen-element hit or a flare
exposes one for 8 seconds. It is the tutorial for "bring the right tool".

## 11 — Lumen family · Lumen

Daylight creatures, drawn to landmarks and open public squares. Beautiful, brittle,
and very hard to sneak up on because they are already looking at you.

| Stage | Name | Size | HP | ATK | ARM | SPD | RES | SKT | FLEE | Aggression | Weak points | Rarity |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **Glimmerfly** | Mote | 50 | 9 | 0.0 | 8 | 22 | 0.9 | 0.65 | Passive | Wing | Common |
| 2 | **Solafaun** | Strider | 280 | 40 | 0.10 | 8 | 96 | 0.7 | 0.40 | Skittish | Flank, antler base | Uncommon |
| 3 | **Aurelian** | Brute | 750 | 76 | 0.20 | 7 | 210 | 0.45 | 0.25 | Territorial | Halo, chest | Rare |

## 12 — Rift family · Rift

Not from here, and not shaped right. Only spawn inside an active rift event. Immune
to element counterplay — everything hits them for ×1.0 — so they are pure execution.

| Stage | Name | Size | HP | ATK | ARM | SPD | RES | SKT | FLEE | Aggression | Weak points | Rarity |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **Riftspawn** | Whelp | 160 | 30 | 0.10 | 7 | 60 | 0.5 | 0.30 | Aggressive | Seam | Rare |
| 2 | **Voidmaw** | Brute | 820 | 88 | 0.25 | 6 | 240 | 0.3 | 0.20 | Aggressive | Inner ring | Very Rare |
| 3 | **Aeonrend** | Titan | 4,200 | 180 | 0.45 | 5 | 900 | 0.0 | 0.00 | Aggressive | Phase-dependent | Apex |

---

## Apex monsters

Three. Scheduled world events, party content, and the only Titans in the launch set.
All three require an `Anchored` state to capture at all.

### Karrahk, the Sunken Spire · Tide / Stone · Titan

| HP | ATK | ARM | SPD | RES | Phases | Party |
| --- | --- | --- | --- | --- | --- | --- |
| 5,800 | 165 | 0.55 | 3 | 1,100 | 3 | 4–8 |

Surfaces in rivers and flooded ground during storm events. Phase 1 is an armour
break; phase 2 floods the arena and forces high ground; phase 3 exposes the spire
core. Quadruple-weak to Verdant.

### Nyxhollow · Gloom · Colossus

| HP | ATK | ARM | SPD | RES | Phases | Party |
| --- | --- | --- | --- | --- | --- | --- |
| 3,100 | 140 | 0.30 | 8 | 780 | 2 | 2–6 |

Midnight-only. Extinguishes light sources in a radius, blanking your weak-point
overlay; the counter is a Lumen carrier in the party keeping a flare up. Fast, and
the only apex that can genuinely kill a careless solo Warden.

### Aeonrend · Rift · Titan

| HP | ATK | ARM | SPD | RES | Phases | Party |
| --- | --- | --- | --- | --- | --- | --- |
| 4,200 | 180 | 0.45 | 5 | 900 | 4 | 6–8 |

The stage-3 Rift monster, and the endgame. Its weak points move between phases and
its element multiplier is flat ×1.0 in both directions, so no loadout counters it —
only coordination does. First capture on a server is a permanent Codex banner.

---

## Family summary

| # | Family | Element(s) | Stages | Branch | Peak size |
| --- | --- | --- | --- | --- | --- |
| 01 | Cinder | Ember | Sootpup → Cinderfang → Pyrecrown | Ashenreaver | Brute |
| 02 | Slag | Ember/Stone | Slagmite → Magmaw → Vulcarne | — | Colossus |
| 03 | Brine | Tide | Brinelet → Tidecoil → Maelstrix | — | Brute |
| 04 | Rime | Tide/Gale | Frostnib → Rimeclaw → Glaciarch | Hoarfell | Brute |
| 05 | Thorn | Verdant | Sporelet → Thornhide → Bramblewarden | — | Brute |
| 06 | Myco | Verdant/Gloom | Mycelid → Blightcap → Rotmatron | Sporeherald | Brute |
| 07 | Crag | Stone | Pebblit → Cragback → Obelisc | — | Colossus |
| 08 | Gale | Gale | Gustling → Zephyrax → Tempestrix | — | Brute |
| 09 | Volt | Volt | Sparkmite → Voltfang → Thunderhelm | Railmane | Brute |
| 10 | Gloom | Gloom | Shadelet → Nightmaw → Umbrakhan | — | Colossus |
| 11 | Lumen | Lumen | Glimmerfly → Solafaun → Aurelian | — | Brute |
| 12 | Rift | Rift | Riftspawn → Voidmaw → Aeonrend | — | Titan |
