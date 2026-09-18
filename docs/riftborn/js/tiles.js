/*
 * RIFTBORN — map tiles, and reading the ground off them.
 *
 * Two jobs. Draw the real world under the patrol view, and answer "what am I
 * standing on" from the pixels rather than from a noise function.
 *
 * Everything degrades. No network, no CORS, a provider that refuses — each of
 * those falls back to the synthetic generator the game shipped with, because a
 * location game that stops working when the map does is worse than one with an
 * invented landscape.
 */

import {
  TILE_PX, tileAt, tileOrigin, tileSpan, normaliseTile, tileUrl,
  TILE_PROVIDERS, DEFAULT_PROVIDER, biomeFromPixel,
} from './geo.js';

export const MAP_ZOOM = 17;                 // ~1.2 m per pixel; a street is legible
const GRID = 16;                            // biome cells per tile edge (~19 m each)
const MAX_TILES = 256;                      // in-memory cap; roughly 25 MB of bitmaps
const CACHE_NAME = 'riftborn-tiles-v1';

/*
 * Colour alone cannot tell industrial from works from transit — they are all grey.
 * So the map decides the big question (water / green / built) and the synthetic
 * generator decides which *kind* of built, which keeps all nine biomes reachable.
 * The placement suite asserts that, so letting the map collapse the built biomes
 * into one would fail a test rather than quietly starve four families.
 */
const BUILT = ['urban_core', 'residential', 'industrial', 'transit', 'works', 'open_ground'];

