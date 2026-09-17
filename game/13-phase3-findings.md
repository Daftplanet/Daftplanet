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

---

# Phase 3, part 2: Rift events and apexes

Two species in the bestiary had nowhere to exist — Riftspawn and Voidmaw spawn only
in `rift_event`, and rift events did not. Three apexes were written up and
unbuildable. The Tether Harpoon and the whole anchor gate were built in phase 2 and
had nothing to point at. All three are now live.

## Rift events

Scheduled from `(cell, day, seed)`, the same trick the spawn table uses: one rift
per 1.2 km cell per day, opening at a deterministic hour, running 75 minutes, with
the apex arriving for the last 20. No server, and two Wardens standing in the same
place would see the same rift open at the same moment.

Inside one, the local spawn table is replaced entirely — Rift-element species only,
at roughly double the usual density. Outside, the map shows rifts as dashed rings
with a countdown, so they are something to plan a walk around rather than something
you stumble into. Gated at Warden rank 12 per `08`.

## Apex phases

Each apex now fights as the bible describes it. Crossing an HP band strips armour,
rotates the exposed weak point, and briefly shields it mid-transition:

| Apex | Phases | Weak point per phase |
| --- | --- | --- |
| Karrahk | 3 | outer plating → vent cluster → spire core |
| Nyxhollow | 2 | shroud knot → hollow eye |
| Aeonrend | 4 | three rift seams → the core |

Karrahk's phase 1 is the armour break `05-bestiary.md` describes, and Aeonrend's
"weak points move between phases" is literal. Armour drops ~18% per phase.

The capture gate matrix behaves exactly as designed:

| | result |
| --- | --- |
| early phase, no anchor | refused — break it down further |
| early phase, anchored | refused — break it down further |
| final phase, no anchor | refused — needs a Tether Harpoon |
| **final phase + anchored** | **catalogued** |

## One line of code killed the entire game

The rift rings are drawn with a `Math.sin(t * 3)` pulse, and I inserted that block
*above* where `t` is declared. Temporal dead zone: it threw on every frame where a
rift was within 1.4 km.

The damage was out of all proportion to the mistake. The exception escaped the
`requestAnimationFrame` callback, so **the callback never re-armed and the whole
game silently froze** — no error visible to the player, just a map that stopped
responding. Spawns, movement, the clock, everything.

Two fixes. The slip itself, and the structural one: the step and draw phases of the
frame loop are now wrapped so an exception is logged once and the loop keeps
running. A single bad frame should degrade a visual, not end the session.

## Apexes were unwinnable in two separate ways

**They one-shot you.** Karrahk hits for 165 against a 100 HP Warden. Apexes scale
to party size in the bible, and I had scaled only health — so a solo apex was not a
hard fight but a perfect-dodge exercise with instant death on one mistake. Attack
now scales alongside health.

**Capture was numerically impossible.** Measured, with a Tether Harpoon landing
perfect anchored weak-point shots on a wounded target:

| Apex | Restraint required | Perfect shots | Time |
| --- | --- | --- | --- |
| Nyxhollow | 8,143 | 80 | ~10 min |
| Aeonrend | 15,660 | 245 | ~30 min |
| Karrahk | 19,140 | 300 | **~37 min** |

The root cause is a decision from phase 1. The design carries **two weapons**, and
the Tether Harpoon's Restraint of 25 is low precisely because its job is anchoring
while *something else* subdues — a crossbow at 58, or several of them in a party.
I deferred the two-weapon loadout in phase 1 on the grounds that it "adds input
complexity without testing anything new". It turns out to be load-bearing for the
entire apex capture path.

The stopgap is consistent with the rest: the Restraint bar scales with party size
like health and attack do. Solo Nyxhollow becomes a 3.3-minute boss fight, which is
right for a Colossus with a party range of 2–6. The two Titans stay long solo, which
is also right — their party ranges are 4–8 and 6–8 and they are not solo content.

**The real fix is the two-weapon loadout, and it is now the top open item.** Anchor
with the harpoon, subdue with the crossbow, is what the design has said all along.

