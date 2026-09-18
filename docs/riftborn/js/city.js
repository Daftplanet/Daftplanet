/*
 * RIFTBORN — the city, seen from a tilted camera.
 *
 * The patrol map was drawn straight down: flat coloured tiles with small flat
 * silhouettes scattered on them. That reads as a diagram of a place rather than
 * a place. This module draws the same tiles from a camera tipped forward, so
 * buildings stand up off the ground, trees have trunks, and everything casts a
 * shadow onto the tile it is standing on.
 *
 * The projection is the cheapest one that does the job. There is no rotation and
 * no perspective divide — the world's X maps straight to the screen's X, and the
 * world's Y is squashed by TILT. That is an axonometric camera tipped forward by
 * asin(TILT) ≈ 38°, and it buys three things a true 3D camera would charge for:
 *
 *   - A world-axis-aligned rectangle stays a screen-axis-aligned rectangle, so
 *     the pre-baked ground tiles from patrol.js still blit with one drawImage.
 *   - Nothing needs a depth buffer. Sorting structures by their world Y and
 *     painting far to near is exact, because nothing is rotated.
 *   - It is reversible in one line, which matters because every tap on the map
 *     has to come back the other way to a world position.
 *
 * What you give up is side walls: with no rotation a box shows its front face and
 * its roof and nothing else. That is not a compromise so much as the house style —
 * it is what a stylised map wants, and it keeps a building readable at the size a
 * phone actually draws one.
 */

import { TILE_M, BIOMES } from './world.js';

/*
 * sin and cos of the camera's tilt. Ground depth is scaled by TILT, height by
 * RISE, and keeping them a sine/cosine pair rather than two free dials is what
 * stops a building looking like it is leaning.
 */
export const TILT = 0.62;
export const RISE = Math.sqrt(1 - TILT * TILT);   // ≈ 0.785

/** World metres to screen pixels, for a camera centred on (camX, camY). */
export const project = (wx, wy, camX, camY, cx, cy, pxPerM) =>
  [cx + (wx - camX) * pxPerM, cy + (wy - camY) * pxPerM * TILT];

/** And back again, because a tap on the map is a place on the ground. */
export const unproject = (sx, sy, camX, camY, cx, cy, pxPerM) =>
  [camX + (sx - cx) / pxPerM, camY + (sy - cy) / (pxPerM * TILT)];

/** How many screen pixels tall a thing of `metres` stands. */
export const riseOf = (metres, pxPerM) => metres * pxPerM * RISE;

