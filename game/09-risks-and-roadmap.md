# 09 — Open Questions, Risks & Roadmap

## Decisions still open

These are the ones that change architecture, so they want answering before code.

| # | Question | Options | Leaning |
| --- | --- | --- | --- |
| 1 | Do Sanctuary residents fight alongside you? | Yes (pet sim) / No (pure collection) / Limited: one resident gives an active ability | **Limited — built and measured.** One escort, one ability, one charge per encounter, no autonomous action. Nine abilities, one per element. Measured in [13](13-phase3-findings.md): the biggest swing against a fight you are already winning is ±11 points, and against one you are losing it is +40. It does not trivialise anything |
| 2 | Is combat real-time aim, or tap-to-shoot? | Free aim / lock-on with a timing bar / hybrid | **Hybrid — both built and measured.** Free aim stays the default and is still the better instrument with a mouse; assisted aim locks, leads, and puts a timing ring on the shot. Measured in [13](13-phase3-findings.md): a walking player goes 43% → 77% by switching, and the ring's penalty is a straight dial between accessibility and skill expression, so it is set forgiving |
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

### Automation, and a client you do not control

Nothing in this section is hypothetical. `PokeGOAPI-Java` is a public Java library
with several hundred commits that speaks Pokémon GO's client protocol directly —
authentication, player profile, inventory, nearby monsters, encounters, catching,
stop interaction — and its own README warns that using it may violate the terms of
service and get accounts banned. It exists because a location game's protocol is
worth reverse-engineering, and it was not the only one.

The lesson is not "add obfuscation". It is that **the client is an untrusted input
device**, and the design above is already half-built on that assumption — it just
has not been written down as a threat model.

What the client can lie about, and what has to be checked somewhere it cannot
reach:

| The client says | Without a server check | What the server has to own |
| --- | --- | --- |
| Where the Warden is | Teleporting between cities, farming every biome from a chair | Displacement over elapsed time **between calls and across sessions**, not just instantaneous speed |
| That an encounter happened | Captures invented wholesale | Encounters issued server-side, bound to (player, spawn, time bucket), **single-use and expiring** |
| Where the shot landed | Every shot a weak point, every capture clean | Hit zone, wound multiplier and status stack are capture-roll **inputs**, so they resolve with the roll |
| What it spent | Infinite darts | Inventory deltas reconcile against rounds fired |
| What happened while offline | An afternoon of captures that never occurred | Bound how much offline play reconciles, and require the encounter token |

Four things worth saying plainly, because each one is a place this design is
already exposed:

- **The speed lockout is a safety feature, not an anti-cheat.** The 25 km/h rule
  in *Player safety* exists so nobody plays while driving, and it lives in the
  client where it can do that job. It stops an honest phone. It stops nothing
  else, and it should never be counted twice.

- **Spawn determinism cuts both ways.** Seeding spawns from
  `(tile_id, time_bucket, global_seed)` is what makes a park feel populated
  without a persistent world sim, and it is a good idea. It also means anyone
  holding the global seed can enumerate every spawn in the world ahead of time —
  which is exactly how the third-party live maps for this genre worked, and they
  did more damage to the games they targeted than bots did. **The seed never
  reaches the client.** Serve the tiles near the player, derived server-side.

- **Offline tolerance is the soft spot, and it is worth the cost anyway.**
  *Technical notes* commits to fights completing offline and reconciling on
  reconnect, because rural coverage is bad and that is not the player's fault.
  But it means accepting the result of a fight the server did not watch. Bound
  it: a ceiling on what reconciles, the encounter token required, and a stream of
  offline-only captures treated as a signal rather than a shrug.

- **Rate limits are for the boring case.** Encounters per hour, captures per day,
  distance per day. They will not catch anyone clever. They make the
  unsophisticated version — the one that actually gets written, in volume —
  unprofitable, which is most of the problem.

**What not to do:** spend the budget on client attestation and obfuscation. It is
an arms race against people with more time than the team has, it ships nothing a
player can see, and it fails open. The lever is the one *Technical notes* already
names — server-authoritative spawns and captures — and this section is the list of
what "authoritative" has to include.

None of this is buildable yet: there is no server, and party play and Codex
sharing are the features that will need one. It is written now because the two
choices that matter here, **where the spawn seed lives** and **what an encounter
token is**, are cheap today and a migration later.

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

