# 10 — Phase 0 Findings

What building the grey box actually taught us. Everything here is evidence from
[`docs/riftborn/`](../docs/riftborn/) and its headless balance sim, not opinion.

## Three bugs in the design bible's maths

Phase 0 exists to find these before they are load-bearing. All three are fixed, in
both the prose and `data/`.

### 1. The Restraint formula had no magnitude term

`restraint_gain` multiplied `ammo_restraint_multiplier × weapon_restraint_rating ×
…`, and every one of those is a multiplier near 1.0. Nothing supplied the actual
per-shot size. A Tranq Dart from a Marker Pistol contributed **1.0 Restraint**
against a bar of 123.5:

```
restraint per body dart, full HP = 1.0
restraint required               = 123.5
=> darts needed                  = 124   (the magazine holds 8)
```

The weapon table's published `RES` column (14 for the pistol) was the missing term
all along. Weapons now carry `restraint` as a per-projectile base, and
`restraint_rating` is gone.

### 2. The two Restraint ladders had no conversion between them

Weapon `RES` (14–58) and species `base_restraint` (22–1100) were authored
independently, so their ratio was accidental. With the formula fixed, the numbers
went from absurdly slow to absurdly fast:

| | Restraint | Darts to subdue |
| --- | --- | --- |
| body, full HP | 14.0 | 8.8 |
| weak point, full HP | 28.0 | 4.4 |
| weak point + sedated | 50.4 | 2.5 |
| weak point + sedated, 25% HP | 126.0 | **1.0** |

A sedated, wounded, weak-point dart **filled the entire capture bar in one shot**.
Rather than rewrite 43 species, there is now one global dial,
`restraint_required_scale`, currently **3.0**. It is the single lever for how long
every capture in the game takes.

### 3. `Sedated` halting Restraint decay removed all time pressure

The bible had decay pause entirely while `Sedated`. Combined with tranq darts
applying it after three stacks — about one second of fire — a full-health monster
had *no clock at all*, and darting from full became the dominant strategy. `Sedated`
now scales decay by **×0.35** instead. `Anchored` still halts it outright, because a
harpooned Titan genuinely is pinned.

### Bonus: Ambush belongs to the bow

The Marker Pistol was collecting the ×1.8 / ×1.5 Ambush bonus on its opener, which
quietly undercut the Sylvan Bow's entire reason to exist. Firing anything louder
than `silent` now alerts the monster **on the trigger pull**, before the round
lands. Loud weapons can never earn Ambush.

## Does the kill-or-capture decision hold up?

The sim runs scripted players through the real fight code. 400 runs per strategy,
24 ball rounds and 12 tranq darts, two skill levels.

```
SKILLED  (steady aim, hunts weak points)
strategy      cull  cat  esc  down   time  shots   hit  clean  HP@cat
cull          53%   0%  47%   0%    4.3s   10.0   0.3   0%     —
pure_dart      0%  92%   0%   9%    6.7s   11.3   0.3  92%  100%
soften_30      0%  71%  29%   0%    5.1s   12.4   0.3   0%   26%
soften_50      0% 100%   0%   0%    4.5s   11.8   0.0   0%   44%
panic          0%  37%  63%   0%    5.1s   11.6   0.5   0%   19%

AVERAGE  (shaky aim, body shots)
cull          66%   0%  34%   0%    6.1s   13.4   1.0   0%     —
pure_dart      0%  60%   0%  40%   11.1s   11.7   1.2  60%  100%
soften_30      0%  79%  21%   0%    7.0s   15.1   0.9   0%   25%
soften_50      0% 100%   0%   0%    6.1s   14.0   0.4   0%   45%
panic          0%  45%  55%   0%    6.9s   14.4   1.0   0%   20%
```

Reading it against the design's intent:

- **Clean capture is a flex, and it costs.** Darting from full works 92% of the time
  for a steady hand and only 60% for an average one, who runs dry or gets dropped
  40% of the time. That is the right shape: possible, demanding, and it forfeits
  every material the kill would have dropped.
