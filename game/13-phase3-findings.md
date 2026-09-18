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

---

# Phase 3, part 7: Decision 2, and the cost of a timing bar

The second architectural question in `09-risks-and-roadmap.md`:

> **Is combat real-time aim, or tap-to-shoot?** Free aim / lock-on with a timing
> bar / hybrid. *Leaning: **Hybrid.** Free aim on a tripod-steady phone is
> miserable while walking.*

This is the biggest untested risk in the project. Everything built so far assumes
free aim with a mouse, and the game is for a phone held in one hand by someone
walking. So: build the alternative, and measure both against honest input.

## What assisted aim is

A lock, a lead, and a ring.

- **Lock.** Focus holds on one pack member until it is resolved, or `T` cycles it.
  In free aim, focus follows the crosshair; with no crosshair it has to hold.
- **Lead.** The assist puts the round where the target will be. This is the part a
  thumb cannot do and the main reason the mode exists.
- **Ring.** It restarts on every shot, sweeps two shot intervals, and has a gold
  band placed *after* the weapon comes off cooldown. Fire inside the band and the
  round is sent at a weak point; fire early — which is what holding the trigger
  does — and it sprays.

The projectile system is untouched. An assisted shot is still a real bullet with
travel time that a monster can still move out of; only its heading changes.

Tying the sweep to the weapon means every gun gets its own tempo for nothing: a
Marker Pistol beats at 0.67s, a Longtooth at 2.67s.

## Three versions, two of them worse than mashing the trigger

**v1: a fixed 1.15s ring on wall-clock time.** Waiting for the band cost roughly
three shots in four. Perfect timing scored **7%** on a cull; mashing scored **91%**.
A 2.5× weak point cannot pay for a 3× loss of rate, so the mechanic was a straight
tax on playing well.

**v2: the ring tied to the weapon, but still on wall-clock time.** Better — perfect
timing reached 66% — and still worse than mashing's 87%. Any mechanic that asks you
to *wait* on a cooldown-limited weapon is spending the only currency that matters.

**v3: the ring restarts on each shot.** Now the band is a fixed offset after the
previous shot rather than a place on a clock you have to chase, so hitting it costs
about 44% of your rate instead of 75%, and buys a 2.5× multiplier. That pays.

The lesson generalises past this game: **a timing mechanic layered on a
cooldown-limited weapon has to be anchored to the cooldown, or it is competing with
rate of fire and rate of fire wins.**

## The bug that made the whole mode look like a bad idea

Between v2 and v3, assisted aim measured *catastrophically* bad — 0% wins, 56%
accuracy, timeouts. The cause was four lines of ordering inside `fire()`:

```js
w.sinceShot = 0;                    // restart the ring
...
const a = assistedAngle(f, speed);  // ...then ask the ring how we did
```

Every assisted shot was judged at phase zero — maximum error, gold never once. The
mode was never actually switched on, and the diagnostic reported that as "assisted
aim is bad" rather than "assisted aim is not running". It took instrumenting a
single fight, shot by shot, to see `gold: 0` next to a run of perfectly-timed
trigger pulls.

## The ring is a dial between accessibility and skill, and that is the finding

Before settling, the off-beat penalty was swept. It is a straight trade:

| off-beat error | floor (walking) | ceiling | skill spread |
|---|---|---|---|
| 0.19 rad | 74% | 85% | 11pt |
| 0.42 rad | 41% | 89% | 48pt |
| 0.75 rad | 0% | 89% | 89pt |

Free aim on the same walking input scores **43%**. So a punishing ring hands
straight back the accessibility the mode exists to provide: at 0.42 a walking
player is no better off than they were with free aim, and at 0.75 they are ruined.
There is no setting of this one knob that buys both.

**The lock is what lifts the floor. The ring can only ever spend that floor to buy
skill expression back.** So it is set forgiving — and one further change gave the
skill back for free.

## Letting the ring loop gave back the gradient at no cost

The ring originally clamped at the end of its sweep: miss the beat and it sat
pinned at "missed" until you fired anyway, and the first shot of an encounter could
never be gold. Making it **loop** means missing the beat costs one sweep — 0.67s on
a pistol — instead of the whole opportunity.

That single change moved the cull numbers from *floor 74 / ceiling 85 / spread 11*
to:

```
CULL                                  win   esc    acc   weak%   time   shots
  FREE AIM
    steady   (both hands, sitting)    64%   37%    97%    65%    4.5s    10.4
    shaky    (one hand, standing)     86%   14%    90%    44%    5.9s    13.8
    walking  (one thumb, moving)      43%   41%    63%    34%    9.5s    20.1
  ASSISTED
    on the beat                       95%    5%    98%    62%    6.5s    11.3
    roughly                           77%   24%    97%    51%    5.7s    11.7
    mashing                           85%   15%    89%    46%    6.0s    13.9

  floor: 43% → 77%   ceiling: 86% → 95%   skill spread: 43pt → 19pt
```

A walking player goes from 43% to 77% by doing nothing but switching mode. A player
who reads the ring reaches 95%, above anything free aim manages. The gradient is
smaller than free aim's 43 points, and it should be — that difference is the part
of free aim's "skill" that was really just input quality.

## And on a capture run, precision is a liability — for the third time

```
SOFTEN_30            win    esc
  on the beat        64%    37%
  roughly            75%    25%
  mashing            86%    14%
```

Exactly inverted. Landing weak points wounds the target faster, which walks it past
its flee threshold before you can swap chambers and dart it, so it bolts.

