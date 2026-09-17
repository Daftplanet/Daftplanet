# RIFTBORN — prototype

Phases 0 and 1 of [`game/09-risks-and-roadmap.md`](../../game/09-risks-and-roadmap.md),
built on the design bible's real data and formulas.

- **Phase 0** — the grey-box fight. One monster, one weapon, two chambers.
- **Phase 1** — the vertical slice. A biome-driven map, 9 wild species across
  3 families, 3 weapons, a persistent Codex with Research I, and an economy that
  makes culling pay for capturing.
- **Phase 2** — the loop closes. All 12 families, all 8 weapons, all 14 rounds, the
  Sanctuary, evolution with its four branch conditions, Research I–III, daily
  contracts, weather, and ammunition gated on element materials.

> **Phase 2 exit criterion:** a player has a reason to log in on day 30.

No AR, no geolocation, no rift events, no pack spawns. Those are phase 3 and later.

## Running it

The page fetches its data files, so it needs to be served over http rather than
opened from the filesystem:

```sh
python3 -m http.server -d docs 8000
# then open http://localhost:8000/riftborn/
```

## Playing it

**Patrol.** Walk with `WASD` (or drag on touch). Monsters spawn from the tile you
are standing in, the 15-minute time bucket, and your world seed — so the map is the
same for everyone standing in the same place at the same time, with no persistent
world simulation behind it. Walk within 25 m of a marker to engage.

**Fight.** Same as phase 0. Hold click to fire, `Space` swaps chamber at its real
0.6 s cost, `E` tags a subdued monster, `Esc` withdraws.

**Sanctuary.** Catalogued monsters live here and accrue **Study** in real time —
1 per minute, so stage 1→2 is about seven hours. Assign a resident to a habitat
matching its element for 25% more, feed it materials for a burst, and evolve it when
the gates clear. Two of the four branches gate on the actual world (local time,
weather) and one on *how you captured it* weeks earlier. The world panel has a Study
rate multiplier so you can see an evolution without waiting a day.

**Codex.** Every species you see, fight, kill or catalogue is recorded. Culling
something you have never catalogued marks the entry **Data Lost**. Spend Research
Points to unlock **Research I** (weak points visible in the field), **II** (spawn
biomes and time windows) and **III** (evolution requirements). Until Research I you
are shooting at a silhouette.

**Loadout.** Pick a weapon and a round for each chamber, and craft more. You carry
24 lethal and 12 capture rounds into a fight; the rest stays at the bench. Culling
pays 3× the alloy of a capture, which is what funds the darts.

| | Desktop | Touch |
| --- | --- | --- |
| Walk / move | `WASD` / arrows | drag (map: anywhere, fight: left half) |
| Aim | mouse | hold the right half |
| Fire | hold left click | hold the right half |
| Swap chamber | `Space` / `Q` | `SWAP` |
| Reload | `R` | `RELOAD` |
| Tag | `E` or click | `TAG` |
| Withdraw | `Esc` | `LEAVE` |

Two dev panels are worth opening. **world** (patrol) scrubs the clock and the walk
pace — shift to dusk and the map fills with Ember and Volt, where daytime is Stone.
**numbers** (fight) is a live readout of every term the maths is using.

## What's in phase 1

- 9 wild species across the Cinder, Crag and Volt families, plus their 2 branch
  forms shown as permanently-blank Codex slots
- Size classes that matter: a Mote's weak point is a genuinely hard shot, a Brute's
  is not, because weak points scale with the body
- Aggression profiles — passive, skittish, territorial and aggressive creatures
  behave differently enough that you fight them differently
- 3 weapons: the Marker Pistol, the Longtooth, and the Sylvan Bow (which draws,
  looses on release, and is silent — so it is the only one that earns Ambush)
- 7 rounds, including Piercing, which the armoured Crag family exists to teach
- The type chart in play: Cryo rounds are ×2.0 against both Ember and Stone
- Biomes, time-of-day spawn shifts, Warden ranks, XP, and an ammo economy

## Architecture

| File | Role |
| --- | --- |
| `js/rules.js` | Pure combat maths. No DOM, no state. |
| `js/game.js` | The fight: entities, AI, `step()`. Also DOM-free. |
| `js/world.js` | Tiles, biomes, deterministic spawns. Also DOM-free. |
| `js/patrol.js` | The map: walking, markers, rendering. |
| `js/profile.js` | Progression, inventory, the Codex, the Sanctuary, persistence. |
| `js/sanctuary.js` | Evolution gates and branch conditions. Pure functions. |
| `js/render.js` | Fight canvas drawing. |
| `js/input.js` | Keyboard, mouse and touch → an `intent` object. |
| `js/app.js` | View routing and glue. |
| `data/*.json` | Synced from `game/data/`. Do not edit here. |
| `sw.js` | Service worker: precache, offline, update-on-reconnect. |
| `manifest.webmanifest` | PWA manifest and icon set. |

The fight and world layers avoid browser APIs so that
[`game/tools/balance_sim.mjs`](../../game/tools/balance_sim.mjs) can drive **the
exact same code** headlessly with scripted players:

```sh
node game/tools/balance_sim.mjs 400      # outcome table by strategy and skill
PROBE=1 node game/tools/balance_sim.mjs  # weak-point targeting experiment
DART=1  node game/tools/balance_sim.mjs  # hit-zone distribution by skill
```

Data is canonical in `game/data/` and copied here by:

```sh
python3 game/tools/sync_prototype_data.py          # sync
python3 game/tools/sync_prototype_data.py --check  # fail if stale
```

`window.__riftborn` exposes the profile, the patrol and the running fight for
console poking. It is a prototype; that is worth more than hiding it.

## Findings

- [`game/10-phase0-findings.md`](../../game/10-phase0-findings.md) — the three
  maths bugs in the design bible that building the fight exposed.
- [`game/11-phase1-findings.md`](../../game/11-phase1-findings.md) — the hit-zone
  bug that turned out to have been distorting phase 0's numbers, and what the map
  taught us.
