/*
 * RIFTBORN phase 0 — headless balance sim.
 *
 * Drives docs/riftborn/js/game.js (the same code the browser runs) with scripted
 * players, so the tuning claims in the design bible can be checked instead of
 * asserted. Run:
 *
 *   node game/tools/balance_sim.mjs [runs]
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { loadLoadout } from '../../docs/riftborn/js/rules.js';
import { createFight, step, weakPointPositions, ARENA } from '../../docs/riftborn/js/game.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, '..', '..', 'docs', 'riftborn', 'data');
const read = (n) => JSON.parse(readFileSync(join(DATA, n), 'utf8'));

const data = {
  elements: read('elements.json'), sizes: read('sizes.json'),
  weapons: read('weapons.json'), ammo: read('ammo.json'), monsters: read('monsters.json'),
};

const LOADOUT = {
  speciesId: 'cinderfang', weaponId: 'marker_pistol',
  lethalId: 'ball_round', captureId: 'tranq_dart',
};

/** Deterministic RNG so a surprising run can be reproduced from its seed. */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const gauss = (rng) => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());

/*
 * Bot players. Each is a policy over the fight state; `aimSigma` stands in for
 * hand steadiness (radians of angular error per shot).
 */
const STRATEGIES = {
  cull: {
    label: 'Cull only (lethal from the start)',
    chamberFor: () => 'lethal',
  },
  pure_dart: {
    label: 'Clean capture (darts from the start)',
    chamberFor: () => 'capture',
  },
  soften_30: {
    label: 'Soften to 30% HP, then dart',
    chamberFor: (f) => (f.monster.hp / f.monster.maxHp > 0.30 ? 'lethal' : 'capture'),
  },
  soften_50: {
    label: 'Soften to 50% HP, then dart',
    chamberFor: (f) => (f.monster.hp / f.monster.maxHp > 0.50 ? 'lethal' : 'capture'),
  },
  panic: {
    label: 'Lethal until it bolts, then dart',
    chamberFor: (f) => (f.monster.state === 'flee' || f.monster.hp / f.monster.maxHp <= 0.25 ? 'capture' : 'lethal'),
  },
};

/*
 * A human-ish bot. Real players do not snap to a target: they see the world a
 * beat late and their crosshair slews. Without those two constraints the sim is
 * an aimbot benchmark and every weak point is a guaranteed hit.
 */
const REACTION_SECONDS = 0.18;
const TURN_RATE = 5.5;            // radians/second the crosshair can travel

