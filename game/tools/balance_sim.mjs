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
import { escortAbility } from '../../docs/riftborn/js/sanctuary.js';
import { createFight, step, weakPointPositions, assistMiss, ARENA } from '../../docs/riftborn/js/game.js';
import {
  makeCombatant, createBattle, takeTurn, levelOf, wildLevel, computeMoveDamage, catchChance,
  activeMon, canUse, conditionOf,
} from '../../docs/riftborn/js/battle.js';
import { studyFromBattle, STUDY_PER_MINUTE } from '../../docs/riftborn/js/sanctuary.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, '..', '..', 'docs', 'riftborn', 'data');
const read = (n) => JSON.parse(readFileSync(join(DATA, n), 'utf8'));

const data = {
  elements: read('elements.json'), sizes: read('sizes.json'),
  weapons: read('weapons.json'), ammo: read('ammo.json'), monsters: read('monsters.json'),
};

const LOADOUT = {
  // SPECIES/WEAPON let a diagnostic point the same harness at a different fight
  // without touching the headline table, which stays Cinderfang vs Marker Pistol.
  speciesId: process.env.SPECIES ?? 'cinderfang',
  weaponId: process.env.WEAPON ?? 'marker_pistol',
  lethalId: process.env.LETHAL ?? 'ball_round',
  captureId: process.env.CAPTURE ?? 'tranq_dart',
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

  /*
   * In assisted mode there is no reticle to steer, so `onTarget` means something
   * else entirely: how well the bot reads the timing ring. `skill.ringTolerance`
   * is how close to the gold band it waits for — 0 is a metronome, 1 is someone
   * mashing the button. That is the axis assisted aim asks a player to be good on,
   * and it has to be measured separately from the axis free aim asks about.
   */
  if (f.aimMode === 'assisted') {
    /*
     * A player does not hold fire for a second to catch the band — they nudge
     * their cadence by a fraction of a beat. `syncWindow` is how long this bot is
     * willing to sit on a ready trigger to land on the beat, and it is the axis
     * assisted aim asks a player to be good on.
     *
     * Modelling skill as "waits however long it takes" was the first attempt and
     * it measured the wrong thing entirely: it made perfect timing score 7% on a
     * cull against mashing's 91%, because the bot was throwing away two thirds of
     * its rate of fire for a 2.5x multiplier.
     */
    const ready = w.cooldown <= 0 && w.mag[w.chamber] > 0;
    if (ready && memory.readySince === undefined) memory.readySince = f.t;
    if (!ready) memory.readySince = undefined;
    const waited = ready ? f.t - memory.readySince : 0;
    const onBeat = assistMiss(f) <= (skill.beatTolerance ?? 0.001);
    const sync = skill.syncWindow ?? 0;

    return {
      moveX: mx, moveY: my, aim: p.aim,
      firing: !busy && !swap && ready && (onBeat || waited >= sync),
      swap, reload,
      escort: Boolean(f.escort && f.escort.charges > 0 && f.escort.readyIn <= 0),
      tag: m.state === 'subdued',
    };
  }

  return {
    moveX: mx, moveY: my, aim,
    firing: !busy && !swap && onTarget && w.mag[w.chamber] > 0,
    swap, reload,
    // Press the charge the instant it arms. Deliberately the worst play a Warden
    // could make with it, so the numbers are a floor on the ability's value and a
    // ceiling on how well a naive player does with one.
    escort: Boolean(f.escort && f.escort.charges > 0 && f.escort.readyIn <= 0),
    tag: m.state === 'subdued',
  };
}

