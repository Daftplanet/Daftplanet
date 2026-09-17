/*
 * RIFTBORN phase 1 — the patrol map.
 *
 * A walkable slice of world with biome-driven spawns. Positions are in metres, so
 * swapping the simulated walk for real GPS later is a matter of feeding different
 * coordinates in — nothing downstream cares where they came from.
 */

import {
  TILE_M, DETECT_M, ENGAGE_M, BIOMES, WEATHER, RIFT_RADIUS_M, RIFT_RANK,
  biomeAt, visibleSpawns, timeWindow, timeBucket, weatherAt,
  riftAt, nextRift, riftsNear, riftSpawns,
} from './world.js';

export const VIEW = { w: 960, h: 640 };
const PX_PER_M = 1.7;   // wide enough to see more than one neighbourhood at a time
const WALK_MS = 1.4;                 // real walking pace, metres/second

const ELEMENT_COLOUR = {
  ember: '#c2622f', tide: '#4a90b8', verdant: '#5f9e5a', stone: '#8a8378',
  gale: '#8fb8c9', volt: '#d9c04a', gloom: '#7a6b96', lumen: '#e0d090', rift: '#b05ad0',
};
const SIZE_MARKER = { mote: 5, whelp: 7, strider: 9, brute: 12, colossus: 16, titan: 20 };

export function createPatrol(profile, pool, apexById = {}) {
  return {
    profile, pool, apexById,
    rift: null,
    rifts: [],
    upcoming: null,
    x: 5000 + Math.random() * 400,
    y: 5000 + Math.random() * 400,
    heading: -Math.PI / 2,
    spawns: [],
    nearest: null,
    hourOffset: 0,          // dev scrubber: shift the clock without waiting for dusk
    walkMultiplier: 8,      // simulated pace, so a 20-minute patrol fits an evaluation
    weatherOverride: null,  // dev: pin the weather to reach a branch condition
    lastBucket: null,
  };
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
  const speed = WALK_MS * p.walkMultiplier;
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
    : visibleSpawns(p.x, p.y, bucket, p.pool, window, seed, weather)
  ).filter((s) => !p.profile.isResolved(s.id));

  // Anything you can see goes into the Codex as Sighted.
  for (const s of p.spawns) p.profile.sight(s.speciesId);
  if (bucket !== p.lastBucket) { p.lastBucket = bucket; p.profile.save(); }

  p.nearest = p.spawns.find((s) => s.distance <= ENGAGE_M) ?? null;
  return p.nearest;
}

// ---------------------------------------------------------------- rendering

export function drawPatrol(ctx, p, view, speciesById) {
  const { dpr } = view;
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, VIEW.w, VIEW.h);

  const cx = VIEW.w / 2, cy = VIEW.h / 2;
  const t = performance.now() / 1000;
  const toScreen = (wx, wy) => [cx + (wx - p.x) * PX_PER_M, cy + (wy - p.y) * PX_PER_M];

  // --- biome tiles
  const tilePx = TILE_M * PX_PER_M;
  const reach = Math.ceil(Math.max(VIEW.w, VIEW.h) / tilePx / 2) + 1;
  const ctx0 = Math.floor(p.x / TILE_M), cty0 = Math.floor(p.y / TILE_M);

  const legendBiomes = [];
  const here = biomeAt(Math.floor(p.x / TILE_M), Math.floor(p.y / TILE_M), p.profile.state.seed);

  for (let ty = cty0 - reach; ty <= cty0 + reach; ty++) {
    for (let tx = ctx0 - reach; tx <= ctx0 + reach; tx++) {
      const biome = biomeAt(tx, ty, p.profile.state.seed);
      legendBiomes.push(biome);
      const [sx, sy] = toScreen(tx * TILE_M, ty * TILE_M);
      ctx.fillStyle = BIOMES[biome].colour;
      ctx.fillRect(sx, sy, tilePx + 1, tilePx + 1);
      ctx.strokeStyle = 'rgba(0,0,0,0.22)';
      ctx.lineWidth = 1;
      ctx.strokeRect(sx + 0.5, sy + 0.5, tilePx, tilePx);
    }
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

    ctx.fillStyle = colour;
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = inRange ? '#e6e9ed' : 'rgba(0,0,0,0.5)';
    ctx.lineWidth = inRange ? 2.5 : 1.5;
    ctx.stroke();

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

  // --- scale bar
  const barPx = 50 * PX_PER_M;
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

export function biomeUnderfoot(p) {
  return biomeAt(Math.floor(p.x / TILE_M), Math.floor(p.y / TILE_M), p.profile.state.seed);
}

export { ELEMENT_COLOUR };
