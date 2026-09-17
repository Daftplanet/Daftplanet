# 01 — Core Concept

## One-line pitch

A location-based AR hunter where you walk real streets, aim a real-feeling weapon
at creatures that have crossed into our world, and choose every fight: kill it for
parts, or subdue it and write it into your Codex.

## The fantasy

You are a **Warden** — field staff for an organisation that shows up after a rift
opens. You are not a trainer collecting pets and you are not a soldier clearing
vermin. You are somewhere in between: half naturalist, half exterminator, carrying
a weapon that can do either job depending on what you load into it.

The emotional beat we want, repeatedly: *you have a rare monster at 15% health, you
have four tranq darts left, and it is about to flee.* Kill it and you bank the
materials guaranteed. Dart it and you might get the Codex entry — or you might get
nothing.

## Design pillars

1. **The ammo swap is the game.** Every meaningful decision routes through "which
   round do I load". If a system doesn't touch that choice, it is probably not
   worth building.
2. **Capture is skill, not a dice roll.** Restraint is a meter you fill by landing
   good shots on weak points with the right ammo. A miss costs you. Luck decides
   very little. (See [03-combat-and-capture.md](03-combat-and-capture.md).)
3. **Culling is legitimate.** It is not the "bad" path. It is faster, safer, and
   pays materials the crafting tree genuinely needs. A player who only culls should
   have a good time — they just end up with a thin Codex.
4. **The Codex is the long game.** Collection, research, and evolution are what
   keep someone playing in month six. Combat is what keeps them playing in week one.
5. **Respect the walk.** The game is played outdoors, one-handed, in 90 seconds at
   a bus stop. Nothing requires two thumbs and full attention to not lose progress.

## Core loop

```
        WALK ─────────────► ENCOUNTER ────────► ENGAGE
          ▲                  (spawn on map)      │
          │                                      ├──► CULL  ── lethal rounds
          │                                      │      └─► materials, Essence, contract credit
          │                                      │
          │                                      └──► CATALOGUE ── capture rounds
          │                                             └─► fill Restraint ─► tag
          │                                                    └─► Codex entry + Sanctuary resident
          │                                                            │
        CRAFT ◄──── SANCTUARY ◄──── RESEARCH ◄──────────────────────────┘
      (better weapons,   (raise, evolve)   (unlock spawn intel, weak points,
       better ammo)                          evolution requirements)
```

Each ring feeds the next:

- **Materials** from culling craft better **ammo**.
- Better ammo makes **capture** viable against bigger, meaner species.
- Captures fill the **Codex**, which unlocks **research**.
- Research reveals **weak points and spawn windows**, which makes both culling and
  capturing faster.

A player who refuses to capture stalls at mid-tier ammo. A player who refuses to
cull runs out of crafting materials. The loop wants both.

## The cataloguing rule (important)

> **You may cull a species freely once you have catalogued it at least once.
> Culling a species that is not yet in your Codex marks the entry `Data Lost` and
> costs you the first-capture research bonus permanently for that account.**

This is the mechanic that makes the ammo choice matter on *first contact*. Seeing an
unfamiliar silhouette should cause a small panic: *do I have a dart loaded?* Without
this rule, the optimal play is always "shoot it dead, catch the next one", and the
tension evaporates.

Softening valve: a `Data Lost` entry can be repaired by catalogueing that species
later — you just never get the one-time first-capture bonus back.

## Session shapes

We design for three, explicitly:

| Session | Length | What it is | Must work |
| --- | --- | --- | --- |
| **Pocket** | 60–120 s | Waiting for a train. One spawn, one fight. | One-handed, portrait, interruptible |
| **Patrol** | 15–40 min | A deliberate walk or a lunch loop. | Contracts, several fights, a craft |
| **Expedition** | 45+ min | Weekend, often with other people. Apex hunts, rift events. | Group play, comms, big payouts |

If a feature only works in Expedition, it is a late-phase feature.

## What this is not

- Not turn-based. Combat is real-time aiming.
- Not PvP-first. Wardens compete on Codex completion, not on each other. (PvP is
  parked in [09-risks-and-roadmap.md](09-risks-and-roadmap.md) as a maybe.)
- Not a pet sim. Monsters in the Sanctuary are studied and grown; they don't fight
  for you on the map. (Open question — see roadmap.)
