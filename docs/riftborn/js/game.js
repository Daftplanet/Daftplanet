/*
 * RIFTBORN phase 3 — the fight.
 *
 * Encounters hold a pack, not a monster. Three of the eight weapons — the
 * Splitbore's pellet cone, the Lattice Launcher's area snare, the Arcbrand's
 * three-target chain — are built around multiple targets and had nothing to show
 * for themselves in a one-on-one.
 *
 * Deliberately DOM-free: render.js draws it, input.js feeds it, and
 * game/tools/balance_sim.mjs drives this exact code headlessly with a scripted
 * player. If it isn't in here, it isn't in the fight.
 */

import {
  computeDamage, computeRestraint, fleeChancePerSecond,
  restraintDecayPerSecond, woundMultiplier, statusProduct,
} from './rules.js';

export const ARENA = { w: 960, h: 640 };
export const PX_PER_METRE = 22;

const PLAYER = { radius: 12, speed: 150, maxHp: 100, invulnSeconds: 0.6 };
const SPREAD_PER_PROJECTILE = 0.055;
const SIZE_RADIUS = { mote: 13, whelp: 19, strider: 26, brute: 38, colossus: 56, titan: 80 };
const MONSTER = { speedScale: 24 };

const LUNGE = { windup: 0.45, dash: 0.35, recover: 0.85, speed: 430, cooldown: 1.6, reach: 260, steer: 1.6 };
const AI = { wanderSpeed: 0.35, fleeSpeedMult: 1.25, fleeEscapeSeconds: 5, noiseRadius: 450 };

const AGGRESSION = {
  passive:     { alert: 110, preferred: 210, attacks: false, cooldown: 99, reach: 0 },
  skittish:    { alert: 180, preferred: 240, attacks: true,  cooldown: 2.8, reach: 110 },
  territorial: { alert: 210, preferred: 170, attacks: true,  cooldown: 1.6, reach: 260 },
  aggressive:  { alert: 320, preferred: 100, attacks: true,  cooldown: 1.2, reach: 320 },
};
const profileFor = (species) => AGGRESSION[species.aggression] ?? AGGRESSION.territorial;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const TERMINAL = ['dead', 'escaped', 'tagged'];
const isDone = (m) => TERMINAL.includes(m.state);

/*
 * Weak point anchors in monster-local terms: `along` runs nose-to-tail, `across`
 * is lateral, `size` scales with the body. Scaling with the body is deliberate —
 * a Mote's core is a genuinely hard shot and a Brute's chest is not, which is most
 * of why the small ones feel different to fight.
 */
const WEAK_POINT_LAYOUT = {
  muzzle:                 { along: 0.85, across: 0.00, size: 0.18 },
  throat:                 { along: 0.62, across: 0.00, size: 0.156 },
  eyes:                   { along: 0.78, across: -0.18, size: 0.132 },
  open_maw:               { along: 0.80, across: 0.00, size: 0.18 },
  jaw_coil:               { along: 0.70, across: 0.22, size: 0.144 },
  crown_vents:            { along: 0.35, across: -0.30, size: 0.156 },
  helm_seam:              { along: 0.45, across: 0.28, size: 0.144 },
  core:                   { along: 0.00, across: 0.00, size: 0.192 },
  chest:                  { along: 0.25, across: 0.25, size: 0.168 },
  cracked_shoulder_plate: { along: 0.10, across: -0.55, size: 0.156 },
  mane_nodes:             { along: -0.10, across: 0.50, size: 0.144 },
  keystone:               { along: 0.00, across: -0.45, size: 0.156 },
  spine_ridge:            { along: -0.45, across: -0.20, size: 0.144 },
  hind_joint:             { along: -0.58, across: 0.28, size: 0.144 },
  base_joints:            { along: -0.60, across: 0.35, size: 0.156 },
  underside:              { along: -0.20, across: 0.00, size: 0.192 },

  // Apex phase targets. Each phase exposes a different one, so a long fight is a
  // sequence of different shots rather than the same shot for two minutes.
  outer_plating:          { along: 0.20, across: -0.58, size: 0.13 },
  vent_cluster:           { along: -0.35, across: 0.45, size: 0.14 },
  spire_core:             { along: 0.00, across: 0.00, size: 0.17 },
  shroud_knot:            { along: -0.50, across: -0.30, size: 0.13 },
  hollow_eye:             { along: 0.60, across: 0.00, size: 0.15 },
  rift_seam_a:            { along: 0.50, across: 0.40, size: 0.12 },
  rift_seam_b:            { along: -0.50, across: 0.40, size: 0.12 },
  rift_seam_c:            { along: 0.00, across: -0.55, size: 0.12 },
  phase_dependent:        { along: 0.00, across: 0.00, size: 0.17 },
};

/*
 * Which weak point is exposed in each phase. `05-bestiary.md` says Aeonrend's
 * "weak points move between phases" and Karrahk's phase 1 is an armour break with
 * the core only exposed at the end; this is that, made concrete.
 */
const APEX_PHASE_WEAK_POINTS = {
  karrahk:       [['outer_plating'], ['vent_cluster'], ['spire_core']],
  nyxhollow:     [['shroud_knot'], ['hollow_eye']],
  aeonrend_apex: [['rift_seam_a'], ['rift_seam_b'], ['rift_seam_c'], ['phase_dependent']],
};

