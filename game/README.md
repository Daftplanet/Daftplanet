# RIFTBORN — Design Bible

Working title for a location-based AR monster hunter: go outside, find creatures
that have bled through into the real world, and decide whether to **cull** them or
**catalogue** them.

The hook is the ammunition. Every weapon in the game fires two families of rounds:

- **Lethal rounds** kill the monster and drop crafting materials fast.
- **Capture rounds** — darts, net shells, rune arrows, snare grenades — subdue it
  instead, so it can be tagged, added to your **Codex** (the personal wiki), and
  raised until it evolves.

You swap ammo mid-fight. That single choice is the game's central tension: culling
is quick and pays now, cataloguing is slow, harder, and is the only thing that
grows your collection.

## Read in this order

| File | What's in it |
| --- | --- |
| [01-core-concept.md](01-core-concept.md) | Pitch, fantasy, design pillars, core loop, session shapes |
| [02-weapons-and-ammo.md](02-weapons-and-ammo.md) | 8 weapons, 14 ammo types, mods, the lethal/capture split |
| [03-combat-and-capture.md](03-combat-and-capture.md) | Damage maths, the Restraint meter, weak points, status effects |
| [04-elements-and-sizes.md](04-elements-and-sizes.md) | 8 elements + Rift, the full type chart, 6 size classes |
| [05-bestiary.md](05-bestiary.md) | 40 monsters across 12 families, plus 3 apexes |
| [06-evolution.md](06-evolution.md) | Evolution rules, branch conditions, the Sanctuary |
| [07-codex-wiki.md](07-codex-wiki.md) | The player wiki: entries, research ranks, completion rewards |
| [08-world-and-progression.md](08-world-and-progression.md) | Biomes, spawn tables, weather, time of day, Warden ranks |
| [09-risks-and-roadmap.md](09-risks-and-roadmap.md) | Open questions, content-rating and safety notes, build phases |
| [10-phase0-findings.md](10-phase0-findings.md) | What building the fight taught us, and the three maths bugs it caught |
| [11-phase1-findings.md](11-phase1-findings.md) | The vertical slice: a collision bug that had been distorting phase 0, and what the map taught us |
| [12-phase2-findings.md](12-phase2-findings.md) | The loop closes: a world that could not host its own bestiary, and evolution against real-world time and weather |
| [13-phase3-findings.md](13-phase3-findings.md) | Packs, rift events, apexes and the two-weapon loadout — including a phase 1 decision that took three phases to prove wrong |

## Machine-readable data

`data/` holds the same content as JSON so the build can consume it directly
instead of re-typing tables out of markdown.

| File | Records |
| --- | --- |
| [data/elements.json](data/elements.json) | 9 elements + the 8×8 effectiveness matrix |
| [data/sizes.json](data/sizes.json) | 6 size classes with their combat modifiers |
| [data/weapons.json](data/weapons.json) | 8 weapons with full stat blocks |
| [data/ammo.json](data/ammo.json) | 14 ammo types, lethal and capture |
| [data/monsters.json](data/monsters.json) | 43 monsters with stats, spawns, evolution |

All numbers in this bible are **first-pass tuning values**, not final. They are
internally consistent so that a prototype has something real to run on, and they
are all in the JSON so they can be rebalanced in one place.

## The prototype

Phases 0 through 2 are built at [`docs/riftborn/`](../docs/riftborn/), plus most of
phase 3: the grey-box fight, the vertical slice, the closed loop — all 12 families,
all 8 weapons, the Sanctuary, evolution with its four branch conditions, Research
I–III, contracts and weather — and now pack spawns, scheduled rift events and the
three phased apexes. Party play and Codex sharing are what remain. It runs the design's real formulas out of `data/`, and the same
fight and world code runs headlessly in a balance sim so tuning claims can be
checked rather than asserted.

```sh
python3 -m http.server -d docs 8000     # then open localhost:8000/riftborn/
node game/tools/balance_sim.mjs 400     # outcome table by strategy and skill
python3 game/tools/stamp_sw.py --check  # service worker cache stamp is current
```

It is an installable PWA that plays fully offline, published from `main` → `docs/`
at `https://daftplanet.github.io/Daftplanet/riftborn/`.

What they changed about this bible is in [10](10-phase0-findings.md),
[11](11-phase1-findings.md), [12](12-phase2-findings.md) and [13](13-phase3-findings.md).

## Glossary

- **Warden** — the player.
- **Riftborn** — the monsters. They enter through rifts and are not native here.
- **Cull** — kill a monster with lethal rounds. Drops materials.
- **Catalogue / Tag** — subdue with capture rounds, then claim. Creates a Codex entry.
- **Restraint** — the capture meter. Fill it to subdue.
- **Codex** — the player's wiki of every species they have catalogued.
- **Sanctuary** — where catalogued monsters live and eventually evolve.
- **Essence** — the soft currency, dropped by both culling and catalogueing.