## Still open

1. **The two-weapon loadout.** Blocking coherent apex capture, and the reason the
   Tether Harpoon currently reads as a bad weapon rather than a specialist tool.
2. **Party play.** Multi-capture and the Titan apexes both point at it, and neither
   can be finished without netcode.
3. **Codex sharing and field reports** — the last unbuilt item in phase 3.
4. Rift events currently ignore the bestiary's own placement rules: Karrahk wants
   waterside and a storm, Nyxhollow wants midnight. Right now the apex is picked by
   hash. Honouring those would make each apex feel like it belongs somewhere.

---

# Phase 3, part 3: The two-weapon loadout

Part 2 ended by naming this the top open item, because apex capture was
numerically impossible without it. It is now in, and the effect is larger than
expected.

## The measurement

Solo Nyxhollow, wounded, in its final phase, anchored, landing perfect weak-point
shots:

| Approach | Shots | Time |
| --- | --- | --- |
| Tether Harpoon alone | 31 | 3.8 min |
| **Anchor, switch, subdue with a Sting Crossbow** | **10** | **0.6 min** |

A sixfold improvement, and it comes entirely from using each weapon for the job it
was designed for. The Harpoon's Restraint of 25 stops looking like a bad stat and
starts looking like what it is: the price of the only tool that can hold a Colossus
still. The Crossbow's 58 — the highest in the game — finally has something to be
the highest *for*.

This is what `02-weapons-and-ammo.md` meant by "two lethal profiles, two capture
profiles, or one of each", and I had it in front of me the whole time.

## What I got wrong, and why it took three phases to surface

In phase 1 I deferred the second weapon slot with this reasoning:

> *a second weapon adds input complexity without testing anything new until mods
> arrive in phase 2.*

That was wrong in a specific, instructive way. I judged the feature by what it added
to the **fight I had already built** — a single Strider, one weapon, two chambers —
and it genuinely added nothing there. What I could not see from inside that fight
was that the second slot is not a combat feature at all. It is the mechanism that
makes an entire *class* of weapon coherent. The Tether Harpoon, the Arcbrand Coil
and the Lattice Launcher are all support tools: they set a target up for something
else to finish. With one slot there is no something else, so all three read as bad
weapons.

The cost of the deferral was not that apexes were unbalanced. It was that I then
spent a tuning pass scaling apex Restraint by party size to paper over a problem
whose actual cause was a missing feature. That scaling is still there and still
correct — apexes should scale to their party — but it was reached for as a fix when
it should only ever have been a dial.

**The lesson worth keeping: a feature that "adds nothing" to the system you have
built so far may be the one that makes the system you have *designed* work.** The
bible said two weapons in phase 0. Three phases of evidence later, it still said two
weapons.

## Mechanics

- **Two slots.** The second stays empty until a second weapon is unlocked, so at
  rank 1 you genuinely have one gun rather than two pistols.
- **Each slot carries its own lethal and capture round**, its own magazine and its
  own reserve. Four loaded round types in total.
- **Switching weapons costs 0.9s**, against 0.6s for a chamber swap. The design
  never specified this; it needs to be longer than a chamber swap or the chamber
  swap stops being a decision, and it needs to be short enough that the
  anchor-switch-subdue rhythm is playable inside a six-second Anchor.
- `Q` cycles, `1` and `2` select directly, and the HUD shows both slots with their
  remaining rounds.
- Saves from before this change **migrate** rather than being wiped: an old
  single-weapon loadout becomes slot 1, with slot 2 empty.

---

# Phase 3, part 4: Weapon mods

`02-weapons-and-ammo.md` gives every weapon three mod slots — barrel, core, sight —
with four options each, and `game/data/weapons.json` has carried the full table
since phase 0. None of it was wired up. It is now, and it turned out to be the most
informative thing built this phase, because unlike packs or rifts it could be
*measured* against the existing balance work rather than just played.

## What a mod does