function apexWeakPoints(speciesId, phase, fallback) {
  const table = APEX_PHASE_WEAK_POINTS[speciesId];
  if (!table) return fallback;
  return table[Math.min(phase, table.length) - 1] ?? fallback;
}

/*
 * Apexes scale to party size (1-8 in the bible). Solo is the only party this
 * prototype can field, so the low end has to be a fight rather than a wall.
 */
export function apexHpScale(partySize = 1) {
  return 0.25 + 0.09 * Math.max(1, Math.min(8, partySize));
}

function layoutFor(name, index, count) {
  if (WEAK_POINT_LAYOUT[name]) return WEAK_POINT_LAYOUT[name];
  const a = (index / Math.max(1, count)) * Math.PI * 2;
  return { along: Math.cos(a) * 0.5, across: Math.sin(a) * 0.5, size: 0.144 };
}

export function weakPointPositions(m) {
  const out = {};
  const names = m.weakPoints ?? [];
  names.forEach((name, i) => {
    const wp = layoutFor(name, i, names.length);
    const r = m.radius;
    out[name] = {
      x: m.x + Math.cos(m.facing) * r * wp.along + Math.cos(m.facing + Math.PI / 2) * r * wp.across,
      y: m.y + Math.sin(m.facing) * r * wp.along + Math.sin(m.facing + Math.PI / 2) * r * wp.across,
      radius: Math.max(3.5, r * wp.size),
    };
  });
  return out;
}

// ---------------------------------------------------------------- setup

function makeMonster(loadout, index, count, rng, partySize = 1) {
  const sp = loadout.species;
  const radius = SIZE_RADIUS[sp.size] ?? 26;
  const phases = sp.apex ? (sp.phases ?? 1) : 1;
  /*
   * Apexes scale to the party on both sides. Scaling only health left Karrahk
   * hitting for 165 against a 100 HP Warden — a one-shot, which makes a solo apex
   * a perfect-dodge exercise rather than a fight.
   */
  const scale = sp.apex ? apexHpScale(partySize) : 1;
  const hp = Math.round(sp.stats.hp * scale);
  const attack = sp.stats.attack * (sp.apex ? Math.max(0.4, scale) : 1);
  /*
   * The Restraint bar scales too. At full party size the bible's numbers are sound
   * — several crossbows subduing while a harpoon holds it — but a solo Warden was
   * looking at 300 perfect harpoon shots for Karrahk, roughly 37 minutes.
   */
  const required = loadout.required * scale;
  // Spread a pack across the top of the arena rather than stacking it.
  const span = Math.min(ARENA.w - 160, 140 * Math.max(1, count - 1));
  const x = count === 1 ? ARENA.w / 2 : ARENA.w / 2 - span / 2 + (span * index) / (count - 1);

  return {
    uid: index,
    x: clamp(x + (rng() - 0.5) * 40, radius + 10, ARENA.w - radius - 10),
    y: 60 + radius * 2 + (rng() - 0.5) * 50,
    facing: Math.PI / 2,
    hp, maxHp: hp,
    attack,
    required,
    radius,
    phases,
    phase: 1,
    phaseShield: 0,
    armourScale: 1,
    phaseBlocked: false,
    speed: sp.stats.speed * MONSTER.speedScale,
    weakPoints: phases > 1 ? apexWeakPoints(sp.id, 1, sp.weak_points) : sp.weak_points,
    state: 'unaware', stateT: 0,
    aware: false,
    restraint: 0,
    statuses: {},
    tranqStacks: 0,
    attackCooldown: 0.6,
    wanderT: 0, wanderDir: rng() * Math.PI * 2,
    lungeDir: 0,
    fleeT: 0,
    hitFlash: 0,
    anchorBlocked: false,
  };
}