This is the third time this phase the same shape has appeared from a completely
different direction: the damage-reducing weapon mods (Suppressor, Flechette,
Potency Coil) all lose culls and win captures; Scorch is +3 on a cull and −7 on a
capture; and now precise aim is worth +10 on a cull and −22 on a capture. **This
game systematically rewards doing less damage when you intend to take something
alive**, and it falls out of the wound multiplier and the flee threshold
interacting, not from anything anyone designed. It is the most load-bearing
accident in the system.

## The answer to decision 2

**Hybrid, with the emphasis moved.** The roadmap's leaning is right that free aim
is not the answer for a phone, but its framing — a timing bar *as* the skill
mechanic — is not what the numbers support. The lock and the lead do the work; the
ring is a reward path for players who want one, and must never become a tax on
players who do not. Free aim stays, as the default, because with a mouse it is
still the better instrument at the top end of a cull.

Both modes ship. It is a setting, and the setting persists.

## Also in

- A cap on the monster velocity estimate the assist leads with. A position change
  that is not movement — a teleport in a test, a future knockback — otherwise reads
  as enormous speed and throws the shot off the map. This project has now been
  bitten twice by a position jump being read as velocity; the third time it is
  impossible.
- A bracket on the locked target, a `T` key and a `TARGET` pad to cycle it, and the
  pad row now wraps rather than pushing a phone sideways at six buttons.

## Still open

1. **Party play** — the last untouched phase 3 item, still netcode-bound.
2. **Public profiles and local leaderboards** — transport, not data.
3. Assisted aim has never been played by a human on a real phone, which is the only
   test that actually settles decision 2. Everything here is a bot with a plausible
   model of a thumb.
4. The AR camera question (decision 3) is still untouched, and unlike 1 and 2 it
   cannot be prototyped in a canvas.
5. Assisted mode ignores the crosshair entirely, so the Splitbore's pellet cone and
   the Lattice Launcher's area shots have no aim point of their own. Both still
   work, but neither is *placed* — they just go where the lock is.

---

# Phase 3, part 8: The world learns to read its own bestiary

The rift events built in part 2 picked their apex at random. The bestiary has always
said otherwise:

| Apex | Published placement |
|---|---|
| Karrahk | `waterside`, `requires_weather: storm` |
| Nyxhollow | `urban_core` or `woodland`, `midnight` |
| Aeonrend | `rift_event`, `event` — no further conditions |

A rift dropped Karrahk into a car park at two in the afternoon. Fixing that turned
out to be the smallest part of the job.

## Three words the engine had never learned

The bestiary has used `midnight`, `event` and `requires_weather: "storm"` since
phase 0. The engine understood none of them and said nothing:

- `timeWindow()` returns exactly four values — dawn, day, dusk, night. `midnight`
  and `event` matched nothing, ever.
- The weather table has `thunderstorm`. Nothing mapped `storm` to it, so the only
  weather condition in the whole bestiary could never be satisfied by any weather
  the world produces.

Two of the three apexes were therefore unplaceable by their own rules, and the
only reason they appeared at all was that the code was ignoring the rules.

There is now a placement layer — `inTimeWindow`, `weatherIs`, `placementFits` —
and, more usefully, a `PLACEMENT_VOCABULARY` export and **a test that walks every
placement term the data uses and fails if the engine does not speak it.** That is
the check that would have caught this in phase 0, and it is the generalisable
fix: content and code drift apart silently, and only an assertion that compares
them catches it.

## A schedule that could not reach the one window it needed

Honouring `midnight` was not enough, because rifts opened between 08:00 and 21:00
and ran 75 minutes with the apex in the last 20. The latest possible apex window
was **22:35**. Nyxhollow's only window was unreachable by construction: the rules
would have been obeyed to the letter and the species still never seen.

Rifts now open 08:00–23:00. A late rift is rare, which is right — a midnight apex
should take planning.

## Honouring the rules makes them vanish, so announce them

With the conditions enforced, Karrahk is **0.4%** of rifts and Nyxhollow **1.1%**.
Within the 1.2 km the live rift list scans, neither turns up in a month.

The answer is not to loosen the rules. It is the thing `09-risks-and-roadmap.md`
already asked for and the build had never delivered: rifts are *"scheduled,
announced ahead"*. There is now a **rift forecast** that scans about 8 km of city
across four days and says when and where each apex is next due — a Karrahk roughly
every three days, a Nyxhollow every two.

What it will not tell you is *why* a given rift carries that apex. The conditions
stay behind **Research II**, which is exactly what `07-codex-wiki.md` sells at that
tier: "spawn biome, time window, weather modifier — you can hunt it deliberately
instead of hoping." Until then the board reads `Research II reveals its conditions`.

That is the first time research on an apex has been worth anything.

## And then the world turned out to have dead ground

Chasing an intermittent phase 1 failure — `spawns generated — 0 in range` — into a
per-biome density count turned up this:

```
industrial   12 species     urban_core   15     woodland    12
open_ground  12             waterside     9     works        9
parkland      9             transit       6     residential  0
```

**`residential` is 16% of the map and had nothing living in it.** It is also the
biome a player is most often standing in, because it is where people live.

`08-world-and-progression.md` is explicit about the intent — *"Mixed, low rate"*,
*"deliberately the thinnest table"* — and the generator implements that faithfully
with a 7% tile rate, the lowest on the map. No species listed the biome, so 7%
was really 0%.