- **"It's about to bolt" is genuinely a gamble.** `panic` — swap to darts the moment
  it runs — converts 37–45% of the time. That is the emotional beat the design asked
  for, and it is losing more often than it wins.
- **Soften-then-dart is the workhorse**, as intended, and swapping earlier is safer.
- **`soften_50` never fails.** Swapping at half health means you start filling
  Restraint before the monster is ever eligible to flee, and Restraint then
  suppresses the flee roll permanently. Its only cost is economic: it burns most of
  your expensive darts and yields a 44% HP capture. That is a legitimate trade, but
  it is the one strategy with no in-fight failure mode — worth watching.

## The emergent finding: weak points are a liability on a fleeing target

The skilled bot loses *more* culls than the shaky one (47% vs 34%). Holding aim
steadiness constant and varying only weak-point targeting:

```
aim sigma   weak points   cull:esc   hit rate   shots/sec   chase sh/sec
    0.035          true        45%        98%        2.31           1.00
    0.035         false        25%        98%        2.33           2.75
```

Identical hit rate, identical overall fire rate — but **during the chase the
weak-point hunter fires 1.00 shots/sec against 2.75**. Tracking a small receding
target costs two-thirds of your rate of fire, and the overall average hides it
because the pre-flee phase dominates.

Partly this is bot policy: a human would switch to body shots on a runner. But it
means the game already rewards knowing *when* to stop aiming for the weak point,
which is a better skill expression than we designed on purpose.

## The one number that needs a decision

`skittishness` decides how often a nearly-won fight walks away. Cinderfang ships at
**0.40**:

| skittishness | cull escapes | panic converts | soften_30 escapes |
| --- | --- | --- | --- |
| **0.40** | 34% | 45% | 21% |
| 0.30 | 25% | 56% | 18% |
| 0.20 | 16% | 70% | 12% |
| 0.10 | 10% | 84% | 7% |

At 0.40 a straightforward cull fails a third of the time. That delivers the drama
the design asked for, but it is a lot of loss on the *default* action in a game
played at a bus stop. **0.25–0.30 is the recommendation** — it keeps the "it's
bolting" moment while cutting routine frustration. Left at 0.40 pending a call,
since it is a published bestiary value.

## Smaller things the build surfaced

- **A weak point hit should use the weapon's own `crit_multiplier`**, not a flat
  ×2.5. The Splitbore at ×2.0 and the Lattice Launcher at ×1.0 need to mean
  something. `hit_zones.weak_point.damage` is now the fallback.
- **`carried` ammo means total rounds, magazine included.** Treating the magazine as
  a bonus on top silently handed the player 20 darts instead of 12, which flattered
  every capture strategy in the first sim runs.
- **Colossus and Titan AR scaling is not a late problem.** Even at Strider size, a
  960×640 arena on a phone in portrait is cramped. The landscape arena is a phase 0
  convenience; a real build wants a portrait-native play space.

## Still open

1. **Should tagging require closing the distance?** The design's 5-second window is
   generous by intent ("played while walking"), which makes the tap free. There is a
   toggle in the prototype's dev panel — worth feeling both before deciding.
2. **Is `soften_50` too safe?** It has no in-fight failure mode. Either accept it as
   the economic-cost option, or let Restraint decay faster above 50% HP.
3. **Warden health.** Three lunges kill you, and the sim's competent bot is hit
   0.3–1.2 times per fight. Untested against a real player on a phone screen.

## Exit criterion

The roadmap's phase 0 gate was: *the kill-or-capture decision is tense with a single
monster in a grey box*. The structure is there — the routes have genuinely different
risk profiles, the ammo swap costs you at the moment it matters most, and the flee
mechanic makes the endgame of every fight a decision rather than a formality.

Whether it is **fun** is the one thing a simulation cannot answer. That needs hands
on it.
