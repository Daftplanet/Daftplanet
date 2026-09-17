/*
 * RIFTBORN phase 0 — the fight.
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
const SPREAD_PER_PROJECTILE = 0.055;   // radians between scattergun pellets
const SIZE_RADIUS = { mote: 13, whelp: 19, strider: 26, brute: 38, colossus: 56, titan: 80 };
const MONSTER = { speedScale: 24 };

// Cinderfang's attack pattern. A telegraphed lunge with a punish window on the
// recovery — which is also when its hind-joint weak point is facing you.
const LUNGE = { windup: 0.45, dash: 0.35, recover: 0.85, speed: 430, cooldown: 1.6, reach: 260, steer: 1.6 };
const AI = { wanderSpeed: 0.35, fleeSpeedMult: 1.25, fleeEscapeSeconds: 5, noiseRadius: 450 };

/*
 * Behaviour by aggression rating. Passive creatures never attack at all, so the
 * only way to lose one is to let it run — which is exactly the pressure a Pebblit
 * or a Sparkmite should apply.
 */
const AGGRESSION = {
  passive:     { alert: 110, preferred: 210, attacks: false, cooldown: 99, reach: 0 },
  skittish:    { alert: 180, preferred: 240, attacks: true,  cooldown: 2.8, reach: 110 },
  territorial: { alert: 210, preferred: 170, attacks: true,  cooldown: 1.6, reach: 260 },
  aggressive:  { alert: 320, preferred: 100, attacks: true,  cooldown: 1.2, reach: 320 },
};
const profileFor = (species) => AGGRESSION[species.aggression] ?? AGGRESSION.territorial;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

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
};

/** Anything not in the table gets an evenly spaced ring slot rather than vanishing. */
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

export function createFight(loadout, opts = {}) {
  // Account-wide passive bonuses from Sanctuary residents. Defaulted so the
  // headless sim and any caller without a profile still work.
  const bonuses = opts.bonuses ?? {};
  const rng = opts.rng ?? Math.random;
  const ai = profileFor(loadout.species);
  const radius = SIZE_RADIUS[loadout.species.size] ?? 26;
  // Rounds carried in total, magazine included — not magazine plus spares.
  const carried = opts.carried ?? { lethal: 24, capture: 12 };
  const magSize = loadout.weapon.magazine;
  const startMag = { lethal: Math.min(magSize, carried.lethal), capture: Math.min(magSize, carried.capture) };
  const sp = loadout.species;

  return {
    rng,
    loadout,
    bonuses,
    t: 0,
    outcome: null,          // culled | catalogued | escaped | driven_off
    outcomeAt: 0,
    requireProximityToTag: opts.requireProximityToTag ?? false,
    tagRange: 120,

    player: { x: ARENA.w / 2, y: ARENA.h - 90, hp: PLAYER.maxHp, maxHp: PLAYER.maxHp, invuln: 0, radius: PLAYER.radius, aim: -Math.PI / 2, hitFlash: 0 },

    ai,
    monster: {
      x: ARENA.w / 2, y: 60 + radius * 2, facing: Math.PI / 2,
      hp: sp.stats.hp, maxHp: sp.stats.hp,
      radius,
      speed: sp.stats.speed * MONSTER.speedScale,
      weakPoints: sp.weak_points,
      state: 'unaware', stateT: 0,
      aware: false,
      restraint: 0,
      statuses: {},            // id -> seconds remaining (Infinity for permanent)
      tranqStacks: 0,
      attackCooldown: Math.min(0.6, ai.cooldown),
      wanderT: 0, wanderDir: rng() * Math.PI * 2,
      lungeDir: 0,
      fleeT: 0,
      hitFlash: 0,
    },

    weapon: {
      chamber: 'lethal',
      mag: { ...startMag },
      reserve: { lethal: carried.lethal - startMag.lethal, capture: carried.capture - startMag.capture },
      carried,
      cooldown: 0, reloadT: 0, swapT: 0,
      charge: 0, wasFiring: false,
    },

    anchorBlocked: false,
    projectiles: [],
    floaters: [],           // transient damage/restraint numbers for the renderer
    shake: 0,

    stats: {
      shots: 0, hits: 0, weakHits: 0,
      lethalHits: 0, captureHits: 0,
      damageDealt: 0, restraintApplied: 0,
      ambushUsed: false, swaps: 0,
      hpFractionAtResolve: null, cleanCapture: false,
      failedSubdues: 0, playerHits: 0,
    },
  };
}

