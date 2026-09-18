/*
 * RIFTBORN — the patrol map.
 *
 * Positions are Web Mercator metres, which means they are positions on the actual
 * Earth: the map under your feet is real streets, the biome is read off those
 * streets, and the spawn grid is anchored to the globe so two Wardens standing in
 * the same park see the same monster.
 *
 * The prediction the original header made turned out to be true — "swapping the
 * simulated walk for real GPS is a matter of feeding different coordinates in" —
 * because nothing downstream ever cared where the metres came from. Three sources
 * now feed them: GPS, a dragged marker, and the simulated walk the tests use.
 */

import {
  TILE_M, DETECT_M, ENGAGE_M, BIOMES, WEATHER, RIFT_RADIUS_M, RIFT_RANK,
  biomeAt, visibleSpawns, timeWindow, timeBucket, weatherAt,
  riftAt, nextRift, riftsNear, riftSpawns,
} from './world.js';
import { lonLatToWorld, groundScale, groundMetres } from './geo.js';
import { createTileSource, MAP_ZOOM } from './tiles.js';
import { spriteFor } from './voxel.js';

export const VIEW = { w: 960, h: 640 };
const PX_PER_M = 1.7;   // wide enough to see more than one neighbourhood at a time
const WALK_MS = 1.4;                 // real walking pace, metres/second

const ELEMENT_COLOUR = {
  ember: '#c2622f', tide: '#4a90b8', verdant: '#5f9e5a', stone: '#8a8378',
  gale: '#8fb8c9', volt: '#d9c04a', gloom: '#7a6b96', lumen: '#e0d090', rift: '#b05ad0',
};
const SIZE_MARKER = { mote: 5, whelp: 7, strider: 9, brute: 12, colossus: 16, titan: 20 };

/*
 * Where a Warden starts before they have a fix. Somewhere with water, parks and
 * streets inside one screen, so the first thing anyone sees is a real place that
 * demonstrates all three kinds of ground: the Thames at Westminster.
 */
export const DEFAULT_START = { lon: -0.1246, lat: 51.5007 };

export function createPatrol(profile, pool, apexById = {}, opts = {}) {
  const saved = profile.state.lastPosition;
  const start = saved ?? lonLatToWorld(DEFAULT_START.lon, DEFAULT_START.lat);
  return {
    profile, pool, apexById,
    rift: null,
    rifts: [],
    upcoming: null,
    x: start.x,
    y: start.y,
    heading: -Math.PI / 2,
    spawns: [],
    nearest: null,
    hourOffset: 0,          // dev scrubber: shift the clock without waiting for dusk
    walkMultiplier: 8,      // simulated pace, so a 20-minute patrol fits an evaluation
    weatherOverride: null,  // dev: pin the weather to reach a branch condition
    lastBucket: null,
    /*
     * The map. Optional on purpose: the headless tools and any test that only
     * cares about spawn maths construct a patrol without one, and everything
     * falls back to the synthetic generator.
     */
    tiles: opts.tiles ?? null,
    mapZoom: opts.zoom ?? MAP_ZOOM,
    // Set by the locator; drives the accuracy ring and the "walking" readout.
    accuracyM: null,
    live: false,
    lockedOut: false,
  };
}

/**
 * Feed a position in from outside — GPS, or a dragged marker.
 * `jumped` marks a re-fix rather than travel, so it is not paid for as walking.
 */
export function placePatrol(p, x, y, { jumped = false, accuracyM = null, live = false } = {}) {
  const moved = groundMetres(p.x, p.y, x, y);
  if (!jumped && moved > 0.2 && moved < 400) {
    p.heading = Math.atan2(y - p.y, x - p.x);
    p.profile.walk(moved, biomeUnderfoot(p));
  }
  p.x = x; p.y = y;
  p.accuracyM = accuracyM;
  p.live = live;
  // Remembering roughly where you were is the difference between opening the app
  // on your street and opening it in London. It stays on the device.
  p.profile.state.lastPosition = { x, y };
  return moved;
}

export function patrolClock(p) {
  const d = new Date(Date.now() + p.hourOffset * 3600 * 1000);
  return {
    date: d,
    window: timeWindow(d),
    bucket: timeBucket(d),
    weather: p.weatherOverride ?? weatherAt(d, p.profile.state.seed),
  };
}

