/*
 * RIFTBORN phase 1 — the world.
 *
 * Tiles, biomes and deterministic spawns. Spawns are seeded from
 * (tile, time bucket, world seed) exactly as the design bible calls for, so every
 * Warden standing in the same park at the same time sees the same monsters without
 * any persistent world simulation behind it.
 *
 * Biome classification here is procedural. A real build derives it from OSM land
 * use, POI density and water features; this stands in for that so the spawn system
 * can be built and tested now. The interface is the same either way: tile -> biome.
 */

export const TILE_M = 40;          // metres per tile
export const DETECT_M = 130;       // how far a spawn shows on the map
export const ENGAGE_M = 25;        // how close you must be to start the fight
export const BUCKET_MS = 15 * 60 * 1000;

/*
 * Nine biomes, and until now each one was a single flat hex — a label with a
 * colour attached rather than a place. `skin` is what makes them somewhere:
 *
 *   ground   two or three tones, picked per tile, so the floor is a patchwork
 *            rather than one unbroken slab of colour
 *   prop     the silhouette scattered across it. This is the part that does the
 *            work: you should know a Woodland from a Works at a glance and
 *            without reading the legend, the way a Pokemon route tells you where
 *            you are by what is growing on it
 *   density  props per tile, roughly. Woodland is a canopy; open ground is bare
 *   ink/lit  the two accents a prop draws with — its shadow side and its lit side
 *
 * The rates are unchanged. This is entirely presentation.
 */
/*
 * How often a wild spawn comes through rift-touched. Set from elements.json at
 * load; the default matches the data so the headless tools and any test that
 * never calls setRiftTouchedRate still see the shipped rate.
 */
let riftTouchedRate = 0.005;
export function setRiftTouchedRate(r) { riftTouchedRate = Number.isFinite(r) ? r : riftTouchedRate; }
export const riftTouchedChance = () => riftTouchedRate;

export const BIOMES = {
  urban_core:  { name: 'Urban Core',  colour: '#414a5e', rate: 0.20,
    skin: { ground: ['#3a4256', '#414a5e', '#4a5468'], prop: 'rooftops', density: 1.8, ink: '#2a3040', lit: '#6f7c95' } },
  industrial:  { name: 'Industrial',  colour: '#5a4a2e', rate: 0.22,
    skin: { ground: ['#514228', '#5a4a2e', '#645336'], prop: 'tanks', density: 1.3, ink: '#382d1a', lit: '#a5854c' } },
  works:       { name: 'Works',       colour: '#6d5330', rate: 0.24,
    skin: { ground: ['#614a2b', '#6d5330', '#795d38'], prop: 'rubble', density: 3.0, ink: '#42311a', lit: '#b28a4e' } },
  transit:     { name: 'Transit',     colour: '#333a44', rate: 0.21,
    skin: { ground: ['#2d343d', '#333a44', '#3b434e'], prop: 'rails', density: 1.0, ink: '#1e232a', lit: '#8d9aa8' } },
  waterside:   { name: 'Waterside',   colour: '#1d5074', rate: 0.22,
    skin: { ground: ['#194668', '#1d5074', '#235b82'], prop: 'ripples', density: 2.4, ink: '#123549', lit: '#7fc6e8' } },
  woodland:    { name: 'Woodland',    colour: '#1f4a28', rate: 0.20,
    skin: { ground: ['#1a4122', '#1f4a28', '#245430'], prop: 'trees', density: 4.0, ink: '#0f2716', lit: '#4fa85c' } },
  parkland:    { name: 'Parkland',    colour: '#356b3c', rate: 0.16,
    skin: { ground: ['#2f6136', '#356b3c', '#3c7644'], prop: 'trees', density: 1.4, ink: '#1c3f21', lit: '#7fc97f' } },
  open_ground: { name: 'Open Ground', colour: '#5c6b33', rate: 0.15,
    skin: { ground: ['#53612d', '#5c6b33', '#66763a'], prop: 'tufts', density: 3.2, ink: '#3c471f', lit: '#a8bd5e' } },
  residential: { name: 'Residential', colour: '#5b4a46', rate: 0.07,
    skin: { ground: ['#52423e', '#5b4a46', '#66534e'], prop: 'houses', density: 1.6, ink: '#382b28', lit: '#b08d78' } },
};