export function createFight(loadout, opts = {}) {
  const rng = opts.rng ?? Math.random;
  const bonuses = opts.bonuses ?? {};
  const ai = profileFor(loadout.species);
  const packSize = Math.max(1, opts.packSize ?? 1);
  const partySize = Math.max(1, opts.partySize ?? 1);

  const requested = opts.carried ?? { lethal: 24, capture: 12 };
  // No capture chamber means no capture rounds to carry.
  const carried = { lethal: requested.lethal, capture: loadout.hasCapture === false ? 0 : requested.capture };
  const magSize = loadout.weapon.magazine;
  const startMag = {
    lethal: Math.min(magSize, carried.lethal),
    capture: Math.min(magSize, carried.capture),
  };

  const f = {
    rng,
    loadout,
    bonuses,
    ai,
    t: 0,
    outcome: null,
    outcomeAt: 0,
    results: [],                 // one entry per monster, as each resolves
    requireProximityToTag: opts.requireProximityToTag ?? false,
    tagRange: 120,

    player: {
      x: ARENA.w / 2, y: ARENA.h - 90, hp: PLAYER.maxHp, maxHp: PLAYER.maxHp,
      invuln: 0, radius: PLAYER.radius, aim: -Math.PI / 2, hitFlash: 0,
    },

    monsters: Array.from({ length: packSize }, (_, i) => makeMonster(loadout, i, packSize, rng, partySize)),
    focusIndex: 0,

    /*
     * Only one pack member may wind up or lunge at a time. Without this a pack of
     * three simply pins the player between simultaneous charges, which is not a
     * fight so much as an ambush you cannot answer.
     */
    attackToken: null,

    weapon: {
      chamber: 'lethal',
      mag: { ...startMag },
      reserve: { lethal: carried.lethal - startMag.lethal, capture: carried.capture - startMag.capture },
      carried,
      cooldown: 0, reloadT: 0, swapT: 0,
      charge: 0, wasFiring: false,
    },

    projectiles: [],
    floaters: [],
    bursts: [],                  // transient AoE rings for the renderer
    shake: 0,

    stats: {
      shots: 0, hits: 0, weakHits: 0,
      lethalHits: 0, captureHits: 0,
      damageDealt: 0, restraintApplied: 0,
      ambushUsed: false, swaps: 0,
      hpFractionAtResolve: null, cleanCapture: false,
      failedSubdues: 0, playerHits: 0,
      culled: 0, catalogued: 0, escaped: 0,
    },
  };

  /* Most of the HUD and the whole balance sim speak in terms of one target. The
   * focused monster is that target, so they keep working unchanged. */
  Object.defineProperty(f, 'monster', {
    get() { return f.monsters[f.focusIndex] ?? f.monsters[0]; },
    enumerable: false,
  });
  Object.defineProperty(f, 'anchorBlocked', {
    get() { return f.monsters.some((m) => m.anchorBlocked && !isDone(m)); },
    enumerable: false,
  });
  Object.defineProperty(f, 'phaseBlocked', {
    get() { return f.monsters.some((m) => m.phaseBlocked && !isDone(m)); },
    enumerable: false,
  });
  Object.defineProperty(f, 'isApex', {
    get() { return Boolean(loadout.species.apex); },
    enumerable: false,
  });

  return f;
}

// ---------------------------------------------------------------- statuses

function hasStatus(m, id) { return m.statuses[id] !== undefined; }
function activeStatuses(m) { return Object.keys(m.statuses); }

function applyStatus(m, id, seconds) {
  const cur = m.statuses[id];
  m.statuses[id] = cur === Infinity ? Infinity : Math.max(cur ?? 0, seconds);
}

function tickStatuses(m, dt) {
  for (const [id, left] of Object.entries(m.statuses)) {
    if (left === Infinity) continue;
    const next = left - dt;
    if (next <= 0) delete m.statuses[id];
    else m.statuses[id] = next;
  }
}

/** Statuses scale Restraint decay: halts_restraint_decay stops it, decay_multiplier scales it. */
function decayMultiplier(L, m) {
  let mult = 1;
  for (const id of activeStatuses(m)) {
    const def = L.statusDefs[id];
    if (!def) continue;
    if (def.halts_restraint_decay) return 0;
    if (def.decay_multiplier !== undefined) mult *= def.decay_multiplier;
  }
  return mult;
}

// ---------------------------------------------------------------- readouts

export function readouts(f, target = f.monster) {
  const { loadout: L } = f;
  const m = target;
  const ammo = (f.weapon.chamber === 'lethal' ? L.ammo.lethal : L.ammo.capture) ?? L.ammo.lethal;
  const shared = {
    weapon: L.weapon, ammo, species: L.species, sizeDef: L.sizeDef,
    hitZones: L.hitZones, effectiveness: L.effectiveness,
    statusDefs: L.statusDefs, activeStatuses: activeStatuses(m), statusCap: L.statusCap,
    hp: m.hp, maxHp: m.maxHp, ambush: !m.aware, ambushCfg: L.ambushCfg,
    woundExponent: L.woundExponent,
  };
  const isCapture = f.weapon.chamber === 'capture';
  return {
    wound: woundMultiplier(m.hp, m.maxHp, L.woundExponent),
    statusProduct: statusProduct(L.statusDefs, activeStatuses(m), L.statusCap),
    required: m.required ?? L.required,
    restraint: m.restraint,
    decay: restraintDecayPerSecond(L.species, m.hp / m.maxHp, L.decayHealthScale) * decayMultiplier(L, m),
    fleeChance: fleeChancePerSecond(L.species, m.restraint, m.required ?? L.required, L.fleeScale),
    bodyValue: isCapture ? computeRestraint({ ...shared, hitZone: 'body' }) : computeDamage({ ...shared, hitZone: 'body' }),
    weakValue: isCapture ? computeRestraint({ ...shared, hitZone: 'weak_point' }) : computeDamage({ ...shared, hitZone: 'weak_point' }),
    isCapture,
  };
}

// ---------------------------------------------------------------- weapon

function canFire(f) {
  const w = f.weapon;
  return f.outcome === null && w.cooldown <= 0 && w.reloadT <= 0 && w.swapT <= 0 && w.mag[w.chamber] > 0;
}

