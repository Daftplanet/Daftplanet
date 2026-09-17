# 13 — Phase 3, part 1: Packs

Phase 2 closed with a flag: three of the eight weapons were built around multiple
targets and had nothing to show for themselves in a one-on-one, and phase 3's
multi-capture needed the same missing piece. That piece is pack spawns, and it is
now in.

**This is not all of phase 3.** Rift events, the three apexes, party play and Codex
sharing are still ahead. What is done is the structural prerequisite they all sit on.

## Encounters hold a pack, not a monster

`createFight` takes a `packSize` and the fight carries `monsters` rather than a
single `monster`. Everything per-monster — health, Restraint, statuses, AI state,
awareness — moved into the array.

The compatibility seam is a `monster` accessor that returns whichever pack member
the crosshair is reading. That kept the balance sim and most of the HUD working
untouched through a change that would otherwise have rippled through four files,
and it is also the right thing for the player: a HUD showing one target's numbers
needs to know which target that is.

Pack sizes are drawn from the same deterministic hash as the spawn itself, biased
low so a lone monster stays the common case:

| | share of spawns |
| --- | --- |
| 1 monster | 62% |
| 2 | 20% |
| 3 | 12% |
| 4 | 6% |

Motes average 2, whelps 1.6, striders 1.3, and anything Brute or larger always
comes alone. The bestiary asked for this — the Cinder family are pack canids, a
Pebblit is a pebble — and so did the arsenal.

## Three weapons finally have something to do

Measured, one shot each, against a cluster of three:

| Weapon | Result |
| --- | --- |
| **Lattice Launcher** (Snare Grenade) | 3/3 gained Restraint, 3 ensnared |
| **Arcbrand Coil** (Arc Cell) | 3/3 damaged, 2 stunned |
| **Splitbore** (Ball Round) | 3/3 damaged by one shell |

The pellet cone is the interesting one: it only spreads with distance, so it catches
a cluster at 180px and a single target at 90px. That is a real positional decision
rather than a stat, and it appeared without being designed — it falls straight out
of the spread geometry.

## The Arcbrand Coil broke the game outright

`02-weapons-and-ammo.md` describes it as "pure setup. No capture round at all," and
the compatibility grid has an empty capture row for it. The app did not believe
that: the bench assigned it a capture round anyway (falling back to its lethal one),
`loadLoadout` then rejected the loadout as invalid, and **every attempt to engage
anything failed with an alert.** Selecting that weapon soft-locked the player out of
the game entirely.

Nobody had noticed because the Arcbrand only became selectable in phase 2, and the
phase 2 tests exercised the bench UI rather than engaging with each weapon in turn.

A weapon may now legitimately have no capture chamber: it carries no capture rounds,
the swap is refused rather than attempted, and the chamber reads "none — pure setup".

Generalising: **a design document that says a thing has none of something is a test
case.** Every "no X at all" in the bible deserves one.

## Pack fairness needed a rule the design never mentions

Three monsters that all wind up at once do not make a hard fight, they make an
unanswerable one — the player is pinned between simultaneous charges with no gap to
move into. There is now an **attack token**: only one pack member may be in windup
or lunge at a time, released when it finishes recovering.

This is a game-feel rule rather than a design one, and the bible has nothing to say
about it. Worth adding to `03-combat-and-capture.md` when packs are written up
properly, because it decides whether a pack is a fight or an ambush.

Pack members also push apart while stalking, so three Sparkmites read as three
silhouettes rather than one lump.

## Multi-capture works, and the design's limit holds

`03` predicted this: "A Snare Grenade that catches three monsters lets you subdue
all three, but the tag window is still 5 seconds total — you physically cannot tap
three. The intent is that group play solves this."

That is exactly what happens. Tagging takes the nearest subdued monster, each has
its own five-second window, and solo you will generally get one or two of three.
The remainder recover Enraged. **The pressure the design predicted is real and the
answer to it — a partner — genuinely does not exist yet.** That is the best argument
so far for party play being worth the netcode.

Outcomes now record per member: three Sparkmites can end as two culls and a capture,
and the Codex, XP, materials and Sanctuary all see each one separately.

## Two test flakes worth naming

Both were my harness, not the product, and both are the same mistake in different
clothes — **asserting on a world that had not finished happening yet**:

- The weapon tests set up a cluster and never pulled the trigger. They passed state
  into the fight and measured the result of no shot at all.
- The offline and patrol tests measured spawns on the first frame, and on a
  residential tile that legitimately returns nothing 93% of the time.

Both now drive real input and walk on if a tile is empty.

## Still open

1. **Rift events, the three apexes, party play, Codex sharing** — the rest of phase 3.
2. **Pack morale.** Killing one member currently has no effect on the others. Making
   survivors more likely to bolt is one line and thematically right, but it could
   just as easily be frustrating; it wants measuring before it goes in.
3. **Packs are single-species.** A mixed pack (a Cinderfang with two Sootpups) is
   more interesting and the fight code already supports differing monsters badly —
   `loadout.species` is still shared across the pack.
4. The attack token means a pack of four is not four times as dangerous as one. That
   is deliberate, but it may make large packs feel like a loot piñata rather than a
   threat. Needs hands on it.