It now has a mixed table: one common species from each of six families — Ember,
Verdant, Stone, Volt, Gloom, Lumen — so no element dominates. A bit of everything
and a lot of nothing, which is what "we do not want the optimal play to be standing
in someone's front garden" should feel like.

The suite that had been failing on this intermittently for weeks carried a comment,
which I wrote, saying *"a residential tile only spawns 7% of the time, so an empty
patch is the world working"*. It was not the world working. **A comment that
explains away a failure is worth exactly as much as the measurement behind it, and
that one had none.** There is now a check that every biome the generator can
produce has something that lives in it — the mirror of phase 2's "every wild species
is reachable".

## Two regressions the suites caught, and one theory they disproved

**The forecast board made the patrol view overflow, and the map canvas painted over
the tab strip.** The Sanctuary tab was visible, enabled, and unclickable — Playwright
reported `<canvas id="map"> … intercepts pointer events` after 30 seconds of
retrying. A flex child that overflows paints outside its box. Fixed twice over,
because either fix alone would have hidden it again: the patrol view scrolls its own
overflow now, and the chrome sits in a layer above any view that overflows anyway.

**The rift suite jumped its clock to a window in the past.** It picked its target
with `riftsNear(...)[0]` — nearest by distance, out of today's *and* tomorrow's
rifts — and the widened schedule changed which one that was. It now picks through
the forecast: the soonest apex window still ahead, which is also what a player
would do.

And one theory that did not survive contact. The intermittent freeze looked like a
cache bug I had just written: the forecast recomputed whenever its result was empty,
so an empty result would never be cached and 196 rift schedules would rebuild every
frame. Plausible, and wrong — **0 of 200 world seeds produce an empty forecast, and
60 scans cost 14 ms.** The cache is still fixed, because caching only non-empty
results is wrong on its own merits, but it was never the freeze. The freeze was the
canvas above.

## Still open

1. **Party play** — the last untouched phase 3 item, still netcode-bound.
2. **Public profiles and local leaderboards** — transport, not data.
3. The forecast scans a fixed 8 km. A real build would scan what the player can
   plausibly travel, which is a different distance in Tokyo than in the Highlands.
4. Nothing warns you that the Karrahk you have been waiting for is in two hours.
   The board is a board; it is not a notification.
5. Residential's six species are a first pass. The design says "mixed", and six
   families out of twelve is only half a mix.

---

# Phase 4: the real world, 3D pixels, and a turn-based battle

Three requests at once, and one of them reverses a lot of what came before.

## The map is the Earth now

Positions are Web Mercator metres, so a position in the game is a position on a
real street and the spawn grid is anchored to the globe. The original `patrol.js`
header had predicted this would be easy — *"swapping the simulated walk for real
GPS is a matter of feeding different coordinates in"* — and it was, because nothing
downstream had ever cared where the metres came from. Three sources feed them now:
GPS via `watchPosition`, a dragged marker, and the simulated walk the tests use.

**Mercator metres are not ground metres.** At Westminster one is 0.62 of the other.
Every distance a player reads goes through `groundMetres`, the scale bar is in
ground metres, and the simulated walk divides the factor back out so a step is a
step at any latitude. Spawn tiles stay in Mercator metres deliberately: that keeps
the grid identical worldwide, which is what makes serverless deterministic spawns
work at all.

**Biome is read off the rendered tile.** Blue is water, green is vegetation, and
the built biomes — all grey, indistinguishable by colour — are still decided by the
synthetic generator. That is not a compromise; it is what keeps all nine biomes
reachable, and the placement suite's "no dead ground" check would fail if the map
were allowed to collapse them into one.

**The basemap defaults to off**, which is a privacy decision before a technical one.
Asking for a tile tells the tile host roughly where you are, and nothing should do
that before the player has asked for a map. The coordinate itself never leaves the
device.

A provider that sends no CORS header gets an `<img>` rather than a `fetch`. This
matters more than it sounds: `fetch(mode: 'cors')` *refuses* such a response
outright, so the map would not have drawn at all — and the module's own comments
were confidently describing a fallback it did not have.

## The monsters are built from their own Codex entries

Forty-three species, no artist, so each one is generated from what the bestiary
already says: family picks the silhouette, size the proportions, elements the
palette, stage the extra mass, and the weak points become glowing voxels snapped to
the nearest solid cube in the region the fight makes you shoot at.

The apexes had no family of their own — `apex` is a bucket, not a lineage — so all
three fell through to the default blob. They take their plan from their element
now: Karrahk coils, Nyxhollow looms.

The first renderer anchored every model at a fixed point, and since isometric
projection grows *upward*, a Titan ran off the top of its frame while a Mote
floated in the middle of its own. Measuring the projected box first and centring
second is the fix, and it is what every caller wanted anyway.

## The fight is turn-based, and the old balance work came with it

Your Sanctuary residents fight; the weapons became the capture step. That is the
shape the game was already pointing at — you raise monsters, so the monsters should
be what you bring — and it let four phases of measured work carry over instead of
being thrown away:

- `elements.json`'s effectiveness table is the type chart;
- `restraintRequired`, `woundMultiplier` and the status product from `ammo.json`
  became the **catch roll**, so a wounded sedated target is still easier to take
  and softening still beats leading with darts: 11% healthy → 22% wounded → 40%
  wounded and sedated;
- `skittishness` still decides whether it bolts.

### The type chart was invisible, and the attack stat was why