function fire(f) {
  const w = f.weapon;
  const L = f.loadout;
  w.mag[w.chamber] -= 1;
  w.cooldown = 60 / L.weapon.rpm;
  f.stats.shots += 1;

  const speed = w.chamber === 'lethal' ? 950 : 760;
  const ammo = (w.chamber === 'lethal' ? L.ammo.lethal : L.ammo.capture) ?? L.ammo.lethal;
  const single = ammo.effect === 'splitbore_single_projectile';
  const count = single ? 1 : (L.weapon.projectiles ?? 1);
  const spread = count > 1 ? SPREAD_PER_PROJECTILE * (count - 1) : 0;

  for (let i = 0; i < count; i++) {
    const offset = count > 1 ? -spread / 2 + (spread * i) / (count - 1) : 0;
    const jitter = count > 1 ? (f.rng() - 0.5) * SPREAD_PER_PROJECTILE : 0;
    const a = f.player.aim + offset + jitter;
    f.projectiles.push({
      x: f.player.x + Math.cos(a) * 16,
      y: f.player.y + Math.sin(a) * 16,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      travelled: 0,
      maxDist: L.weapon.range_m * PX_PER_METRE,
      kind: w.chamber,
    });
  }
  f.shake = Math.min(f.shake + 1.6, 6);

  // Anything louder than `silent` gives you away before the round lands, so a loud
  // weapon can never collect the Ambush multiplier. That bonus belongs to the bow.
  if (L.weapon.noise !== 'silent') {
    for (const m of f.monsters) {
      if (!isDone(m) && dist(m, f.player) < AI.noiseRadius) wake(f, m);
    }
  }
}

function stepTrigger(f, dt, intent) {
  const w = f.weapon;
  const draw = f.loadout.weapon.charge_seconds ?? 0;
  const firing = Boolean(intent.firing);

  if (draw > 0) {
    if (firing && canFire(f)) w.charge = Math.min(draw, w.charge + dt);
    else if (w.wasFiring && !firing) {
      if (w.charge >= draw && canFire(f)) fire(f);
      w.charge = 0;
    } else if (!firing) w.charge = 0;
  } else if (firing && canFire(f)) {
    fire(f);
  }
  w.wasFiring = firing;
}

function startReload(f) {
  const w = f.weapon;
  if (w.reloadT > 0 || w.swapT > 0) return;
  if (w.mag[w.chamber] >= f.loadout.weapon.magazine) return;
  if (w.reserve[w.chamber] <= 0) return;
  w.reloadT = f.loadout.weapon.reload_seconds / (1 + (f.bonuses.reload_speed ?? 0));
}

function finishReload(f) {
  const w = f.weapon;
  const want = f.loadout.weapon.magazine - w.mag[w.chamber];
  const take = Math.min(want, w.reserve[w.chamber]);
  w.mag[w.chamber] += take;
  w.reserve[w.chamber] -= take;
}

function startSwap(f) {
  const w = f.weapon;
  if (f.loadout.hasCapture === false) return;      // nothing to swap to
  if (w.swapT > 0) return;
  w.swapT = f.loadout.chamberSwapSeconds;
  w.reloadT = 0;
  f.stats.swaps += 1;
}

// ---------------------------------------------------------------- hits

function segmentDistance(ax, ay, bx, by, cx, cy) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / len2));
  return Math.hypot(ax + dx * t - cx, ay + dy * t - cy);
}

/*
 * Decide which zone a hit landed in.
 *
 * Resolving this by "whichever collision check fired on this substep" made the
 * outcome depend on substep quantisation: a weak point sitting a few pixels deeper
 * inside the silhouette lost its chance to register at all, and moving Cinderfang's
 * throat by 2.6px swung capture success from 88% to 7%. Instead, once a projectile
 * contacts a monster, sweep its path from the entry surface to the body centre and
 * take the closest weak point it passes on the way IN — so a rear weak point
 * genuinely requires shooting from behind.
 */
function zoneAt(p, m, wps) {
  const speed = Math.hypot(p.vx, p.vy) || 1;
  const reach = m.radius + 3;
  const bx = p.x + (p.vx / speed) * reach;
  const by = p.y + (p.vy / speed) * reach;

  let best = null, bestDist = Infinity;
  for (const wp of Object.values(wps)) {
    const d = segmentDistance(p.x, p.y, bx, by, wp.x, wp.y);
    if (d <= wp.radius + 3 && d < bestDist) { best = wp; bestDist = d; }
  }
  return best ? 'weak_point' : 'body';
}

function applyLethal(f, m, ammo, hitZone, scale = 1, ambush = false) {
  const L = f.loadout;
  if (m.phaseShield > 0) return 0;              // invulnerable mid-transition
  const dmg = computeDamage({
    weapon: L.weapon, ammo, species: L.species, sizeDef: L.sizeDef,
    hitZone, hitZones: L.hitZones, effectiveness: L.effectiveness,
    ambush, ambushCfg: L.ambushCfg, armourScale: m.armourScale ?? 1,
  }) * (1 + (f.bonuses.lethal_damage ?? 0)) * scale;

  m.hp = Math.max(0, m.hp - dmg);
  f.stats.damageDealt += dmg;
  return dmg;
}