export function stepPatrol(p, dt, intent) {
  // WALK_MS is a ground pace. A Mercator metre is cos(latitude) ground metres, so
  // walking at a fixed number of world units would be slower in Reykjavik than in
  // Nairobi — divide it back out and a step is a step anywhere.
  const speed = (WALK_MS * p.walkMultiplier) / Math.max(0.1, groundScale(p.y));
  if (intent.moveX || intent.moveY) {
    const len = Math.hypot(intent.moveX, intent.moveY) || 1;
    const dx = (intent.moveX / len) * speed * dt;
    const dy = (intent.moveY / len) * speed * dt;
    p.x += dx; p.y += dy;
    p.heading = Math.atan2(dy, dx);
    p.profile.walk(Math.hypot(dx, dy), biomeUnderfoot(p));
  }

  const { date, window, bucket, weather } = patrolClock(p);
  p.weather = weather;

  /*
   * Rift events replace the local spawn table entirely while you are inside one:
   * Rift-element species exist nowhere else, and in the closing minutes the apex
   * turns up at the centre. Gated on rank, like every other late-game system.
   */
  const seed = p.profile.state.seed;
  const riftOpen = p.profile.rank >= RIFT_RANK || p.profile.state.devUnlockAll;
  // apexById goes in so the rift can honour each apex's published placement:
  // Karrahk wants waterside in a storm, Nyxhollow urban core or woodland at
  // midnight, and Aeonrend is the one that fits any rift at all.
  p.rifts = riftsNear(p.x, p.y, date, seed, 1, p.apexById);
  p.rift = riftOpen ? riftAt(p.x, p.y, date, seed, p.apexById) : null;
  p.upcoming = riftOpen ? nextRift(p.x, p.y, date, seed, p.apexById) : null;

  p.spawns = (p.rift
    ? riftSpawns(p.rift, p.x, p.y, p.pool, p.apexById, bucket, seed)
    : visibleSpawns(p.x, p.y, bucket, p.pool, window, seed, weather, (x, y) => biomeAtWorld(p, x, y))
  ).filter((s) => !p.profile.isResolved(s.id));

  // Anything you can see goes into the Codex as Sighted.
  for (const s of p.spawns) p.profile.sight(s.speciesId);
  if (bucket !== p.lastBucket) { p.lastBucket = bucket; p.profile.save(); }

  p.nearest = p.spawns.find((s) => s.distance <= ENGAGE_M) ?? null;
  return p.nearest;
}

// ---------------------------------------------------------------- rendering

/*
 * ---------------------------------------------------------------- biome skins
 *
 * A biome used to be one flat colour per tile. That reads as a legend swatch
 * rather than a place, and this is a game whose whole premise is that the ground
 * under you decides what lives there — so the ground has to say which ground it
 * is before you read anything.
 *
 * The approach is the one a tile-based game has always used: a patchwork floor
 * of two or three tones, and a scatter of silhouettes that name the place. You
 * should know a Woodland from a Works at a glance. Everything is seeded from the
 * tile's own coordinates, so a place looks the same every time you walk back to
 * it, and nothing is stored.
 */
