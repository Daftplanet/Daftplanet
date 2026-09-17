# Browser suites

Fourteen Playwright suites that drive the real prototype in a real browser: they click
the real buttons, read the real HUD, and fail on any console error. Between them
they cover every phase that has been built.

| suite | what it holds down |
|---|---|
| `smoke1.mjs` | phase 1 — patrol, spawns, time of day, a fight fought to an outcome, withdraw, Codex, crafting, persistence, 390px layout |
| `smoke2.mjs` | phase 2 — the Sanctuary, study, evolution and its branch gates, research I–III, contracts, resident bonuses |
| `packs.mjs` | pack spawns, the one-attacker token, area and chain weapons, per-member resolution |
| `rifts.mjs` | scheduled rift events, Rift-only spawns, and the three phased apexes |
| `pwa.mjs` | manifest, icons, service worker, and that it boots and fights with the network cut |
| `twoweapons.mjs` | two weapon slots, their separate magazines, the switch cost, and the apex that needs both |
| `mods.mjs` | the barrel/core/sight rails, the Codex gate on the two research sights, and what each mod changes |
| `codex.mjs` | measured specimens and their percentiles, Your Records, the field-report card and what it refuses to put on it, completion rewards, lineage and the showcase |
| `escort.mjs` | the escort's one charge, all nine element abilities doing what they claim, stage scaling, the HUD button, and that a burn never resurrects what a bullet killed |
| `aim.mjs` | free aim unchanged, the assisted lock holding through an aim sweep, the ring's tempo and gold band, and that a player who never aims can still resolve a fight |
| `placement.mjs` | that the engine speaks every placement term the bestiary uses, that no biome is dead ground, that each apex appears only where and when its entry allows, and that the forecast finds it |
| `map.mjs` | the Web Mercator projection against known figures, tile addressing, biome-by-colour, GPS and drag-to-move, and every way a basemap can fail |
| `voxel.mjs` | that all 43 species build a solid model with their weak points on it, that the shapes derive from the Codex entry rather than a fresh roll, and that a Titan and a Mote both fit their frame |
| `battle.mjs` | the turn-based fight: move sets, the type chart beating the stat gap, the catch roll inheriting the Restraint maths, priority, swapping, packs fought and recorded one member at a time, an apex fight that is a fight rather than an endurance test, every apex phase actually happening and gating its own capture, Nyxhollow blanking its health bar until you bring a Lumen, PP running out and Strike being what is left, a status move that lands and a burn that bites, a held monster losing its turn, a fair fight lasting long enough to have a decision in it while a mismatch still ends in one hit, choosing a party and its lead, a released monster coming off the team sheet, the Sanctuary showing a level and all four moves, Study going only to whoever was on the field, and that a Warden with no monsters can still win their first fight |

## Running them

```sh
npm install playwright        # once, anywhere on your path
node game/tests/run.mjs       # serves docs/ itself and runs all fourteen
node game/tests/run.mjs mods rifts
```

`run.mjs` starts its own static server on a free port, so nothing needs to be
running first. It also serves **fake map tiles** — a quartered image with water,
woodland, parkland and built ground in known positions — so the whole map path
(fetch, decode, classify, draw) is testable without the internet. A suite that
needs OpenStreetMap to be up fails for reasons that are not the code's. Set `CHROMIUM=/path/to/chrome` if Playwright cannot find a browser,
or `RIFTBORN_URL` to point a single suite at an already-running copy.

## For a long time, a failing check did not fail the run

Every suite ended `process.exit(errors.length ? 1 : 0)`. It exited on console
errors and on nothing else; `ok()` printed `PASS` or `FAIL` and threw the result
away. So across fourteen suites and several hundred checks, a check could go red
and the run would still print `all suites passed` underneath it.

It was caught by eye, not by the tooling, while reading output for another
reason. The check it was hiding had been failing two runs in three.

Every suite counts failures now and exits on them. **A check that cannot fail
the build is a comment with extra steps.**

## They are slow now

About ninety minutes for the full run. `aim` simulates 24 fights x 45 seconds x
four input profiles and dominates it; the turn-based fights doubled in length
when a damage cap stopped them ending in two turns. Run a single suite by name
while working (`node game/tests/run.mjs battle`) and the whole set before you
push.

## A warning about these suites

More bugs on this project have been found *in the tests* than in the game. A suite
that set up a pack and never pulled the trigger; a bot that re-rolled its aim error
every frame and so waited for a perfect sample; a scripted player that aimed where
the monster had been; a spawn assertion measuring the one family that does not shift
with the clock. Every one of them reported a green pass or a confident number that
was not true.

A suite that bulk-catalogued the whole bestiary by *replacing* Codex entries, then
failed its own persistence check on the records it had just destroyed. It reported a
real-looking data-loss bug that did not exist. And an aim check that teleported a
monster into position without moving its motion history, so the next frame read the
jump as velocity and reported an 11-degree spray as 163 degrees — the same mistake
this project had already made once, three suites earlier.

The other direction is just as real, though. A phase 1 check had been failing
intermittently on "0 spawns in range" for weeks, and a comment — mine — explained it
away as the world working as designed. It was not: 16% of the map had no species
that could spawn on it. A comment that explains away a failure is worth exactly as
much as the measurement behind it.

A check can also be honest and still be useless, by asking for a signal too rare
to see. `aim`'s ninth check wanted a never-aiming assisted player to finish at
least one of six fights. That player finishes about a third of its fights, so six
fights expects two — and zero turns up about half the time. The claim was true;
the sample could not show it. Twenty-four fights gives 7 to 11 against free aim's
flat zero, and the threshold sits at 3 with margin.

When a suite tells you something surprising, suspect the suite first — and then go
and check.