/* Element spawn multipliers by time of day, from 08-world-and-progression.md. */
const TIME_ELEMENT = {
  dawn:  { rime: 2.0, lumen: 1.4, gloom: 0.4 },
  day:   { lumen: 1.8, verdant: 1.3, gloom: 0.1 },
  dusk:  { ember: 1.4, volt: 1.6 },
  night: { gloom: 2.5, ember: 1.2, lumen: 0.1 },
};

const RARITY_WEIGHT = { common: 62, uncommon: 25, rare: 10, very_rare: 3, apex: 0 };

// ---------------------------------------------------------------- hashing

/** Integer hash -> [0,1). Cheap, stable across engines, good enough for spawns. */
function hash(...parts) {
  let h = 2166136261 >>> 0;
  for (const p of parts) {
    let v = Math.imul(p | 0, 0x9e3779b1) >>> 0;
    h ^= v; h = Math.imul(h, 16777619) >>> 0;
    h ^= h >>> 13;
  }
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smooth = (t) => t * t * (3 - 2 * t);

/** Smoothed value noise over the tile grid. */
function noise(x, y, freq, seed) {
  const fx = x * freq, fy = y * freq;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = smooth(fx - x0), ty = smooth(fy - y0);
  const a = hash(x0, y0, seed), b = hash(x0 + 1, y0, seed);
  const c = hash(x0, y0 + 1, seed), d = hash(x0 + 1, y0 + 1, seed);
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

// ---------------------------------------------------------------- biomes

/**
 * Classify a tile.
 *
 * Water and rail are drawn as lines rather than blobs, because that is what they
 * are: a river you follow and a track you cross. Everything else is overlapping
 * density fields. Order matters — linear features win over area ones.
 */
export function biomeAt(tx, ty, seed = 1) {
  const drift = noise(tx, ty, 0.03, seed + 90) * 26 - 13;

  // A meandering river, repeating every 80 tiles (~3.2 km), plus standing water.
  const meander = Math.sin(tx * 0.05 + seed) * 11 + noise(tx, 0, 0.06, seed + 50) * 22 - 11;
  const ry = ((ty - meander) % 80 + 80) % 80;
  if (Math.min(ry, 80 - ry) < 1.7) return 'waterside';
  if (noise(tx, ty, 0.085, seed + 60) > 0.82) return 'waterside';      // lakes and docks

  const rail = Math.abs(((ty + drift) % 34 + 34) % 34 - 17);
  const rail2 = Math.abs(((tx * 0.7 + drift) % 41 + 41) % 41 - 20.5);
  if (rail < 1.1 || rail2 < 1.0) return 'transit';

  const industry = noise(tx, ty, 0.055, seed + 3);
  const green = noise(tx, ty, 0.07, seed + 2);
  const urban = noise(tx, ty, 0.045, seed + 1);
  const works = noise(tx, ty, 0.16, seed + 4);
  const canopy = noise(tx, ty, 0.10, seed + 70);

  if (industry > 0.66) return works > 0.62 ? 'works' : 'industrial';
  // Dense tree cover is woodland; managed green is parkland.
  if (green > 0.62) {
    if (canopy > 0.56) return 'woodland';
    return green > 0.74 ? 'parkland' : 'open_ground';
  }
  if (urban > 0.60) return 'urban_core';
  if (industry > 0.56) return 'industrial';
  if (green > 0.54) return 'open_ground';
  return 'residential';
}

// ---------------------------------------------------------------- time

export function timeWindow(date = new Date()) {
  const h = date.getHours();
  if (h >= 4 && h < 7) return 'dawn';
  if (h >= 7 && h < 17) return 'day';
  if (h >= 17 && h < 21) return 'dusk';
  return 'night';
}

/*
 * The bestiary's placement vocabulary is wider than `timeWindow`'s four coarse
 * answers. `midnight` is a narrow slice inside `night`, and `event` means "only
 * while the event that carries it is running". Neither was ever implemented, so
 * every species asking for one — Nyxhollow among them — could never be placed.
 *
 * `timeWindow` keeps returning the four coarse names, because that is what the
 * spawn weighting is built on; this is the finer question, asked separately.
 */
const WINDOW_HOURS = {
  dawn: [4, 7], day: [7, 17], dusk: [17, 21], night: [21, 4], midnight: [23, 1],
};

export function inTimeWindow(name, date = new Date()) {
  if (name === 'any') return true;
  // `event` is not a clock window at all — whatever carries it decides when.
  if (name === 'event') return true;
  const span = WINDOW_HOURS[name];
  if (!span) return false;
  const h = date.getHours();
  const [lo, hi] = span;
  return lo > hi ? (h >= lo || h < hi) : (h >= lo && h < hi);
}

/*
 * The bestiary asks for `requires_weather: "storm"`; the weather table has
 * `thunderstorm`. Nothing bridged the two, so Karrahk's one condition could
 * never be satisfied by any weather the world actually produces.
 */
const WEATHER_KINDS = { storm: ['thunderstorm'] };

export function weatherIs(kind, weather) {
  if (!kind) return true;
  if (kind === weather) return true;
  return (WEATHER_KINDS[kind] ?? []).includes(weather);
}

/**
 * Does this species' published placement allow it here, now, in this weather?
 *
 * `rift_event` is a biome no tile ever has: it means "inside a rift", so a species
 * asking for it fits any rift and nothing else.
 */
export function placementFits(species, { biome, weather, date, inRift = false }) {
  const biomes = species.spawn.biomes ?? [];
  const biomeOk = biomes.includes(biome) || (inRift && biomes.includes('rift_event'));
  if (!biomeOk) return false;
  if (!weatherIs(species.spawn.requires_weather, weather)) return false;
  const windows = species.spawn.time_windows ?? ['any'];
  return windows.some((w) => inTimeWindow(w, date));
}

/** Every placement term the data uses, so a test can check the engine speaks them all. */
export const PLACEMENT_VOCABULARY = {
  timeWindows: [...Object.keys(WINDOW_HOURS), 'any', 'event'],
  weatherKinds: [...Object.keys(WEATHER_KINDS)],
};

export function timeBucket(date = new Date()) {
  return Math.floor(date.getTime() / BUCKET_MS);
}

/*
 * Weather.
 *
 * Simulated here, deterministically from the hour and the world seed, so the
 * prototype needs no third-party feed and sends nobody's location anywhere. A real
 * build swaps this one function for a live forecast; everything downstream only
 * asks "what is the weather", not where it came from.
 */
export const WEATHER = {
  clear:        { name: 'Clear',        elements: { ember: 1.8, lumen: 1.4 } },
  rain:         { name: 'Rain',         elements: { tide: 2.0, ember: 0.5 } },
  thunderstorm: { name: 'Thunderstorm', elements: { volt: 2.5, tide: 1.4, ember: 0.4 } },
  snow:         { name: 'Snow',         elements: { tide: 1.6, gale: 1.4, ember: 0.4 }, freezing: true },
  fog:          { name: 'Fog',          elements: { gloom: 1.8 }, detectionScale: 0.6 },
  wind:         { name: 'High Wind',    elements: { gale: 2.2 } },
  overcast:     { name: 'Overcast',     elements: {} },
};

const WEATHER_TABLE = ['clear', 'overcast', 'overcast', 'rain', 'wind', 'fog', 'thunderstorm', 'clear', 'rain', 'snow'];

export function weatherAt(date = new Date(), seed = 1) {
  const hourBucket = Math.floor(date.getTime() / (3600 * 1000) / 3);   // shifts every 3 hours
  const roll = hash(hourBucket, seed + 31, 0);
  return WEATHER_TABLE[Math.floor(roll * WEATHER_TABLE.length)];
}

// ---------------------------------------------------------------- spawns

/**
 * Weight a species for this tile. A biome mismatch is a hard zero — that is what
 * makes walking somewhere different worth doing.
 */
function speciesWeight(species, biome, window, weather) {
  if (species.is_branch_form || species.apex) return 0;          // evolution-only / event-only
  if (!species.spawn.biomes.includes(biome)) return 0;

  let w = RARITY_WEIGHT[species.rarity] ?? 0;
  if (w === 0) return 0;

  const windows = species.spawn.time_windows;
  if (!windows.includes('any')) {
    w *= windows.includes(window) ? 2.0 : 0.3;                   // off-hours are rare, not impossible
  }
  const byElement = TIME_ELEMENT[window] ?? {};
  for (const el of species.elements) w *= byElement[el] ?? 1;

  const byWeather = WEATHER[weather]?.elements ?? {};
  for (const el of species.elements) w *= byWeather[el] ?? 1;

  return w;
}

/**
 * Every spawn in a tile, derived purely from (tile, bucket, seed). No state, so
 * the same call anywhere returns the same answer.
 */
export function spawnsInTile(tx, ty, bucket, pool, biome, window, seed = 1, weather = 'overcast') {
  const roll = hash(tx, ty, bucket, seed + 7);
  const rate = BIOMES[biome].rate;
  if (roll > rate) return [];

  const weights = pool.map((s) => speciesWeight(s, biome, window, weather));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return [];

  let pick = hash(tx, ty, bucket, seed + 11) * total;
  let chosen = pool[0];
  for (let i = 0; i < pool.length; i++) {
    pick -= weights[i];
    if (pick <= 0) { chosen = pool[i]; break; }
  }

  // Keep it off the tile edges so markers never sit on top of each other.
  const ox = 0.2 + hash(tx, ty, bucket, seed + 13) * 0.6;
  const oy = 0.2 + hash(tx, ty, bucket, seed + 17) * 0.6;

  return [{
    id: `${tx}:${ty}:${bucket}`,
    speciesId: chosen.id,
    /*
     * The rare colourway, rolled from the same (tile, bucket, seed) as everything
     * else about this spawn — so it is the same for everybody. Two Wardens in the
     * same park see the same rift-touched monster, which is what turns a shiny
     * from a screenshot into somewhere to walk to.
     *
     * The rate lives in elements.json; the salt is its own so adding it did not
     * move any existing spawn by a metre.
     */
    riftTouched: hash(tx, ty, bucket, seed + 29) < riftTouchedRate,
    packSize: packSizeFor(chosen, hash(tx, ty, bucket, seed + 23)),
    x: (tx + ox) * TILE_M,
    y: (ty + oy) * TILE_M,
    biome,
    bucket,
  }];
}

/**
 * How many turn up together.
 *
 * Small things swarm and big things come alone, which is both what the bestiary
 * describes — the Cinder family are pack canids, a Pebblit is a pebble — and what
 * the arsenal needs: a pellet cone, an area snare and a three-target chain have
 * nothing to say to a single monster. Rare species stay solitary so meeting one
 * remains an event rather than a wall.
 */
export function packSizeFor(species, roll) {
  if (['brute', 'colossus', 'titan'].includes(species.size)) return 1;
  if (['rare', 'very_rare', 'apex'].includes(species.rarity)) return 1;
  // The exponent biases towards the low end: a lone monster stays the common case,
  // so meeting a group reads as a distinct kind of encounter rather than the norm.
  if (species.size === 'mote') return 1 + Math.floor(roll ** 1.7 * 4);    // 1-4
  if (species.size === 'whelp') return 1 + Math.floor(roll ** 2.0 * 3);   // 1-3
  return 1 + Math.floor(roll ** 2.4 * 2);                                 // strider 1-2
}

/** Every spawn the Warden can currently see. */
/**
 * `biomeFor` lets the caller decide what each tile is — the real map when it has
 * loaded, the synthetic generator otherwise. The spawn maths never learns which,
 * which is why real biomes could be dropped in without touching any of it.
 */
export function visibleSpawns(px, py, bucket, pool, window, seed = 1, weather = 'overcast', biomeFor = null) {
  const range = DETECT_M * (WEATHER[weather]?.detectionScale ?? 1);
  const reach = Math.ceil(range / TILE_M) + 1;
  const ctx = Math.floor(px / TILE_M), cty = Math.floor(py / TILE_M);
  const out = [];

  for (let ty = cty - reach; ty <= cty + reach; ty++) {
    for (let tx = ctx - reach; tx <= ctx + reach; tx++) {
      const biome = biomeFor
        ? biomeFor((tx + 0.5) * TILE_M, (ty + 0.5) * TILE_M)
        : biomeAt(tx, ty, seed);
      for (const s of spawnsInTile(tx, ty, bucket, pool, biome, window, seed, weather)) {
        s.distance = Math.hypot(s.x - px, s.y - py);
        if (s.distance <= range) out.push(s);
      }
    }
  }
  return out.sort((a, b) => a.distance - b.distance);
}

/** Spawn pool for a build: wild-spawnable species from the given families. */
export function buildPool(monsters, families) {
  return monsters.filter((m) => families.includes(m.family) && !m.is_branch_form && !m.apex);
}

// ---------------------------------------------------------------- rift events

/*
 * Rift events.
 *
 * 09-risks-and-roadmap.md wants these scheduled, announced ahead, anchored to a
 * landmark, an hour or so long, with apexes in the closing minutes. They are the
 * only place Rift-element species exist at all — without them Riftspawn and Voidmaw
 * are in the bestiary and unreachable.
 *
 * Scheduling uses the same trick as spawns: derived from (cell, day, seed), so
 * every Warden sees the same rift open in the same place at the same time with no
 * server keeping track. One rift per cell per day means there is always one within
 * walking distance to plan around.
 */
export const RIFT_CELL_TILES = 30;                 // ~1.2 km between rifts
export const RIFT_RADIUS_M = 110;
export const RIFT_DURATION_MIN = 75;
export const APEX_WINDOW_MIN = 20;                 // the apex shows up for the finale
export const RIFT_RANK = 12;

/*
 * The three apexes, and the rule that decides which one a rift carries.
 *
 * This used to be a flat random pick, which quietly contradicted the bestiary:
 * Karrahk is published as waterside-in-a-storm and Nyxhollow as urban core or
 * woodland at midnight, and a rift dropped either of them into a car park at two
 * in the afternoon. Aeonrend is the rift-native one — `rift_event` / `event`, no
 * further conditions — so it is always eligible and always the fallback.
 *
 * Honouring the rules is what makes Research II worth buying on an apex: once you
 * know Karrahk wants water and a storm, you can go and find one.
 */
const APEX_IDS = ['karrahk', 'nyxhollow', 'aeonrend_apex'];
const DAY_MS = 24 * 60 * 60 * 1000;

const dayIndex = (date) => Math.floor(date.getTime() / DAY_MS);

/**
 * The rift for one cell on one day, whether or not it is currently open.
 *
 * `apexById` is optional. Without it the rift still schedules and still opens —
 * it just falls back to the rift-native apex, because deciding which apex fits
 * needs the bestiary's placement rules and the caller may not have them.
 */
export function riftForCell(cx, cy, day, seed = 1, apexById = null) {
  const roll = hash(cx, cy, day, seed + 41);
  /*
   * 08:00–23:00. The old range stopped at 21:00, which capped the latest possible
   * apex window at 22:35 — so `midnight`, the one window Nyxhollow is published
   * in, was unreachable by construction. A late rift is rare and that is correct:
   * a midnight apex should take planning to reach.
   */
  const startHour = 8 + Math.floor(hash(cx, cy, day, seed + 43) * 16);
  const startMin = Math.floor(hash(cx, cy, day, seed + 47) * 4) * 15;

  const dayStart = day * DAY_MS;
  const startMs = dayStart + startHour * 3600000 + startMin * 60000;
  const endMs = startMs + RIFT_DURATION_MIN * 60000;
  const apexFromMs = endMs - APEX_WINDOW_MIN * 60000;

  // Sit it a little off the cell centre so rifts are not on a visible grid.
  const ox = 0.3 + hash(cx, cy, day, seed + 53) * 0.4;
  const oy = 0.3 + hash(cx, cy, day, seed + 59) * 0.4;
  const x = (cx + ox) * RIFT_CELL_TILES * TILE_M;
  const y = (cy + oy) * RIFT_CELL_TILES * TILE_M;

  // The context that decides the apex is the one at the moment it appears, not
  // when the rift opens an hour earlier.
  const at = new Date(apexFromMs);
  const biome = biomeAt(Math.floor(x / TILE_M), Math.floor(y / TILE_M), seed);
  const weather = weatherAt(at, seed);

  let apexId = 'aeonrend_apex';
  let eligible = null;
  if (apexById) {
    eligible = APEX_IDS.filter((id) => {
      const sp = apexById[id];
      return sp && placementFits(sp, { biome, weather, date: at, inRift: true });
    });
    if (eligible.length) apexId = eligible[Math.floor(roll * eligible.length)];
  }

  return {
    id: `rift:${cx}:${cy}:${day}`,
    x, y,
    startMs,
    endMs,
    apexId,
    apexFromMs,
    // Carried so the UI can say why this rift has the apex it has, and so a
    // Warden reading Research II can act on it.
    biome,
    weather,
    apexEligible: eligible,
  };
}

/** Every rift near a position, today and tomorrow, sorted by distance. */
export function riftsNear(px, py, date = new Date(), seed = 1, cells = 1, apexById = null) {
  const cell = RIFT_CELL_TILES * TILE_M;
  const cx0 = Math.floor(px / cell), cy0 = Math.floor(py / cell);
  const today = dayIndex(date);
  const out = [];

  for (let dy = -cells; dy <= cells; dy++) {
    for (let dx = -cells; dx <= cells; dx++) {
      for (const day of [today, today + 1]) {
        const r = riftForCell(cx0 + dx, cy0 + dy, day, seed, apexById);
        r.distance = Math.hypot(r.x - px, r.y - py);
        r.opensInMs = r.startMs - date.getTime();
        r.active = date.getTime() >= r.startMs && date.getTime() < r.endMs;
        r.apexUp = r.active && date.getTime() >= r.apexFromMs;
        out.push(r);
      }
    }
  }
  return out.sort((a, b) => a.distance - b.distance);
}

/** The rift the Warden is currently standing inside, if it is open. */
export function riftAt(px, py, date = new Date(), seed = 1, apexById = null) {
  return riftsNear(px, py, date, seed, 1, apexById)
    .find((r) => r.active && r.distance <= RIFT_RADIUS_M) ?? null;
}

/** The next rift worth walking to: open now, or opening soonest. */
export function nextRift(px, py, date = new Date(), seed = 1, apexById = null) {
  const near = riftsNear(px, py, date, seed, 1, apexById);
  return near.find((r) => r.active)
    ?? near.filter((r) => r.opensInMs > 0).sort((a, b) => a.opensInMs - b.opensInMs)[0]
    ?? null;
}

/**
 * Spawns inside an open rift. Dense, Rift-element only, and in the closing minutes
 * the apex itself at the centre.
 */
export function riftSpawns(rift, px, py, pool, apexById, bucket, seed = 1) {
  const out = [];
  const riftPool = pool.filter((s) => s.elements.includes('rift'));
  const reach = Math.ceil(RIFT_RADIUS_M / TILE_M);
  const ctx = Math.floor(rift.x / TILE_M), cty = Math.floor(rift.y / TILE_M);

  for (let ty = cty - reach; ty <= cty + reach; ty++) {
    for (let tx = ctx - reach; tx <= ctx + reach; tx++) {
      const roll = hash(tx, ty, bucket, seed + 61);
      if (roll > 0.42) continue;                                   // dense by design
      if (!riftPool.length) continue;

      // Voidmaw is very rare even here; Riftspawn carries the event.
      const pick = hash(tx, ty, bucket, seed + 67);
      const chosen = riftPool.length > 1 && pick > 0.82
        ? riftPool.find((s) => s.rarity === 'very_rare') ?? riftPool[0]
        : riftPool.find((s) => s.rarity === 'rare') ?? riftPool[0];

      const x = (tx + 0.2 + hash(tx, ty, bucket, seed + 71) * 0.6) * TILE_M;
      const y = (ty + 0.2 + hash(tx, ty, bucket, seed + 73) * 0.6) * TILE_M;
      if (Math.hypot(x - rift.x, y - rift.y) > RIFT_RADIUS_M) continue;

      out.push({
        id: `${rift.id}:${tx}:${ty}:${bucket}`,
        speciesId: chosen.id,
        packSize: packSizeFor(chosen, hash(tx, ty, bucket, seed + 79)),
        x, y, biome: 'rift_event', bucket, inRift: true,
        distance: Math.hypot(x - px, y - py),
      });
    }
  }

  if (rift.apexUp && apexById[rift.apexId]) {
    out.push({
      id: `${rift.id}:apex`,
      speciesId: rift.apexId,
      packSize: 1,
      x: rift.x, y: rift.y,
      biome: 'rift_event', bucket, inRift: true, isApex: true,
      distance: Math.hypot(rift.x - px, rift.y - py),
    });
  }

  return out.sort((a, b) => a.distance - b.distance);
}

/*
 * The rift forecast.
 *
 * Honouring the bestiary's placement rules makes Karrahk and Nyxhollow genuinely
 * rare — about 0.4% and 1.1% of rifts — which is correct and, on its own, would
 * make them unfindable. The answer is not to loosen the rules; it is the thing
 * 09-risks-and-roadmap.md already asks for: rifts are "scheduled, announced
 * ahead". So scan wide and tell the Warden when and where the next one of each is.
 *
 * Cells are 1.2 km apart, so a ±3 scan covers about 8.4 km of city across the next
 * four days. At that range it is a Karrahk roughly every three days and a Nyxhollow
 * every two — an expedition to plan, not a lottery to wait out. A ±1 scan, which is
 * all the live rift list uses, turns up neither in a month.
 */
export const FORECAST_CELLS = 3;        // ±3 cells ≈ 8.4 km across
export const FORECAST_DAYS = 4;

export function apexForecast(px, py, date = new Date(), seed = 1, apexById = null, opts = {}) {
  const cells = opts.cells ?? FORECAST_CELLS;
  const days = opts.days ?? FORECAST_DAYS;
  const cell = RIFT_CELL_TILES * TILE_M;
  const cx0 = Math.floor(px / cell), cy0 = Math.floor(py / cell);
  const today = dayIndex(date);
  const now = date.getTime();

  const best = {};
  for (let dy = -cells; dy <= cells; dy++) {
    for (let dx = -cells; dx <= cells; dx++) {
      for (let d = 0; d < days; d++) {
        const r = riftForCell(cx0 + dx, cy0 + dy, today + d, seed, apexById);
        // Only things still to come, or the one running right now.
        if (r.endMs <= now) continue;
        const cur = best[r.apexId];
        if (!cur || r.apexFromMs < cur.apexFromMs) {
          best[r.apexId] = {
            ...r,
            distance: Math.hypot(r.x - px, r.y - py),
            opensInMs: r.startMs - now,
            apexInMs: r.apexFromMs - now,
            active: now >= r.startMs && now < r.endMs,
          };
        }
      }
    }
  }
  return APEX_IDS.map((id) => best[id]).filter(Boolean).sort((a, b) => a.apexFromMs - b.apexFromMs);
}