// ---------------------------------------------------------------- statuses

function hasStatus(m, id) { return m.statuses[id] !== undefined; }
function activeStatuses(m) { return Object.keys(m.statuses); }

function applyStatus(m, id, seconds) {
  const cur = m.statuses[id];
  m.statuses[id] = cur === Infinity ? Infinity : Math.max(cur ?? 0, seconds);
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

function tickStatuses(m, dt) {
  for (const [id, left] of Object.entries(m.statuses)) {
    if (left === Infinity) continue;
    const next = left - dt;
    if (next <= 0) delete m.statuses[id];
    else m.statuses[id] = next;
  }
}

// ---------------------------------------------------------------- readouts
// Everything the HUD and dev panel show is derived here, so the numbers on
// screen are the numbers the fight is actually using.

export function readouts(f) {
  const { loadout: L, monster: m } = f;
  const ammo = f.weapon.chamber === 'lethal' ? L.ammo.lethal : L.ammo.capture;
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
    required: L.required,
    restraint: m.restraint,
    decay: restraintDecayPerSecond(L.species, m.hp / m.maxHp, L.decayHealthScale) * decayMultiplier(L, m),
    fleeChance: fleeChancePerSecond(L.species, m.restraint, L.required, L.fleeScale),
    bodyValue: isCapture
      ? computeRestraint({ ...shared, hitZone: 'body' })
      : computeDamage({ ...shared, hitZone: 'body' }),
    weakValue: isCapture
      ? computeRestraint({ ...shared, hitZone: 'weak_point' })
      : computeDamage({ ...shared, hitZone: 'weak_point' }),
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
  // A Slug collapses the Splitbore to a single projectile, per its ammo entry.
  const ammo = w.chamber === 'lethal' ? L.ammo.lethal : L.ammo.capture;
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

  // Anything louder than `silent` gives you away before the round lands, so a
  // loud weapon can never collect the Ambush multiplier. That bonus belongs to
  // the bow.
  if (L.weapon.noise !== 'silent' && Math.hypot(f.monster.x - f.player.x, f.monster.y - f.player.y) < AI.noiseRadius) {
    wake(f);
  }
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
  const cap = f.loadout.weapon.magazine;
  const want = cap - w.mag[w.chamber];
  const take = Math.min(want, w.reserve[w.chamber]);
  w.mag[w.chamber] += take;
  w.reserve[w.chamber] -= take;
}

/**
 * Trigger handling. A weapon with `charge_seconds` (the Sylvan Bow) draws while
 * the trigger is held and looses on release; releasing early cancels the shot.
 * Everything else fires on the press.
 */
function stepTrigger(f, dt, intent) {
  const w = f.weapon;
  const draw = f.loadout.weapon.charge_seconds ?? 0;
  const firing = Boolean(intent.firing);

  if (draw > 0) {
    if (firing && canFire(f)) {
      w.charge = Math.min(draw, w.charge + dt);
    } else if (w.wasFiring && !firing) {
      if (w.charge >= draw && canFire(f)) fire(f);
      w.charge = 0;
    } else if (!firing) {
      w.charge = 0;
    }
  } else if (firing && canFire(f)) {
    fire(f);
  }
  w.wasFiring = firing;
}

function startSwap(f) {
  const w = f.weapon;
  if (w.swapT > 0) return;
  w.swapT = f.loadout.chamberSwapSeconds;
  w.reloadT = 0;                       // swapping cancels a reload, per design
  f.stats.swaps += 1;
}

// ---------------------------------------------------------------- hits

function resolveHit(f, projectile, hitZone) {
  const L = f.loadout;
  const m = f.monster;
  const ammo = projectile.kind === 'lethal' ? L.ammo.lethal : L.ammo.capture;
  const ambush = !m.aware;
  if (ambush) f.stats.ambushUsed = true;

  const shared = {
    weapon: L.weapon, ammo, species: L.species, sizeDef: L.sizeDef,
    hitZone, hitZones: L.hitZones, effectiveness: L.effectiveness,
    ambush, ambushCfg: L.ambushCfg,
  };

  f.stats.hits += 1;
  if (hitZone === 'weak_point') f.stats.weakHits += 1;

  if (projectile.kind === 'lethal') {
    const dmg = computeDamage(shared) * (1 + (f.bonuses.lethal_damage ?? 0));
    m.hp = Math.max(0, m.hp - dmg);
    f.stats.lethalHits += 1;
    f.stats.damageDealt += dmg;
    f.floaters.push({ x: projectile.x, y: projectile.y, text: `-${dmg.toFixed(0)}`, kind: 'damage', t: 0 });
  } else {
    const gain = computeRestraint({
      ...shared,
      statusDefs: L.statusDefs, activeStatuses: activeStatuses(m), statusCap: L.statusCap,
      hp: m.hp, maxHp: m.maxHp, woundExponent: L.woundExponent,
    });
    m.restraint += gain * (1 + (f.bonuses.restraint_gain ?? 0));
    f.stats.captureHits += 1;
    f.stats.restraintApplied += gain;
    f.floaters.push({ x: projectile.x, y: projectile.y, text: `+${gain.toFixed(0)}`, kind: 'restraint', t: 0 });

    // Tranq darts sedate on the third stack (ammo.json: stacks_to_apply).
    if (ammo.applies === 'sedated') {
      m.tranqStacks += 1;
      if (m.tranqStacks >= (ammo.stacks_to_apply ?? 1)) applyStatus(m, 'sedated', 6);
    } else if (ammo.applies) {
      applyStatus(m, ammo.applies, ammo.status_seconds ?? 6);
    }
  }

  m.hitFlash = 0.12;
  f.shake = Math.min(f.shake + (hitZone === 'weak_point' ? 3.5 : 1.5), 8);
  wake(f);
}

/** Damage and noise both alert the monster; a silent weapon would not call this. */
function wake(f) {
  if (!f.monster.aware) {
    f.monster.aware = true;
    if (f.monster.state === 'unaware') setState(f.monster, 'stalk');
  }
}

/** Shortest distance from point c to the segment a->b. */
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
 * contacts the monster, sweep its remaining path through the body and take the
 * closest weak point it passes on the way IN — surface to centre, not all the way
 * through. So a rear weak point genuinely requires shooting from behind, which is
 * what makes a lunge recovery worth punishing.
 */
function zoneAt(p, m, wps) {
  const speed = Math.hypot(p.vx, p.vy) || 1;
  const reach = m.radius + 3;        // entry surface to centre only
  const bx = p.x + (p.vx / speed) * reach;
  const by = p.y + (p.vy / speed) * reach;

  let best = null, bestDist = Infinity;
  for (const wp of Object.values(wps)) {
    const d = segmentDistance(p.x, p.y, bx, by, wp.x, wp.y);
    if (d <= wp.radius + 3 && d < bestDist) { best = wp; bestDist = d; }
  }
  return best ? 'weak_point' : 'body';
}

function stepProjectiles(f, dt) {
  const m = f.monster;
  const wps = weakPointPositions(m);
  const alive = [];

  for (const p of f.projectiles) {
    const steps = Math.max(1, Math.ceil((Math.hypot(p.vx, p.vy) * dt) / 8)); // substep so fast rounds can't tunnel
    let consumed = false;
    for (let i = 0; i < steps && !consumed; i++) {
      const sdt = dt / steps;
      p.x += p.vx * sdt; p.y += p.vy * sdt;
      p.travelled += Math.hypot(p.vx, p.vy) * sdt;

      if (f.outcome === null && !['dead', 'escaped', 'tagged'].includes(m.state)) {
        const touching = Math.hypot(p.x - m.x, p.y - m.y) <= m.radius + 3;
        const onWeakPoint = Object.values(wps)
          .some((wp) => Math.hypot(p.x - wp.x, p.y - wp.y) <= wp.radius + 3);
        if (touching || onWeakPoint) {
          resolveHit(f, p, zoneAt(p, m, wps));
          consumed = true;
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

function stepMonster(f, dt) {
  const m = f.monster;
  const p = f.player;
  const L = f.loadout;
  if (['dead', 'escaped', 'tagged'].includes(m.state)) return;

  m.stateT += dt;
  m.hitFlash = Math.max(0, m.hitFlash - dt);

  const slow = hasStatus(m, 'sedated') ? (L.statusDefs.sedated.move_speed_multiplier ?? 0.5) : 1;
  const chilled = hasStatus(m, 'chilled') ? (L.statusDefs.chilled.move_speed_multiplier ?? 0.6) : 1;
  const speed = m.speed * slow * chilled;
  const d = dist(m, p);

  // --- death and subdue checks happen before behaviour
  if (m.hp <= 0) { setState(m, 'dead'); finish(f, 'culled'); return; }
  if (m.restraint >= L.required && m.state !== 'subdued') {
    // Colossus and Titan need an Anchor before they can go down at all, which is
    // the Tether Harpoon's whole job. Without one the meter simply caps.
    if (L.sizeDef.anchor_required && !hasStatus(m, 'anchored')) {
      m.restraint = L.required;
      f.anchorBlocked = true;
    } else {
      setState(m, 'subdued');
      m.stateT = 0;
      return;
    }
  }

  switch (m.state) {
    case 'unaware': {
      m.wanderT -= dt;
      if (m.wanderT <= 0) { m.wanderT = 1.5 + f.rng() * 1.5; m.wanderDir = f.rng() * Math.PI * 2; }
      move(m, Math.cos(m.wanderDir), Math.sin(m.wanderDir), speed * AI.wanderSpeed, dt);
      m.facing = m.wanderDir;
      if (d < f.ai.alert) wake(f);                         // notices you entering its space
      break;
    }
    case 'stalk': {
      m.facing = Math.atan2(p.y - m.y, p.x - m.x);
      m.attackCooldown -= dt;
      // Hold a preferred range, strafing rather than walking straight in.
      const pref = f.ai.preferred;
      const toward = d > pref + 40 ? 1 : d < pref - 40 ? -1 : 0;
      const ang = Math.atan2(p.y - m.y, p.x - m.x);
      const strafe = ang + Math.PI / 2;
      const dx = Math.cos(ang) * toward * 1.15 + Math.cos(strafe) * 0.45;
      const dy = Math.sin(ang) * toward * 1.15 + Math.sin(strafe) * 0.45;
      move(m, dx, dy, speed, dt);
      if (f.ai.attacks && m.attackCooldown <= 0 && d < f.ai.reach) setState(m, 'windup');
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
      // Slight in-flight correction: dodging still works, but it has to be early
      // and committed rather than a late sidestep.
      const want = Math.atan2(p.y - m.y, p.x - m.x);
      let turn = ((want - m.lungeDir + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      const maxTurn = LUNGE.steer * dt;
      m.lungeDir += clamp(turn, -maxTurn, maxTurn);
      m.facing = m.lungeDir;
      move(m, Math.cos(m.lungeDir), Math.sin(m.lungeDir), LUNGE.speed * slow, dt);
      if (p.invuln <= 0 && dist(m, p) <= m.radius + p.radius + 4) hitPlayer(f);
      if (m.stateT >= LUNGE.dash) setState(m, 'recover');
      break;
    }
    case 'recover': {
      // Overshoots past the player, so its back — and the hind joint — is exposed.
      move(m, Math.cos(m.lungeDir), Math.sin(m.lungeDir), speed * 0.25, dt);
      if (m.stateT >= LUNGE.recover) { m.attackCooldown = f.ai.cooldown; setState(m, 'stalk'); }
      break;
    }
    case 'flee': {
      m.fleeT += dt;
      const target = nearestEdge(m);
      const ang = Math.atan2(target.y - m.y, target.x - m.x);
      m.facing = ang;
      // Limping: at low health it can actually be run down, so a chase is a real
      // decision rather than a formality.
      const flight = 0.85 + 0.5 * (m.hp / m.maxHp);
      move(m, Math.cos(ang), Math.sin(ang), speed * flight, dt);
      const atEdge = m.x < 40 || m.x > ARENA.w - 40 || m.y < 40 || m.y > ARENA.h - 40;
      if (atEdge || m.fleeT > AI.fleeEscapeSeconds) { setState(m, 'escaped'); finish(f, 'escaped'); }
      break;
    }
    case 'subdued': {
      if (m.stateT >= L.subdueWindow) {
        // Missed the window: it recovers at half Restraint and is now Enraged.
        m.restraint = L.required * L.failedSubdue.restraint_retained;
        applyStatus(m, L.failedSubdue.applies, Infinity);
        f.stats.failedSubdues += 1;
        setState(m, 'stalk');
        m.attackCooldown = 0.4;
      }
      break;
    }
  }
}

function move(m, dx, dy, speed, dt) {
  const len = Math.hypot(dx, dy) || 1;
  m.x = clamp(m.x + (dx / len) * speed * dt, m.radius, ARENA.w - m.radius);
  m.y = clamp(m.y + (dy / len) * speed * dt, m.radius, ARENA.h - m.radius);
}

function nearestEdge(m) {
  const opts = [{ x: m.x, y: -20 }, { x: m.x, y: ARENA.h + 20 }, { x: -20, y: m.y }, { x: ARENA.w + 20, y: m.y }];
  return opts.reduce((a, b) => (dist(m, a) < dist(m, b) ? a : b));
}

function hitPlayer(f) {
  const m = f.monster;
  const enraged = hasStatus(m, 'enraged');
  const dmg = f.loadout.species.stats.attack
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

/** Flee rolls run continuously below the threshold; a filling Restraint meter suppresses them. */
function stepFlee(f, dt) {
  const m = f.monster;
  const L = f.loadout;
  if (!['stalk', 'windup', 'recover'].includes(m.state)) return;
  if (hasStatus(m, 'enraged') || hasStatus(m, 'ensnared') || hasStatus(m, 'anchored') || hasStatus(m, 'calmed')) return;
  if (m.hp / m.maxHp >= L.species.stats.flee_threshold) return;

  const perSecond = fleeChancePerSecond(L.species, m.restraint, L.required, L.fleeScale);
  const chance = 1 - Math.pow(1 - clamp(perSecond, 0, 0.999), dt);
  if (f.rng() < chance) { setState(m, 'flee'); m.fleeT = 0; }
}

function finish(f, outcome) {
  if (f.outcome) return;
  f.outcome = outcome;
  f.outcomeAt = f.t;
  f.stats.hpFractionAtResolve = f.monster.hp / f.monster.maxHp;
  f.stats.cleanCapture = outcome === 'catalogued' && f.stats.hpFractionAtResolve > 0.8;
}

function tryTag(f) {
  const m = f.monster;
  if (m.state !== 'subdued') return false;
  if (f.requireProximityToTag && dist(m, f.player) > f.tagRange) return false;
  setState(m, 'tagged');
  finish(f, 'catalogued');
  return true;
}

// ---------------------------------------------------------------- main step

/**
 * Advance the fight.
 * intent: { moveX, moveY, aim, firing, swap, reload, tag }
 */
export function step(f, dt, intent) {
  dt = Math.min(dt, 1 / 30);            // never let a stalled tab teleport anything
  if (f.outcome !== null) { f.t += dt; decayCosmetics(f, dt); return; }

  f.t += dt;
  const w = f.weapon;
  const p = f.player;

  // --- player
  p.invuln = Math.max(0, p.invuln - dt);
  p.hitFlash = Math.max(0, p.hitFlash - dt);
  if (intent.aim !== undefined && intent.aim !== null) p.aim = intent.aim;
  if (intent.moveX || intent.moveY) {
    const len = Math.hypot(intent.moveX, intent.moveY) || 1;
    p.x = clamp(p.x + (intent.moveX / len) * PLAYER.speed * dt, p.radius, ARENA.w - p.radius);
    p.y = clamp(p.y + (intent.moveY / len) * PLAYER.speed * dt, p.radius, ARENA.h - p.radius);
  }

  // --- weapon timers
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

  // --- monster
  tickStatuses(f.monster, dt);
  const decay = restraintDecayPerSecond(f.loadout.species, f.monster.hp / f.monster.maxHp, f.loadout.decayHealthScale)
    * decayMultiplier(f.loadout, f.monster);
  f.monster.restraint = Math.max(0, f.monster.restraint - decay * dt);
  stepMonster(f, dt);
  stepFlee(f, dt);
  stepProjectiles(f, dt);

  // Out of every round that could still resolve the fight.
  const noAmmo = w.mag.lethal + w.reserve.lethal + w.mag.capture + w.reserve.capture === 0;
  if (noAmmo && f.projectiles.length === 0 && f.outcome === null) finish(f, 'driven_off');

  decayCosmetics(f, dt);
}

function decayCosmetics(f, dt) {
  f.shake = Math.max(0, f.shake - dt * 22);
  f.floaters = f.floaters.filter((fl) => (fl.t += dt) < 0.9);
}

export { hasStatus, activeStatuses, tryTag };
