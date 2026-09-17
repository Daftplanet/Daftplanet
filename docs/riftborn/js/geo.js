/*
 * RIFTBORN — the real world.
 *
 * Everything in the game already worked in metres on a flat plane. This turns that
 * plane into the actual Earth by making it Web Mercator: the same projection every
 * slippy map uses, so a position in game metres is a position on a real street and
 * the two never need translating at the edges.
 *
 * The consequence worth knowing: Mercator metres are not ground metres away from
 * the equator. At latitude φ a Mercator metre is cos(φ) ground metres — in London
 * that is 0.62 — so every distance shown to a player goes through `groundMetres`.
 * Spawn tiles are laid out in Mercator metres, which means a 40 m tile is a little
 * smaller on the ground the further north you are. That is a real distortion and
 * it is deliberate: it keeps the tile grid identical for every player worldwide,
 * which is what makes deterministic spawns work without a server.
 *
 * No DOM here, so the projection can be tested headlessly.
 */

export const EARTH_CIRCUMFERENCE = 40075016.686;
export const ORIGIN_SHIFT = EARTH_CIRCUMFERENCE / 2;      // 20037508.34
export const MAX_LAT = 85.05112878;                       // where Mercator gives up

const clampLat = (lat) => Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/** Longitude/latitude to Web Mercator metres, with the origin moved to the top-left. */
export function lonLatToWorld(lon, lat) {
  const x = ((lon + 180) / 360) * EARTH_CIRCUMFERENCE;
  const s = Math.sin(rad(clampLat(lat)));
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * EARTH_CIRCUMFERENCE;
  return { x, y };
}

/** And back. */
export function worldToLonLat(x, y) {
  const lon = (x / EARTH_CIRCUMFERENCE) * 360 - 180;
  const n = Math.PI * (1 - (2 * y) / EARTH_CIRCUMFERENCE);
  const lat = deg(Math.atan(Math.sinh(n)));
  return { lon, lat };
}

/**
 * How many ground metres one Mercator metre is worth here. Everything a player
 * reads — distance to a spawn, kilometres walked, rift range — multiplies by this.
 */
export function groundScale(y) {
  return Math.cos(rad(clampLat(worldToLonLat(0, y).lat)));
}

/** Ground distance in metres between two world points. */
export function groundMetres(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay) * groundScale((ay + by) / 2);
}

// ---------------------------------------------------------------- slippy tiles

export const TILE_PX = 256;

/** Mercator metres covered by one map tile at this zoom. */
export function tileSpan(zoom) {
  return EARTH_CIRCUMFERENCE / Math.pow(2, zoom);
}

/** The slippy-map tile containing a world point, plus where in it the point falls. */
export function tileAt(x, y, zoom) {
  const span = tileSpan(zoom);
  const fx = x / span;
  const fy = y / span;
  const tx = Math.floor(fx);
  const ty = Math.floor(fy);
  return { z: zoom, x: tx, y: ty, px: (fx - tx) * TILE_PX, py: (fy - ty) * TILE_PX };
}

/** The world position of a tile's top-left corner. */
export function tileOrigin(tx, ty, zoom) {
  const span = tileSpan(zoom);
  return { x: tx * span, y: ty * span };
}

/** Tiles are only valid inside the pyramid; wrap in x, clamp in y. */
export function normaliseTile(tx, ty, zoom) {
  const n = Math.pow(2, zoom);
  return { x: ((tx % n) + n) % n, y: Math.max(0, Math.min(n - 1, ty)) };
}

/*
 * Tile providers.
 *
 * `crossOrigin` matters more than it looks: reading biome from the map means
 * calling getImageData on a canvas the tile was drawn into, and a tile served
 * without CORS headers taints that canvas and makes the read throw. Providers
 * that do not send them can still be *displayed*, just not sampled — see
 * tiles.js, which falls back to the synthetic generator rather than failing.
 *
 * Attribution is not optional. Every provider here requires it and the map draws
 * it; removing that line would be a licence violation, not a style choice.
 */