export function createTileSource(opts = {}) {
  const provider = opts.provider ?? DEFAULT_PROVIDER;
  // A provider with no URL is the "no map" setting: everything below becomes a
  // no-op and the caller falls back to the synthetic world without knowing.
  const live = Boolean((TILE_PROVIDERS[provider] ?? {}).url);
  const fallbackBiome = opts.fallbackBiome;          // (tx, ty) -> biome, the synthetic one
  const tiles = new Map();                           // key -> { img, grid, state }
  const order = [];                                  // insertion order, for eviction
  let tainted = false;                               // set once a CORS read has failed

  const key = (x, y, z) => `${z}/${x}/${y}`;

  function evict() {
    while (order.length > MAX_TILES) {
      const k = order.shift();
      const t = tiles.get(k);
      if (t?.img?.close) { try { t.img.close(); } catch { /* not an ImageBitmap */ } }
      tiles.delete(k);
    }
  }

  /**
   * Classify one tile into a GRID x GRID biome grid.
   *
   * The built-vs-open call is made by *contrast within the tile*, not absolute
   * lightness: a dark basemap draws roads lighter than the ground and a light one
   * draws them darker, and hard-coding either way made every CARTO Light tile read
   * as open ground.
   */
  function classify(bitmap, tx, ty, z) {
    const c = document.createElement('canvas');
    c.width = TILE_PX;
    c.height = TILE_PX;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, TILE_PX, TILE_PX);

    let data;
    try {
      data = ctx.getImageData(0, 0, TILE_PX, TILE_PX).data;
    } catch {
      // Tainted canvas: the provider sent no CORS header. Display still works.
      tainted = true;
      return null;
    }

    const cell = TILE_PX / GRID;
    const grid = new Array(GRID * GRID);
    const lightness = new Array(GRID * GRID);
    const variation = new Array(GRID * GRID);

    for (let gy = 0; gy < GRID; gy++) {
      for (let gx = 0; gx < GRID; gx++) {
        const votes = {};
        let sum = 0, sumSq = 0, n = 0;
        for (let py = 0; py < cell; py += 2) {
          for (let px = 0; px < cell; px += 2) {
            const i = (((gy * cell + py) | 0) * TILE_PX + ((gx * cell + px) | 0)) * 4;
            const r = data[i], g = data[i + 1], b = data[i + 2];
            const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
            sum += lum; sumSq += lum * lum; n++;
            const biome = biomeFromPixel(r, g, b);
            if (biome) votes[biome] = (votes[biome] ?? 0) + 1;
          }
        }
        const idx = gy * GRID + gx;
        const mean = sum / n;
        lightness[idx] = mean;
        variation[idx] = Math.sqrt(Math.max(0, sumSq / n - mean * mean));

        // A cell is water or green only if a clear majority of it is.
        const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
        grid[idx] = best && best[1] > n * 0.45 ? best[0] : null;
      }
    }

    // Anything unclaimed is "built or bare" — the synthetic generator picks which,
    // but how busy the pixels are decides whether it is busy-built or open.
    const span = tileSpan(z);
    for (let i = 0; i < grid.length; i++) {
      if (grid[i]) continue;
      const gx = i % GRID, gy = Math.floor(i / GRID);
      const wx = tx * span + ((gx + 0.5) / GRID) * span;
      const wy = ty * span + ((gy + 0.5) / GRID) * span;
      const synthetic = fallbackBiome ? fallbackBiome(wx, wy) : 'residential';
      const busy = variation[i] > 0.075;
      if (busy) {
        // Keep the synthetic answer when it is already a built biome; otherwise
        // the map is telling us there is structure here that the noise missed.
        grid[i] = BUILT.includes(synthetic) && synthetic !== 'open_ground' ? synthetic : 'urban_core';
      } else {
        grid[i] = synthetic === 'urban_core' ? 'residential' : synthetic;
      }
    }
    return grid;
  }

  async function fetchTile(x, y, z) {
    const { x: nx, y: ny } = normaliseTile(x, y, z);
    const url = tileUrl(provider, nx, ny, z);
    /*
     * Cache-first, so a route you have walked before still draws with no signal.
     * The Cache API is used directly rather than through the service worker
     * because tiles are the one thing that should keep growing after install.
     */
    let response = null;
    try {
      const cache = await caches.open(CACHE_NAME);
      response = await cache.match(url);
      if (!response) {
        response = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (response.ok) await cache.put(url, response.clone());
      }
    } catch {
      try {
        response = await fetch(url, { mode: 'cors', credentials: 'omit' });
      } catch {
        return null;
      }
    }
    if (!response || !response.ok) return null;
    try {
      return await createImageBitmap(await response.blob());
    } catch {
      return null;
    }
  }

  /*
   * The no-CORS path.
   *
   * `fetch(mode: 'cors')` does not merely fail to *sample* a provider that sends
   * no Access-Control-Allow-Origin — it refuses the response outright, so the map
   * does not draw at all. An <img> has no such scruples: it will display the tile
   * and taint any canvas it is read from. So a provider without CORS still gets a
   * visible map, and loses only the biome reading, which is exactly the trade the
   * rest of this module was written assuming.
   */
  function fetchTileNoCors(x, y, z) {
    const { x: nx, y: ny } = normaliseTile(x, y, z);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => { tainted = true; resolve(img); };
      img.onerror = () => resolve(null);
      img.src = tileUrl(provider, nx, ny, z);
    });
  }

  function request(x, y, z) {
    if (!live) return { state: 'off', img: null, grid: null };
    const k = key(x, y, z);
    if (tiles.has(k)) return tiles.get(k);
    const entry = { state: 'loading', img: null, grid: null };
    tiles.set(k, entry);
    order.push(k);
    evict();

    const cors = (TILE_PROVIDERS[provider] ?? {}).cors !== false;
    const load = cors ? fetchTile(x, y, z) : fetchTileNoCors(x, y, z);
    load.then((bitmap) => {
      if (!bitmap) { entry.state = 'failed'; return; }
      entry.img = bitmap;
      entry.grid = cors ? classify(bitmap, ...normaliseTileXY(x, y, z), z) : null;
      entry.state = entry.grid ? 'ready' : 'display-only';
    }).catch(() => { entry.state = 'failed'; });

    return entry;
  }

  const normaliseTileXY = (x, y, z) => {
    const n = normaliseTile(x, y, z);
    return [n.x, n.y];
  };

  return {
    provider,
    get tainted() { return tainted; },
    get attribution() { return (TILE_PROVIDERS[provider] ?? TILE_PROVIDERS[DEFAULT_PROVIDER]).attribution; },
    get loaded() { return [...tiles.values()].filter((t) => t.state === 'ready' || t.state === 'display-only').length; },

    get live() { return live; },

    /** Warm the tiles around a world point so the map is there before it is needed. */
    prefetch(x, y, z = MAP_ZOOM, radius = 1) {
      if (!live) return;
      const t = tileAt(x, y, z);
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) request(t.x + dx, t.y + dy, z);
      }
    },

    /**
     * The biome at a world point, read from the map. Null when the tile is not
     * loaded, has no grid, or could not be sampled — the caller falls back.
     */
    biomeAt(x, y, z = MAP_ZOOM) {
      if (!live) return null;
      const t = tileAt(x, y, z);
      const entry = tiles.get(key(...normaliseTileXY(t.x, t.y, z), z));
      if (!entry?.grid) return null;
      const gx = Math.min(GRID - 1, Math.floor((t.px / TILE_PX) * GRID));
      const gy = Math.min(GRID - 1, Math.floor((t.py / TILE_PX) * GRID));
      return entry.grid[gy * GRID + gx] ?? null;
    },

    /**
     * Draw the map under a view centred on (cx, cy) world metres.
     * `scale` is canvas pixels per Mercator metre.
     */
    draw(ctx, cx, cy, w, h, scale, z = MAP_ZOOM) {
      if (!live) return 0;
      const span = tileSpan(z);
      const tilePxOnScreen = span * scale;
      const halfW = w / 2 / scale;
      const halfH = h / 2 / scale;
      const t0 = tileAt(cx - halfW, cy - halfH, z);
      const t1 = tileAt(cx + halfW, cy + halfH, z);

      let drawn = 0;
      for (let ty = t0.y; ty <= t1.y; ty++) {
        for (let tx = t0.x; tx <= t1.x; tx++) {
          const entry = request(tx, ty, z);
          const o = tileOrigin(tx, ty, z);
          const sx = w / 2 + (o.x - cx) * scale;
          const sy = h / 2 + (o.y - cy) * scale;
          if (entry.img) {
            // +1 px on the size closes the hairline seams that rounding leaves.
            ctx.drawImage(entry.img, sx, sy, tilePxOnScreen + 1, tilePxOnScreen + 1);
            drawn++;
          }
        }
      }
      return drawn;
    },
  };
}