function tileRng(tx, ty, salt = 0) {
  let a = (Math.imul(tx | 0, 0x27d4eb2d) ^ Math.imul(ty | 0, 0x165667b1) ^ (salt * 0x9e3779b9)) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PROPS = {
  /** Flat roofs, seen from above, with the sunward edge catching the light. */
  rooftops(ctx, x, y, s, r, ink, lit) {
    const w = s * (0.34 + r() * 0.3), h = s * (0.28 + r() * 0.26);
    ctx.fillStyle = ink;
    ctx.fillRect(x + 2, y + 2, w, h);
    ctx.fillStyle = lit;
    ctx.fillRect(x, y, w, h * 0.22);
  },
  /*
   * A pitched roof seen from above: a rectangle with a ridge down the middle and
   * the sunward slope lighter. The first version drew a bare triangle, which at
   * 68 pixels a tile read as a pine tree or a traffic cone — the suburbs looked
   * like a forest. A roof is a rectangle; the ridge is what says roof.
   */
  houses(ctx, x, y, s, r, ink, lit) {
    const w = s * (0.3 + r() * 0.16), h = w * (0.62 + r() * 0.2);
    ctx.fillStyle = ink;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = lit;
    ctx.fillRect(x, y, w, h / 2);                       // the slope facing the light
    ctx.strokeStyle = ink; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y + h / 2); ctx.lineTo(x + w, y + h / 2); ctx.stroke();
  },
  /** Canopy first, trunk under it, so the crown always sits on top. */
  trees(ctx, x, y, s, r, ink, lit) {
    const rad = s * (0.07 + r() * 0.06);
    ctx.fillStyle = ink;
    ctx.fillRect(x - 1, y, 2, rad * 1.6);
    ctx.fillStyle = lit;
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = ink;
    ctx.beginPath(); ctx.arc(x + rad * 0.34, y + rad * 0.3, rad * 0.55, 0, Math.PI * 2); ctx.fill();
  },
  /** Three strokes, splayed. Anything more and open ground stops reading as open. */
  tufts(ctx, x, y, s, r, ink, lit) {
    const h = s * (0.05 + r() * 0.05);
    ctx.strokeStyle = lit; ctx.lineWidth = 1;
    ctx.beginPath();
    for (const dx of [-2, 0, 2]) { ctx.moveTo(x + dx, y); ctx.lineTo(x + dx * 1.8, y - h); }
    ctx.stroke();
  },
  /** Arcs, not circles: a ripple is the near edge of a ring, lit from one side. */
  ripples(ctx, x, y, s, r, ink, lit) {
    const rad = s * (0.06 + r() * 0.08);
    ctx.strokeStyle = lit; ctx.lineWidth = 1; ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.arc(x, y, rad, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, rad * 0.55, Math.PI * 0.2, Math.PI * 0.8); ctx.stroke();
    ctx.globalAlpha = 1;
  },
  /** A cylinder read from above is a disc with a pipe running off it. */
  tanks(ctx, x, y, s, r, ink, lit) {
    const rad = s * (0.08 + r() * 0.05);
    ctx.fillStyle = ink;
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = lit; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, rad * 0.62, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + rad, y); ctx.lineTo(x + rad * 2.4, y); ctx.stroke();
  },
  /** Spoil heaps: irregular, low, and never the same twice. */
  rubble(ctx, x, y, s, r, ink, lit) {
    const w = s * (0.05 + r() * 0.06);
    ctx.fillStyle = r() > 0.5 ? ink : lit;
    ctx.beginPath();
    ctx.moveTo(x - w, y + w * 0.6); ctx.lineTo(x, y - w); ctx.lineTo(x + w, y + w * 0.6);
    ctx.closePath(); ctx.fill();
  },
  /** Two rails and their sleepers, running the length of the tile. */
  rails(ctx, x, y, s, r, ink, lit) {
    const len = s * 0.9, gap = s * 0.09;
    ctx.strokeStyle = ink; ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const t = (i / 4) * len - len / 2;
      ctx.moveTo(x + t, y - gap); ctx.lineTo(x + t, y + gap);
    }
    ctx.stroke();
    ctx.strokeStyle = lit; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - len / 2, y - gap); ctx.lineTo(x + len / 2, y - gap);
    ctx.moveTo(x - len / 2, y + gap); ctx.lineTo(x + len / 2, y + gap);
    ctx.stroke();
  },
};

/** Paint one tile of ground: a tone from the patchwork, then its props. */
export function drawTileSkin(ctx, biome, tx, ty, sx, sy, px, { alpha = 1, propsOnly = false } = {}) {
  const def = BIOMES[biome];
  const skin = def?.skin;
  if (!skin) {
    ctx.fillStyle = def?.colour ?? '#2b2f36';
    ctx.fillRect(sx, sy, px + 1, px + 1);
    return;
  }
  const r = tileRng(tx, ty);
  ctx.save();
  ctx.globalAlpha = alpha;
  // The ground tone is still drawn from the same rng even when it is not painted,
  // so a tile's props land in the same places with or without the floor under them.
  const tone = skin.ground[Math.floor(r() * skin.ground.length)] ?? def.colour;
  if (!propsOnly) {
    ctx.fillStyle = tone;
    ctx.fillRect(sx, sy, px + 1, px + 1);
  }

  const draw = PROPS[skin.prop];
  if (draw) {
    // A fractional density is a chance rather than a count, so parkland can
    // average fewer than one tree a tile without ever drawing half of one.
    const whole = Math.floor(skin.density);
    const n = whole + (r() < skin.density - whole ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const x = sx + (0.12 + r() * 0.76) * px;
      const y = sy + (0.12 + r() * 0.76) * px;
      draw(ctx, x, y, px, r, skin.ink, skin.lit);
    }
  }
  ctx.restore();
}