Numeric effects are proportional deltas applied to the base weapon before the fight
starts, so a mod is invisible to the rest of the engine: `loadLoadout` returns a
fitted weapon and everything downstream reads the same fields it always did. Two of
the published effects have no meaning in a top-down arena and are mapped honestly
rather than faked:

- `zoom` becomes **reach** (+15% range). There is no zoom to give.
- `reveal_through_cover` does **nothing**, and the bench says so. This arena has no
  cover. It is left in the data because the design's outdoor spaces will have some.

Three effects needed new machinery in the fight itself:

- **Recoil** did not exist. It is now deliberately **mod-only** — every stock weapon
  has zero — which means the existing balance numbers are untouched by definition,
  Fast Cycle is a real trade rather than a free upgrade, and Stabiliser only earns
  its slot next to something that shakes.
- **Noise** now drives the alert radius on a four-rung ladder
  (`silent`/`low`/`medium`/`high` → 0×/0.5×/1×/1.4× the wake distance), so a
  Suppressor buys distance rather than surprise.
- **Illumination**: Shadelet's `weak_point_requires: "illumination"` had never been
  implemented. Its weak point now has no position at all until a Thermal sight or a
  Lumen round lights it.

## A Suppressor must not be able to buy silence

The first version stepped noise down the ladder without a floor. Fitted to the
Sting Crossbow — which ships at `low` — that produced a `silent` weapon, and
`silent` means an alert radius of zero, which means *every shot keeps the Ambush
multiplier*. One barrel mod bought the Sylvan Bow's entire identity.

The floor is now: a mod can step you towards silence and stops one rung short of
it. Only a weapon that ships silent is silent. This is the second time a support
mechanic has quietly tried to hand out the bow's ambush bonus, and it will not be
the last — the rule belongs in the data eventually, not in `applyMods`.

## The sights had to cost the stock HUD something

`bio_scanner`'s published effect is "shows the exact Restraint meter". But the HUD
already drew a full-precision Restraint bar with exact figures next to it, so the
mod's effect was *nothing*. A mod whose effect is already free is not a decision.

So the stock readout was made worse, which is the honest direction:

- **Without a Bio-Scanner**: the meter is notched into quarters and the bar snaps to
  them, and the figure reads `■■□□`. You can see roughly where you are and you
  cannot tell 70% from 95% — exactly the judgement call the swap timing is supposed
  to be.
- **With one**: smooth bar, exact `65 / 110`, and a live `bolt risk 24%/s` chip —
  the flee chance the player has never been shown outside the dev panel.

`tracker_lens` rings the weak points you have already researched; it does not teach
you one you have never studied, so the Codex still has to be earned first.

Both gated sights read `requires: research_1` / `research_2` as **Codex progress**
(5 species at Research I, 3 at Research II) rather than a rank. They are the only
unlocks in the game that walking cannot buy, which is what the bible means by
putting them "behind Codex research". The gate is enforced on the way into the
fight, not only at the bench, so an edited save cannot smuggle one in.

## What the mods actually do — and a measurement that was wrong twice

`MODS=1 node game/tools/balance_sim.mjs` runs each mod alone against Cinderfang.

The first run said **every mod that changes a number makes culling worse**, by up to
19 points, including Extended Cell — which has no damage or rate penalty at all and
cannot possibly make you worse at killing. That was my own harness lying again.
Fitting a mod shifts the RNG stream (a different magazine reloads on a different
frame), so the runs are *not* paired with the baseline; they are independent
samples. `MODNOISE=1` measures the noise floor directly: the same strategy, same
code, only the seed base changed, scores **79%–89% at 200 runs**. My baseline had
landed on the luckiest base in that range and every mod was being compared against
it. The diagnostic now runs 800 apiece and prints "(noise)" against anything inside
±2.5 points.

With that fixed the table is clean, and it says something good about the design:

```
cull                         soften_30 (capture)
mod             win   Δ      mod             win   Δ
stock           85%   —      stock           82%   —
suppressor      76%  -9pt    suppressor      88%  +6pt
flechette       79%  -6pt    flechette       91%  +9pt
potency_coil    74% -10pt    potency_coil    87%  +5pt
extended_cell   72% -13pt    extended_cell   84%  +2pt (noise)
```

