# 11 — Phase 1 Findings

The vertical slice: a biome-driven map, 9 wild species, 3 weapons, a persistent
Codex. Built at [`docs/riftborn/`](../docs/riftborn/).

The headline is uncomfortable and worth stating first: **phase 0's balance numbers
were partly an artifact of a collision bug**, and phase 1 only found it because
adding eight more species moved a weak point by three pixels.

## The hit-zone bug

Generalising the fight meant replacing two hardcoded weak points with a layout
table. Cinderfang's throat moved from 0.72 to 0.62 of the body radius — **2.6
pixels** — and capture success collapsed:

| | weak-point share of hits | clean capture |
| --- | --- | --- |
| throat at 0.72r | 59% | 88% |
| throat at 0.62r | 24% | **7%** |

Nothing about the design changed. The cause was in the engine: a projectile
advanced in ~8px substeps and, on each one, tested weak points and then the body.
Whichever check happened to fire first won. A weak point sitting slightly deeper
inside the silhouette lost its chance to register at all, because the body's
collision edge was reached first.

So "how often do you hit a weak point" was being decided by substep quantisation
rather than by aim. Every phase 0 number rested on that.

**The fix:** once a projectile contacts the monster, sweep its remaining path from
the entry surface to the body centre and take the closest weak point it passes.
Deterministic, and it matches what a player means by "I aimed at the throat".
Re-running both geometries afterwards gives 84% and 85% — the sensitivity is gone.

Restricting the sweep to the way *in* rather than all the way through matters too:
it means a rear weak point genuinely requires shooting from behind, which is what
makes punishing a lunge recovery worth doing.

## The sim was flattering the player

The balance bot re-rolled its aim error every frame and only fired when the
crosshair was within 0.06 rad of target. That turns "shaky aim" into "perfect aim,
eventually" — the bot simply waited for a favourable sample. Aim sigma was doing
almost nothing.

Hand tremor is now a slow random walk that cannot be waited out. The skill bands
separated immediately, and for the first time they look like a real gradient:

```
                       clean capture (dart from full health)
  AVERAGE  (shaky aim)          38%
  SKILLED  (steady aim)         99%
```

That is the right shape for something the bible calls "a flex": an expert can do it
almost every time, a normal player fails it nearly two thirds of the time and gets
driven off in the attempt.

Current full table, 400 runs per strategy, 24 ball rounds and 12 tranq darts:

```
SKILLED                                        AVERAGE
strategy    cull  cat  esc  down   time        cull  cat  esc  down   time
cull         56%   0%  44%   0%    4.3s         76%   0%  24%   0%    5.7s
pure_dart     0%  99%   0%   2%    5.5s          0%  38%   0%  63%   14.0s
soften_30     0%  76%  24%   0%    5.2s          0%  79%  21%   0%    6.9s
soften_50     0% 100%   0%   0%    4.6s          0% 100%   0%   0%    6.2s
panic         0%  45%  55%   0%    5.2s          0%  53%  47%   0%    6.7s
```

`soften_50` is still the one strategy with no in-fight failure mode, unchanged from
phase 0. Its cost remains purely economic.

## A rank-1 Warden could meet a Colossus with no way out

The smoke test drew an **Obelisc** — 1,600 HP behind 0.6 armour, which a Marker
Pistol chips at 7.2 damage a shot — and simply hung there. Two things were wrong:

- `05-bestiary.md` says an Obelisc "is a fight you choose, entirely, and can walk
  away from at any point", and there was no way to walk away.
- The Colossus anchor gate worked (the Restraint meter caps and says so) but that
  is a dead end without a Tether Harpoon, which does not unlock until rank 16.

There is now a **withdraw** action (`Esc` / `LEAVE`). Rounds already fired are
spent, but the spawn is left standing and nothing is written to the Codex. This is
not a concession — it is the behaviour the bestiary already described.

## What the map taught us

**Biome regions are bigger than a screen.** At a realistic neighbourhood scale, a
960×640 viewport sat entirely inside one biome and the map read as a flat colour
field. The fix was to zoom out and separate the palette, but the underlying tension
is real and will come back with real OSM data: *the scale at which land use varies
is larger than the scale a phone can show.* A real build needs to solve this with
labelling and minimap context, not just zoom.

**Time of day does visible work for almost nothing.** Shifting the clock moves the
Ember share of spawns from 12–17% at noon to 28–32% at night, with Stone as the
daytime constant. It is a handful of multipliers and it makes the world feel like it
has a schedule. Worth having early, exactly as `08` predicted.

**Spawn determinism from `(tile, bucket, seed)` works and costs nothing.** No
server, no persistent world, and two players in the same place would see the same
monsters. Recommend keeping this as the model into phase 2.

## Emergent, and we did not design it

Weak points scale with body size, which was a convenience for laying them out
generically. The consequence is that **a Mote's core is a genuinely hard shot and a
Brute's chest is not**. Small monsters are hard to hit but easy to restrain; large
ones are the reverse. That falls straight out of the size table in `04` and gives
each size class a combat identity we never wrote down.

## Deviations from the roadmap

| Roadmap | Built | Why |
| --- | --- | --- |
| "6 ammo types" | 7 | The Crag family exists to teach Piercing rounds; dropping them would have removed the lesson |
| Two weapon slots | One weapon per encounter | The chamber swap is the tension being tested; a second weapon adds input complexity without testing anything new until mods arrive in phase 2 |
| Element-gated materials | Two generic currencies | Element materials only matter for weapon upgrades, which are phase 2. Inventing them now means inventing content to spend them on |

## Still open

1. **`skittishness` is still 0.40** and still loses ~24% of straightforward culls
   for an average player (44% for a weak-point hunter — see the phase 0 finding
   about chasing runners). The recommendation remains 0.25–0.30.
2. **Rank 4 is a long way from rank 1.** 2,000 XP gates both the Longtooth and the
   Sylvan Bow, and a patrol that captures a few commons earns a few hundred. Either
   the early curve needs flattening or the pistol needs to stay interesting longer.
3. **Nothing yet rewards a *second* capture of the same species.** Research Points
   accrue, but with only Research I implemented there is nothing to spend them on
   after the first. Phase 2's Research II and III fix this; until then a completed
   Codex entry is inert.
4. **Withdrawing has no cost.** Right now the only way to lose a fight you have
   started is to see it through. That is correct for an Obelisc and probably too
   generous for everything else.

## Exit criterion

*A 20-minute Patrol session is worth repeating tomorrow.*

The loop closes: walk, choose, fight, record, spend, walk again. Culling funds the
darts, the darts fill the Codex, the Codex reveals weak points, and weak points make
the next fight faster. Time of day gives a reason to come back at a different hour.

Whether twenty minutes of it is genuinely worth repeating is, again, the thing a
simulation cannot answer.
