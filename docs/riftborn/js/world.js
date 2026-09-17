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
    x: (tx + ox) * TILE_M,
    y: (ty + oy) * TILE_M,
    biome,
    bucket,
  }];
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