**Every mod that trades damage away is a loss for killing and a gain for taking
alive.** Nobody designed that; it falls out of the wound multiplier. Lower damage
means the target spends longer in the wounded band where Restraint accrues fastest,
which is the whole reason softening works. The barrel and core rails are therefore
already a kill-build/take-alive-build split with no rebalancing needed.

## Extended Cell: a bigger magazine does not remove the reload, it *moves* it

Extended Cell survived the noise correction at **−13 points on the cull**, which
still looks impossible: +50% magazine, no damage change, no rate change, and it
reloads *less often* (0.86 reloads per fight against 1.22).

The mechanism, once measured, is the reload's **position**:

| | stock (mag 8) | Extended Cell (mag 12) |
|---|---|---|
| first reload at shot | 8.0 | 12.0 |
| seconds below the flee threshold | 1.03 | 1.35 |
| …of which spent reloading | 0.18 | **0.63** |
| fights reaching `flee` at all | 363/800 | 452/800 |

Cinderfang dies in about 13.7 shots. With a magazine of 8 your one reload lands at
shot 8 — while the target is still healthy and the flee roll is not even running.
With a magazine of 12 it lands at shot 12, which is inside the window where the
target is below its flee threshold and rolling to bolt every frame. You reload less
and are punished more, because the reload you do take is the one that matters.

This is not a bug and has not been "fixed". It is the most interesting thing the
mod table produced: magazine size is not a quantity, it is a *phase* relationship
with how long the target takes to die. Extended Cell is a capture-build mod — where
`sedated`, `ensnared` and `calmed` suppress the flee roll outright — and a trap in a
cull build. Nothing on the card says that, and nothing should; it is the kind of
thing a player works out.

## Mechanics

- **One mod per category per slot.** Mods are fitted to the slot, cleared by
  clicking the fitted card again, and replaced by clicking a sibling.
- Mods are **free and reversible** — they are not consumed and there is no cost.
  Their scarcity is the three slots, not a currency.
- Changing a slot's weapon clears its mods; re-picking the same weapon keeps them.
- Saves from before this change **migrate**: every slot gains an empty `mods`
  object, and nothing else is touched.

## Still open

1. **Party play**, still the honest answer to multi-capture and the two Titans.
2. **Codex sharing and field reports** — the last unbuilt item in phase 3.
3. The Anchor lasts six seconds, which allows roughly one crossbow magazine per
   application. That rhythm feels right on paper but has never been played.
4. The noise floor now lives in `applyMods` rather than in the data. A weapon that
   ships silent should carry that as a property mods cannot touch.
5. Mods are unlocked, not owned. If they should ever be crafted or found, the
   inventory hook does not exist yet.
6. The phase 1 browser suite's "fight reaches an outcome" test has failed
   intermittently against fast fliers in packs. It passed ten runs in a row after
   this change; the diagnostic now reports how many loops it ran and what stopped
   it, so the next failure will say why rather than just that.

---

# Phase 3, part 5: The Codex as a record

The last named phase 3 item was "Codex sharing and field reports". Three of the
four things `07-codex-wiki.md` lists under Sharing need a server and are not
prototypable here; the fourth — field reports — needs nothing but a canvas, and it
turned out to be the one that forced the rest of the work.

## What a field report needs, and what the Codex did not have

`07` describes the card as "species, method, approximate area, HP remaining". Three
of those four existed. The interesting absence was the fourth thing the same
document asks for two panels earlier:

> Largest **2.31 m** (98th percentile)

Nothing in the build had a height, a percentile, or any notion that two Cinderfangs
might differ. And `07` is explicit about why that matters:

> Note the bottom panel. The species data is the same for everyone; **Your Records**
> is not, and that is what makes the Codex worth opening more than once.

So the card came second. First, every monster had to become an individual.

## Every specimen is measured, and nothing else changes

