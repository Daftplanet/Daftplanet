# Browser suites

Eight Playwright suites that drive the real prototype in a real browser: they click
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

## Running them

```sh
npm install playwright        # once, anywhere on your path
node game/tests/run.mjs       # serves docs/ itself and runs all eight
node game/tests/run.mjs mods rifts
```

`run.mjs` starts its own static server on a free port, so nothing needs to be
running first. Set `CHROMIUM=/path/to/chrome` if Playwright cannot find a browser,
or `RIFTBORN_URL` to point a single suite at an already-running copy.

## A warning about these suites

More bugs on this project have been found *in the tests* than in the game. A suite
that set up a pack and never pulled the trigger; a bot that re-rolled its aim error
every frame and so waited for a perfect sample; a scripted player that aimed where
the monster had been; a spawn assertion measuring the one family that does not shift
with the clock. Every one of them reported a green pass or a confident number that
was not true.

A suite that bulk-catalogued the whole bestiary by *replacing* Codex entries, then
failed its own persistence check on the records it had just destroyed, is the most
recent. It reported a real-looking data-loss bug that did not exist.

When a suite tells you something surprising, suspect the suite first.