function applyCapture(f, m, ammo, hitZone, scale = 1, ambush = false) {
  const L = f.loadout;
  if (m.phaseShield > 0) return 0;
  const gain = computeRestraint({
    weapon: L.weapon, ammo, species: L.species, sizeDef: L.sizeDef,
    hitZone, hitZones: L.hitZones, effectiveness: L.effectiveness,
    statusDefs: L.statusDefs, activeStatuses: activeStatuses(m), statusCap: L.statusCap,
    hp: m.hp, maxHp: m.maxHp, ambush, ambushCfg: L.ambushCfg, woundExponent: L.woundExponent,
  }) * (1 + (f.bonuses.restraint_gain ?? 0)) * scale;

  m.restraint += gain;
  f.stats.restraintApplied += gain;

  if (ammo.applies === 'sedated') {
    m.tranqStacks += 1;
    if (m.tranqStacks >= (ammo.stacks_to_apply ?? 1)) applyStatus(m, 'sedated', 6);
  } else if (ammo.applies) {
    applyStatus(m, ammo.applies, ammo.status_seconds ?? 6);
  }
  return gain;
}

function resolveHit(f, projectile, m, hitZone) {
  const L = f.loadout;
  const ammo = (projectile.kind === 'lethal' ? L.ammo.lethal : L.ammo.capture) ?? L.ammo.lethal;
  const ambush = !m.aware;
  if (ambush) f.stats.ambushUsed = true;

  f.stats.hits += 1;
  if (hitZone === 'weak_point') f.stats.weakHits += 1;

  if (projectile.kind === 'lethal') {
    const dmg = applyLethal(f, m, ammo, hitZone, 1, ambush);
    f.stats.lethalHits += 1;
    f.floaters.push({ x: projectile.x, y: projectile.y, text: `-${dmg.toFixed(0)}`, kind: 'damage', t: 0 });
    chainIfNeeded(f, m, ammo, projectile);
  } else {
    const gain = applyCapture(f, m, ammo, hitZone, 1, ambush);
    f.stats.captureHits += 1;
    f.floaters.push({ x: projectile.x, y: projectile.y, text: `+${gain.toFixed(0)}`, kind: 'restraint', t: 0 });
  }

  splashIfNeeded(f, projectile, m, ammo);

  m.hitFlash = 0.12;
  f.shake = Math.min(f.shake + (hitZone === 'weak_point' ? 3.5 : 1.5), 8);
  wake(f, m);
}

/** The Arcbrand's arc: reduced damage to the nearest others, and Stunned on the third link. */
function chainIfNeeded(f, origin, ammo, projectile) {
  const links = f.loadout.weapon.chain_targets ?? 0;
  if (links <= 1) return;

  const others = f.monsters
    .filter((o) => o !== origin && !isDone(o) && dist(o, origin) < 220)
    .sort((a, b) => dist(a, origin) - dist(b, origin))
    .slice(0, links - 1);

  let prev = origin;
  others.forEach((o, i) => {
    const falloff = 0.65 ** (i + 1);
    applyLethal(f, o, ammo, 'body', falloff, !o.aware);
    o.hitFlash = 0.12;
    f.bursts.push({ x1: prev.x, y1: prev.y, x2: o.x, y2: o.y, kind: 'chain', t: 0 });
    if (ammo.effect === 'stunned_on_third_chain' && i + 2 >= 3) {
      applyStatus(o, 'stunned', f.loadout.statusDefs.stunned?.seconds ?? 2);
    }
    wake(f, o);
    prev = o;
  });
  if (ammo.effect === 'stunned_on_third_chain' && others.length >= 2) {
    applyStatus(origin, 'stunned', f.loadout.statusDefs.stunned?.seconds ?? 2);
  }
}

/** Area rounds: the snare grenade and the launcher's payloads catch everything nearby. */
function splashIfNeeded(f, projectile, struck, ammo) {
  const radiusM = ammo.aoe_radius_m ?? f.loadout.weapon.aoe_radius_m ?? 0;
  if (!radiusM) return;
  const radius = radiusM * PX_PER_METRE;

  f.bursts.push({ x: projectile.x, y: projectile.y, radius, kind: projectile.kind, t: 0 });
  for (const m of f.monsters) {
    if (m === struck || isDone(m)) continue;
    if (dist(m, projectile) > radius + m.radius) continue;
    if (projectile.kind === 'lethal') applyLethal(f, m, ammo, 'body', 0.7, !m.aware);
    else applyCapture(f, m, ammo, 'body', 0.7, !m.aware);
    m.hitFlash = 0.12;
    wake(f, m);
  }
}

function wake(f, m) {
  if (m.aware) return;
  m.aware = true;
  if (m.state === 'unaware') setState(m, 'stalk');
}

function stepProjectiles(f, dt) {
  const alive = [];

  for (const p of f.projectiles) {
    const steps = Math.max(1, Math.ceil((Math.hypot(p.vx, p.vy) * dt) / 8));
    let consumed = false;
    for (let i = 0; i < steps && !consumed; i++) {
      const sdt = dt / steps;
      p.x += p.vx * sdt; p.y += p.vy * sdt;
      p.travelled += Math.hypot(p.vx, p.vy) * sdt;

      if (f.outcome === null) {
        for (const m of f.monsters) {
          if (isDone(m)) continue;
          const wps = weakPointPositions(m);
          const touching = dist(p, m) <= m.radius + 3;
          const onWeakPoint = Object.values(wps).some((wp) => Math.hypot(p.x - wp.x, p.y - wp.y) <= wp.radius + 3);
          if (touching || onWeakPoint) {
            resolveHit(f, p, m, zoneAt(p, m, wps));
            consumed = true;
            break;
          }
        }
      }
      if (p.travelled >= p.maxDist || p.x < 0 || p.x > ARENA.w || p.y < 0 || p.y > ARENA.h) consumed = true;
    }
    if (!consumed) alive.push(p);
  }
  f.projectiles = alive;
}