Each monster now rolls a height when the fight starts. The species' own typical
height is **derived, not authored**: its HP position within its size class's
`hp_band` places it within that class's `height_m` band, so Cinderfang (310 HP in a
Strider's 220–520) comes out at 1.59 m of a 1.2–2.5 m band. A heavier animal is a
bigger animal, and no new data file was needed to say so. The roll is normal about
that mean at σ ≈ 8.5%, clamped to the class band: a Strider is never taller than a
Strider.

**It affects nothing.** Not HP, not Restraint, not the drawn radius. That was a
decision, not an oversight:

- `07` frames it as a record — a brag — and the showcase it feeds is "largest,
  cleanest, weirdest", not "strongest".
- Scaling the *hitbox* by height would be a real difficulty change dressed up as
  cosmetics, and would silently re-open every balance figure measured across four
  phases.

The percentile is computed against the **species**, at roll time, from the normal
CDF. Ranking a specimen against your own catalogue would mean your third-biggest
becomes the 40th percentile the moment you catch a fourth.

## A cosmetic number cost five points of culls before it was moved

Rolling the height from the fight's own RNG shifted every draw after it. The phase 0
headline table moved — skilled cull 63% → 58% — not because anything got harder, but
because every seed now produced a different fight. That is the same decorrelation
the weapon-mod diagnostic ran into one section above, and it is much worse here:
the mod table is a diagnostic, but `10-phase0-findings.md` publishes numbers that
are supposed to reproduce.

The specimen roll now draws from its **own stream** (`opts.specimenRng`, defaulting
to `Math.random`). The balance table is byte-identical to the commit before this
one.

**The rule this establishes: anything that does not affect the simulation must not
draw from the simulation's randomness.** A cosmetic feature is allowed to be
cosmetic in the numbers too.

## An evolution carries the percentile, not the height

The first version kept a resident's measured height across an evolution, which made
a 0.80 m Sootpup into a 0.80 m Cinderfang — the smallest Cinderfang ever recorded,
from the biggest Sootpup you ever caught. Evolution now carries the **percentile**
and re-derives the height against the animal it became (0.80 m at the 95th → 1.81 m
at the 95th). A runt stays a runt; the giant you raised stays a giant.

This needed an inverse normal, which is the one piece of real maths in the change.

## The card

`js/report.js` renders a 1080×1350 PNG offscreen: element-tinted wash, portrait
scaled by percentile, name and dex number, chips for height / percentile / HP
remaining, then method, area and date. It saves through a blob download and shares
through `navigator.share({files})`, falling back to the download when a browser
advertises share without file support — which iOS does.

The location rule from `09-risks-and-roadmap.md` is enforced **in the renderer**,
not trusted to the caller: the card draws a biome name and has no code path that
reads a coordinate, a tile or a distance. You can hand `drawFieldReport` a latitude
and it will ignore it, which is what the test does.

Two things went wrong drawing it, both the same shape — text with no bound. A long
family blurb walked out of the bottom of its panel (a card has no scrollbar), and
the panel itself was 40px too short. Both fixed; the wrap now clamps to three lines
with an ellipsis.

## Completion rewards, and a reward that reaches the bench

`07`'s completion table was unbuilt. Two rungs of it are now in:

- **Family complete (every stage, every branch) → +1 Sanctuary habitat slot.** The
  Codex now pays into progression, not just the rank track.
- **All 12 families at stage 1 → the Bio-Scanner, permanently.**

The second is the interesting one, because of what landed one section earlier: the
Bio-Scanner is the sight that turns the coarse quarter-notched Restraint meter into
exact figures. The completion reward now outranks its research gate — the only
unlock in the game you earn by *breadth* of collection rather than depth of study,
and it is worth having precisely because the stock HUD was made worse to make room
for it. Neither half of that was designed with the other in mind; they were built a
day apart and the hook was already in the bible.

## Also in

- **Lineage is surfaced.** A resident that has been through two evolutions says so.
  It has been recorded as `evolvedFrom` since phase 2 and nothing had ever displayed it.
- **Specimen showcase** — pin up to three residents, fourth pin refused.
- Culled specimens are measured too. You had it in front of you.