A Mote's attack of 10 against a Strider's 34 is a 3.4× swing, which buried the 2×
type chart underneath it. Measured: Tide-on-Ember did **8** damage while
Ember-on-Tide did **11** — "super effective" hitting for less than "not very
effective", with the headline mechanic of the entire game inverted.

Compressing the attack term to an exponent of 0.55 keeps a bigger monster
meaningfully stronger and leaves the type chart the loudest term. The same pairing
now reads 12 against 8, the right way round.

### The opening battle was unwinnable

At rank 1 you own no monsters, so the Warden fights with the gun. That was a flat
number, and it lost: twelve turns to be driven off with the wild monster on 2 HP.
The `uses_weapon: true` flag had been in the move data from the start and nothing
read it. Wired to the equipped weapon's damage, the opening is won 63% of the time
in about nine turns — winnable, not a formality.

### The arena is still here

Retiring it would mean deleting four phases of balance work and five test suites to
make a point. It is a setting in the world panel, the aim modes still apply to it,
and the phase 1 suite now says which combat it is testing rather than relying on
whichever is the default — which is how this was caught.

## What the sandbox could not verify

Tile hosts are blocked by this container's network policy, so the map has never
been seen rendering real streets from here. The suite serves its own tiles instead
— a quartered PNG with water, woodland, parkland and built ground in known
positions, plus a no-CORS variant and a 404 variant — which exercises the whole
path end to end and does not depend on OpenStreetMap being up. **The real basemap
is unverified by eye and will need a look on a device with a normal connection.**

# Phase 4, part 2: making the battle feed the game around it

Two of the three things the last section left open, and a third that was hiding
underneath them.

## Your monsters got stronger by sitting in their pen

A resident's level is `4 + floor(sqrt(study)/2) + (stage-1)*6`. Study came from
habitat time (1/minute), walking (25/km) and feeding (40 for three materials).
None of those involve the monster doing anything, and `finishBattle` granted
none of the three.

So the default combat mode — the thing you now spend the whole game doing —
taught your monsters **nothing at all**. In Pokémon terms: no experience from
battles. The raising loop and the fighting loop were two separate games sharing
a save file.

Study for fighting is now participation × opposition:

```
study = 5.5 × wildLevel × clamp(wildLevel / myLevel, 0.25, 2.5) × outcomeScale
```

Three deliberate choices in that line:

- **Participation is the gate.** Whoever was on the field learns; the bench does
  not. Swapping a weak monster in to share the lesson costs you the turn, which
  is the trade that makes it a decision.
- **No stage bonus**, although one is the obvious thing to write. `wildLevel`
  already adds six per stage, so a stage bonus counts stage twice — and that
  made the *harder* evolution the *cheaper* one in battles.
- **Winning is winning.** A cull teaches exactly what a capture does, because
  the game's thesis is that both are legitimate. Losing teaches a quarter;
  running away teaches less than losing, because you did not stay in it.

### The arithmetic was naive and the measurement said so

I calibrated by hand first: 400 Study at ~22 a battle is 18 battles, 1600 at
~100 is 16, near enough equal, done. I wrote that in the comment.

Then `STUDY=1 node game/tools/balance_sim.mjs` played real battles through
`battle.js` and accumulated Study until each threshold, 120 traces per tier:

| tier | battles | won | turns each | Study/battle | = passive |
|---|---|---|---|---|---|
| stage 1 → 2 (400) | 29.8 | 96% | 5.6 | 13 | 0.2 h |
| stage 2 → 3 (1600) | 31.0 | 76% | 9.0 | 52 | 0.9 h |

Thirty battles, not seventeen. Dividing a threshold by a nominal per-battle
figure ignores that **the reward shrinks as the monster you are raising outgrows
what you are fighting**, so the last stretch to a threshold is far slower than
the first. Only accumulating shows that. The comment now carries the measured
table instead of my arithmetic.

The ratio that matters came out right without being aimed at: a battle is worth
about 13 minutes of habitat time at tier 1 and 52 at tier 2, and takes two or
three minutes to play. Active play beats idling by roughly five to one, and
idling still earns its keep overnight.

## A pack of three was one monster and a lie on the engage card

`startBattle` built a single combatant and ignored `spawn.packSize` entirely,
then resolved the whole spawn. The engage card said "Sparkmite ×3", you fought
one, and the other two evaporated — a phase of pack work bypassed by the default
combat mode.

A pack is a **queue**, not a crowd: one member at a time, each its own
individual with its own measured height and its own Restraint requirement.
That is the only reading that keeps the rest of the engine honest, because
Restraint, the catch roll and the flee check are all written about an
individual. What makes a pack hard is that **your side does not heal between
members**, so the third one meets whatever the first two left of you.

The replacement does not act on the turn it arrives. Without that the order loop
runs straight on past the member you just downed and lets a fresh, full-health
monster hit you in the same turn — a pack of three would collect three free
attacks purely from the shape of a `for` loop. There is a check for it now.

Per-member results come back in the same shape the arena's `fight.results`
already used, so a pack can still end as two culls and a capture and **the Codex
cannot tell which combat mode you played**.

## And underneath both: an apex fight was 118 turns

This one was found by accident. The Study diagnostic reported stage 2 battles
running 21 turns against stage 1's 7, which is not a Study problem, so I measured
turns-to-kill in a mirror match across all 43 species:

| stage | median turns | worst |
|---|---|---|
| 1 | 6 | 9 |
| 2 | 14 | 27 |
| 3 | **41** | **Karrahk, 118** |