export const TILE_PROVIDERS = {
  /*
   * The default is deliberately OFF, and that is a privacy decision before it is
   * a technical one. Asking for a map tile tells the tile host roughly where the
   * player is; nothing should do that before the player has asked for a map. Until
   * then the synthetic generator draws the ground, exactly as it always has.
   */
  off: {
    name: 'No map (synthetic)',
    url: null,
    subdomains: [],
    attribution: '',
    maxZoom: 22,
    cors: false,
    dark: true,
  },
  carto_dark: {
    name: 'CARTO Dark',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    subdomains: ['a', 'b', 'c', 'd'],
    attribution: '© OpenStreetMap contributors © CARTO',
    maxZoom: 20,
    cors: true,
    dark: true,
  },
  carto_light: {
    name: 'CARTO Light',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    subdomains: ['a', 'b', 'c', 'd'],
    attribution: '© OpenStreetMap contributors © CARTO',
    maxZoom: 20,
    cors: true,
    dark: false,
  },
  osm: {
    name: 'OpenStreetMap',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    subdomains: [],
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
    cors: true,
    dark: false,
  },
};

export const DEFAULT_PROVIDER = 'off';
export const SUGGESTED_PROVIDER = 'carto_dark';   // what 'turn the map on' picks

/*
 * Test providers, registered only when the harness has asked for them. The map
 * path is otherwise untestable in a sandbox with no outbound network — and a
 * suite that depends on a real tile host being up fails for reasons that are not
 * the code's. `test` serves tiles with CORS, `test_opaque` without, `test_dead`
 * 404s, which is one branch of tiles.js each.
 */
if (typeof window !== 'undefined' && window.__TEST_TILES__) {
  const origin = window.__TEST_TILES__;
  Object.assign(TILE_PROVIDERS, {
    test: {
      name: 'Test tiles', url: `${origin}/faketiles/{z}/{x}/{y}.png`, subdomains: [],
      attribution: '© OpenStreetMap contributors (test)', maxZoom: 20, cors: true, dark: true,
    },
    test_opaque: {
      name: 'Test tiles (no CORS)', url: `${origin}/opaquetile/{z}/{x}/{y}.png`, subdomains: [],
      attribution: '© OpenStreetMap contributors (test)', maxZoom: 20, cors: false, dark: true,
    },
    test_dead: {
      name: 'Test tiles (404)', url: `${origin}/notile/{z}/{x}/{y}.png`, subdomains: [],
      attribution: '© OpenStreetMap contributors (test)', maxZoom: 20, cors: true, dark: true,
    },
  });
}

/** Build a tile URL. `{r}` is the retina suffix, used only where the device wants it. */
export function tileUrl(provider, x, y, z, retina = false) {
  const p = TILE_PROVIDERS[provider] ?? TILE_PROVIDERS[DEFAULT_PROVIDER];
  const sub = p.subdomains.length
    ? p.subdomains[Math.abs(x + y) % p.subdomains.length]
    : '';
  return p.url
    .replace('{s}', sub)
    .replace('{z}', z)
    .replace('{x}', x)
    .replace('{y}', y)
    .replace('{r}', retina && p.cors ? '@2x' : '');
}

// ---------------------------------------------------------------- biome by colour

/*
 * Reading the biome off the map.
 *
 * A rendered map tile already encodes what is on the ground: water is blue, parks
 * and woods are green, buildings and roads are grey. Classifying the pixel is
 * approximate and it is also the only method that needs no second API, no rate
 * limit, and — the reason it was chosen over Overpass — sends nobody's coordinates
 * anywhere the map request was not already going.
 *
 * Thresholds are in HSL because the two CARTO styles and OSM have very different
 * lightness but agree on hue: water is blue whether the basemap is dark or light.
 */
export function rgbToHsl(r, g, b) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h: h * 360, s, l };
}

/**
 * One pixel to one biome. Returns null when the colour says nothing useful, so the
 * caller can fall back rather than inventing a landscape.
 */
export function biomeFromPixel(r, g, b) {
  const { h, s, l } = rgbToHsl(r, g, b);

  // Saturated blue is water on every basemap in TILE_PROVIDERS.
  if (h >= 175 && h <= 260 && s > 0.12) return 'waterside';
  // Saturated green is vegetation. Dark green reads as woodland, pale as parkland.
  if (h >= 70 && h <= 175 && s > 0.10) return l < 0.42 ? 'woodland' : 'parkland';

  // Everything else is built or bare, separated by how busy the pixel is. A tile
  // renderer draws roads and buildings lighter than open land on a dark basemap
  // and darker on a light one, so this is decided by contrast against the tile,
  // not by absolute lightness — see classifyTile.
  return null;
}