// ---------------------------------------------------------------- monster AI

function setState(m, s) { m.state = s; m.stateT = 0; }

function move(m, dx, dy, speed, dt) {
  const len = Math.hypot(dx, dy) || 1;
  m.x = clamp(m.x + (dx / len) * speed * dt, m.radius, ARENA.w - m.radius);
  m.y = clamp(m.y + (dy / len) * speed * dt, m.radius, ARENA.h - m.radius);
}

function nearestEdge(m) {
  const opts = [{ x: m.x, y: -20 }, { x: m.x, y: ARENA.h + 20 }, { x: -20, y: m.y }, { x: ARENA.w + 20, y: m.y }];
  return opts.reduce((a, b) => (dist(m, a) < dist(m, b) ? a : b));
}

/*
 * Apex phases. Crossing an HP band strips more armour, exposes a different weak
 * point and resets any hold you had — so a long fight is a sequence of different
 * problems rather than the same shot repeated.
 */
function advancePhase(f, m) {
  if (m.phases < 2 || m.hp <= 0) return;
  const want = Math.min(m.phases, 1 + Math.floor((1 - m.hp / m.maxHp) * m.phases));
  if (want <= m.phase) return;

  m.phase = want;
  m.phaseShield = 1.2;
  m.weakPoints = apexWeakPoints(f.loadout.species.id, m.phase, f.loadout.species.weak_points);
  m.armourScale = Math.max(0.4, 1 - 0.18 * (m.phase - 1));
  m.restraint = 0;                       // it shrugs off whatever hold you had
  m.phaseBlocked = false;
  f.shake = 12;
  f.bursts.push({ x: m.x, y: m.y, radius: m.radius * 2.4, kind: 'phase', t: 0 });
  f.floaters.push({ x: m.x, y: m.y - m.radius - 30, text: `PHASE ${m.phase}`, kind: 'phase', t: 0 });
}