## Still open

1. **Party play**, still the honest answer to multi-capture and the two Titans, and
   still not prototypable without netcode.
2. **Public profiles and local leaderboards** need a server by definition. The
   pieces they would read — completion %, family banners, apex captures, the
   showcase — all now exist locally, so what is missing is transport, not data.
3. The card's portrait is the arena silhouette: a tinted disc with its weak points
   marked. `07` wants "a 3D model rendered from your specimen". The layout has the
   hole for it.
4. Rift events still ignore the bestiary's placement rules — Karrahk wants waterside
   in a storm, Nyxhollow wants midnight, and neither is honoured.
5. Habitat affinity is thin, and pack morale and mixed-species packs remain unbuilt.

---

# Phase 3, part 6: The escort — decision 1, answered with numbers

`09-risks-and-roadmap.md` opens with seven questions marked *"these are the ones
that change architecture, so they want answering before code"*. The first is:

> **Do Sanctuary residents fight alongside you?** Yes (pet sim) / No (pure
> collection) / Limited: one resident gives an active ability. *Leaning: **Limited.**
> Full pet combat doubles the combat scope.*

Phase 4 says it will build "whatever question 1 and 4 resolved to", and a leaning
is not a resolution. This builds the Limited option so the question can be settled
by measurement instead of instinct — and it is the first time anything you catch
does something in a fight rather than sitting in a stat bonus.

## The limits are the design

- **One escort**, chosen out of combat.
- **One charge per encounter.** Not a cooldown — a cooldown makes it a rotation to
  optimise, and a rotation is a pet sim with extra steps.
- **It never acts on its own.** Nothing the escort does happens without a press.
  That is the whole line between "Limited" and "Yes".
- It arms three seconds in, so Shroud cannot be used to open an ambush you are
  already getting.

The ability comes from the resident's **first element**, so the nine elements that
already carry an identity through the type chart and the passive bonuses now carry
a verb as well:

| Element | Ability | What it does |
|---|---|---|
| Ember | Scorch | Burns over time, and never lands the last point |
| Tide | Undertow | A burst of Restraint, scaled by the wound multiplier like a dart |
| Verdant | Rootgrasp | Ensnares |
| Stone | Bulwark | Absorbs the next blows before the Warden feels them |
| Gale | Downdraught | Shoves it back and spoils a windup |
| Volt | Jolt | Slams both chambers full |
| Gloom | Shroud | The whole pack forgets you — Ambush is live again |
| Lumen | Kindle | Lights a hidden weak point |
| Rift | Fracture | Strips armour for a window |

Three of them reach straight into work from earlier this phase: Kindle drives the
illumination system built for Shadelet and the Thermal sight, Fracture stacks with
mod pierce and apex phase breaks, and Shroud is the only thing besides the Sylvan
Bow that can hand you the Ambush multiplier.

## Strength comes from stage, which is the first combat payoff for evolving

An ability scales on its **magnitude**. One with no magnitude — Rootgrasp is a
duration, Kindle is a duration — scales on its **duration instead, at half rate**,
because a stage 3 Rootgrasp holding a target for four and a quarter seconds stops
being a window and becomes a stun. Never both, or Scorch would compound to 2.3×.

Shroud and Jolt scale on nothing, and that is a real property rather than an
oversight: awareness is reset or it is not, the magazine is full or it is not.

## A "never kills" clamp that could not be killed through

The first version of Scorch read:

```js
m.hp = Math.max(1, m.hp - tick);      // "burn softens, it does not finish"
```

The intent was sound — an escort that finishes your capture for you is a feel-bad,
and softening into the wound band is what Scorch is for. The implementation was
catastrophic. `applyLethal` leaves a killed monster at exactly `hp === 0`, and the
death check sits **thirty lines below** the burn tick in the same function. So
every killing shot was undone on the next frame: the clamp raised a dead monster
back to 1 HP.

A burning Cinderfang could not be killed at all.

```
cull            win   esc     Δwin
none            85%   15%       —
ember/Scorch    27%   74%    -58pt      <- before
ember/Scorch    88%   13%     +3pt      <- after `if (m.hp > 1)`
```