### Phase 0 — Paper and prototype (no map) — **built**

Prove the fight is fun before touching geolocation.

Lives at [`docs/riftborn/`](../docs/riftborn/); findings in
[10-phase0-findings.md](10-phase0-findings.md).

- One monster (Cinderfang), one weapon (Marker Pistol), both ammo types.
- Restraint meter, wound multiplier, weak points, flee behaviour.
- **Exit criterion:** the kill-or-capture decision is tense with a single monster in
  a grey box. If it isn't fun here, no amount of map makes it fun.
- *Status: the structure holds up and the maths is fixed. Whether it is fun is the
  one thing the sim cannot answer — it needs hands on it.*

### Phase 1 — Vertical slice — **built**

Findings in [11-phase1-findings.md](11-phase1-findings.md).

- 3 families (Cinder, Crag, Volt) = 9 species, all stages.
- 3 weapons (Pistol, Longtooth, Sylvan Bow), 6 ammo types.
- Type chart, size classes, Codex entries with Research I.
- Real map, real spawns, one biome classification pass.
- **Exit criterion:** a 20-minute Patrol session is worth repeating tomorrow.
- *Status: the loop closes — cull funds darts, darts fill the Codex, the Codex
  reveals weak points, weak points speed up the next fight. Needs hands on it.*

### Phase 2 — The loop closes — **built**

Findings in [12-phase2-findings.md](12-phase2-findings.md).

- All 12 families, 40 non-apex species.
- All 8 weapons, all 14 ammo types, mods.
- Sanctuary, evolution, all 4 branches.
- Research I–III, contracts, crafting economy.
- Weather and time-of-day spawn modifiers.
- **Exit criterion:** a player has a reason to log in on day 30.
- *Status: the mechanism exists — Study accrues while you are away and evolution
  gates on real time and weather you cannot rush. Whether that is a reason rather
  than a mechanism needs hands on it. Pack spawns are now blocking three weapons.*

### Phase 3 — Together — **packs, rift events and apexes built**

Findings in [13-phase3-findings.md](13-phase3-findings.md).

- Rift events, the 3 apexes, party play. *Rift events and all three apexes are
  built and solo-playable; party play needs netcode and is untouched.*
- Multi-capture (snare + partner tag). *The snare half is built and does not
  need a partner: `aoe_radius_m` was honoured by the arena and ignored by the
  turn battle, so an area round now ensnares every pack member still queued.
  Measured against a no-radius control in [13](13-phase3-findings.md) — it
  scales with pack size and cuts escapes to a fifth. Partner tag needs netcode.*
- Codex sharing, field reports, local leaderboards. *Field reports and the whole
  Your Records layer are built; profiles and leaderboards need a server.*
- *Also built, ahead of the plan: the two-weapon loadout, the full weapon-mod
  table, and the escort that answers decision 1.*
- **Exit criterion:** an Expedition session pulls people out of the house.

### Phase 4 — Live

- Seasonal species and rotating branch conditions.
- New families on a content cadence.
- Whatever question 4 above resolved to. *Questions 1 and 2 are now answered in
  the build rather than by leaning.*

## Technical notes (light — not a spec)

Enough to not paint ourselves into a corner:

- **Server-authoritative spawns and captures.** Spawn tables, Restraint resolution
  and tagging all resolve server-side. A client-authoritative capture in a
  collection game is farmed within a week. *"Authoritative" has a specific list
  behind it — see "Automation, and a client you do not control" above.*
- **Spawn determinism.** Seed spawns from `(tile_id, time_bucket, global_seed)` so
  every player in a park sees the same monsters without a persistent world sim.
  *The global seed stays server-side: anyone holding it can enumerate every spawn
  in the world, which is how this genre's scraper maps were built.*
- **Data-driven from day one.** Everything in `data/*.json` loads at runtime and is
  hot-swappable. Balance changes must not need a client release.
- **Offline tolerance.** Fights complete offline and reconcile on reconnect, with
  server-side validation. Rural coverage is bad and that is not the player's fault.
  *It is also the softest surface in the design, and worth the cost anyway — the
  bounds it needs are listed above.*
- **Battery.** GPS at reduced cadence when stationary, AR camera only on demand. A
  game that eats 40% of a battery in 30 minutes does not get played on the way home.