Nobody taps a button 118 times. The apexes — the fights the entire rift system
exists to deliver — were unplayable, and it had gone unnoticed because
everything anyone had actually played was stage 1.

The cause was the fix from the previous section. Damage was

```
base_damage × (power/50) × (attack/30)^0.55 × effectiveness × stab × roll × (1−armour)
```

That `^0.55` is what rescued the type chart from being buried under the attack
stat. But **health did not get the same treatment**: health grows with level,
size class *and* evolution stage, while damage now grew with the 0.55 power of
one of those. Every tier of the game was slower than the last, compounding.

Damage is now a share of what it is hitting:

```
defender.maxHp × 0.15 × (power/50) × (attackRatio)^0.55 × effectiveness × stab × roll × (1−armour)
```

Turns-to-kill is scale-free by construction. Measured over the same 43 species:
**7 turns at stage 1, 7 at stage 2, 8 at stage 3**, with the whole bestiary
inside 12. And the thing the compression was protecting survives intact — a
super-effective move takes 47% of a target's health where a resisted one takes
22%, so the chart is worth 2.1× and is plainly visible in the bar.

The extremes stay extreme, which is the point. Karrahk one-shots a Glimmerfly.
A Glimmerfly needs 44 turns to fell a Karrahk — it will be dead long before, and
that is the correct answer to bringing a Mote to an apex rather than a number to
tune away.

## The suites could not fail

While chasing a flaky check I noticed the run announcing **`all suites passed`
with a red `FAIL` line above it**.

Every suite ended `process.exit(errors.length ? 1 : 0)` — it exited on console
errors and on nothing else. The `ok()` helper printed `PASS` or `FAIL` and threw
the result away. So for fourteen suites and several hundred checks, a check
could go red and the build stayed green.

A check that cannot fail the build is a comment with extra steps. All fourteen
count failures now and exit on them.

The check it was hiding was `aim`'s ninth: a never-aiming assisted player
finishes about a third of its fights, so over six fights it expects **two**
culls, and zero came up about half the time against an assertion wanting at
least one. It was failing two runs in three on `main`, invisibly. At 24 fights
the count is 7 to 11 against free aim's flat zero — a signal rather than a coin
toss. The threshold is 3, with margin.

That makes it three bugs in this section found by measuring something else:
the 118-turn apex was found by a Study diagnostic, and the dead check was found
by a flake in an unrelated suite.

### And one it surfaced that is not yet explained

With failures counting, a full run turned up a phase 1 (arena) failure that had
never been visible before:

```
FAIL  fight reaches an outcome — unresolved after 59 loops, stopped on "no live target"
  {"pack":["escaped 210/210","escaped 133/210","escaped 193/210"],"outcome":"driven_off",
   "restraint":"0/265","shots":24,"hits":4,"ammo":"L 0+0 / C 8+4","playerHp":0}
```

The scripted player lost a Voltfang ×3 fight — legitimate — the engine set
`driven_off` correctly, and `finishFight()` ran (the next check confirms the
profile recorded it). But the result overlay never became visible inside the
three seconds the suite waits, so the encounter is a soft-lock for as long as it
lasts: the fight is over and the screen does not say so.

**What is known:** it is rare — once in about thirteen `phase1` runs. It is in
the real-time arena, which this section's diff does not touch: the arena reads
no `battle_rules`, `game.js`/`rules.js`/`render.js` are unchanged, and `smoke1`
pins itself to arena mode so none of the turn-based code runs. Six targeted runs
on the branch point and six on this work both passed 6/6, including seven
`driven_off` endings between them that displayed correctly.

**What is not known:** why that one did not. Forcing `driven_off` two other ways
— running the magazines dry, and standing still at 1 HP against an aware pack —
would not reproduce it, and there were no console errors, which rules out the
obvious candidate of an exception in `showOutcome` being swallowed by the frame
loop's catch.

It is left open rather than guessed at. It is listed below.

# Phase 4, part 3: what a phase means in a turn system

The apexes were the last thing the turn-based battle had no answer for. The
bestiary has always described them as staged fights — *"phase 1 breaks armour,
phase 2 floods the arena, phase 3 exposes the core"* — and the real-time arena
has always implemented that. The turn battle did not, so a rift boss was a large
stat block with a sensible number of turns in it and none of the shape.

## The design question, answered from the bestiary rather than invented

A phase in the arena is an HP band that moves the weak point, strips armour and
wipes your Restraint. Two of those three have no meaning in a turn system —
there is no aiming, so there is no weak point to move — so the question was what
a phase should *take away from you* instead.

The bestiary already said, per apex:

| apex | its line | what that becomes in a turn |
|---|---|---|
| **Karrahk** | "phase 3 exposes the core" | it **cannot be caught** until phase 3 |
| **Nyxhollow** | "extinguishes light… countered by a Lumen carrier" | it **hides its own health bar** unless you brought Lumen |
| **Aeonrend** | "element multipliers are flat 1.0 both ways" | the **type chart is switched off** |

Plus, for all three: armour sheds per phase, and the moveset changes — an apex
fights *differently* each phase rather than just harder.

## One table, read by both combat modes

The arena owned the phase definitions in a `const` inside `game.js`. Adding
phases to the turn battle meant either duplicating that table or inventing a
second one, and those are the same bug with different symptoms. The table moved
to `apex_phases` in `elements.json`; both modes read it off the loadout, and a
check holds them to it.

That move is not free: the arena's armour curve was a generic
`1 - 0.18 × (phase - 1)`, and the per-phase table is not evenly spaced, because
"exposes the core" is a bigger event than the step before it. Karrahk's final
phase now strips to 0.4 rather than 0.64. The `rifts` suite passes unchanged.