function runFight(seed, strat, skill, override, mods, escort, aimMode) {
  const rng = mulberry32(seed);
  const loadout = loadLoadout(data, { ...LOADOUT, mods });
  if (override) {
    loadout.species = { ...loadout.species, stats: { ...loadout.species.stats, ...override } };
  }
  const f = createFight(loadout, {
    rng,
    aimMode,
    escort: escort ? { ability: escort } : null,
    escortRules: data.elements.escort_ability_rules,
  });
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
  let time = 0, shots = 0, clean = 0, hpAt = 0, failed = 0, playerHits = 0, darts = 0;

  for (let i = 0; i < runs; i++) {
    const f = runFight(i * 7919 + 13, strat, skill, override);
    const o = f.outcome ?? 'timeout';
    out[o] = (out[o] ?? 0) + 1;
    time += f.outcomeAt; shots += f.stats.shots; failed += f.stats.failedSubdues;
    darts += f.weapon.carried.capture - (f.weapon.mag.capture + f.weapon.reserve.capture);
    playerHits += f.stats.playerHits;
    if (f.stats.cleanCapture) clean++;
    if (o === 'catalogued') hpAt += f.stats.hpFractionAtResolve;
  }
  const pct = (n) => `${((n / runs) * 100).toFixed(0)}%`.padStart(4);
  return {
    name, label: strat.label,
    row: `${name.padEnd(12)} ${pct(out.culled)} ${pct(out.catalogued)} ${pct(out.escaped)} ${pct(out.driven_off)} `
       + `${(time / runs).toFixed(1).padStart(6)}s ${(shots / runs).toFixed(1).padStart(6)} `
       + `${(darts / runs).toFixed(1).padStart(6)} ${(playerHits / runs).toFixed(1).padStart(5)} ${pct(clean)} `
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
  console.log('strategy      cull  cat  esc  down   time  shots  darts   hit  clean  HP@cat');
  console.log('-'.repeat(80));
  for (const [name, strat] of Object.entries(STRATEGIES)) {
    console.log(summarise(name, strat, runs, skill).row);
  }
  console.log();
}
console.log('cull/cat/esc/down = outcome share. darts = capture rounds burned (the expensive ones). '
          + 'hit = times the Warden was hit. clean = captures above 80% HP.');


/*
 * Sensitivity sweep on the flee dial. Cinderfang ships at skittishness 0.4, which
 * is the single number deciding how often a nearly-won fight walks away.
 */
console.log('\nFLEE SENSITIVITY — effective skittishness = species value x flee_chance_scale');
console.log('Cinderfang ships at 0.40; the table shows the effective figure.');
console.log('effective   cull:esc   panic:cat   soften_30:esc');
console.log('-'.repeat(52));
for (const skt of [0.40, 0.32, 0.26, 0.20]) {
  const over = { skittishness: skt / (data.ammo.flee_chance_scale ?? 1) };
  const skill = SKILLS[1];
  const c = summarise('cull', STRATEGIES.cull, runs, skill, over).out;
  const p = summarise('panic', STRATEGIES.panic, runs, skill, over).out;
  const s30 = summarise('soften_30', STRATEGIES.soften_30, runs, skill, over).out;
  const pc = (n, d) => `${((n / d) * 100).toFixed(0)}%`.padStart(6);
  console.log(`${skt.toFixed(2).padStart(9)}   ${pc(c.escaped, runs)}     ${pc(p.catalogued, runs)}      ${pc(s30.escaped, runs)}`);
}
console.log(`\nflee_chance_scale is currently ${data.ammo.flee_chance_scale ?? 1}, so Cinderfang plays at ${(0.4 * (data.ammo.flee_chance_scale ?? 1)).toFixed(2)}.`);


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


/*
 * MODS=1 asks the only question that matters about a weapon mod: does fitting it
 * change the fight, or is it a number on a card? Each mod is run alone.
 *
 * Fitting a mod shifts the RNG stream (a different magazine size reloads on a
 * different frame), so runs are NOT paired with the baseline — they are
 * independent samples. At the headline table's 200 runs the same strategy swings
 * 79-89% purely on the seed base, which is wider than most of the effects here;
 * MODNOISE=1 reproduces that. So this runs 800 apiece and prints the noise band,
 * and anything inside it is reported as noise rather than as a finding.
 */
if (process.env.MODNOISE) {
  // Control: how much does the headline figure move when only the seeds change?
  const skill = SKILLS[1];
  for (const base of [13, 14, 15, 16, 17]) {
    let win = 0;
    for (let i = 0; i < 200; i++) if (runFight(i * 7919 + base, STRATEGIES.cull, skill).outcome === 'culled') win++;
    console.log(`seed base ${base}: cull ${((win / 200) * 100).toFixed(0)}%`);
  }
}

if (process.env.MODS) {
  const N = 800;
  const skill = SKILLS[1];                       // average aim: mods should help the median Warden
  const cases = [['stock', undefined]];
  for (const [cat, list] of Object.entries(data.weapons.mods)) {
    for (const mod of list) cases.push([mod.id, { [cat]: mod.id }]);
  }

  console.log(`\nMOD DIAGNOSTIC — one mod at a time, Marker Pistol vs Cinderfang, average aim, ${N} runs each`);
  console.log('Seed noise at this sample size is about \u00b12pt; treat anything smaller as no effect.');
  for (const [stratName, strat] of [['cull', STRATEGIES.cull], ['soften_30', STRATEGIES.soften_30]]) {
    console.log(`\n${stratName}`);
    console.log('mod              win   esc   time   shots  darts   Δwin');
    let baseWin = null;
    for (const [name, mods] of cases) {
      const want = stratName === 'cull' ? 'culled' : 'catalogued';
      let win = 0, esc = 0, time = 0, shots = 0, darts = 0;
      for (let i = 0; i < N; i++) {
        const f = runFight(i * 7919 + 13, strat, skill, null, mods);
        if (f.outcome === want) win++;
        if (f.outcome === 'escaped') esc++;
        time += f.outcomeAt; shots += f.stats.shots;
        darts += f.weapon.carried.capture - (f.weapon.mag.capture + f.weapon.reserve.capture);
      }
      if (baseWin === null) baseWin = win / N;
      const d = win / N - baseWin;
      console.log(`${name.padEnd(15)} ${`${((win/N)*100).toFixed(0)}%`.padStart(4)} `
        + `${`${((esc/N)*100).toFixed(0)}%`.padStart(5)} ${(time/N).toFixed(1).padStart(6)}s `
        + `${(shots/N).toFixed(1).padStart(6)} ${(darts/N).toFixed(1).padStart(6)}  `
        + `${name === 'stock' ? '    —' : `${d >= 0 ? '+' : ''}${(d*100).toFixed(0)}pt`.padStart(5)}`
        + `${name !== 'stock' && Math.abs(d) < 0.025 ? '  (noise)' : ''}`);
    }
  }
}


/*
 * ESCORT=1 answers decision 1 in 09-risks-and-roadmap.md with numbers instead of
 * a leaning: does one resident with one ability per encounter change the fight,
 * and does it trivialise it?
 *
 * The bot presses it as soon as it is armed, which is the WORST case for the
 * design — a player choosing the moment will do better than this, so anything
 * that already looks strong here is too strong.
 */
if (process.env.ESCORT) {
  const N = 800;
  const skill = SKILLS[1];
  const stage = Number(process.env.STAGE ?? 1);
  const rules = data.elements.escort_ability_rules;
  const cases = [['none', null]];
  for (const [el, ability] of Object.entries(data.elements.escort_abilities)) {
    cases.push([`${el}/${ability.name}`, escortAbility({ elements: [el], stage }, data.elements.escort_abilities, rules)]);
  }

  console.log(`\nESCORT DIAGNOSTIC — one charge per encounter, stage ${stage}, average aim, ${N} runs each`);
  console.log('The bot fires the charge the instant it arms; a player picking their moment does better.');
  for (const [stratName, strat] of [['cull', STRATEGIES.cull], ['soften_30', STRATEGIES.soften_30]]) {
    console.log(`\n${stratName}`);
    // Warden HP left is the sensitive column: a defensive ability can be plainly
    // working and still move the win rate by nothing, because survival only shows
    // up in the outcome when it crosses a whole-hit boundary.
    console.log('escort              win   esc   down   time   shots  hitsTaken  HP left   Δwin');
    let baseWin = null;
    for (const [name, ability] of cases) {
      const want = stratName === 'cull' ? 'culled' : 'catalogued';
      let win = 0, esc = 0, down = 0, time = 0, shots = 0, hits = 0, hp = 0;
      for (let i = 0; i < N; i++) {
        const f = runFight(i * 7919 + 13, strat, skill, null, undefined, ability);
        if (f.outcome === want) win++;
        if (f.outcome === 'escaped') esc++;
        if (f.outcome === 'driven_off') down++;
        time += f.outcomeAt; shots += f.stats.shots; hits += f.stats.playerHits;
        hp += f.player.hp + f.player.shield;
      }
      if (baseWin === null) baseWin = win / N;
      const d = win / N - baseWin;
      console.log(`${name.padEnd(19)} ${`${((win/N)*100).toFixed(0)}%`.padStart(4)} `
        + `${`${((esc/N)*100).toFixed(0)}%`.padStart(5)} ${`${((down/N)*100).toFixed(0)}%`.padStart(6)} `
        + `${(time/N).toFixed(1).padStart(6)}s ${(shots/N).toFixed(1).padStart(6)} `
        + `${(hits/N).toFixed(2).padStart(10)} ${(hp/N).toFixed(1).padStart(7)}  `
        + `${name === 'none' ? '    —' : `${d >= 0 ? '+' : ''}${(d*100).toFixed(0)}pt`.padStart(5)}`
        + `${name !== 'none' && Math.abs(d) < 0.025 ? '  (noise)' : ''}`);
    }
  }
}

/*
 * AIM=1 answers decision 2 in 09-risks-and-roadmap.md — "is combat real-time aim
 * or tap-to-shoot?" — by running the same fights under both.
 *
 * The comparison only means something if the input quality is honest. Free aim on
 * a phone held in one hand, on the move, is not the 0.035-radian tremor of the
 * SKILLED tier; the WALKING tier below is what the roadmap means when it says
 * free aim "is miserable while walking".
 *
 * What the design needs from assisted aim is a LIFTED FLOOR AND AN INTACT
 * CEILING. If it flattens the skill gradient it has replaced the game with a
 * button, and the honest answer would be no.
 */
if (process.env.AIM) {
  const N = 600;
  const FREE = [
    { aimSigma: 0.035, targetWeakPoints: true,  label: 'steady    (both hands, sitting)' },
    { aimSigma: 0.090, targetWeakPoints: false, label: 'shaky     (one hand, standing)' },
    { aimSigma: 0.230, targetWeakPoints: false, label: 'walking   (one thumb, moving)' },
  ];
  /*
   * syncWindow is how long this bot will sit on a ready trigger waiting for the
   * band; beatTolerance is how sloppily it reads the band when it does. Mashing
   * has neither and so always fires early, which is the point.
   */
  const ASSISTED = [
    { syncWindow: 1.5, beatTolerance: 0.001, label: 'on the beat   (waits for the ring)' },
    { syncWindow: 1.5, beatTolerance: 0.30,  label: 'roughly       (near enough the ring)' },
    { syncWindow: 0.0, beatTolerance: 0.001, label: 'mashing       (trigger held, no timing)' },
  ];

  const run = (strat, skill, mode) => {
    const want = strat === STRATEGIES.cull ? 'culled' : 'catalogued';
    let win = 0, esc = 0, hits = 0, shots = 0, weak = 0, time = 0;
    for (let i = 0; i < N; i++) {
      const f = runFight(i * 7919 + 13, strat, skill, null, undefined, null, mode);
      if (f.outcome === want) win++;
      if (f.outcome === 'escaped') esc++;
      hits += f.stats.hits; shots += f.stats.shots; weak += f.stats.weakHits; time += f.outcomeAt;
    }
    return {
      win: win / N, esc: esc / N, acc: shots ? hits / shots : 0,
      weak: hits ? weak / hits : 0, time: time / N, shots: shots / N,
    };
  };

  for (const [stratName, strat] of [['cull', STRATEGIES.cull], ['soften_30', STRATEGIES.soften_30]]) {
    console.log(`\n${stratName.toUpperCase()} — free aim vs assisted, ${N} runs each`);
    console.log('input quality                          win    esc    acc   weak%   time   shots');
    const row = (label, r) => console.log(
      `${label.padEnd(38)} ${`${(r.win * 100).toFixed(0)}%`.padStart(4)} `
      + `${`${(r.esc * 100).toFixed(0)}%`.padStart(6)} ${`${(r.acc * 100).toFixed(0)}%`.padStart(6)} `
      + `${`${(r.weak * 100).toFixed(0)}%`.padStart(6)} ${r.time.toFixed(1).padStart(7)}s ${r.shots.toFixed(1).padStart(7)}`);

    console.log('  FREE AIM');
    const free = FREE.map((s) => [s, run(strat, s, 'free')]);
    for (const [s, r] of free) row(`    ${s.label}`, r);
    console.log('  ASSISTED  (lock + timing ring)');
    const assisted = ASSISTED.map((s) => [s, run(strat, s, 'assisted')]);
    for (const [s, r] of assisted) row(`    ${s.label}`, r);

    const spread = (rows) => Math.max(...rows.map(([, r]) => r.win)) - Math.min(...rows.map(([, r]) => r.win));
    console.log(`  floor: free ${(Math.min(...free.map(([, r]) => r.win)) * 100).toFixed(0)}%`
      + ` → assisted ${(Math.min(...assisted.map(([, r]) => r.win)) * 100).toFixed(0)}%`
      + `   ·   ceiling: free ${(Math.max(...free.map(([, r]) => r.win)) * 100).toFixed(0)}%`
      + ` → assisted ${(Math.max(...assisted.map(([, r]) => r.win)) * 100).toFixed(0)}%`
      + `   ·   skill spread: free ${(spread(free) * 100).toFixed(0)}pt`
      + ` → assisted ${(spread(assisted) * 100).toFixed(0)}pt`);
  }
}


/*
 * ---------------------------------------------------------------- STUDY=1
 *
 * What is a battle worth?
 *
 * Study is the evolution currency, and before the turn-based battle existed it
 * came only from habitat time (1/minute), walking (25/km) and feeding (40 for
 * three materials). Granting it for fighting is easy; granting the RIGHT amount
 * is not, and the failure modes point in both directions — too little and the
 * battle is decoration, too much and the Sanctuary's whole "this pays in three
 * weeks" identity evaporates.
 *
 * So this plays real battles through battle.js — the same module the browser
 * runs — and accumulates Study until a resident hits its evolution threshold.
 * It reports the count, which is the number that actually matters, rather than
 * dividing the threshold by a nominal per-battle figure. Those two disagree,
 * and the reason they disagree is the interesting part: the relative-level term
 * means the reward SHRINKS as the monster you are raising outgrows what you are
 * fighting, so the last stretch to a threshold is slower than the first.
 */
if (process.env.STUDY) {
  const byId = Object.fromEntries(data.monsters.monsters.map((m) => [m.id, m]));
  const N = Number(process.env.RUNS ?? 400);

  /* A bot that fights it out: best expected move, dart it once it is soft. */
  function playBattle(seed, mySpecies, myStudy, wildSpecies, rank, { capture = true } = {}) {
    const rng = mulberry32(seed);
    const resident = { uid: 'x', speciesId: mySpecies.id, study: myStudy, heightM: 1, percentile: 0.5 };
    const mine = makeCombatant(mySpecies, levelOf(resident, mySpecies), data, { resident, specimenRng: rng });
    const wild = makeCombatant(wildSpecies, wildLevel(wildSpecies, rank), data, { wild: true, specimenRng: rng });
    const b = createBattle({ data, team: [mine], wilds: [wild], rng });
    const dart = data.ammo.capture.find((a) => a.id === 'tranq_dart');

    for (let turn = 0; turn < 60 && !b.outcome; turn++) {
      const w = b.wild;
      const soft = w.hp / w.maxHp < 0.5;
      if (capture && soft && dart && catchChance(b, dart).chance > 0.3) {
        takeTurn(b, { kind: 'catch', ammoId: dart.id });
        continue;
      }
      // Best expected damage, which is what a competent player converges on.
      let best = 0, bestI = 0;
      mine.moves.forEach((m, i) => {
        const d = computeMoveDamage(mine, w, m, data, () => 0.5).damage * (m.accuracy ?? 1);
        if (d > best) { best = d; bestI = i; }
      });
      takeTurn(b, { kind: 'move', index: bestI });
    }
    if (!b.outcome) b.outcome = 'escaped';
    return b;
  }

  /** Battles from zero Study to an evolution threshold, fighting this tier. */
  function battlesToEvolve(mySpecies, wildSpecies, rank, threshold, seed0) {
    let study = 0, battles = 0, wins = 0, turns = 0;
    while (study < threshold && battles < 5000) {
      const b = playBattle(seed0 + battles * 7919, mySpecies, study, wildSpecies, rank);
      const me = b.team[0];
      let gained = 0;
      for (const r of b.results) gained += studyFromBattle(r.level, me.level, r.outcome);
      if (!b.results.length) gained += studyFromBattle(b.wild.level, me.level, b.outcome);
      study += gained;
      turns += b.turn;
      if (b.outcome === 'caught' || b.outcome === 'defeated') wins++;
      battles++;
    }
    return { battles, wins: wins / battles, turns: turns / battles, study };
  }

  const TIERS = [
    { label: 'stage 1 -> 2  (400 Study)',  mine: 'sootpup',    wild: 'sootpup',    rank: 3,  need: 400 },
    { label: 'stage 2 -> 3  (1600 Study)', mine: 'cinderfang', wild: 'cinderfang', rank: 10, need: 1600 },
  ];

  console.log(`\nSTUDY FROM BATTLE — accumulating to each evolution threshold, ${N} traces per tier`);
  console.log('tier                          battles   win%   turns/battle   Study/battle   = passive');
  for (const t of TIERS) {
    const runs = Array.from({ length: N }, (_, i) =>
      battlesToEvolve(byId[t.mine], byId[t.wild], t.rank, t.need, i * 104729 + 7));
    const avg = (f) => runs.reduce((a, r) => a + f(r), 0) / runs.length;
    const battles = avg((r) => r.battles);
    const perBattle = t.need / battles;
    const hours = perBattle / STUDY_PER_MINUTE / 60;
    console.log(`${t.label.padEnd(28)} ${battles.toFixed(1).padStart(7)} `
      + `${`${(avg((r) => r.wins) * 100).toFixed(0)}%`.padStart(6)} `
      + `${avg((r) => r.turns).toFixed(1).padStart(14)} `
      + `${perBattle.toFixed(0).padStart(14)} `
      + `${`${hours.toFixed(1)}h`.padStart(10)}`);
  }

  /*
   * The anti-grind check. Wild level scales with Warden rank, so a Mote stays a
   * Mote forever; without a relative term it would stay farmable forever too.
   */
  console.log('\nANTI-GRIND — one win against the same low-stage wild, as the raised monster grows');
  console.log('my Study    my level    wild level    Study for the win');
  for (const study of [0, 400, 1600, 3600]) {
    const sp = byId.sootpup;
    const lvl = levelOf({ study }, sp);
    const wl = wildLevel(sp, 3);
    console.log(`${String(study).padStart(8)} ${String(lvl).padStart(11)} ${String(wl).padStart(13)} `
      + `${String(studyFromBattle(wl, lvl, 'defeated')).padStart(20)}`);
  }

  console.log('\nBY ENDING — the same fight, ended five ways (level 16 wild, level 14 of mine)');
  for (const o of ['caught', 'defeated', 'escaped', 'wiped', 'fled']) {
    console.log(`  ${o.padEnd(10)} ${String(studyFromBattle(16, 14, o)).padStart(5)} Study`);
  }
}


/*
 * ---------------------------------------------------------------- MOVES=1
 *
 * Is the FIGHT menu a decision, or a button you hold?
 *
 * Four policies over the same fair matchups — same evolution stage, same size
 * class, different element, so neither side simply outclasses the other. If
 * "press the biggest number" scores what a thinking policy scores, the moves are
 * decoration and the only real choice in a battle is which monster you brought.
 *
 * That is what it measured before this section existed: two damage moves per
 * element, both the same element, so the type chart multiplied both equally and
 * cancelled — "biggest power" and "best expected damage" agreed on 83% of turns
 * and finished within 5 points of each other.
 */
if (process.env.MOVES) {
  const byId = Object.fromEntries(data.monsters.monsters.map((m) => [m.id, m]));
  const pool = data.monsters.monsters.filter((m) => !m.apex);
  const pairs = [];
  for (const a of pool) {
    for (const z of pool) {
      if (a.id === z.id || a.stage !== z.stage || a.size !== z.size) continue;
      if (a.elements[0] === z.elements[0]) continue;
      pairs.push([a.id, z.id]);
    }
  }
  const use = pairs.slice(0, Number(process.env.PAIRS ?? 60));
  const N = Number(process.env.RUNS ?? 60);

  const bestDamage = (b, mine) => {
    let bi = 0, bd = -1;
    mine.moves.forEach((mv, i) => {
      if (!canUse(mine, i)) return;
      const d = computeMoveDamage(mine, b.wild, mv, data, () => 0.5).damage * (mv.accuracy ?? 1);
      if (d > bd) { bd = d; bi = i; }
    });
    return bi;
  };

  const POLICIES = {
    'biggest power        ': (b, mine) => {
      let bi = 0, bp = -1;
      mine.moves.forEach((mv, i) => { if (canUse(mine, i) && mv.power > bp) { bp = mv.power; bi = i; } });
      return bi;
    },
    'best expected damage ': bestDamage,
    'status first         ': (b, mine) => {
      const si = mine.moves.findIndex((mv, i) => canUse(mine, i) && (mv.applies || mv.applies_self)
        && !(mv.applies ? b.wild.statuses[mv.applies] : mine.statuses[mv.applies_self]));
      return si >= 0 ? si : bestDamage(b, mine);
    },
    'random               ': (b, mine, rng) => {
      const ok = mine.moves.map((mv, i) => i).filter((i) => canUse(mine, i));
      return ok[Math.floor(rng() * ok.length)] ?? 0;
    },
  };

  console.log(`\nMOVE POLICIES — ${use.length} fair matchups x ${N} seeds each`);
  console.log('policy                  win%   turns   status turns');
  const scores = [];
  for (const [name, pick] of Object.entries(POLICIES)) {
    let win = 0, turns = 0, n = 0, statusTurns = 0;
    for (const [A, Z] of use) {
      for (let s = 0; s < N; s++) {
        const rng = mulberry32(s * 7919 + 13);
        const mine = makeCombatant(byId[A], 20, data, { resident: { study: 900 }, specimenRng: rng });
        const wild = makeCombatant(byId[Z], 20, data, { wild: true, specimenRng: rng });
        const b = createBattle({ data, team: [mine], wilds: [wild], rng });
        let g = 0;
        while (!b.outcome && g++ < 200) {
          const m = activeMon(b);
          if (!m || m.fainted) break;
          const i = pick(b, m, rng);
          if (m.moves[i]?.applies || m.moves[i]?.applies_self) statusTurns++;
          takeTurn(b, { kind: 'move', index: i });
        }
        if (b.outcome === 'defeated') win++;
        turns += b.turn; n++;
      }
    }
    scores.push(win / n);
    console.log(`${name} ${`${((win / n) * 100).toFixed(1)}%`.padStart(7)} `
      + `${(turns / n).toFixed(1).padStart(7)} ${(statusTurns / n).toFixed(2).padStart(14)}`);
  }
  const spread = (Math.max(...scores) - Math.min(...scores)) * 100;
  console.log(`\nspread best to worst: ${spread.toFixed(1)} points.`);
  console.log('If the top two rows tie, the moves are decoration and only the monster you bring matters.');
}

/*
 * ---------------------------------------------------------------- FIELD=1
 *
 * Is a mid-fight heal a decision, or a trap?
 *
 * A field item costs the turn. Both sides deal damage as a share of health and
 * the comparable-damage cap holds a fair exchange near a fifth of a bar, so a
 * salve restoring 40% nets roughly +20% — positive, but only just, and only
 * while you are still alive to spend the turn. The failure modes are symmetric
 * and both fatal: restore too little and nobody should ever press it, restore
 * too much and every losing fight becomes winnable by attrition, which turns
 * the patrol limit this whole system exists to create straight back off.
 *
 * So the question is not "does healing help" — it is whether the answer depends
 * on the situation. A heal that is right at every health level is a button you
 * hold; one that is right only when you are ahead is a decision.
 */
if (process.env.FIELD) {
  const byId = Object.fromEntries(data.monsters.monsters.map((m) => [m.id, m]));
  const pool = data.monsters.monsters.filter((m) => !m.apex && m.stage === 2);
  const pairs = [];
  for (const a of pool) {
    for (const z of pool) {
      if (a.id === z.id || a.size !== z.size || a.elements[0] === z.elements[0]) continue;
      pairs.push([a.id, z.id]);
    }
  }
  const use = pairs.slice(0, Number(process.env.PAIRS ?? 40));
  const N = Number(process.env.RUNS ?? 40);
  const ITEM = process.env.ITEM ?? 'field_salve';
  const item = { ...data.ammo.field.find((f) => f.id === ITEM) };
  // RESTORE sweeps the tuning without editing the data file.
  if (process.env.RESTORE) {
    item.restores_hp = Number(process.env.RESTORE);
    data.ammo.field = data.ammo.field.map((f) => (f.id === ITEM ? item : f));
  }

  const bestDamage = (b, mine) => {
    let bi = 0, bd = -1;
    mine.moves.forEach((mv, i) => {
      if (!canUse(mine, i)) return;
      const d = computeMoveDamage(mine, b.wild, mv, data, () => 0.5).damage * (mv.accuracy ?? 1);
      if (d > bd) { bd = d; bi = i; }
    });
    return bi;
  };
  const statusFirst = (b, mine) => {
    const si = mine.moves.findIndex((mv, i) => canUse(mine, i) && (mv.applies || mv.applies_self)
      && !(mv.applies ? b.wild.statuses[mv.applies] : mine.statuses[mv.applies_self]));
    return si >= 0 ? si : bestDamage(b, mine);
  };

  // Each policy gets the SAME number of salves, so what is measured is when you
  // press it rather than how many you were handed.
  const STOCK = Number(process.env.STOCK ?? 2);
  /*
   * Two shapes of policy, because "when do I heal" and "should I heal at all"
   * are different questions. A flat threshold measures the second; the two
   * conditional policies measure the first — if a policy that reads the
   * matchup cannot beat one that ignores it, the item is a flat bonus rather
   * than a decision, and it does not belong on a menu you press mid-fight.
   */
  const outdamaging = (b, mine) => {
    const mineDmg = computeMoveDamage(mine, b.wild, mine.moves[bestDamage(b, mine)], data, () => 0.5).damage;
    let wildDmg = 0;
    b.wild.moves.forEach((mv) => {
      const d = computeMoveDamage(b.wild, mine, mv, data, () => 0.5).damage;
      if (d > wildDmg) wildDmg = d;
    });
    return { mineDmg, wildDmg, turnsToKill: b.wild.hp / Math.max(1, mineDmg),
      turnsToDie: mine.hp / Math.max(1, wildDmg) };
  };
  const POLICIES = {
    'never heal           ': null,
    'heal below 60%       ': 0.60,
    'heal below 35%       ': 0.35,
    'heal below 20%       ': 0.20,
    'heal if hit softly   ': (b, mine) => {
      const { wildDmg } = outdamaging(b, mine);
      // Worth a turn only when the heal buys more than a turn of survival.
      return mine.hp / mine.maxHp < 0.6 && (item.restores_hp * mine.maxHp) > wildDmg * 1.2;
    },
    'heal if race is close': (b, mine) => {
      const { turnsToKill, turnsToDie } = outdamaging(b, mine);
      // A turn spent healing has to change who runs out first.
      return mine.hp / mine.maxHp < 0.6 && turnsToDie < turnsToKill && turnsToDie + 1 > turnsToKill - 1;
    },
  };

  console.log(`\nFIELD ITEMS — ${item.name}, restores ${
    Math.round((item.restores_hp ?? 0) * 100)}% · ${use.length} fair stage-2 matchups x ${N} seeds · ${STOCK} in the bag`);
  console.log('policy                  win%   turns   used   left at end');
  const rows = [];
  for (const [name, threshold] of Object.entries(POLICIES)) {
    let win = 0, turns = 0, n = 0, used = 0, hpLeft = 0;
    for (const [A, Z] of use) {
      for (let s = 0; s < N; s++) {
        const rng = mulberry32(s * 7919 + 13);
        const mine = makeCombatant(byId[A], 20, data, { resident: { study: 900 }, specimenRng: rng });
        const wild = makeCombatant(byId[Z], 20, data, { wild: true, specimenRng: rng });
        const b = createBattle({ data, team: [mine], wilds: [wild], rng });
        let stock = STOCK, g = 0;
        while (!b.outcome && g++ < 200) {
          const m = activeMon(b);
          if (!m || m.fainted) break;
          const wants = threshold === null ? false
            : typeof threshold === 'function' ? threshold(b, m) : m.hp / m.maxHp < threshold;
          if (wants && stock > 0) {
            stock -= 1;
            takeTurn(b, { kind: 'item', itemId: ITEM });
          } else {
            takeTurn(b, { kind: 'move', index: statusFirst(b, m) });
          }
        }
        if (b.outcome === 'defeated') win++;
        used += STOCK - stock;
        hpLeft += Math.max(0, mine.hp) / mine.maxHp;
        turns += b.turn; n++;
      }
    }
    rows.push([name, win / n]);
    console.log(`${name} ${`${((win / n) * 100).toFixed(1)}%`.padStart(7)} `
      + `${(turns / n).toFixed(1).padStart(7)} ${(used / n).toFixed(2).padStart(6)} `
      + `${`${((hpLeft / n) * 100).toFixed(0)}%`.padStart(13)}`);
  }
  const base = rows[0][1];
  const best = Math.max(...rows.slice(1).map((r) => r[1]));
  console.log(`\nbest healing policy beats never-heal by ${((best - base) * 100).toFixed(1)} points.`);
  console.log('Near zero: the item is a trap. Very large: the patrol limit is off, and attrition always wins.');
}

/*
 * --------------------------------------------------------------- PATROL=1
 *
 * How long is a patrol, and what does the field kit buy?
 *
 * A patrol is a party of three walking out, fighting until nobody is fit, and
 * walking back. Health and PP carry from fight to fight, so this is a real
 * limit rather than a number in a document — and it is the limit the whole
 * condition system exists to create.
 *
 * The field kit is the only thing that moves it without going home, so the
 * question is whether it extends the patrol (its job) or removes the limit
 * (which would undo the point). A patrol that runs to twice its length is the
 * design working; one that never ends is the design gone.
 *
 * The wild is drawn from ALL stage 2 species rather than one. Measured against
 * a single species this came out at 1.1 wins per patrol and a design that
 * looked far too harsh — the species happened to be a bad matchup for the party,
 * which is the fourth time on this branch a first sample has been too narrow.
 */
if (process.env.PATROL) {
  const byId = Object.fromEntries(data.monsters.monsters.map((m) => [m.id, m]));
  const stage2 = data.monsters.monsters.filter((m) => !m.apex && m.stage === 2);
  const partyIds = (process.env.PARTY ?? 'cinderfang,brinelet,sporelet').split(',');
  const N = Number(process.env.RUNS ?? 300);
  const salve = data.ammo.field.find((f) => f.id === 'field_salve');
  const deep = data.ammo.field.find((f) => f.id === 'deep_salve');

  const bestDamage = (b, mine) => {
    let bi = 0, bd = -1;
    mine.moves.forEach((mv, i) => {
      if (!canUse(mine, i)) return;
      const d = computeMoveDamage(mine, b.wild, mv, data, () => 0.5).damage * (mv.accuracy ?? 1);
      if (d > bd) { bd = d; bi = i; }
    });
    return bi;
  };
  const statusFirst = (b, mine) => {
    const si = mine.moves.findIndex((mv, i) => canUse(mine, i) && (mv.applies || mv.applies_self)
      && !(mv.applies ? b.wild.statuses[mv.applies] : mine.statuses[mv.applies_self]));
    return si >= 0 ? si : bestDamage(b, mine);
  };

  // A patrol: fight until every member is down, carrying condition between fights.
  const patrol = (seed, { salves = 0, deeps = 0 }) => {
    const rng = mulberry32(seed);
    // The party as resident records — the same shape profile.js keeps.
    const party = partyIds.map(() => ({ hp: 1, pp: null }));
    let battles = 0, won = 0, usedSalve = 0, usedDeep = 0;

    for (let guard = 0; guard < 40; guard++) {
      // Between fights: patch up whoever is worst, if there is anything to use.
      while (deeps > 0) {
        const down = party.find((r) => r.hp <= 0);
        const hurt = down ?? party.filter((r) => r.hp < 0.5).sort((a, z) => a.hp - z.hp)[0];
        if (!hurt) break;
        hurt.hp = Math.min(1, (hurt.hp <= 0 ? 0 : hurt.hp) + deep.restores_hp);
        deeps -= 1; usedDeep += 1;
      }
      const fit = party.map((r, i) => [r, i]).filter(([r]) => r.hp > 0);
      if (!fit.length) break;

      const team = fit.map(([r, i]) => makeCombatant(byId[partyIds[i]], 20, data,
        { resident: { study: 900, hp: r.hp, pp: r.pp }, specimenRng: rng }));
      const wildSp = stage2[Math.floor(rng() * stage2.length)];
      const wild = makeCombatant(wildSp, 20, data, { wild: true, specimenRng: rng });
      const b = createBattle({ data, team, wilds: [wild], rng });

      let stock = salves, g = 0;
      while (!b.outcome && g++ < 200) {
        // The engine sends out the next fit one itself when the lead goes down,
        // and calls the battle 'wiped' when there is nobody left, so this loop
        // only has to stop when it says so.
        const m = activeMon(b);
        if (!m || m.fainted) break;
        // Heal only when the turn changes who runs out first — the policy that
        // beat every flat threshold in FIELD=1, while spending fewer salves.
        let heal = false;
        if (stock > 0 && m.hp / m.maxHp < 0.6) {
          const mineDmg = computeMoveDamage(m, b.wild, m.moves[bestDamage(b, m)], data, () => 0.5).damage;
          let wildDmg = 0;
          b.wild.moves.forEach((mv) => {
            const d = computeMoveDamage(b.wild, m, mv, data, () => 0.5).damage;
            if (d > wildDmg) wildDmg = d;
          });
          const toKill = b.wild.hp / Math.max(1, mineDmg);
          const toDie = m.hp / Math.max(1, wildDmg);
          heal = toDie < toKill && toDie + 1 > toKill - 1;
        }
        if (heal) { stock -= 1; usedSalve += 1; takeTurn(b, { kind: 'item', itemId: 'field_salve' }); }
        else takeTurn(b, { kind: 'move', index: statusFirst(b, m) });
      }
      battles += 1;
      if (b.outcome === 'defeated' || b.outcome === 'caught') won += 1;
      // Condition goes home with them, which is what makes this a patrol.
      fit.forEach(([r], k) => { const c = conditionOf(team[k]); r.hp = c.hp; r.pp = c.pp; });
    }
    return { battles, won, usedSalve, usedDeep };
  };

  const KITS = {
    'nothing              ': { salves: 0, deeps: 0 },
    '2 field salves       ': { salves: 2, deeps: 0 },
    '1 deep salve         ': { salves: 0, deeps: 1 },
    '2 salves + 2 deep    ': { salves: 2, deeps: 2 },
  };
  console.log(`\nPATROL LENGTH — party of ${partyIds.length} vs ${stage2.length} stage-2 species, ${N} patrols each`);
  console.log('field kit               battles   won    win%   items used');
  let base = 0;
  for (const [name, kit] of Object.entries(KITS)) {
    let battles = 0, won = 0, items = 0;
    for (let i = 0; i < N; i++) {
      const r = patrol(i * 7919 + 13, kit);
      battles += r.battles; won += r.won; items += r.usedSalve + r.usedDeep;
    }
    if (!base) base = battles / N;
    console.log(`${name} ${(battles / N).toFixed(1).padStart(7)} ${(won / N).toFixed(1).padStart(6)} `
      + `${`${((won / battles) * 100).toFixed(0)}%`.padStart(7)} ${(items / N).toFixed(2).padStart(12)}`);
  }
  console.log('\nA patrol should get LONGER with a kit, not endless. If the bottom row runs away');
  console.log('from the top one, the field kit has cancelled the limit the whole system exists to create.');
}