export function drawPatrol(ctx, p, view, speciesById) {
  const { dpr } = view;
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, VIEW.w, VIEW.h);

  const cx = VIEW.w / 2, cy = VIEW.h / 2;
  const t = performance.now() / 1000;
  const toScreen = (wx, wy) => [cx + (wx - p.x) * PX_PER_M, cy + (wy - p.y) * PX_PER_M];

  // --- the ground
  const tilePx = TILE_M * PX_PER_M;
  const reach = Math.ceil(Math.max(VIEW.w, VIEW.h) / tilePx / 2) + 1;
  const ctx0 = Math.floor(p.x / TILE_M), cty0 = Math.floor(p.y / TILE_M);

  const legendBiomes = [];
  const here = biomeUnderfoot(p);

  /*
   * Real map first. `draw` returns how many tiles it actually painted, so a blank
   * region — first load, no signal, a provider refusing — paints the synthetic
   * biome blocks underneath instead of leaving a void.
   */
  const painted = p.tiles ? p.tiles.draw(ctx, p.x, p.y, VIEW.w, VIEW.h, PX_PER_M, p.mapZoom) : 0;

  if (!painted) {
    for (let ty = cty0 - reach; ty <= cty0 + reach; ty++) {
      for (let tx = ctx0 - reach; tx <= ctx0 + reach; tx++) {
        const biome = biomeAt(tx, ty, p.profile.state.seed);
        const [sx, sy] = toScreen(tx * TILE_M, ty * TILE_M);
        drawTileSkin(ctx, biome, tx, ty, sx, sy, tilePx);
      }
    }
  } else {
    // Over a real map, the biome grid is a tint rather than a block, so the
    // streets stay readable underneath it.
    ctx.save();
    ctx.globalAlpha = 0.20;
    for (let ty = cty0 - reach; ty <= cty0 + reach; ty++) {
      for (let tx = ctx0 - reach; tx <= ctx0 + reach; tx++) {
        const biome = biomeAtWorld(p, (tx + 0.5) * TILE_M, (ty + 0.5) * TILE_M);
        const [sx, sy] = toScreen(tx * TILE_M, ty * TILE_M);
        ctx.fillStyle = BIOMES[biome].colour;
        ctx.fillRect(sx, sy, tilePx + 1, tilePx + 1);
      }
    }
    ctx.restore();

    /*
     * Over real streets the props go on lightly, and only for the biomes that
     * are a surface rather than a building — trees and water read as the ground
     * they sit on, where rooftops and rails would argue with the ones already
     * drawn underneath.
     */
    const NATURAL = new Set(['woodland', 'parkland', 'open_ground', 'waterside']);
    ctx.save();
    ctx.globalAlpha = 0.45;
    for (let ty = cty0 - reach; ty <= cty0 + reach; ty++) {
      for (let tx = ctx0 - reach; tx <= ctx0 + reach; tx++) {
        const biome = biomeAtWorld(p, (tx + 0.5) * TILE_M, (ty + 0.5) * TILE_M);
        if (!NATURAL.has(biome)) continue;
        const [sx, sy] = toScreen(tx * TILE_M, ty * TILE_M);
        drawTileSkin(ctx, biome, tx, ty, sx, sy, tilePx, { propsOnly: true });
      }
    }
    ctx.restore();
  }

  for (let ty = cty0 - reach; ty <= cty0 + reach; ty++) {
    for (let tx = ctx0 - reach; tx <= ctx0 + reach; tx++) {
      legendBiomes.push(biomeAtWorld(p, (tx + 0.5) * TILE_M, (ty + 0.5) * TILE_M));
    }
  }

  // --- how good the fix is. A 40 m GPS reading in a city is normal, and drawing
  // it is more honest than a confident dot that is quietly 40 m out.
  if (p.live && p.accuracyM > 0) {
    ctx.save();
    ctx.fillStyle = 'rgba(105,210,231,0.10)';
    ctx.strokeStyle = 'rgba(105,210,231,0.35)';
    ctx.lineWidth = 1;
    const rPx = (p.accuracyM / Math.max(0.1, groundScale(p.y))) * PX_PER_M;
    ctx.beginPath(); ctx.arc(cx, cy, rPx, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  // --- detection radius (fog pulls it in, Gale residents push it out)
  const detect = DETECT_M
    * (WEATHER[p.weather ?? 'overcast']?.detectionScale ?? 1)
    * (1 + (p.profile.bonus?.('detection_radius') ?? 0));
  ctx.strokeStyle = 'rgba(105,210,231,0.22)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 6]);
  ctx.beginPath(); ctx.arc(cx, cy, detect * PX_PER_M, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);

  // --- engage radius
  ctx.strokeStyle = 'rgba(105,210,231,0.5)';
  ctx.beginPath(); ctx.arc(cx, cy, ENGAGE_M * PX_PER_M, 0, Math.PI * 2); ctx.stroke();

  // --- rifts: a ring you can see from outside and walk into
  for (const r of p.rifts) {
    if (r.distance > 1400) continue;
    if (!r.active && r.opensInMs <= 0) continue;      // already been and gone
    const [rx, ry] = toScreen(r.x, r.y);
    const rad = RIFT_RADIUS_M * PX_PER_M;
    ctx.save();
    if (r.active) {
      ctx.strokeStyle = r.apexUp ? '#e0403a' : '#b05ad0';
      ctx.globalAlpha = 0.5 + 0.3 * Math.sin(t * 3);
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(rx, ry, rad, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 0.09;
      ctx.fillStyle = r.apexUp ? '#e0403a' : '#b05ad0';
      ctx.fill();
    } else {
      ctx.strokeStyle = 'rgba(176,90,208,0.35)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 7]);
      ctx.beginPath(); ctx.arc(rx, ry, rad, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = r.active ? '#e6e9ed' : 'rgba(176,90,208,0.8)';
    ctx.font = '11px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    const mins = Math.round(r.opensInMs / 60000);
    ctx.fillText(r.active ? (r.apexUp ? 'RIFT — APEX' : 'RIFT — OPEN') : `rift · ${mins}m`, rx, ry - rad - 8);
    ctx.restore();
  }

  // --- spawn markers
  for (const s of p.spawns) {
    const sp = speciesById[s.speciesId];
    const [sx, sy] = toScreen(s.x, s.y);
    const r = SIZE_MARKER[sp.size] ?? 8;
    const colour = ELEMENT_COLOUR[sp.elements[0]] ?? '#aaa';
    const inRange = s.distance <= ENGAGE_M;
    const rare = ['rare', 'very_rare'].includes(sp.rarity) || s.isApex;

    if (rare) {
      // A wild stage-3 should announce itself.
      ctx.strokeStyle = colour;
      ctx.globalAlpha = 0.35 + 0.35 * Math.sin(t * 4);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(sx, sy, r + 7 + Math.sin(t * 4) * 2, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    /*
     * The marker is the monster. A cached voxel sprite costs no more to draw than
     * the disc it replaces — one per (species, size), reused for every marker —
     * and it means you can tell what is over there before you walk to it.
     */
    const px = Math.round(r * 3.4);
    const sprite = spriteFor(sp, px, 0.125, { riftTouched: !!s.riftTouched });

    /*
     * A rare colourway has to be spottable from across the park or it is not an
     * event, it is a surprise you get after walking. So a rift-touched spawn
     * wears a violet halo that pulses out of step with the rare-species ring —
     * you can see there is something odd over there before you can see what.
     */
    if (s.riftTouched) {
      ctx.save();
      ctx.strokeStyle = '#b05ad0';
      ctx.globalAlpha = 0.45 + 0.35 * Math.sin(t * 2.2 + 1);
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(sx, sy, r + 11 + Math.sin(t * 2.2) * 2.5, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = '#dfa0f0';
      for (let i = 0; i < 3; i++) {
        const a = t * 1.3 + (i / 3) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(sx + Math.cos(a) * (r + 13), sy + Math.sin(a) * (r + 13) * 0.6, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // A disc behind it keeps the element colour readable against a real map,
    // where the ground under a marker is whatever the street happens to be.
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = colour;
    ctx.beginPath(); ctx.ellipse(sx, sy + r * 0.55, r * 1.05, r * 0.45, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    ctx.drawImage(sprite, sx - px / 2, sy - px * 0.62, px, px);

    if (inRange) {
      ctx.strokeStyle = '#e6e9ed';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(sx, sy + r * 0.55, r * 1.15, r * 0.52, 0, 0, Math.PI * 2); ctx.stroke();
    }

    // A pack draws satellite dots so the map shows what you are walking into.
    const pack = s.packSize ?? 1;
    if (pack > 1) {
      ctx.fillStyle = colour;
      ctx.globalAlpha = 0.75;
      for (let i = 1; i < pack; i++) {
        const a = (i / (pack - 1 || 1)) * Math.PI * 1.4 - Math.PI * 0.7;
        ctx.beginPath();
        ctx.arc(sx + Math.cos(a) * (r + 7), sy + Math.sin(a) * (r + 7), Math.max(2.5, r * 0.4), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    if (s.distance <= DETECT_M * 0.55 || inRange) {
      ctx.fillStyle = inRange ? '#e6e9ed' : 'rgba(230,233,237,0.65)';
      ctx.font = '11px ui-monospace, Menlo, Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(pack > 1 ? `${sp.name} ×${pack}` : sp.name, sx, sy - r - 6);
    }
  }

  // --- the Warden
  ctx.fillStyle = '#e6e9ed';
  ctx.beginPath(); ctx.arc(cx, cy, 7, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#69d2e7';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(p.heading) * 15, cy + Math.sin(p.heading) * 15);
  ctx.stroke();

  // --- biome legend: without it the map is just coloured rectangles
  const shown = [...new Set(legendBiomes)];
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(VIEW.w - 132, 12, 120, 12 + shown.length * 15);
  ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
  ctx.textAlign = 'left';
  shown.forEach((b, i) => {
    const y = 26 + i * 15;
    ctx.fillStyle = BIOMES[b].colour;
    ctx.fillRect(VIEW.w - 124, y - 7, 10, 10);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.strokeRect(VIEW.w - 124.5, y - 7.5, 11, 11);
    ctx.fillStyle = b === here ? '#e6e9ed' : '#9aa3ad';
    ctx.fillText(BIOMES[b].name, VIEW.w - 108, y + 2);
  });

  /*
   * Attribution. Every provider in TILE_PROVIDERS requires it and none of them
   * make it optional — this line is a licence term, not decoration, and it is
   * drawn into the canvas so it cannot be styled away by accident.
   */
  if (p.tiles && painted) {
    const credit = p.tiles.attribution;
    ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'right';
    const w = ctx.measureText(credit).width;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(VIEW.w - w - 18, VIEW.h - 26, w + 12, 16);
    ctx.fillStyle = '#9aa3ad';
    ctx.fillText(credit, VIEW.w - 12, VIEW.h - 15);
    ctx.textAlign = 'left';
  }

  // --- scale bar
  // The bar is in GROUND metres, so it shrinks with latitude exactly as the real
  // world does. Labelling Mercator metres would have it read 50 m in Lagos and
  // 50 m in Oslo for visibly different distances.
  const barPx = (50 / Math.max(0.1, groundScale(p.y))) * PX_PER_M;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(14, VIEW.h - 34, barPx + 62, 22);
  ctx.strokeStyle = '#9aa3ad';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(24, VIEW.h - 18); ctx.lineTo(24 + barPx, VIEW.h - 18);
  ctx.moveTo(24, VIEW.h - 22); ctx.lineTo(24, VIEW.h - 14);
  ctx.moveTo(24 + barPx, VIEW.h - 22); ctx.lineTo(24 + barPx, VIEW.h - 14);
  ctx.stroke();
  ctx.fillStyle = '#9aa3ad';
  ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
  ctx.textAlign = 'left';
  ctx.fillText('50 m', 24 + barPx + 8, VIEW.h - 14);

  ctx.restore();
}

/**
 * What you are standing on: the real map first, the synthetic generator when the
 * map has nothing to say. The fallback is not a degraded mode — it is what every
 * test, tool and offline session runs on.
 */
export function biomeUnderfoot(p) {
  return biomeAtWorld(p, p.x, p.y);
}

export function biomeAtWorld(p, x, y) {
  const fromMap = p.tiles?.biomeAt(x, y, p.mapZoom);
  if (fromMap) return fromMap;
  return biomeAt(Math.floor(x / TILE_M), Math.floor(y / TILE_M), p.profile.state.seed);
}

export { ELEMENT_COLOUR };
