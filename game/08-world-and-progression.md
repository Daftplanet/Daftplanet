# 08 — World, Spawning & Progression

## Biomes

The map is the real world, classified into biomes from map data (OSM land use,
POI density, elevation, water features). Every tile gets a primary and secondary
biome, and biome drives the spawn table.

| Biome | Derived from | Favours | Suppresses |
| --- | --- | --- | --- |
| **Urban Core** | High POI density, tall buildings | Volt, Gloom, Lumen | Verdant |
| **Industrial** | Warehouses, works, substations | Ember, Volt, Stone | Lumen |
| **Parkland** | Parks, gardens, allotments | Verdant, Lumen | Ember |
| **Waterside** | Rivers, canals, coast, lakes | Tide, Gale | Ember |
| **Woodland** | Forest, dense tree cover | Verdant, Gloom | Volt |
| **Open Ground** | Fields, moor, large open spaces | Gale, Stone | Volt |
| **Works** | Construction, quarries, roadworks | Stone, Ember | Tide |
| **Transit** | Stations, rail, tram, major roads | Volt, Gale | Verdant |
| **Residential** | Housing, low POI density | Mixed, low rate | — |

Residential is deliberately the thinnest table. We do not want the optimal play to be
"stand in someone's front garden".

## Spawn rate modifiers

```
spawn_rate = base_tile_rate
           × biome_multiplier
           × time_of_day_multiplier
           × weather_multiplier
           × season_multiplier
           × event_multiplier
           × warden_bonus          (Gale/Gloom/Lumen residents, gear)
```

### Time of day

| Window | Boost | Suppress |
| --- | --- | --- |
| Dawn 04:00–07:00 | Rime ×2.0, Lumen ×1.4 | Gloom ×0.4 |
| Day 07:00–17:00 | Lumen ×1.8, Verdant ×1.3 | Gloom ×0.1 |
| Dusk 17:00–21:00 | Ember ×1.4, Volt ×1.6 | — |
| Night 21:00–04:00 | Gloom ×2.5, Ember ×1.2 | Lumen ×0.1 |

### Weather (live feed)

| Condition | Effect |
| --- | --- |
| Rain | Tide ×2.0, Ember ×0.5 |
| Thunderstorm | Volt ×2.5, **Railmane evolution window** |
| Snow / < 0 °C | Rime ×2.5, **Glaciarch cold-form window** |
| Fog | Gloom ×1.8, spawn detection radius −40% |
| Clear + hot | Ember ×1.8, Lumen ×1.4 |
| Wind > 30 km/h | Gale ×2.2 |

Weather integration is cheap to build and does more for "the world feels alive" than
almost anything else on the roadmap. Prioritise it early.

### Rift events

Scheduled, announced 24 h ahead, 60–90 minutes long, anchored to a real landmark.

- Rift-element species spawn **only** here.
- Apex monsters appear in the final 20 minutes.
- Spawn density is high enough that a solo Warden gets value, but apexes need a party.
- Anyone can walk in; no ticket for the base event.

## Spawn rarity distribution

| Rarity | Share of spawns | Typical |
| --- | --- | --- |
| Common | 62% | Stage 1, some stage 2 |
| Uncommon | 25% | Stage 2 |
| Rare | 10% | Stage 3 Brutes |
| Very Rare | 3% | Colossus, branch forms |
| Apex | Event only | Titans |

A wild stage-3 monster is a genuine event and should be treated like one by the
UI — a distinct spawn sound, a different map marker, a "hold on, what is that".

## Warden ranks

25 ranks. XP from culling, catalogueing, contracts, research, and distance walked.

| Rank | XP to reach | Unlocks |
| --- | --- | --- |
| 1 | 0 | Marker Pistol, Tranq Dart, Ball Round, 3 habitat slots |
| 3 | 1,200 | Stage 1→2 evolution, Net Shell |
| 4 | 2,000 | Tier 2 weapons: Splitbore, Longtooth, Sylvan Bow |
| 6 | 4,500 | Contracts, Piercing + Broadhead rounds |
| 8 | 8,000 | Stage 2→3 evolution, Research III |
| 9 | 10,500 | Tier 3 weapons: Sting Crossbow, Lattice Launcher, Arcbrand |
| 12 | 20,000 | Rift events, Rune Arrow, 6 habitat slots |
| 16 | 40,000 | Tether Harpoon, Colossus capture, Anchor Tether |
| 20 | 75,000 | Apex events, Lullaby Bolt, 9 habitat slots |
| 25 | 150,000 | Titan capture, 12 habitat slots, prestige cosmetics |

XP award shape, roughly:

```
cull        =  10 × species_tier
catalogue   =  35 × species_tier          ← 3.5× a cull, on purpose
first catch = 150 × species_tier
clean catch = +50%
evolution   = 200 × resulting_stage
contract    = 120–900
per km walked = 40
```

Catalogueing pays 3.5× a cull in XP but costs more time, more expensive ammo, and
more risk. That ratio is the main tuning dial for the whole economy — if playtests
show everyone culling, raise it; if nobody culls, lower it or cut material drops
from capture.

## Contracts

Daily and weekly directed objectives. They exist to push players toward parts of the
system they are avoiding.

| Type | Example | Reward |
| --- | --- | --- |
| **Cull** | "Cull 5 Volt-element monsters" | Materials, XP |
| **Catalogue** | "Catalogue any Stone-element Strider" | Capture ammo, RP |
| **Clean** | "Catalogue a monster above 80% HP" | RP, Essence |
| **Method** | "Catalogue something using only a bow" | Weapon mod |
| **Explore** | "Visit 3 distinct biomes" | XP, Essence |
| **Family** | "Complete any family line" | Habitat slot |

The contract board should always hold at least one cull and one catalogue contract
so neither playstyle can fully ignore the other.

## Economy

| Currency | Earned by | Spent on |
| --- | --- | --- |
| **Essence** | Culling and catalogueing both | Ammo crafting, habitat upkeep, fast travel refresh |
| **Materials** | Culling (×3 rate), catalogueing (×1) | Weapons, mods, upgrades, feeding |
| **Research Points** | Catalogueing only | Codex research tiers |
| **Rift Shards** | Rift events, apexes | Tier 4 gear, prestige cosmetics |

Materials dropping at 3× from culling is the deliberate counterweight to the XP
ratio above. Neither playstyle starves the other; each is slow at something.