## Three things measurement changed

**A burst skipped a whole phase.** A Verdant party took Karrahk from phase 1 to
phase 3 in a single hit — `phaseAt` reads the band off current health, so a big
enough hit jumps two. The arena gets away with it because its fights are long
enough to cross bands one at a time. A break now advances **one phase per
turn**, which makes the phases content rather than probability.

**The type chart nearly deleted the fight.** Relative damage multiplies a
*fraction of health*, so Karrahk's quadruple Verdant weakness with the
same-element bonus came to **0.9 of the bar in one hit**. Measured:

| party | hits to fell Karrahk |
|---|---|
| Bramblewarden (Verdant, 4× weakness) | **4** |
| Pyrecrown (Ember, resisted) | **38** |

One end skips the phases the fight exists for; the other is a slog. Apex damage
is now banded to 6–16% of the bar per move, which lands those two at **7 and 17
hits** — the counter is still plainly worth bringing, at about 2.4×, without
deciding whether the fight happens at all. Ordinary monsters are *not* banded:
Karrahk one-shotting a Glimmerfly is the correct answer to bringing a Mote to an
apex, and it stays.

**The catch gate did nothing, because every phase read 2%.** An apex's derived
capture chance is 0.04% — the Restraint maths is built for a monster you could
plausibly carry home, and a Titan with 1100 base Restraint is not that, so the
0.02 floor rounded every phase to the same number. An apex's chance is
**designed per phase** now: a ceiling in the data, scaled by the ratio of your
Restraint value to the ideal shot, so softening and sedating still matter and no
new constants are invented.

    Karrahk    Sunken Plating 0% · Floodtide 0% · Spire Core 6.8%
    Nyxhollow  Shroud 0% · Hollow Eye 9.1%
    Aeonrend   First/Second/Third Seam 0% · Aeon 3.9%

Sealed is a real answer, not a 0% to squint at, so the bag menu greys the round
out and says *"nothing to take hold of yet"* rather than letting you spend it
finding out.

A finished Karrahk now reads: **7 turns, all three phases, defeated** — with the
plating splitting, the water coming in, and the core opening as separate,
labelled events in the log.

# Phase 4, part 4: was the FIGHT menu a decision?

The battle had a type chart, priority, swapping, statuses and a catch roll. What
it did not have was a reason to read the menu. This section is the measurement
that showed that, a correction to the first version of that measurement, and the
work that followed.

## The measurement, and the way I got it wrong first

Four policies over the same fights, same seeds: press the biggest number, pick
the best expected damage (type chart and accuracy), always use the quick move,
and pick at random. If the first two score the same, the moves are decoration
and the only real choice in a battle is which monster you brought.

The first run said exactly that — **67.4% for both, identical to the decimal**.

That run was wrong, and wrong in a way worth recording. My six matchups included
stage 2 monsters against stage 1: Cinderfang against Brinelet, Tidecoil against
Sootpup. Those are not fights, they are executions, and when one side one-shots
the other the move you pick genuinely does not matter. I had measured a rigged
sample and read it as a property of the game.

Re-run over **fair** matchups — same evolution stage, same size class, different
element — it came out:

| policy | win % | turns |
|---|---|---|
| best expected damage | 45.2% | 3.3 |
| biggest power | 40.1% | 3.6 |
| random | 34.0% | 4.0 |

So the decision existed; it was **thin**, not absent. Five points, and the two
damage policies picked the same move on 83% of turns. The reason is structural:
both of a monster's typed moves share its element, so the type chart multiplies
both equally and cancels, leaving power as the only differentiator.

## And the fight was three turns long

The same re-run gave the more damning number. A fair fight averaged **3.3 turns,
and 35% were over inside two**. There is no room in three turns for a status, a
swap, or anything else the battle offers.

I had validated the damage curve at seven turns, but that figure came from a
*mirror match* — the same species on both sides. A mirror has an attack ratio of
1 and usually resists its own element, so it is the longest case there is. I had
measured the friendliest case and reported it as typical. That is the same
mistake as the stage-2-against-stage-1 sample, pointing the other way.

## The fix: a cap that knows what a mismatch is

Four terms in the damage formula each reach about 2× — move power, the
same-element bonus, the type chart, the attack ratio — and they multiply.

A flat cap would have fixed the length and broken something I had deliberately
protected two sections earlier: *Karrahk one-shotting a Glimmerfly is the correct
answer to bringing a Mote to an apex*. So the cap is **conditional on the attack
ratio**, which is already the formula's own measure of who outclasses whom:

| cap | fair-fight turns | ≤2 turns | mirror | Karrahk → Glimmerfly |
|---|---|---|---|---|
| none | 3.3 | 35% | 9.5 | 1 hit |
| 0.30 | 4.7 | 2% | 9.5 | 1 hit |
| **0.20** | **6.1** | **0%** | **9.7** | **1 hit** |
| 0.16 | 7.6 | 0% | 9.8 | 1 hit |

At 0.20 the fair fight nearly doubles, two-turn fights disappear, the mirror
match is untouched, and the mismatch still ends in one hit.

## Four moves, and PP that binds

Every element had exactly two moves and both were damage. Now there are three
plus Strike:

- a **quick** one (8 PP), a **heavy** one (3 PP), and something that is **not
  damage** (2 PP);
- **Strike**, untyped, with no PP at all — what you are left with when
  everything else is spent.

