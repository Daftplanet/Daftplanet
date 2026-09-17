# 07 — The Codex

The Codex is the player's wiki: the in-game record of every species they have
catalogued. It is the collection, the research tree, and the progression screen all
at once — and it is the thing the whole capture mechanic exists to fill.

## Entry states

| State | How you get there | What you see |
| --- | --- | --- |
| **Unknown** | Default | Nothing. A numbered blank slot |
| **Sighted** | Spawned near you, not engaged | Silhouette, element, size class |
| **Encountered** | Fought it, it escaped or you culled it before cataloguing | Silhouette, element, size, rough HP band |
| **Data Lost** | Culled a species you had never catalogued | As Encountered, flagged red. First-capture bonus forfeit |
| **Catalogued** | Subdued and tagged | Full entry unlocked |
| **Researched** | Catalogued + research points spent | Weak points, spawn windows, evolution conditions |
| **Complete** | Every stage of the family catalogued | Family banner, cosmetic, passive bonus |

The `Data Lost` state is the sharp edge. It is not a soft nudge — it is a visible red
mark on your collection that a completionist will feel. Players who don't care about
the Codex will never notice it. That asymmetry is intentional.

## A Codex entry

```
┌──────────────────────────────────────────────────────┐
│  № 002   CINDERFANG                    ★★☆ Uncommon  │
│  Ember · Strider · 1.9 m avg                         │
├──────────────────────────────────────────────────────┤
│  [ 3D model, rotatable, rendered from your specimen ] │
├──────────────────────────────────────────────────────┤
│  FIELD NOTES                                          │
│  Pack hunter. Nests in warm concrete. Will not        │
│  engage a lone target inside a lit area — it waits.   │
│                                                       │
│  WEAK POINTS        ▸ Throat        ×2.5              │
│  (Research I)       ▸ Hind joint    ×2.5              │
│                                                       │
│  COUNTERS           Strong vs Verdant, Gloom          │
│                     Weak to Tide, Stone               │
│                                                       │
│  SPAWNS             Industrial, urban · 18:00–02:00   │
│  (Research II)      Rate ×2.1 in dry weather          │
│                                                       │
│  EVOLVES FROM       Sootpup  (400 Study, Rank 3)      │
│  EVOLVES TO         Pyrecrown  (1,600 Study, Rank 8)  │
│  (Research III)     Ashenreaver (…, evolve 22:00–04:00)│
├──────────────────────────────────────────────────────┤
│  YOUR RECORDS                                         │
│  Catalogued  4      Culled  17                        │
│  First taken 12 Mar · Sting Crossbow · Rune Arrow     │
│  Best clean capture  94% HP                           │
│  Largest  2.31 m  (98th percentile)                   │
└──────────────────────────────────────────────────────┘
```

Note the bottom panel. The species data is the same for everyone; **Your Records** is
not, and that is what makes the Codex worth opening more than once.

## Research

Catalogueing a species grants **Research Points** for that family. Spend them on that
entry to unlock three tiers:

| Tier | Cost | Unlocks | Why you care |
| --- | --- | --- | --- |
| **Research I** | 1 RP | Weak point locations | Direct ×2.5 damage upgrade |
| **Research II** | 3 RP | Spawn biome, time window, weather modifier | You can hunt it deliberately instead of hoping |
| **Research III** | 6 RP | Evolution requirements and branch conditions | You stop guessing at branches |

RP is earned per **first capture of a species** (5 RP), per subsequent capture
(1 RP), and per clean capture above 80% HP (+1 RP). It is never earned by culling.

Research I is the one that closes the loop: the Codex is not a reward for playing
well, it is a tool that makes you play better. A researched species dies — or is
taken — noticeably faster.

## Completion rewards

| Milestone | Reward |
| --- | --- |
| Family complete (3 stages) | Family banner, +1 Sanctuary habitat slot |
| All branches of a family | Cosmetic weapon skin in that element |
| All 12 families stage 1 | Bio-Scanner sight, permanently |
| All 12 families complete | Apex rift access without an event ticket |
| 43/43 including apexes | Title, Sanctuary decoration, permanent +5% Restraint |

## Sharing

The Codex is the social layer. There is no PvP at launch, so competition runs
through the collection:

- **Public profile** — completion %, family banners, apex captures. Opt-in.
- **Specimen showcase** — pin 3 specimens with their records. Largest, cleanest,
  weirdest.
- **Local leaderboards** — per-city completion, refreshed weekly.
- **Field reports** — a shareable card generated from a capture: species, method,
  approximate area, HP remaining. This is the organic marketing surface.

Sharing always publishes **neighbourhood-level location at most**, never a precise
point, and it is off by default. See [09](09-risks-and-roadmap.md).
