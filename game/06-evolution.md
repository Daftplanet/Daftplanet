# 06 — Evolution & the Sanctuary

## The rule that makes capture matter

**Only catalogued monsters evolve.** A culled monster drops materials and is gone.
A catalogued one goes to your Sanctuary, gains Study points while it lives there, and
eventually becomes something you have never seen — which then needs its own Codex
entry, which means you now want to find the *wild* version too.

This is the retention engine. Culling pays today; catalogueing pays in three weeks.

## Evolution requirements

Every line has three gates. All three must be met.

1. **Study points.** Accrued passively while the monster is in the Sanctuary, and in
   bursts when you feed it materials or take it on a walk (it tracks your step count
   in the background, at low battery cost).
2. **Warden rank.** Stops a new player evolving a Colossus in week one.
3. **A condition.** Sometimes trivial ("none"), sometimes the whole point.

```
Stage 1 → 2:   400 Study    Rank 3
Stage 2 → 3: 1,600 Study    Rank 8
Branch:      as stage 2 → 3, plus the branch condition
```

## Branch conditions

Four branches ship at launch. Each teaches a different lesson about the systems.

| Branch | From | Condition | Teaches |
| --- | --- | --- | --- |
| **Ashenreaver** | Cinderfang | Evolve between 22:00 and 04:00 local time | Time of day is a real variable |
| **Sporeherald** | Blightcap | The Blightcap was catalogued with a **Rune Arrow** | *How* you captured it is recorded forever |
| **Railmane** | Voltfang | Evolve during a real-world thunderstorm at your location | Live weather feeds the game |
| **Hoarfell** | Rimeclaw | Evolve while ambient temperature < 0 °C | Same, seasonal |

The Sporeherald condition is the most interesting one and should be expanded in
later content: **the capture method is part of the specimen's permanent record.**
A monster taken with a net is not the same specimen as one taken with a dart, and
some evolutions only accept one of them.

## Evolution is irreversible and consumes the specimen

When a Sootpup becomes a Cinderfang, you have a Cinderfang. The Codex keeps the
Sootpup entry (you catalogued it, that's permanent), but your Sanctuary no longer
holds one. If you want to keep a Sootpup, catch another.

This matters because **Codex completion requires having catalogued every stage in
the wild or via evolution**, and the fastest route to a full line is usually:
catch stage 1, evolve it, catch another stage 1, evolve that one too, and so on. It
keeps low-tier spawns relevant long after they stop being dangerous.

## The Sanctuary

Your home base. Not a combat space.

| Feature | What it does |
| --- | --- |
| **Habitats** | 3 slots at rank 1, up to 12. Each habitat has an element affinity; a matching resident gains Study 25% faster |
| **Residents** | Catalogued monsters live here. Cap starts at 9, grows with rank |
| **Feeding** | Spend crafting materials for a Study burst. Elementally matched food is worth double |
| **Workbench** | Craft ammo, weapons, mods. Consumes materials from culling |
| **Research desk** | Spend Codex research points to unlock weak points, spawn intel, evolution hints |
| **Release** | Return a resident to the wild. Refunds ~40% of Study as Essence. Codex entry is retained |

### Passive bonuses

Residents grant small account-wide bonuses by element, which is how a collection
stops being a trophy shelf and starts being a build:

```
Per resident, by element:
  Ember    +1% lethal damage
  Tide     +1% Restraint gain
  Verdant  +1% material drop quantity
  Stone    +1% Warden damage resistance
  Gale     +1% movement / spawn detection radius
  Volt     +1% weapon reload speed
  Gloom    +2% rare spawn chance at night
  Lumen    +2% rare spawn chance in daylight
  Rift     +1% to all of the above
```

Capped at +15% per element so it can't run away, and evolved residents count double.
A full Sanctuary of Ember monsters is a genuinely different Warden to a full
Sanctuary of Tide ones.

## Specimen records

Every catalogued monster carries a permanent record, and this is deliberately rich
because it is what makes a specimen *yours*:

- Species, element(s), size class
- **Capture method** — weapon and ammo used
- **Capture location** — approximate, at neighbourhood granularity, never precise
  coordinates (see [09](09-risks-and-roadmap.md))
- Date, time of day, weather at capture
- HP remaining at subdue (a "clean capture" at >80% HP is a flex)
- Size percentile within the species
- Study points, evolution progress

Two Cinderfangs are not interchangeable, and the Codex shows the difference.