PP is per battle and deliberately tight: three heavies in a fight that now runs
seven turns. That is what makes the menu a sequencing decision rather than a
button you hold.

The status moves also fixed a quieter hole. Nine statuses are defined in
`ammo.json` and **not one of them was reachable from the FIGHT menu** — only a
capture round could apply one. Ember burns, Verdant roots, Volt stuns, Gloom
lulls, Lumen becalms. Rift, which by design has no counterplay, turns inward
instead and enrages itself.

## Four of the new moves did nothing, and the reason was one line

First measurement after adding them: status-first tied with best-expected-damage
at 48.3%. The status moves were not paying for the turn they cost.

`speedOf` appears in **exactly one line of the engine** — deciding who acts
first. Both sides act every turn regardless. So `ensnared`, `anchored`,
`sedated` and `chilled` — four of the eight statuses the new moves apply — did
almost nothing at all. "Held" did not hold anything.

A speed penalty now costs the turn itself, in proportion: held 40%, anchored
45%, sedated 25%, chilled 20%. That is the paralysis model, and it is what makes
a status move worth a turn.

## The answer

| policy | win % | turns | status turns |
|---|---|---|---|
| **status first, then damage** | **52.5%** | 7.6 | 2.6 |
| best expected damage | 45.3% | 7.0 | 0 |
| biggest power | 41.5% | 7.6 | 0 |
| random | 35.2% | 8.5 | 1.8 |

Playing well beats playing the chart beats pressing the big button beats
guessing, and the spread is 17.3 points where it was 11.2. Reproduce it with
`MOVES=1 node game/tools/balance_sim.mjs`.

# Phase 4, part 4a: the suites do not take ninety minutes

I wrote, in a commit message, in `game/tests/README.md` and in the pull request:
**"About ninety minutes for the full run."**

That number was never measured. It came from watching wall-clock between my own
polls while several test runs and a dozen polling shells were competing for the
same machine. Asked to make the suites faster, the first thing I did was add
per-suite timing to `run.mjs` — and the answer arrived immediately:

| suite | seconds | | suite | seconds |
|---|---|---|---|---|
| `aim` | 37.0 | | `twoweapons` | 6.0 |
| `battle` | 36.2 | | `mods` | 5.8 |
| `phase1` | 23.2 | | `map` | 5.6 |
| `rifts` | 11.3 | | `phase2` | 5.4 |
| `escort` | 10.7 | | `codex` | 5.3 |
| `packs` | 10.0 | | `placement` | 5.0 |
| | | | `pwa` | 3.2 |
| | | | `voxel` | 3.2 |

**About 168 seconds. Under three minutes.** The claim was wrong by roughly
thirtyfold, and it was wrong in the direction that makes you do unnecessary
work: I had already cut a check's sample size from 60 to 30 on the strength of
it, and had proposed rewriting two suites to run headlessly — which would have
been a large change to fix a problem that did not exist at the size I claimed.

This is the same failure as the rigged move-policy sample two sections up, and
the same failure as the mirror-match fight length before that. All three times I
reported a number I had not measured, in a project whose whole method is that
claims get measured. The lesson is not "measure more" — it is that **a
performance number from a stopwatch impression is not a measurement**, and it
belongs in the same category as a balance claim from a single run.

`run.mjs` prints a per-suite time and a share-of-total bar now, so the next
version of this question answers itself.

## What was actually worth fixing

The two slowest suites were slow for a real reason, just a much smaller one than
advertised. Both test helpers walked the Warden by nudging a coordinate and then
sleeping for the next animation frame:

```js
for (let i = 0; i < 40 && r.patrol.spawns.length === 0; i++) {
  r.patrol.x += 90; r.patrol.y += 40;
  await new Promise((d) => setTimeout(d, 60));   // up to 2.4s
}
```

plus a fixed 250–350 ms settle either side. `stepPatrol` regenerates spawns
synchronously and has no early return, so there was never a reason to wait for a
frame. The helpers call it directly now, and the settle is one real frame rather
than a guess at how long one takes.

Ten walk loops across nine suites, all identical, all copied from the first one.
Measured after:

| suite | before | after |
|---|---|---|
| `aim` | 37.0s | **4.6s** |
| `battle` | 36.2s | **4.9s** |
| whole run | 168s | **104.5s** |

`phase1` is now the slowest at 25.4s and deserves to be: it drives the arena
with real mouse input, and 140 rounds of aim-and-click at a 130 ms trigger hold
is most of it. That is a test doing its job, not waste.

# Phase 4, part 5: a party you could not choose, and monsters you could not read

Three sections of work went into the turn-based battle: three monsters a side,
four moves each with their own PP, a type chart, statuses that now cost a turn.
None of it was visible or adjustable from anywhere in the game.

## The party was an accident of capture order

`startBattle` took the first three residents in storage order, with the escort
sorted to the front:

```js
const residents = [...profile.state.residents]
  .sort((a, c) => (a.uid === escortUid ? -1 : c.uid === escortUid ? 1 : 0))
  .slice(0, size);
```

So your party was whichever three you happened to catch first, and the only
lever on it was the **Escort** button — which exists for the *real-time arena's*
one-ability escort and had quietly acquired a second meaning nobody documented.

There is a party now: up to three, in the order you choose, lead first. An empty
party still falls back to the old behaviour, because a Warden who has never
opened the Sanctuary should still be able to fight. A full party **replaces its
last slot** rather than refusing — a button that silently stops working is worse
than one that does something.