function stepMonster(f, m, dt) {
  const p = f.player;
  const L = f.loadout;
  if (isDone(m)) return;

  m.stateT += dt;
  m.hitFlash = Math.max(0, m.hitFlash - dt);

  advancePhase(f, m);
  if (m.phaseShield > 0) {
    m.phaseShield = Math.max(0, m.phaseShield - dt);
    m.facing = Math.atan2(p.y - m.y, p.x - m.x);
    return;
  }

  const slow = hasStatus(m, 'sedated') ? (L.statusDefs.sedated.move_speed_multiplier ?? 0.5) : 1;
  const chilled = hasStatus(m, 'chilled') ? (L.statusDefs.chilled.move_speed_multiplier ?? 0.6) : 1;
  const speed = m.speed * slow * chilled;
  const d = dist(m, p);

  if (m.hp <= 0) { setState(m, 'dead'); record(f, m, 'culled'); return; }

  if (m.restraint >= m.required && m.state !== 'subdued') {
    // An apex cannot be taken until it is broken down to its last phase.
    if (m.phases > 1 && m.phase < m.phases) {
      m.restraint = m.required;
      m.phaseBlocked = true;
    // Colossus and Titan need an Anchor before they can go down at all.
    } else if (L.sizeDef.anchor_required && !hasStatus(m, 'anchored')) {
      m.restraint = m.required;
      m.anchorBlocked = true;
    } else {
      m.anchorBlocked = false;
      setState(m, 'subdued');
      releaseToken(f, m);
      return;
    }
  }

  if (hasStatus(m, 'stunned') && !['subdued', 'flee'].includes(m.state)) return;
  if (hasStatus(m, 'ensnared') && !['subdued'].includes(m.state)) {
    m.facing = Math.atan2(p.y - m.y, p.x - m.x);
    return;                                   // held in place, but still dangerous to stand next to
  }

  switch (m.state) {
    case 'unaware': {
      m.wanderT -= dt;
      if (m.wanderT <= 0) { m.wanderT = 1.5 + f.rng() * 1.5; m.wanderDir = f.rng() * Math.PI * 2; }
      move(m, Math.cos(m.wanderDir), Math.sin(m.wanderDir), speed * AI.wanderSpeed, dt);
      m.facing = m.wanderDir;
      if (d < f.ai.alert) wake(f, m);
      break;
    }
    case 'stalk': {
      m.facing = Math.atan2(p.y - m.y, p.x - m.x);
      m.attackCooldown -= dt;
      const pref = f.ai.preferred;
      const toward = d > pref + 40 ? 1 : d < pref - 40 ? -1 : 0;
      const ang = Math.atan2(p.y - m.y, p.x - m.x);
      const strafe = ang + Math.PI / 2;
      let dx = Math.cos(ang) * toward * 1.15 + Math.cos(strafe) * 0.45;
      let dy = Math.sin(ang) * toward * 1.15 + Math.sin(strafe) * 0.45;
      // Pack members give each other room instead of stacking into one silhouette.
      for (const o of f.monsters) {
        if (o === m || isDone(o)) continue;
        const sep = dist(m, o);
        const min = m.radius + o.radius + 14;
        if (sep < min && sep > 0) {
          dx += ((m.x - o.x) / sep) * 1.4;
          dy += ((m.y - o.y) / sep) * 1.4;
        }
      }
      move(m, dx, dy, speed, dt);
      if (f.ai.attacks && m.attackCooldown <= 0 && d < f.ai.reach && takeToken(f, m)) setState(m, 'windup');
      break;
    }
    case 'windup': {
      m.facing = Math.atan2(p.y - m.y, p.x - m.x);
      if (m.stateT >= LUNGE.windup * (hasStatus(m, 'sedated') ? 1.6 : 1)) {
        m.lungeDir = m.facing;
        setState(m, 'lunge');
      }
      break;
    }
    case 'lunge': {
      const want = Math.atan2(p.y - m.y, p.x - m.x);
      let turn = ((want - m.lungeDir + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      m.lungeDir += clamp(turn, -LUNGE.steer * dt, LUNGE.steer * dt);
      m.facing = m.lungeDir;
      move(m, Math.cos(m.lungeDir), Math.sin(m.lungeDir), LUNGE.speed * slow, dt);
      if (p.invuln <= 0 && dist(m, p) <= m.radius + p.radius + 4) hitPlayer(f, m);
      if (m.stateT >= LUNGE.dash) setState(m, 'recover');
      break;
    }
    case 'recover': {
      move(m, Math.cos(m.lungeDir), Math.sin(m.lungeDir), speed * 0.25, dt);
      if (m.stateT >= LUNGE.recover) {
        m.attackCooldown = f.ai.cooldown;
        releaseToken(f, m);
        setState(m, 'stalk');
      }
      break;
    }
    case 'flee': {
      m.fleeT += dt;
      const target = nearestEdge(m);
      const ang = Math.atan2(target.y - m.y, target.x - m.x);
      m.facing = ang;
      // Limping: at low health it can be run down, so a chase is a real decision.
      const flight = 0.85 + 0.5 * (m.hp / m.maxHp);
      move(m, Math.cos(ang), Math.sin(ang), speed * flight, dt);
      const atEdge = m.x < 40 || m.x > ARENA.w - 40 || m.y < 40 || m.y > ARENA.h - 40;
      if (atEdge || m.fleeT > AI.fleeEscapeSeconds) { setState(m, 'escaped'); record(f, m, 'escaped'); }
      break;
    }
    case 'subdued': {
      if (m.stateT >= L.subdueWindow) {
        m.restraint = m.required * L.failedSubdue.restraint_retained;
        applyStatus(m, L.failedSubdue.applies, Infinity);
        f.stats.failedSubdues += 1;
        setState(m, 'stalk');
        m.attackCooldown = 0.4;
      }
      break;
    }
  }
}

function takeToken(f, m) {
  if (f.attackToken === null) { f.attackToken = m.uid; return true; }
  return f.attackToken === m.uid;
}
function releaseToken(f, m) {
  if (f.attackToken === m.uid) f.attackToken = null;
}

function hitPlayer(f, m) {
  const enraged = hasStatus(m, 'enraged');
  const dmg = (m.attack ?? f.loadout.species.stats.attack)
    * (enraged ? (f.loadout.statusDefs.enraged.damage_dealt_multiplier ?? 1.4) : 1)
    * (1 - Math.min(0.5, f.bonuses.damage_resistance ?? 0));
  f.player.hp = Math.max(0, f.player.hp - dmg);
  f.player.invuln = PLAYER.invulnSeconds;
  f.player.hitFlash = 0.3;
  f.stats.playerHits += 1;
  f.shake = 10;
  f.floaters.push({ x: f.player.x, y: f.player.y - 20, text: `-${dmg.toFixed(0)}`, kind: 'player', t: 0 });
  if (f.player.hp <= 0) finish(f, 'driven_off');
}

function stepFlee(f, m, dt) {
  const L = f.loadout;
  if (!['stalk', 'windup', 'recover'].includes(m.state)) return;
  if (hasStatus(m, 'enraged') || hasStatus(m, 'ensnared') || hasStatus(m, 'anchored') || hasStatus(m, 'calmed')) return;
  if (m.hp / m.maxHp >= L.species.stats.flee_threshold) return;

  const perSecond = fleeChancePerSecond(L.species, m.restraint, m.required, L.fleeScale);
  const chance = 1 - Math.pow(1 - clamp(perSecond, 0, 0.999), dt);
  if (f.rng() < chance) { releaseToken(f, m); setState(m, 'flee'); m.fleeT = 0; }
}

// ---------------------------------------------------------------- resolution

function record(f, m, outcome, detail = {}) {
  releaseToken(f, m);
  f.results.push({
    speciesId: f.loadout.species.id,
    outcome,
    hpFraction: m.hp / m.maxHp,
    clean: outcome === 'catalogued' && m.hp / m.maxHp > 0.8,
  });
  if (outcome === 'culled') f.stats.culled += 1;
  if (outcome === 'catalogued') f.stats.catalogued += 1;
  if (outcome === 'escaped') f.stats.escaped += 1;
  Object.assign(f.stats, detail);
  checkEncounterOver(f);
}

function checkEncounterOver(f) {
  if (f.outcome) return;
  if (f.monsters.every(isDone)) {
    // A single-target encounter reports its one result, so callers that predate
    // packs keep reading the outcome they expect.
    const summary = f.monsters.length === 1
      ? (f.results[0]?.outcome ?? 'escaped')
      : 'resolved';
    finish(f, summary);
  }
}

function finish(f, outcome) {
  if (f.outcome) return;
  f.outcome = outcome;
  f.outcomeAt = f.t;

  // Anything still standing when the player goes down or runs dry got away.
  for (const m of f.monsters) {
    if (!isDone(m)) {
      setState(m, 'escaped');
      f.results.push({ speciesId: f.loadout.species.id, outcome: 'escaped', hpFraction: m.hp / m.maxHp, clean: false });
      f.stats.escaped += 1;
    }
  }

  const captured = f.results.find((r) => r.outcome === 'catalogued');
  f.stats.hpFractionAtResolve = captured ? captured.hpFraction : (f.results[0]?.hpFraction ?? 0);
  f.stats.cleanCapture = Boolean(captured?.clean);
}

/** Tag the nearest subdued monster. With a pack you cannot reach them all in time. */
function tryTag(f) {
  const subdued = f.monsters
    .filter((m) => m.state === 'subdued')
    .filter((m) => !f.requireProximityToTag || dist(m, f.player) <= f.tagRange)
    .sort((a, b) => dist(a, f.player) - dist(b, f.player));
  if (!subdued.length) return false;

  const m = subdued[0];
  setState(m, 'tagged');
  record(f, m, 'catalogued');
  return true;
}

// ---------------------------------------------------------------- main step

/** Whichever live monster the crosshair is closest to. Drives the HUD. */
function updateFocus(f) {
  let best = -1, bestScore = Infinity;
  f.monsters.forEach((m, i) => {
    if (isDone(m)) return;
    const ang = Math.atan2(m.y - f.player.y, m.x - f.player.x);
    let delta = Math.abs(((ang - f.player.aim + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    const score = delta * 260 + dist(m, f.player) * 0.25;
    if (score < bestScore) { bestScore = score; best = i; }
  });
  if (best >= 0) f.focusIndex = best;
}

export function step(f, dt, intent) {
  dt = Math.min(dt, 1 / 30);
  if (f.outcome !== null) { f.t += dt; decayCosmetics(f, dt); return; }

  f.t += dt;
  const w = f.weapon;
  const p = f.player;

  p.invuln = Math.max(0, p.invuln - dt);
  p.hitFlash = Math.max(0, p.hitFlash - dt);
  if (intent.aim !== undefined && intent.aim !== null) p.aim = intent.aim;
  if (intent.moveX || intent.moveY) {
    const len = Math.hypot(intent.moveX, intent.moveY) || 1;
    p.x = clamp(p.x + (intent.moveX / len) * PLAYER.speed * dt, p.radius, ARENA.w - p.radius);
    p.y = clamp(p.y + (intent.moveY / len) * PLAYER.speed * dt, p.radius, ARENA.h - p.radius);
  }

  w.cooldown = Math.max(0, w.cooldown - dt);
  if (w.swapT > 0) {
    w.swapT = Math.max(0, w.swapT - dt);
    if (w.swapT === 0) w.chamber = w.chamber === 'lethal' ? 'capture' : 'lethal';
  } else if (w.reloadT > 0) {
    w.reloadT = Math.max(0, w.reloadT - dt);
    if (w.reloadT === 0) finishReload(f);
  }
  if (intent.swap) startSwap(f);
  if (intent.reload) startReload(f);
  if (intent.tag) tryTag(f);
  stepTrigger(f, dt, intent);

  for (const m of f.monsters) {
    if (isDone(m)) continue;
    tickStatuses(m, dt);
    const decay = restraintDecayPerSecond(f.loadout.species, m.hp / m.maxHp, f.loadout.decayHealthScale)
      * decayMultiplier(f.loadout, m);
    m.restraint = Math.max(0, m.restraint - decay * dt);
    stepMonster(f, m, dt);
    if (!isDone(m)) stepFlee(f, m, dt);
  }

  stepProjectiles(f, dt);
  updateFocus(f);

  const noAmmo = w.mag.lethal + w.reserve.lethal + w.mag.capture + w.reserve.capture === 0;
  if (noAmmo && f.projectiles.length === 0 && f.outcome === null) finish(f, 'driven_off');

  decayCosmetics(f, dt);
}

function decayCosmetics(f, dt) {
  f.shake = Math.max(0, f.shake - dt * 22);
  f.floaters = f.floaters.filter((fl) => (fl.t += dt) < 0.9);
  f.bursts = f.bursts.filter((b) => (b.t += dt) < 0.4);
}

export { hasStatus, activeStatuses, tryTag, isDone };