function botIntent(f, strat, rng, skill, memory) {
  const m = f.monster;
  const p = f.player;

  // What the bot can actually see: the fight as it was REACTION_SECONDS ago.
  memory.push({ t: f.t, x: m.x, y: m.y, facing: m.facing, state: m.state, hp: m.hp });
  while (memory.length > 2 && f.t - memory[0].t > REACTION_SECONDS) memory.shift();
  const seen = memory[0];

  const want = strat.chamberFor({ ...f, monster: { ...m, hp: seen.hp, state: seen.state } });

  // Aim at the perceived target, leading it, then slew towards that angle.
  const speed = f.weapon.chamber === 'lethal' ? 950 : 760;
  let tx = seen.x, ty = seen.y;
  if (skill.targetWeakPoints) {
    const wps = Object.values(weakPointPositions({ ...m, x: seen.x, y: seen.y, facing: seen.facing }));
    if (wps.length) {
      const best = wps.reduce((a, b) => (Math.hypot(a.x - p.x, a.y - p.y) < Math.hypot(b.x - p.x, b.y - p.y) ? a : b));
      tx = best.x; ty = best.y;
    }
  }
  const recent = memory[memory.length - 1];
  const flight = Math.hypot(tx - p.x, ty - p.y) / speed;
  tx += (recent.x - seen.x) * flight * 8;
  ty += (recent.y - seen.y) * flight * 8;

  /*
   * Hand tremor has to persist. Re-rolling the error every frame let the bot hold
   * fire until a favourable sample came up, which turned "shaky aim" into "perfect
   * aim, eventually" and made both skill levels hit weak points far too often.
   * A slow random walk cannot be waited out.
   */
  memory.bias = (memory.bias ?? 0) * 0.94 + gauss(rng) * skill.aimSigma * 0.34;
  const desired = Math.atan2(ty - p.y, tx - p.x) + memory.bias;
  let delta = ((desired - p.aim + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  const maxTurn = TURN_RATE * (1 / 60);
  const aim = p.aim + Math.max(-maxTurn, Math.min(maxTurn, delta));
  const onTarget = Math.abs(delta) < 0.06;

  // Movement reacts to the perceived state, so a telegraph read late gets clipped.
  const ang = Math.atan2(seen.y - p.y, seen.x - p.x);
  const d = Math.hypot(seen.x - p.x, seen.y - p.y);
  let mx = 0, my = 0;
  if (seen.state === 'windup' || seen.state === 'lunge') {
    mx = Math.cos(ang + Math.PI / 2); my = Math.sin(ang + Math.PI / 2);
  } else if (d < 150) { mx = -Math.cos(ang); my = -Math.sin(ang); }
  else if (d > 260) { mx = Math.cos(ang); my = Math.sin(ang); }
  if (p.x < 60) mx += 1; if (p.x > ARENA.w - 60) mx -= 1;
  if (p.y < 60) my += 1; if (p.y > ARENA.h - 60) my -= 1;

  const w = f.weapon;
  const busy = w.swapT > 0 || w.reloadT > 0;
  const swap = !busy && w.chamber !== want;
  const reload = !busy && !swap && w.mag[w.chamber] === 0 && w.reserve[w.chamber] > 0;

  return {
    moveX: mx, moveY: my, aim,
    firing: !busy && !swap && onTarget && w.mag[w.chamber] > 0,
    swap, reload,
    tag: m.state === 'subdued',
  };
}

function runFight(seed, strat, skill, override) {
  const rng = mulberry32(seed);
  const loadout = loadLoadout(data, LOADOUT);
  if (override) {
    loadout.species = { ...loadout.species, stats: { ...loadout.species.stats, ...override } };
  }
  const f = createFight(loadout, { rng });
  const dt = 1 / 60;
  const memory = [];
  let guard = 0;

  let fleeTime = 0, fleeShots = 0;
  while (f.outcome === null && guard++ < 60 * 180) {
    const before = f.stats.shots;
    const fleeing = f.monster.state === 'flee';
    step(f, dt, botIntent(f, strat, rng, skill, memory));
    if (fleeing) { fleeTime += dt; fleeShots += f.stats.shots - before; }
  }
  f.stats.fleeTime = fleeTime;
  f.stats.fleeShots = fleeShots;
  return f;
}

function summarise(name, strat, runs, skill, override) {
  const out = { culled: 0, catalogued: 0, escaped: 0, driven_off: 0, timeout: 0 };
  let time = 0, shots = 0, clean = 0, hpAt = 0, failed = 0, playerHits = 0;

  for (let i = 0; i < runs; i++) {
    const f = runFight(i * 7919 + 13, strat, skill, override);
    const o = f.outcome ?? 'timeout';
    out[o] = (out[o] ?? 0) + 1;
    time += f.outcomeAt; shots += f.stats.shots; failed += f.stats.failedSubdues;
    playerHits += f.stats.playerHits;
    if (f.stats.cleanCapture) clean++;
    if (o === 'catalogued') hpAt += f.stats.hpFractionAtResolve;
  }
  const pct = (n) => `${((n / runs) * 100).toFixed(0)}%`.padStart(4);
  return {
    name, label: strat.label,
    row: `${name.padEnd(12)} ${pct(out.culled)} ${pct(out.catalogued)} ${pct(out.escaped)} ${pct(out.driven_off)} `
       + `${(time / runs).toFixed(1).padStart(6)}s ${(shots / runs).toFixed(1).padStart(6)} `
       + `${(playerHits / runs).toFixed(1).padStart(5)} ${pct(clean)} `
       + `${out.catalogued ? `${((hpAt / out.catalogued) * 100).toFixed(0)}%`.padStart(5) : '    —'}`,
    out,
  };
}

const runs = Number(process.argv[2] ?? 200);
const loadout = loadLoadout(data, LOADOUT);

console.log('RIFTBORN phase 0 — balance sim');
console.log(`${loadout.species.name} (${loadout.species.stats.hp} HP, armour ${loadout.species.stats.armour_reduction}) `
          + `vs ${loadout.weapon.name}`);
console.log(`Restraint required ${loadout.required.toFixed(1)}, decay ${loadout.decay.toFixed(2)}/s, `
          + `24 ball rounds + 12 tranq darts, ${runs} runs per strategy\n`);

const SKILLS = [
  { aimSigma: 0.035, targetWeakPoints: true,  label: 'SKILLED  (steady aim, hunts weak points)' },
  { aimSigma: 0.090, targetWeakPoints: false, label: 'AVERAGE  (shaky aim, body shots)' },
];
for (const skill of SKILLS) {
  const label = skill.label;
  console.log(label);
  console.log('strategy      cull  cat  esc  down   time  shots   hit  clean  HP@cat');
  console.log('-'.repeat(74));
  for (const [name, strat] of Object.entries(STRATEGIES)) {
    console.log(summarise(name, strat, runs, skill).row);
  }
  console.log();
}
console.log('cull/cat/esc/down = outcome share. hit = times the Warden was hit. '
          + 'clean = captures above 80% HP.');


/*
 * Sensitivity sweep on the flee dial. Cinderfang ships at skittishness 0.4, which
 * is the single number deciding how often a nearly-won fight walks away.
 */
console.log('\nFLEE SENSITIVITY — how often the monster gets away, by skittishness');
console.log('skittishness   cull:esc   panic:cat   soften_30:esc');
console.log('-'.repeat(52));
for (const skt of [0.40, 0.30, 0.20, 0.10]) {
  const over = { skittishness: skt };
  const skill = SKILLS[1];
  const c = summarise('cull', STRATEGIES.cull, runs, skill, over).out;
  const p = summarise('panic', STRATEGIES.panic, runs, skill, over).out;
  const s30 = summarise('soften_30', STRATEGIES.soften_30, runs, skill, over).out;
  const pc = (n, d) => `${((n / d) * 100).toFixed(0)}%`.padStart(6);
  console.log(`${skt.toFixed(2).padStart(9)}   ${pc(c.escaped, runs)}     ${pc(p.catalogued, runs)}      ${pc(s30.escaped, runs)}`);
}
console.log('\nCinderfang ships at 0.40. Lower values make a nearly-won fight less likely to walk away.');


/*
 * PROBE=1 adds a focused experiment: holding aim steadiness constant and varying
 * only whether the bot hunts weak points. Kept because it is how the "weak points
 * are a liability on a fleeing target" finding was established.
 */
if (process.env.DART) {
  console.log('\nZONE DIAGNOSTIC — what share of hits land on a weak point');
  for (const skill of SKILLS) {
    for (const [name, strat] of [['pure_dart', STRATEGIES.pure_dart], ['cull', STRATEGIES.cull]]) {
      let weak = 0, hits = 0;
      const outs = {};
      for (let i = 0; i < 80; i++) {
        const f = runFight(i * 7919 + 13, strat, skill);
        outs[f.outcome] = (outs[f.outcome] ?? 0) + 1;
        weak += f.stats.weakHits; hits += f.stats.hits;
      }
      console.log(`${skill.label.split(' ')[0].padEnd(8)} ${name.padEnd(10)} weak share ${`${((weak/hits)*100).toFixed(0)}%`.padStart(5)}   ${JSON.stringify(outs)}`);
    }
  }
}

if (process.env.PROBE) {
  console.log('\nPROBE — does weak-point chasing cost you fleeing targets?');
  console.log('aim sigma   weak points   cull:esc   hit rate   shots/sec   chase sh/sec');
  for (const sigma of [0.035, 0.090]) {
    for (const weak of [true, false]) {
      let esc = 0, hits = 0, shots = 0, time = 0, ft = 0, fs = 0;
      for (let i = 0; i < runs; i++) {
        const f = runFight(i * 7919 + 13, STRATEGIES.cull, { aimSigma: sigma, targetWeakPoints: weak });
        if (f.outcome === 'escaped') esc++;
        hits += f.stats.hits; shots += f.stats.shots; time += f.outcomeAt;
        ft += f.stats.fleeTime; fs += f.stats.fleeShots;
      }
      console.log(`${sigma.toFixed(3).padStart(9)}   ${String(weak).padStart(11)}   ${`${((esc/runs)*100).toFixed(0)}%`.padStart(8)}   ${`${((hits/shots)*100).toFixed(0)}%`.padStart(8)}   ${(shots/time).toFixed(2).padStart(9)}   ${(ft ? fs/ft : 0).toFixed(2).padStart(12)}`);
    }
  }
}
