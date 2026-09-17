# 09 — Open Questions, Risks & Roadmap

## Decisions still open

These are the ones that change architecture, so they want answering before code.

| # | Question | Options | Leaning |
| --- | --- | --- | --- |
| 1 | Do Sanctuary residents fight alongside you? | Yes (pet sim) / No (pure collection) / Limited: one resident gives an active ability | **Limited.** Full pet combat doubles the combat scope |
| 2 | Is combat real-time aim, or tap-to-shoot? | Free aim / lock-on with a timing bar / hybrid | **Hybrid.** Free aim on a tripod-steady phone is miserable while walking |
| 3 | AR camera mandatory? | Always / optional toggle / off by default | **Optional.** AR is the marketing, "field view" is how people actually play |
| 4 | PvP at all? | None / async Codex competition / live duels | **Async only** at launch. Live PvP needs netcode we don't need yet |
| 5 | Monetisation | Cosmetics only / ammo + storage / battle pass | Cosmetics + storage. **Never sell capture ammo** — it is the skill currency |
| 6 | Trading specimens between Wardens | Yes / no / gifting only | Gifting only. Trading invites bots the day it ships |
| 7 | Do monsters persist per-player or per-world? | Instanced per player / shared spawn everyone can see | **Shared spawn, instanced fight.** Shared is what makes a park feel populated |

## Risks worth naming now

### Content rating and store review

The game pairs firearms with a real-world map and a camera feed. That combination
draws scrutiny that neither element attracts alone, and it affects the store
listing, the age rating, and which markets you can ship to. Concrete mitigations
that cost nothing if decided now and a lot if decided later:

- Keep weapons **visibly fantastical** — rune-etched, no real manufacturer
  silhouettes, no real calibres, no reload animations copied from real firearms.
- Monsters only. **Nothing humanoid is ever a valid target**, and the targeting
  system should be incapable of acquiring one.
- No blood. Culled monsters dissolve into Essence.
- Expect a 12+ / T rating as the realistic floor, and design the marketing
  screenshots around AR-off "field view" rather than a gun overlaid on a street.
- Some markets restrict AR games near government or military sites regardless of
  content. Build the geofence exclusion system early; retrofitting it is painful.

None of this changes the design above — it is all presentation. But "we'll sort the
art direction later" is how this becomes a rebuild.

### Player safety

Location-based games have a real injury record, and the mitigations are well
understood. Build them in from the first playable:

- **Speed lockout.** Above ~25 km/h, disable spawns and combat. Offer a passenger
  confirmation, once per session, rate-limited.
- **No spawns** on carriageways, rail tracks, water, or private land. Pull the spawn
  point to the nearest footpath.
- **Curfew nudge**, not a block, for Gloom content after midnight.
- **Never require walking backwards.** See the Titan scaling rule in [04](04-elements-and-sizes.md).
- **Eyes-up design.** Audio cue on spawn, generous tap windows, nothing that punishes
  looking away. The 5-second subdue window exists for this reason.

### Location privacy

Capture records include where a specimen was taken, and the sharing features publish
some of that. Rules:

- Store precise coordinates only where the game needs them, and never publish them.
- **Public sharing is neighbourhood-granularity at most**, and off by default.
- No "friends see my live position" at launch. It is the single highest-risk feature
  in this genre and it is not load-bearing for anything in this design.
- Retain raw location history for the minimum the gameplay requires, then coarsen.

### Design risks

| Risk | Signal to watch | Lever |
| --- | --- | --- |
| Everyone just culls | Capture rate < 20% of encounters | Raise catalogue XP ratio, cut cull materials |
| Nobody culls | Material starvation complaints | Raise cull material drops, lower capture ammo cost |
| `Data Lost` feels punishing | Churn spike in week 1 | Make it repairable sooner, or tutorialise harder |
| Capture feels random | "I did everything and lost it" reports | Restraint is deterministic by design — surface the meter more loudly |
| Rural players starved | Retention gap by population density | Rural spawn-rate compensation, longer detection radius |
| AR unusable in practice | AR-on session share < 15% | Lean into field view, keep AR as a photo mode |

## Build roadmap

### Phase 0 — Paper and prototype (no map)

Prove the fight is fun before touching geolocation.

- One monster (Cinderfang), one weapon (Marker Pistol), both ammo types.
- Restraint meter, wound multiplier, weak points, flee behaviour.
- **Exit criterion:** the kill-or-capture decision is tense with a single monster in
  a grey box. If it isn't fun here, no amount of map makes it fun.

### Phase 1 — Vertical slice

- 3 families (Cinder, Crag, Volt) = 9 species, all stages.
- 3 weapons (Pistol, Longtooth, Sylvan Bow), 6 ammo types.
- Type chart, size classes, Codex entries with Research I.
- Real map, real spawns, one biome classification pass.
- **Exit criterion:** a 20-minute Patrol session is worth repeating tomorrow.

### Phase 2 — The loop closes

- All 12 families, 40 non-apex species.
- All 8 weapons, all 14 ammo types, mods.
- Sanctuary, evolution, all 4 branches.
- Research I–III, contracts, crafting economy.
- Weather and time-of-day spawn modifiers.
- **Exit criterion:** a player has a reason to log in on day 30.

### Phase 3 — Together

- Rift events, the 3 apexes, party play.
- Multi-capture (snare + partner tag).
- Codex sharing, field reports, local leaderboards.
- **Exit criterion:** an Expedition session pulls people out of the house.

### Phase 4 — Live

- Seasonal species and rotating branch conditions.
- New families on a content cadence.
- Whatever question 1 and 4 above resolved to.

## Technical notes (light — not a spec)

Enough to not paint ourselves into a corner:

- **Server-authoritative spawns and captures.** Spawn tables, Restraint resolution
  and tagging all resolve server-side. A client-authoritative capture in a
  collection game is farmed within a week.
- **Spawn determinism.** Seed spawns from `(tile_id, time_bucket, global_seed)` so
  every player in a park sees the same monsters without a persistent world sim.
- **Data-driven from day one.** Everything in `data/*.json` loads at runtime and is
  hot-swappable. Balance changes must not need a client release.
- **Offline tolerance.** Fights complete offline and reconcile on reconnect, with
  server-side validation. Rural coverage is bad and that is not the player's fault.
- **Battery.** GPS at reduced cadence when stationary, AR camera only on demand. A
  game that eats 40% of a battery in 30 minutes does not get played on the way home.
