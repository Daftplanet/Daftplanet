# RIFTBORN — Phase 0 prototype

The grey box from [`game/09-risks-and-roadmap.md`](../../game/09-risks-and-roadmap.md):

> One monster (Cinderfang), one weapon (Marker Pistol), both ammo types. Restraint
> meter, wound multiplier, weak points, flee behaviour.
> **Exit criterion:** the kill-or-capture decision is tense with a single monster in
> a grey box. If it isn't fun here, no amount of map makes it fun.

No map, no AR, no progression, no art. Those are all later phases, and building any
of them before this question is answered would be building on a guess.

## Running it

The page fetches its data files, so it needs to be served over http rather than
opened from the filesystem:

```sh
python3 -m http.server -d docs 8000
# then open http://localhost:8000/riftborn/
```

It is also served from GitHub Pages at `/riftborn/` once this branch is merged.

## Controls

| | Desktop | Touch |
| --- | --- | --- |
| Move | `WASD` / arrows | drag the left half |
| Aim | mouse | hold the right half |
| Fire | hold left click | hold the right half |
| Swap chamber | `Space` or `Q` | `SWAP` |
| Reload | `R` | `RELOAD` |
| Tag a subdued monster | `E` or click it | `TAG` |

The **numbers** button opens a live readout of every term the fight is using —
wound multiplier, status product, Restraint per hit, decay, flee chance per second.
It is reading the running fight, not a copy, so it is the fastest way to see why
something happened.

Two toggles in that panel are worth playing with:

- **Show weak points** — turning it off is what an unresearched Codex entry feels
  like. The weak points are still there and still worth ×2.5, you just cannot see
  where they are. This is the argument for Research I in one checkbox.
- **Must close to 120px to tag** — off by default, matching the design's generous
  5-second window. On, the window becomes a real scramble. Open question, see below.

## What's in it

- The Restraint meter with decay, the wound multiplier, and the subdue → tag window
- Weak points with per-zone damage and Restraint multipliers, moving with the body
- Chamber swapping at its real 0.6s cost, with per-chamber magazines and reserves
- `Sedated` from tranq stacks, `Enraged` from a missed tag window
- Flee behaviour, including Restraint suppressing the flee roll
- A telegraphed lunge with a punish window on the recovery
- Four outcomes: `CULLED`, `CATALOGUED` (with clean-capture detection), `ESCAPED`,
  `DRIVEN OFF`

## Architecture

| File | Role |
| --- | --- |
| `js/rules.js` | Pure combat maths. No DOM, no state. |
| `js/game.js` | The fight: entities, AI, the `step()` function. Also DOM-free. |
| `js/render.js` | Canvas drawing. |
| `js/input.js` | Keyboard, mouse and touch → an `intent` object. |
| `js/main.js` | Data loading, loop, HUD. |
| `data/*.json` | Synced from `game/data/`. Do not edit here. |

`game.js` and `rules.js` are deliberately free of browser APIs so that
[`game/tools/balance_sim.mjs`](../../game/tools/balance_sim.mjs) can drive the
**exact same fight code** with scripted players. Input is a plain `intent` object,
so the fight never knows whether a human or a bot is driving it.

```sh
node game/tools/balance_sim.mjs 400      # outcome table by strategy and skill
PROBE=1 node game/tools/balance_sim.mjs  # plus the weak-point targeting experiment
```

Data is canonical in `game/data/` and copied here by:

```sh
python3 game/tools/sync_prototype_data.py          # sync
python3 game/tools/sync_prototype_data.py --check  # fail if stale
```

## Findings

The tuning work this build produced — including three bugs in the design bible's
own maths — is written up in
[`game/10-phase0-findings.md`](../../game/10-phase0-findings.md).