Nothing in the game would have reported this. The monster did not look immortal —
it looked like it kept fleeing at the last second, which is a thing monsters
legitimately do. It took a diagnostic that asks "what is each ability worth" to
produce a number so absurd it had to be a bug.

## Does it trivialise the fight? No — and the interesting part is *where* it helps

`ESCORT=1 node game/tools/balance_sim.mjs`. The bot presses the charge the instant
it arms, which is the worst play available, so these are a floor.

Against a Cinderfang with a Marker Pistol — a fight you already win 85% of:

```
cull                          soften_30 (capture)
none            85%    —      none            82%    —
ember/Scorch    88%  +3pt     ember/Scorch    75%  -7pt
volt/Jolt       74% -11pt     tide/Undertow   85%  +3pt
gale/Downdraught 77%  -7pt    verdant/Rootgrasp 85% +3pt
```

Nothing is a win button. The largest single effect is 11 points, and it is
**negative** — Jolt tops the magazine up early and relocates the one real reload
into the window where the target is deciding whether to bolt, which is precisely
the Extended Cell finding from part 4 arriving by a different road. Scorch splits
the same way the damage-reducing mods did: +3 on a cull, −7 on a capture, because
burning a target past its flee threshold early makes it bolt before you can dart it.

Against a Railmane with a Longtooth — a fight you *lose*, driven off 72% of the
time:

```
escort              win   esc   down   HP left   Δwin
none                 21%    6%    72%     27.6      —
verdant/Rootgrasp    61%   14%    26%     74.3   +40pt
stone/Bulwark        46%   31%    24%     51.0   +24pt
ember/Scorch         21%    6%    72%     27.8    +0pt  (noise)
rift/Fracture        21%    6%    72%     27.6    +0pt  (noise)
```

**The escort is a survival tool, and only the defensive abilities matter where it
counts.** One charge turns a fight you lose four times in five into one you win
three times in five. It does not win it for you; it makes an unwinnable encounter
an encounter. That reads exactly like "Limited" should, and it is a much better
answer than the win-rate-neutral result I expected.

Note what Bulwark does to escapes: 6% → 31%. Surviving longer means the monster
gets more seconds to flee. Nothing in this game is free.

## A column that had to be added to see the design working

Stage 1 and stage 3 Bulwark produced **identical** win rates against Railmane —
46% / 31% / 24%, to the digit. Not a scaling bug: Railmane hits for 104 against a
100 HP Warden, so a 34-point shield and a 58-point shield both buy exactly one
extra hit and every fight plays out the same.

A flat shield only matters when it crosses a whole-hit boundary. The diagnostic now
prints **Warden HP left**, where the difference is plain (51.0 → 68.8), and that
column is the one to read for any defensive ability. It is the second time this
phase that a real effect was invisible in the headline number and obvious one
column over.

## Also in

- The escort orbits the Warden in the arena, tinted by its element, pulsing while
  its charge is live and going grey when spent. It has no collision and takes no
  damage, because it is not a combatant.
- `F` on a keyboard, a labelled pad on touch, and the button itself reads
  `Scorch 2.6s` → `F · Scorch` → `Scorch — SPENT`.
- Releasing your escort clears the slot instead of leaving a dangling uid.
- `applyLethal` is now exported as a measurement seam, so a suite can ask what one
  body shot does right now without simulating a trigger pull.

## Still open

1. **Party play** — the last untouched phase 3 item and still netcode-bound.
2. **Public profiles and local leaderboards** — transport, not data.
3. Downdraught looks weak in the table (+2pt against Railmane) because the bot
   presses it on a timer rather than on a telegraph. It is the one ability whose
   value the harness cannot measure, and the one most worth playing by hand.
4. An escort brings its ability but takes no risk. Whether it should be able to be
   hurt — and whether that turns "Limited" back into a pet sim — is untested.
5. Nine abilities, nine elements, one per resident. Dual-element species use their
   first element only, which quietly makes the second element decorative here.
