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

export const BIOMES = {
  urban_core:  { name: 'Urban Core',  colour: '#3b4353', rate: 0.20 },
  industrial:  { name: 'Industrial',  colour: '#4a4132', rate: 0.22 },
  works:       { name: 'Works',       colour: '#5c4c33', rate: 0.24 },
  transit:     { name: 'Transit',     colour: '#2a3138', rate: 0.21 },
  waterside:   { name: 'Waterside',   colour: '#25445c', rate: 0.22 },
  woodland:    { name: 'Woodland',    colour: '#22412a', rate: 0.20 },
  parkland:    { name: 'Parkland',    colour: '#2d5436', rate: 0.16 },
  open_ground: { name: 'Open Ground', colour: '#31463a', rate: 0.15 },
  residential: { name: 'Residential', colour: '#2b2f36', rate: 0.07 },
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
export function visibleSpawns(px, py, bucket, pool, window, seed = 1, weather = 'overcast') {
  const range = DETECT_M * (WEATHER[weather]?.detectionScale ?? 1);
  const reach = Math.ceil(range / TILE_M) + 1;
  const ctx = Math.floor(px / TILE_M), cty = Math.floor(py / TILE_M);
  const out = [];

  for (let ty = cty - reach; ty <= cty + reach; ty++) {
    for (let tx = ctx - reach; tx <= ctx + reach; tx++) {
      const biome = biomeAt(tx, ty, seed);
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

const APEX_IDS = ['karrahk', 'nyxhollow', 'aeonrend_apex'];
const DAY_MS = 24 * 60 * 60 * 1000;

const dayIndex = (date) => Math.floor(date.getTime() / DAY_MS);

/** The rift for one cell on one day, whether or not it is currently open. */
export function riftForCell(cx, cy, day, seed = 1) {
  const roll = hash(cx, cy, day, seed + 41);
  const startHour = 8 + Math.floor(hash(cx, cy, day, seed + 43) * 14);   // 08:00–21:00
  const startMin = Math.floor(hash(cx, cy, day, seed + 47) * 4) * 15;

  const midnight = day * DAY_MS;
  const startMs = midnight + startHour * 3600000 + startMin * 60000;
  const endMs = startMs + RIFT_DURATION_MIN * 60000;

  // Sit it a little off the cell centre so rifts are not on a visible grid.
  const ox = 0.3 + hash(cx, cy, day, seed + 53) * 0.4;
  const oy = 0.3 + hash(cx, cy, day, seed + 59) * 0.4;

  return {
    id: `rift:${cx}:${cy}:${day}`,
    x: (cx + ox) * RIFT_CELL_TILES * TILE_M,
    y: (cy + oy) * RIFT_CELL_TILES * TILE_M,
    startMs,
    endMs,
    apexId: APEX_IDS[Math.floor(roll * APEX_IDS.length)],
    apexFromMs: endMs - APEX_WINDOW_MIN * 60000,
  };
}

/** Every rift near a position, today and tomorrow, sorted by distance. */
export function riftsNear(px, py, date = new Date(), seed = 1, cells = 1) {
  const cell = RIFT_CELL_TILES * TILE_M;
  const cx0 = Math.floor(px / cell), cy0 = Math.floor(py / cell);
  const today = dayIndex(date);
  const out = [];

  for (let dy = -cells; dy <= cells; dy++) {
    for (let dx = -cells; dx <= cells; dx++) {
      for (const day of [today, today + 1]) {
        const r = riftForCell(cx0 + dx, cy0 + dy, day, seed);
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
export function riftAt(px, py, date = new Date(), seed = 1) {
  return riftsNear(px, py, date, seed).find((r) => r.active && r.distance <= RIFT_RADIUS_M) ?? null;
}

/** The next rift worth walking to: open now, or opening soonest. */
export function nextRift(px, py, date = new Date(), seed = 1) {
  const near = riftsNear(px, py, date, seed);
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
