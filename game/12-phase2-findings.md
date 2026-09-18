# 12 — Phase 2 Findings

The loop closes: all 12 families, all 8 weapons, all 14 rounds, the Sanctuary,
evolution with its four branch conditions, Research I–III, contracts, weather, and
an ammunition economy gated on element materials.

## The world could not host its own bestiary

The first thing phase 2 found was that `08-world-and-progression.md` lists nine
biomes and the world generator only made seven. **Waterside and woodland did not
exist**, which silently blocked every species that needs them — the entire Brine and
Rime families, and the woodland half of Myco and Gloom. Phase 1 never noticed
because its three families happened to live in the biomes that did exist.

The design had a per-species biome list and a per-biome spawn table and nothing
checked the two against each other. There is now a startup assertion in the test
suite: **every wild species must be reachable from some combination of biome, time
window and weather.** It reports 33 of 35 reachable, and the two that are not are
the Rift species, which correctly only appear at rift events in phase 3.

Worth generalising: a content set that references a generated world needs a
reachability check, or content silently goes missing.

## Two bugs in the new persistence layer

- **`admit()` mutated state without saving it.** Harmless in normal play, because
  `recordOutcome` saves immediately afterwards — which is exactly why it survived
  until a test called it directly. Every other public mutator persisted; this one
  was the exception, and an exception like that is a footgun waiting for the next
  caller.
- **`evolve()` recorded the wrong lineage.** It assigned the new species id before
  pushing the old one onto `evolvedFrom`, so every specimen claimed to have evolved
  from itself. A one-line ordering mistake that no amount of playing would have
  surfaced, because nothing displays lineage yet.

## Weather is simulated, deliberately

`08` calls for a live weather feed. The prototype derives weather deterministically
from the hour and the world seed instead. Two reasons, both worth keeping in mind
for the real build:

1. A live feed means a third-party dependency in the hot path of spawn generation.
2. It means sending a player's location to that third party. `09` already commits to
   storing precise coordinates only where gameplay needs them; a weather lookup is
   exactly the kind of incidental leak that commitment is meant to prevent. A real
   build should query by coarsened position, not by GPS fix.

Everything downstream only asks *what the weather is*, so swapping the source is one
function. The mechanic itself works: Volt spawns go from 6% of the map in clear
conditions to 17% in a thunderstorm, and a thunderstorm is what a Voltfang needs to
become a Railmane.

## Evolution pacing, and why the prototype cheats

Study accrues at **1 per minute of real time**, so stage 1→2 (400 Study) is about
seven hours and stage 2→3 (1,600) is a bit over a day. That is the right shape for
an exit criterion of "a reason to log in on day 30" — it is a thing you come back
to, not a thing you grind.

It is also unevaluable in a sitting, so the world panel has a **Study rate**
multiplier. Same principle as the weapon unlock toggle in phase 1: the design keeps
its numbers, the evaluator gets a tool, and the tool is labelled as one.

The branch conditions all work against the real world:

| Branch | Condition | Verified |
| --- | --- | --- |
| Ashenreaver | Evolve 22:00–04:00 local | Blocked at noon, clear at 01:00 |
| Hoarfell | Evolve below 0 °C | Gated on freezing weather |
| Railmane | Evolve during a thunderstorm | Gated on live weather state |
| Sporeherald | Blightcap taken with a Rune Arrow | Reads the specimen's stored capture method |

Sporeherald is the interesting one, and it works: the resident record carries the
ammunition it was captured with, so *how* you took it two weeks ago decides what it
can become. That is the mechanic `06` described and it needed no special casing —
just a field on the specimen.

## Three weapons cannot show their identity yet

The Splitbore, Lattice Launcher and Arcbrand Coil are all built around **multiple
targets**: a cone of pellets, an area snare, a chain that arcs to three monsters.
In a one-on-one encounter the Splitbore is a short-range burst weapon, the Launcher
is a worse grenade, and the Arcbrand is a mediocre rifle that applies `Stunned`.

They are in, and they work, but they are under-tested. What they need is **pack
spawns** — which is phase 3's multi-capture, so this is not a gap so much as an
ordering consequence. Worth flagging that a third of the arsenal is currently
carried by content that does not exist yet.

## Element-gated ammunition does route the player

Replacing the generic currency with per-element materials had the intended effect
immediately: Rune Arrows cost Lumen and Gloom, so wanting them means hunting Lumen
and Gloom monsters, which means daylight landmarks and midnight alleys respectively.
The bench refuses the craft and says which material is short.

This is the cheapest "reason to go somewhere specific" in the whole design and it
cost one table.

## Still open

1. **Pack spawns** are now blocking three weapons and phase 3's multi-capture.
   They are the next structural piece, not a polish item.
2. **Residents do nothing but evolve.** `09`'s open question 1 — do Sanctuary
   residents fight alongside you — is now the biggest unanswered design question,
   because the Sanctuary is otherwise a waiting room with a passive bonus attached.
3. **Habitat affinity is a 25% Study bonus and nothing else.** It wants either more
   weight or less UI.
4. **Nothing surfaces lineage.** A specimen records what it evolved from and where
   it was taken; the Codex shows almost none of it. That record is what makes a
   specimen *yours* per `06`, and it is currently invisible.

## Exit criterion

*A player has a reason to log in on day 30.*

The mechanism exists: residents accrue Study while you are away, evolution gates on
real-world time and weather you cannot rush, contracts reset daily, and the Codex
still has 40 entries in it. Whether that is a *reason* rather than a *mechanism* is,
as ever, the part that needs hands on it.