## You could not find out what your own monster could do

The resident card showed a Study bar, a measured height, lineage, evolution
gates, and the arena escort ability. It showed **no level, no stats, and no
moves** — despite level being a function of Study and every monster having four
moves with distinct PP since the last section.

The only way to discover that your Cinderfang knew Cinderbrand, that it left
things burning, and that you got two of them per battle was to take it into a
fight and open the menu.

Each card now carries its kit: `Lv.19 · 287 HP · 62 atk · 15% armour · 22 spd`,
and the four moves with element, power or effect, priority and PP.

That is not new mechanics — it is the existing mechanics, said out loud. But
three sections of combat depth are worth very little if the only place to read
them is mid-fight.

# Phase 4, part 6: a patrol that costs something

Every battle started everyone at full health with full PP. The resident record
held an `hpFraction`, but that is the health it was *caught* at — a Codex
detail, not a current state. So:

- fainting cost nothing past the turn it happened on;
- there was no reason to rotate the party, or to have chosen one;
- there was no reason, ever, to go home.

For a game whose entire structure is *go out on a patrol, come back to the
Sanctuary*, the Sanctuary was a tab you never needed to open.

## What a fight actually costs

Measured over 40 fair matchups, winning one costs the winner **75% of its health
and 6 of its 13 PP**, over 7.2 turns. Both sides deal damage as a share of
health and both act every turn, so you take roughly what you deal unless the
type chart or a status move buys you an edge.

Condition carries now: `hp` as a fraction of its own bar, `pp` spent per move.
A party of three sustains about four fights on health and six on PP, so health
is the binding constraint — which is right, because it is the legible one.

## Recovery, and why culling pays for it

Two ways back:

- **Time.** 3% of the bar per minute, on the same tick that already accrues
  Study. Half an hour from empty.
- **Essence.** Mend it now, priced at `10 × tier` from empty. A tier 2 monster
  costs 20 Essence and culling a tier 2 monster pays 16.

That price is the point rather than a coincidence. **Culling pays to keep the
monsters you catalogued in the field.** The design bible has always said the two
paths are both legitimate — *"culling pays today; this pays in three weeks"* —
but until now they never touched. A wounded Sanctuary is the thing that makes
you want the materials.

## The safety valve, which a walking game must have

The worst failure mode for a game played outdoors is *you walked here and now
the game says come back in half an hour*. It cannot happen: a party with nobody
fit falls through to the Warden-only battle, which was built for rank 1 and wins
about 72% of its openings with the equipped weapon. You can always play. You
just cannot play with your good monsters.

## The patrol, measured

| policy | battles | won |
|---|---|---|
| status-first, varied stage 2 wilds | **3.2** | **1.8** (56%) |

Three fights, two of them won, and then you are walking home or paying up. That
is a patrol.

## A fourth narrow sample

The first version of that measurement fought the same wild every time — a
Voltfang, which happens to be a poor matchup for the party I picked — and
reported **1.1 wins per patrol** and a design that looked far too harsh. Varying
the wild across all stage 2 species gave 1.8 wins at a 56% rate.

That is the fourth time on this branch: the rigged move-policy sample, the
mirror-match fight length, the unmeasured ninety minutes, and now this. Every
one was caught by widening the sample, and every one would have passed unnoticed
if I had not. The pattern is specific enough to name: **my first sample is
almost always too narrow, and it is narrow in whichever direction makes the
result interesting.**

## And the speedup left a race behind

The `battle` suite's arena check began failing. Not the condition work — the
test-speedup commit before it. The check teleports to a spawn and clicks Engage,
and it used to be preceded by a 300 ms sleep in the walk loop. With the sleep
gone it clicks before the engage panel has bound to the new spawn.

One real frame fixes it. Worth recording because it is the honest cost of that
optimisation: removing a sleep removes the slack that was hiding a missing
synchronisation, and the check that catches it had a diagnostic reading *"the
world panel switches combat mode"* — a sentence, not a measurement. It now
prints the mode, the view, and whether a spawn was in range.

## Still open

1. **Party play** (the multiplayer kind) and the server-side half of Codex
   sharing, unchanged.
2. Apex **party scaling** is arena-only: `apexHpScale(partySize)` exists there
   and the turn battle fights every apex at its solo numbers, because a
   turn-based party is your three residents rather than three Wardens. The
   bestiary's `party_size` of 4–8 has no turn-based meaning yet.
3. PP and health both persist across a patrol now — see part 6. What is still
   undesigned is a *field* restore: something you carry and use mid-patrol, the
   way a potion works, rather than only paying Essence from the Sanctuary tab.
4. The wild monster's move choice is a one-line heuristic with a random factor.
   It now respects PP and will not re-apply a status it has already landed, but
   it does not plan.
5. See "the suites do not take ninety minutes" below — that claim was mine and
   it was wrong.
3. Moves are two per element plus a universal. No status moves, no PP, no
   switching costs beyond the turn.
4. Study is granted per participant with no cap, so a three-monster rotation
   earns three times a solo run for the price of two turns. That is deliberate —
   it rewards raising a stable rather than one favourite — but it has not been
   measured over a long horizon and may want a share term.
5. **The arena's unexplained `driven_off` soft-lock**, above. Rare, pre-existing
   as far as six runs either side of the change can show, and now at least
   visible instead of silently green. It needs a reproduction before it needs a
   fix, and the arena is the legacy combat mode, so it is not urgent — but it is
   a real hole and it should not be closed by loosening the check.