function rng(tx, ty, salt = 0) {
  let a = (Math.imul(tx | 0, 0x27d4eb2d) ^ Math.imul(ty | 0, 0x165667b1) ^ (salt * 0x9e3779b9)) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Mix two #rrggbb colours. Used for every face tone, so it is worth having once. */
function mix(a, b, k) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const f = clamp01(k);
  const r = Math.round((pa >> 16) * (1 - f) + (pb >> 16) * f);
  const g = Math.round(((pa >> 8) & 255) * (1 - f) + ((pb >> 8) & 255) * f);
  const bl = Math.round((pa & 255) * (1 - f) + (pb & 255) * f);
  return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, '0')}`;
}

/*
 * What stands up on each biome.
 *
 * `count` is per tile, `h` is a height range in metres, and `foot` is the
 * footprint as a fraction of the tile. These are the numbers that decide whether
 * a place reads as a city centre or a suburb, so they are a table rather than
 * being scattered through the drawing code.
 */
const SKYLINE = {
  urban_core:  { kind: 'block', count: [2, 3], h: [15, 38], foot: [0.28, 0.44], windows: true,
                 wall: ['#7c8aa4', '#8b96ae', '#6b7992', '#94849c'], roof: '#414c63' },
  residential: { kind: 'house', count: [2, 3], h: [6, 9],   foot: [0.18, 0.26],
                 wall: ['#d2bda2', '#dfcbae', '#c3ab90'], roof: '#a8543c' },
  industrial:  { kind: 'shed',  count: [1, 2], h: [11, 19], foot: [0.26, 0.40], tanks: true,
                 wall: ['#7e8b93', '#8c98a0', '#6f7c85'], roof: '#4a555c' },
  works:       { kind: 'block', count: [1, 2], h: [7, 14],  foot: [0.17, 0.27],
                 wall: ['#b4a181', '#c0ad8d', '#a4926f'], roof: '#6d5c43' },
  transit:     { kind: 'platform', count: [0, 1], h: [2.5, 4], foot: [0.34, 0.5], flat: true,
                 chance: 0.3, wall: ['#6b7480', '#78818d'], roof: '#525b66' },
  waterside:   { kind: 'water', count: [0, 0], h: [0, 0],   foot: [0, 0], flat: true },
  woodland:    { kind: 'tree',  count: [3, 5], h: [8, 15],  foot: [0.18, 0.28],
                 crown: ['#3f8a43', '#4d9b4a', '#357a3c'] },
  parkland:    { kind: 'tree',  count: [1, 2], h: [7, 12],  foot: [0.18, 0.26],
                 crown: ['#5cae55', '#6bbd61', '#4e9e4c'] },
  open_ground: { kind: 'tuft',  count: [3, 5], h: [0.8, 1.8], foot: [0.06, 0.12],
                 crown: ['#8fa254', '#9cb05e'] },
};

/*
 * A structure's own colours, rather than the ground's.
 *
 * The first pass tinted every building from its tile's `ink` and `lit`, which is
 * how the whole map came out one shade of mud: the ground tones were chosen to
 * sit *behind* things, and using them for the things as well leaves nothing to
 * tell the two apart. A building gets its own palette, picked per structure so a
 * street is not all one colour.
 */
function paletteFor(s) {
  const plan = SKYLINE[s.biome] ?? {};
  const pick = (arr, k) => arr[Math.floor(k * arr.length) % arr.length];
  if (plan.crown) return { crown: pick(plan.crown, s.seed) };
  const wall = pick(plan.wall ?? ['#8b8b8b'], s.seed);
  return { wall, roof: plan.roof ?? '#b0b0b0' };
}

/**
 * Does this biome's ground get things standing on it?
 *
 * Where it does, the flat top-down silhouettes that used to name the place are
 * switched off: they were drawn for a straight-down camera, and leaving them on
 * paints a tree seen from above underneath a tree seen from the side. Water and
 * rails keep theirs, because a ripple and a railway line are markings on the
 * ground rather than objects on it.
 */
export const standsUp = (biome) => !!SKYLINE[biome] && !SKYLINE[biome].flat;

/**
 * Every structure standing on one tile, in world metres.
 *
 * Kept separate from the drawing because the whole screen's worth has to be
 * gathered and sorted by depth before any of it is painted — a building drawn
 * out of order sits in front of the one that should be hiding it.
 */
export function structuresOn(tx, ty, biome, salt = 11) {
  const plan = SKYLINE[biome];
  if (!plan || plan.kind === 'water') return [];
  const r = rng(tx, ty, salt);
  if (plan.chance != null && r() > plan.chance) return [];
  const n = plan.count[0] + Math.floor(r() * (plan.count[1] - plan.count[0] + 1));
  const out = [];
  for (let i = 0; i < n; i++) {
    const foot = (plan.foot[0] + r() * (plan.foot[1] - plan.foot[0])) * TILE_M;
    const depth = foot * (0.75 + r() * 0.5);
    // Inset so nothing straddles a tile edge: a building cut in half by the
    // seam between two tiles is the tell that this is a grid and not a town.
    const margin = 0.08 * TILE_M;
    const x = tx * TILE_M + margin + r() * Math.max(0, TILE_M - foot - margin * 2);
    const y = ty * TILE_M + margin + r() * Math.max(0, TILE_M - depth - margin * 2);
    out.push({
      kind: plan.kind, x, y, w: foot, d: depth,
      h: plan.h[0] + r() * (plan.h[1] - plan.h[0]),
      seed: r(), windows: !!plan.windows, biome,
    });
  }
  if (plan.tanks && r() < 0.6) {
    const rad = (0.10 + r() * 0.05) * TILE_M;
    out.push({
      kind: 'tank', x: tx * TILE_M + 0.1 * TILE_M + r() * TILE_M * 0.6,
      y: ty * TILE_M + 0.1 * TILE_M + r() * TILE_M * 0.6,
      w: rad * 2, d: rad * 2, h: 6 + r() * 5, seed: r(), biome,
    });
  }
  return out;
}

/*
 * A soft contact shadow. Everything standing gets one, because without it a
 * building reads as a sticker floating over the ground rather than resting on it.
 */
function shadow(ctx, sx, sy, w, d) {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.26)';
  ctx.beginPath();
  ctx.ellipse(sx + w / 2, sy, w * 0.62, Math.max(2, d * 0.42), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** A flat-roofed box: front wall, roof, and a rim where they meet. */
function box(ctx, s, sx, sy, w, d, rise, pal) {
  const wall = pal.wall;
  ctx.fillStyle = mix(wall, '#000000', 0.20);
  ctx.fillRect(sx, sy - rise, w, rise);

  // A vertical gradient on the wall is what keeps a tall box from reading as a
  // flat rectangle: the base sits in the street's shade, the top catches the sky.
  const g = ctx.createLinearGradient(0, sy - rise, 0, sy);
  g.addColorStop(0, mix(wall, '#ffffff', 0.10));
  g.addColorStop(1, mix(wall, '#000000', 0.34));
  ctx.fillStyle = g;
  ctx.fillRect(sx, sy - rise, w, rise);

  ctx.fillStyle = pal.roof;
  ctx.fillRect(sx, sy - rise - d, w, d);

  // The lit rim where roof meets wall separates the two planes at the size a
  // phone actually draws one, where a shading difference alone disappears.
  ctx.fillStyle = mix(pal.roof, '#ffffff', 0.45);
  ctx.fillRect(sx, sy - rise - 1.2, w, 1.6);

  if (s.windows && rise > 14) {
    /*
     * Windows are the one detail that says "tall building" rather than "tall
     * box". They are seeded from the structure, so a given tower keeps the same
     * windows lit every time you walk past it.
     */
    const wr = rng(Math.round(s.x), Math.round(s.y), 7);
    const cols = Math.max(1, Math.round(w / 7));
    const rows = Math.max(1, Math.round(rise / 8));
    const pw = w / cols, ph = rise / rows;
    for (let cIdx = 0; cIdx < cols; cIdx++) {
      for (let rIdx = 0; rIdx < rows; rIdx++) {
        if (wr() < 0.35) continue;
        ctx.fillStyle = wr() < 0.28 ? 'rgba(255,226,158,0.75)' : 'rgba(196,216,240,0.22)';
        ctx.fillRect(sx + cIdx * pw + pw * 0.24, sy - rise + rIdx * ph + ph * 0.24,
                     Math.max(1.5, pw * 0.5), Math.max(1.5, ph * 0.44));
      }
    }
  }
}

/** A house: a box with a pitched roof, which is what stops it reading as a shed. */
function house(ctx, s, sx, sy, w, d, rise, pal) {
  const g = ctx.createLinearGradient(0, sy - rise, 0, sy);
  g.addColorStop(0, mix(pal.wall, '#ffffff', 0.08));
  g.addColorStop(1, mix(pal.wall, '#000000', 0.26));
  ctx.fillStyle = g;
  ctx.fillRect(sx, sy - rise, w, rise);

  // The roof slab first, so the gable in front of it reads as the near end of a
  // roof rather than a triangle stuck on a wall.
  const ridge = Math.max(5, rise * 0.5);
  ctx.fillStyle = mix(pal.roof, '#000000', 0.22);
  ctx.fillRect(sx - w * 0.04, sy - rise - d - ridge * 0.1, w * 1.08, d + ridge * 0.1);

  ctx.fillStyle = pal.roof;
  ctx.beginPath();
  ctx.moveTo(sx - w * 0.04, sy - rise);
  ctx.lineTo(sx + w / 2, sy - rise - ridge);
  ctx.lineTo(sx + w * 1.04, sy - rise);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = mix(pal.roof, '#ffffff', 0.35);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(sx - w * 0.04, sy - rise);
  ctx.lineTo(sx + w / 2, sy - rise - ridge);
  ctx.stroke();

  // One lit window, which is most of what makes a small house read as a home.
  const hr = rng(Math.round(s.x), Math.round(s.y), 5);
  if (rise > 7 && hr() < 0.7) {
    ctx.fillStyle = 'rgba(255,224,150,0.7)';
    ctx.fillRect(sx + w * 0.36, sy - rise * 0.62, Math.max(2, w * 0.26), Math.max(2, rise * 0.3));
  }
}

/** A cylinder, for the tank farms that say "industrial" faster than a label. */
function tank(ctx, s, sx, sy, w, d, rise, pal) {
  const rx = w / 2, ry = Math.max(2, (d / 2) * TILT + 1);
  const g = ctx.createLinearGradient(sx, 0, sx + w, 0);
  g.addColorStop(0, mix(pal.wall, '#000000', 0.32));
  g.addColorStop(0.42, mix(pal.wall, '#ffffff', 0.12));
  g.addColorStop(1, mix(pal.wall, '#000000', 0.30));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(sx, sy - rise);
  ctx.lineTo(sx, sy);
  ctx.ellipse(sx + rx, sy, rx, ry, 0, Math.PI, 0, true);
  ctx.lineTo(sx + w, sy - rise);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = mix(pal.roof, '#ffffff', 0.12);
  ctx.beginPath();
  ctx.ellipse(sx + rx, sy - rise, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = mix(pal.roof, '#000000', 0.25);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(sx + rx, sy - rise, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
}

/** A tree: trunk, then overlapping canopy blobs so the silhouette is not a circle. */
function tree(ctx, s, sx, sy, w, d, rise, pal) {
  const cx = sx + w / 2;
  const trunkW = Math.max(2, w * 0.17);
  ctx.fillStyle = '#5a4128';
  ctx.fillRect(cx - trunkW / 2, sy - rise * 0.46, trunkW, rise * 0.46);

  const crown = pal.crown;
  const rad = w * 0.62;
  const top = sy - rise;
  ctx.fillStyle = mix(crown, '#000000', 0.22);
  for (const [ox, oy, rr] of [[0, 0, rad], [-rad * 0.54, rad * 0.44, rad * 0.7], [rad * 0.52, rad * 0.4, rad * 0.66]]) {
    ctx.beginPath();
    ctx.ellipse(cx + ox, top + oy + rad * 0.55, rr, rr * 0.88, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // One highlight blob, sunward, which is the whole reason this reads as round
  // rather than as a green hole cut in the map.
  ctx.fillStyle = mix(crown, '#ffffff', 0.26);
  ctx.beginPath();
  ctx.ellipse(cx - rad * 0.26, top + rad * 0.3, rad * 0.5, rad * 0.44, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** Grass. Barely a structure, but an empty field with nothing on it reads as tarmac. */
function tuft(ctx, s, sx, sy, w, d, rise, pal) {
  ctx.strokeStyle = pal.crown;
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = -1; i <= 1; i++) {
    ctx.moveTo(sx + w / 2 + i * w * 0.3, sy);
    ctx.lineTo(sx + w / 2 + i * w * 0.5, sy - rise);
  }
  ctx.stroke();
  ctx.lineCap = 'butt';
}

/** A station platform: a low slab with a canopy on posts over it. */
function platform(ctx, s, sx, sy, w, d, rise, pal) {
  ctx.fillStyle = mix(pal.wall, '#000000', 0.28);
  ctx.fillRect(sx, sy - rise, w, rise);
  ctx.fillStyle = pal.wall;
  ctx.fillRect(sx, sy - rise - d, w, d);
  ctx.fillStyle = mix(pal.wall, '#ffffff', 0.22);
  ctx.fillRect(sx, sy - rise - 1, w, 1.2);

  // The canopy is the bit that says station. Posts at each end, a roof over.
  const canopy = rise * 1.6;
  const top = sy - rise - d - canopy;
  ctx.fillStyle = mix(pal.roof, '#000000', 0.45);
  for (const px of [sx + w * 0.06, sx + w * 0.94]) ctx.fillRect(px - 1, top, 2, canopy);
  ctx.fillStyle = mix(pal.roof, '#ffffff', 0.12);
  ctx.fillRect(sx - w * 0.06, top, w * 1.12, Math.max(2.5, d * 0.55));
}

const DRAW = { block: box, shed: box, house, tank, tree, tuft, platform };

/**
 * Paint a list of structures, far to near, at absolute screen positions.
 *
 * This is the uncached path. It is what the baker itself uses, and what a caller
 * with no DOM to bake into falls back to. Sorting across the whole list rather
 * than per tile is the point: two buildings on neighbouring tiles still have to
 * be painted in the right order relative to each other.
 */
export function drawStructures(ctx, list, camX, camY, cx, cy, pxPerM) {
  const sorted = [...list].sort((a, b) => (a.y + a.d) - (b.y + b.d));
  for (const s of sorted) {
    if (!BIOMES[s.biome]) continue;
    const [sx, sy] = project(s.x, s.y + s.d, camX, camY, cx, cy, pxPerM);
    paintOne(ctx, s, sx, sy, pxPerM);
  }
}

function paintOne(ctx, s, sx, sy, pxPerM) {
  const w = s.w * pxPerM;
  const d = s.d * pxPerM * TILT;
  const rise = riseOf(s.h, pxPerM);
  if (s.kind !== 'tuft') shadow(ctx, sx, sy, w, d);
  (DRAW[s.kind] ?? box)(ctx, s, sx, sy, w, d, rise, paletteFor(s));
}

/*
 * Pre-rendered tile skylines.
 *
 * Drawn live, a screenful of city centre measured 9.4ms a frame — 56% of a
 * 16.7ms budget on a desktop CPU, which is worse than the flat prop scatter this
 * camera replaced. Nearly all of it is per-structure setup that does not vary
 * between frames: a linear gradient built for every wall, and up to twenty-five
 * window rectangles per tower, roughly ten thousand of them across a screen.
 *
 * So the same answer as the ground: bake a small set of variants per biome and
 * blit whichever a tile's own hash picks. A tile's whole skyline goes into one
 * sprite with its internal depth order already resolved, and because tiles are
 * blitted in row order, a tower in the row nearer the camera still covers the
 * one behind it. The cross-tile ordering that mattered survives; the per-frame
 * gradient does not.
 */
const VARIANTS = 32;
const skylineCache = new Map();

/** The tallest thing a biome can put on a tile, in screen pixels. */
function headroom(biome, pxPerM) {
  const plan = SKYLINE[biome];
  if (!plan) return 0;
  // Trees and canopies draw above their nominal height, so this is deliberately
  // generous: a sprite clipped at the top loses the roof off a building.
  return riseOf(plan.h[1], pxPerM) * 1.45 + 12;
}

function skylineSprite(biome, variant, pxPerM) {
  const key = `${biome}:${variant}:${pxPerM}`;
  const hit = skylineCache.get(key);
  if (hit) return hit;

  const tilePx = TILE_M * pxPerM;
  const pad = 10;
  const top = Math.ceil(headroom(biome, pxPerM) + pad);
  const c = document.createElement('canvas');
  c.width = Math.ceil(tilePx + pad * 2);
  c.height = Math.ceil(top + tilePx * TILT + pad);
  const g = c.getContext('2d');

  // Bake from the variant index, exactly as the ground does, so the same tile
  // gets the same skyline every time without storing anything per tile.
  const list = structuresOn(variant, 0, biome, 7);
  const sorted = [...list].sort((a, b) => (a.y + a.d) - (b.y + b.d));
  for (const s of sorted) {
    const lx = (s.x - variant * TILE_M) * pxPerM + pad;
    const ly = (s.y + s.d - 0) * pxPerM * TILT + top;
    paintOne(g, s, lx, ly, pxPerM);
  }
  const sprite = { canvas: c, dx: -pad, dy: -top };
  skylineCache.set(key, sprite);
  return sprite;
}

/** Which baked skyline a tile wears. Its own coordinates decide, as before. */
function skylineVariant(tx, ty) {
  const h = (Math.imul(tx | 0, 0x9e3779b1) ^ Math.imul(ty | 0, 0x85ebca6b)) >>> 0;
  return h % VARIANTS;
}

/**
 * Blit one tile's skyline. Callers walk the visible grid in row order — far row
 * first — which is what keeps the depth order right between tiles.
 */
export function drawTileSkyline(ctx, biome, tx, ty, sx, sy, pxPerM, { baked = true } = {}) {
  if (!SKYLINE[biome] || !baked || typeof document === 'undefined') {
    drawStructuresAt(ctx, structuresOn(tx, ty, biome), sx, sy, tx, ty, pxPerM);
    return;
  }
  const sprite = skylineSprite(biome, skylineVariant(tx, ty), pxPerM);
  ctx.drawImage(sprite.canvas, sx + sprite.dx, sy + sprite.dy);
}

/** The uncached fallback, positioned relative to a tile's screen origin. */
function drawStructuresAt(ctx, list, sx, sy, tx, ty, pxPerM) {
  const sorted = [...list].sort((a, b) => (a.y + a.d) - (b.y + b.d));
  for (const s of sorted) {
    paintOne(ctx, s,
             sx + (s.x - tx * TILE_M) * pxPerM,
             sy + (s.y + s.d - ty * TILE_M) * pxPerM * TILT,
             pxPerM);
  }
}

/** Only for tests and a hot reload; the cache is otherwise permanent. */
export function clearSkylineCache() { skylineCache.clear(); }
