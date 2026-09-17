/*
 * RIFTBORN — turn-based battle.
 *
 * Your Sanctuary residents fight; the weapons became the capture step. That is
 * the shape the whole game was already pointing at — you raise monsters, so the
 * monsters should be what you bring — and it lets four phases of balance work
 * carry over rather than being thrown away:
 *
 *   - the element chart in elements.json is the type chart;
 *   - `restraintRequired`, `woundMultiplier` and the status multipliers from
 *     ammo.json become the catch roll, so a wounded sedated target is still
 *     easier to take and softening still beats leading with darts;
 *   - `skittishness` is still what decides whether it bolts.
 *
 * DOM-free, like rules.js and game.js before it, so a headless sim can play
 * thousands of battles and the browser plays exactly the same ones.
 *
 * Every action returns a list of log lines. The UI renders the log; it never
 * computes an outcome, which is what keeps the two from disagreeing.
 */

import {
  elementMultiplier, restraintRequired, woundMultiplier, statusProduct, rollSpecimen,
} from './rules.js';

// ---------------------------------------------------------------- combatants

/**
 * A monster's level, derived rather than stored. Study is what the Sanctuary
 * already accrues, so a resident you have raised for a week fights better than
 * one caught this morning without needing a second progression track.
 */
export function levelOf(resident, species) {
  const fromStudy = Math.floor(Math.sqrt(Math.max(0, resident?.study ?? 0)) / 2);
  const fromStage = ((species?.stage ?? 1) - 1) * 6;
  return Math.max(1, Math.min(60, 4 + fromStudy + fromStage));
}

/** Wild monsters scale to how far along the Warden is, within the species' means. */
export function wildLevel(species, rank) {
  const base = 3 + ((species.stage ?? 1) - 1) * 6;
  return Math.max(1, Math.min(60, base + Math.floor(rank * 0.7)));
}

function statsFor(species, level, rules) {
  const k = 1 + (level - 1) * (rules.level_scale_per_stage ?? 0.55) * 0.08;
  return {
    maxHp: Math.round(species.stats.hp * 0.55 * k),
    attack: species.stats.attack * k,
    armour: species.stats.armour_reduction,
    speed: species.stats.speed,
  };
}

/** The moves a species knows: the universal one, plus its elements' pair. */
export function movesFor(species, data) {
  const out = [...(data.elements.universal_moves ?? [])];
  for (const el of species.elements ?? []) {
    for (const m of data.elements.element_moves?.[el] ?? []) out.push(m);
  }
  return out;
}

export function makeCombatant(species, level, data, { resident = null, wild = false, specimenRng = Math.random } = {}) {
  const rules = data.elements.battle_rules;
  const stats = statsFor(species, level, rules);
  // A wild monster is still an individual with a measured height — the Codex
  // records that, and losing it when combat changed would have been a quiet
  // regression in a system two commits old.
  const sizeDef = data.sizes.sizes.find((s) => s.id === species.size);
  const specimen = resident
    ? { heightM: resident.heightM ?? null, percentile: resident.percentile ?? null }
    : rollSpecimen(species, sizeDef, specimenRng);
  return {
    heightM: specimen.heightM,
    percentile: specimen.percentile,
    speciesId: species.id,
    species,
    resident,
    wild,
    level,
    hp: stats.maxHp,
    maxHp: stats.maxHp,
    attack: stats.attack,
    armour: stats.armour,
    speed: stats.speed,
    moves: movesFor(species, data),
    statuses: {},          // id -> turns remaining
    restraint: 0,
    required: 0,           // set for the wild side when the battle starts
    fainted: false,
    // Was this one ever on the field? Only participants earn Study.
    participated: false,
    // For a pack member: the ending it reached, once it has reached one.
    resolved: null,
    flash: 0,
  };
}

// ---------------------------------------------------------------- damage

/**
 * One move's damage. Deliberately the same shape as the shooter's
 * `computeDamage`: base × element chart × same-element bonus × armour, then a
 * roll. Anyone who has read the old formula can read this one.
 */
export function computeMoveDamage(attacker, defender, move, data, rng = Math.random) {
  const rules = data.elements.battle_rules;
  const eff = elementMultiplier(data.elements.effectiveness, move.element, defender.species.elements);
  const stab = move.element && attacker.species.elements.includes(move.element)
    ? (rules.stab_multiplier ?? 1.5) : 1;
  const crit = rng() < (rules.crit_chance ?? 0.0625);
  const [lo, hi] = rules.damage_roll ?? [0.85, 1];
  const roll = lo + rng() * (hi - lo);

  /*
   * Damage is a FRACTION OF THE DEFENDER'S HEALTH, not an absolute number, and
   * that is the most important line here. It went through two wrong versions to
   * get there and both are worth keeping written down.
   *
   * Version one multiplied a flat base by the attacker's raw attack stat. A
   * Mote's attack of 10 against a Strider's 34 is a 3.4x swing, which buried the
   * 2x type chart underneath it: Tide-on-Ember measured 8 damage while
   * Ember-on-Tide measured 11, so "super effective" hit for LESS than "not very
   * effective" and the headline mechanic of the whole game was invisible.
   *
   * Version two fixed that by compressing attack to ^0.55. The type chart came
   * back — and a scaling bug came with it, because health did not get the same
   * treatment. Health grows with level, size class and evolution stage; damage
   * now grew with the 0.55 power of one of those. Measured across the bestiary,
   * a same-species fight took 6 turns at stage 1, 14 at stage 2 and a median of
   * 41 at stage 3. A mirror match against Karrahk took ONE HUNDRED AND EIGHTEEN
   * TURNS. Nobody is tapping a button 118 times, so the apexes — the fights the
   * whole rift system exists to deliver — were unplayable, and the headline
   * numbers looked fine because everything anyone had played was stage 1.
   *
   * Version three is this one: a move takes a share of what it is hitting, so
   * turns-to-kill is the same whether the target is a Mote or a Titan. The
   * attacker's advantage is the RATIO of the two attack stats, still compressed
   * so the type chart stays the loudest term: measured, a super-effective move
   * takes 47% of the target's health where a resisted one takes 22%, so the
   * chart is worth 2.1x and is plainly visible in the bar.
   *
   * Measured across all 43 species, a same-species best-move fight is now 7
   * turns at stage 1, 7 at stage 2 and 8 at stage 3, with the whole bestiary
   * inside 12. The extremes stay extreme, which is the point: Karrahk one-shots
   * a Glimmerfly, and a Glimmerfly needs 44 turns to fell a Karrahk — it will be
   * dead long before, and that is the correct answer to bringing a Mote to an
   * apex rather than a number to tune away.
   */
  const ratio = Math.max(1, attacker.attack) / Math.max(1, defender.attack);
  const power = Math.pow(ratio, rules.attack_ratio_exponent ?? 0.55);

  const raw = defender.maxHp * (rules.hp_fraction_damage ?? 0.15)
    * (move.power / 50)
    * power
    * eff * stab * roll
    * (crit ? (rules.crit_multiplier ?? 1.75) : 1)
    * (1 - defender.armour);

  return {
    damage: Math.max(1, Math.round(raw)),
    effectiveness: eff,
    crit,
    // A move the defender resists or is weak to should say so, and the caller
    // should not have to work it out from the number.
    note: eff > 1.4 ? 'super effective' : eff < 0.7 ? 'not very effective' : eff === 0 ? 'no effect' : null,
  };
}

// ---------------------------------------------------------------- the battle

/**
 * Arm one wild combatant: its Restraint requirement is a property of the
 * individual, so every member of a pack gets its own.
 */
function armWild(data, w) {
  w.wild = true;
  w.required = restraintRequired(
    w.species,
    data.sizes.sizes.find((s) => s.id === w.species.size),
    data.ammo.restraint_required_scale ?? 1,
  );
  return w;
}

export function createBattle(opts) {
  const { data, rng = Math.random } = opts;
  const rules = data.elements.battle_rules;

  /*
   * A pack is a QUEUE, not a crowd. Phase 3 spawns packs of up to four and the
   * first turn-based build simply ignored `packSize` — it fought one member and
   * then resolved the whole spawn, which quietly deleted a phase of work and
   * made the engage card ("Sparkmite x3") a lie.
   *
   * One at a time is also the only reading that keeps the rest of the engine
   * honest: Restraint, the catch roll and the flee check are all written about
   * an individual. What makes a pack hard is that YOUR side does not heal
   * between members, so the third one meets whatever the first two left of you.
   */
  const wilds = (opts.wilds ?? [opts.wild]).filter(Boolean).map((w) => armWild(data, w));

  return {
    data, rng, rules,
    team: opts.team ?? [],
    active: 0,
    wilds,
    index: 0,
    wild: wilds[0],
    /*
     * One entry per member that reached an ending, in the shape the arena's
     * `fight.results` already uses, so a pack can end as two culls and a capture
     * down either combat path and the Codex cannot tell which one you played.
     */
    results: [],
    /*
     * The Warden fights alongside an empty bench. At rank 1 nobody has a monster
     * yet, and a game that refuses to start until you have caught something you
     * cannot fight is not a game.
     */
    wardenOnly: (opts.team ?? []).length === 0,
    /*
     * The Warden's own damage comes from the equipped weapon, which is what
     * `uses_weapon` in the move data has always meant. Before this it was a flat
     * number, and the opening battle — the one you fight before you own a single
     * monster — was unwinnable: 12 turns to lose with the wild monster on 2 HP.
     */
    warden: {
      hp: 100, maxHp: 100,
      moves: data.elements.warden_moves ?? [],
      weapon: opts.weapon ?? null,
    },
    turn: 0,
    log: [],
    // The verdict for the ENCOUNTER. Per-member endings live in `results`.
    outcome: null,          // null | 'caught' | 'defeated' | 'fled' | 'wiped' | 'escaped'
    caughtWith: null,
    lastCatch: null,
    // Rounds actually fired, by ammo id. The caller spends these whether or not
    // the capture landed — a dart that bounces is still a dart you no longer have.
    spent: {},
  };
}

const alive = (b) => b.team.filter((c) => !c.fainted);
export const activeMon = (b) => b.team[b.active] ?? null;

function say(b, text, kind = 'info') {
  b.log.push({ text, kind, turn: b.turn });
  return b.log;
}

// ---------------------------------------------------------------- the queue

/** The verdict for the whole encounter, read off what happened to each member. */
function encounterVerdict(b) {
  if (b.results.some((r) => r.outcome === 'caught')) return 'caught';
  if (b.results.some((r) => r.outcome === 'defeated')) return 'defeated';
  return 'escaped';
}

/**
 * One member of the pack reached an ending. Record it, and either send up the
 * next one or call the encounter.
 *
 * Returns true when the encounter is over, so callers know whether to stop.
 */
function resolveMember(b, outcome) {
  const w = b.wild;
  w.resolved = outcome;
  b.results.push({
    speciesId: w.speciesId,
    outcome,
    level: w.level,
    // The arena's "clean capture" rule, unchanged: subdued above 80% health.
    clean: outcome === 'caught' && w.hp / w.maxHp > 0.8,
    hpFraction: w.hp / w.maxHp,
    heightM: w.heightM,
    percentile: w.percentile,
    caughtWith: outcome === 'caught' ? b.caughtWith : null,
  });

  const left = b.wilds.length - b.index - 1;
  if (left > 0) {
    b.index += 1;
    b.wild = b.wilds[b.index];
    /*
     * The replacement does not act on the turn it arrives. Without this the
     * order loop would run on past the member you just downed and let a fresh,
     * full-health monster hit you in the same turn — a pack of three would get
     * three free attacks purely from the shape of the loop.
     */
    b.advanced = true;
    say(b, `Another ${b.wild.species.name} steps up — ${left} left.`, 'info');
    return false;
  }

  b.outcome = encounterVerdict(b);
  return true;
}

/** How many of the pack are still to be dealt with, the current one included. */
export const remaining = (b) => Math.max(0, b.wilds.length - b.results.length);

// ---------------------------------------------------------------- statuses

const STATUS_EFFECT = {
  sedated: { speed: 0.5, label: 'sedated' },
  ensnared: { speed: 0.2, label: 'held' },
  stunned: { skip: true, label: 'stunned' },
  chilled: { speed: 0.6, label: 'chilled' },
  enraged: { attack: 1.4, label: 'enraged' },
  calmed: { attack: 0.7, label: 'calmed' },
  anchored: { speed: 0.1, label: 'anchored' },
};

export function applyStatus(c, id, turns) {
  c.statuses[id] = Math.max(c.statuses[id] ?? 0, turns);
}

function tickStatuses(c) {
  for (const id of Object.keys(c.statuses)) {
    c.statuses[id] -= 1;
    if (c.statuses[id] <= 0) delete c.statuses[id];
  }
}

const speedOf = (c) => {
  let s = c.speed;
  for (const id of Object.keys(c.statuses)) s *= STATUS_EFFECT[id]?.speed ?? 1;
  return s;
};

// ---------------------------------------------------------------- the catch

/**
 * The chance a capture round takes this monster, reusing the shooter's Restraint
 * maths wholesale.
 *
 * Restraint is no longer a bar you fill in real time; it is the roll. A dart's
 * contribution is scaled by how wounded the target is (the wound multiplier),
 * by its statuses, and by its size resistance — exactly the terms the real-time
 * fight used — and the result is compared against the same
 * `restraint_required_scale` the bestiary is balanced on.
 */
export function catchChance(b, ammo) {
  const wild = b.wild;
  const sizeDef = b.data.sizes.sizes.find((s) => s.id === wild.species.size);
  const statuses = Object.keys(wild.statuses);

  const value = (ammo.restraint_multiplier ?? 1)
    * elementMultiplier(b.data.elements.effectiveness, ammo.element, wild.species.elements)
    * statusProduct(b.data.ammo.statuses, statuses, b.data.ammo.status_product_cap)
    * woundMultiplier(wild.hp, wild.maxHp, b.data.ammo.wound_multiplier_exponent ?? 1)
    * (ammo.bonus_vs?.some((e) => wild.species.elements.includes(e)) ? ammo.bonus_multiplier : 1)
    / sizeDef.size_resistance;

  // 40 is the reference: one tranq dart into a healthy mid-size target. Anything
  // above it is the softening, sedating and element matching paying off.
  const chance = Math.max(0.02, Math.min(0.95, (value * 40) / wild.required));
  return { chance, value };
}

// ---------------------------------------------------------------- turns

function attack(b, attacker, defender, move, who) {
  if (attacker.statuses?.stunned) {
    say(b, `${who} is stunned and cannot move.`, 'bad');
    return;
  }
  if (b.rng() > (move.accuracy ?? 1)) {
    say(b, `${who} used ${move.name} — it missed.`, 'miss');
    return;
  }
  const res = computeMoveDamage(attacker, defender, move, b.data, b.rng);
  defender.hp = Math.max(0, defender.hp - res.damage);
  defender.flash = 1;
  say(b, `${who} used ${move.name}.${res.crit ? ' A critical hit!' : ''}`
       + `${res.note ? ` It was ${res.note}.` : ''} −${res.damage}`,
      res.effectiveness > 1.4 ? 'good' : res.effectiveness < 0.7 ? 'weak' : 'hit');
}

function wildMove(b) {
  const w = b.wild;
  // The wild monster favours whatever hurts the current defender most, with a
  // little noise so it is not perfectly predictable.
  const defender = b.wardenOnly ? { species: { elements: [] }, armour: 0 } : activeMon(b);
  const scored = w.moves.map((m) => {
    const eff = elementMultiplier(b.data.elements.effectiveness, m.element, defender.species?.elements ?? []);
    return { m, score: m.power * eff * (m.accuracy ?? 1) * (0.8 + b.rng() * 0.4) };
  });
  return scored.sort((x, y) => y.score - x.score)[0].m;
}

function wildTurn(b) {
  const w = b.wild;
  if (w.fainted || b.outcome) return;
  const move = wildMove(b);

  if (b.wardenOnly) {
    if (w.statuses.stunned) { say(b, `${w.species.name} is stunned and cannot move.`, 'bad'); return; }
    if (b.rng() > (move.accuracy ?? 1)) { say(b, `${w.species.name} used ${move.name} — it missed.`, 'miss'); return; }
    const dmg = Math.max(1, Math.round((move.power / 50) * (w.attack / 30) * 12));
    b.warden.hp = Math.max(0, b.warden.hp - dmg);
    say(b, `${w.species.name} used ${move.name}. −${dmg}`, 'hit');
    if (b.warden.hp <= 0) { b.outcome = 'wiped'; say(b, 'You are driven off.', 'bad'); }
    return;
  }

  const mine = activeMon(b);
  attack(b, w, mine, move, w.species.name);
  if (mine.hp <= 0) {
    mine.fainted = true;
    say(b, `${mine.species.name} is down.`, 'bad');
    if (!alive(b).length) { b.outcome = 'wiped'; say(b, 'You have nothing left to send out.', 'bad'); }
    else {
      const next = b.team.findIndex((c) => !c.fainted);
      b.active = next;
      say(b, `You send out ${b.team[next].species.name}.`, 'info');
    }
  }
}

/** Does the wild monster bolt this turn? Same skittishness the shooter used. */
function checkFlee(b) {
  const w = b.wild;
  if (b.outcome || w.fainted) return;
  if (Object.keys(w.statuses).some((s) => ['ensnared', 'anchored', 'calmed'].includes(s))) return;
  const hurt = 1 - w.hp / w.maxHp;
  const chance = w.species.stats.skittishness * 0.12 * (hurt > (w.species.stats.flee_threshold ?? 0.25) ? 0 : 1);
  if (hurt < 1 - (w.species.stats.flee_threshold ?? 0.25)) return;   // only when wounded past its threshold
  if (b.rng() < w.species.stats.skittishness * 0.18) {
    say(b, `${w.species.name} broke away.`, 'bad');
    resolveMember(b, 'escaped');
  }
  void chance;
}

/**
 * Take one turn. `action` is what the player chose:
 *   { kind: 'move', index }  { kind: 'catch', ammoId }
 *   { kind: 'swap', index }  { kind: 'run' }
 *
 * Returns the log entries this turn produced, so the UI can play them in order.
 */
export function takeTurn(b, action) {
  if (b.outcome) return [];
  const from = b.log.length;
  b.turn += 1;
  b.advanced = false;

  const mine = activeMon(b);
  const w = b.wild;

  /*
   * Participation is recorded here and nowhere else: whoever is on the field
   * when a turn is taken has been in the fight, and that is what earns Study.
   * A monster that never leaves the bench learns nothing, so bringing a weak
   * one in to share the lesson costs the turn it takes to swap it in.
   */
  if (mine && !b.wardenOnly) mine.participated = true;

  // Swapping and catching happen before the wild monster acts; a move races it.
  if (action.kind === 'swap') {
    const target = b.team[action.index];
    if (target && !target.fainted && action.index !== b.active) {
      b.active = action.index;
      say(b, `You send out ${target.species.name}.`, 'info');
      wildTurn(b);
    } else {
      say(b, 'That one cannot go out.', 'miss');
      b.turn -= 1;
    }
  } else if (action.kind === 'catch') {
    const ammo = b.data.ammo.capture.find((a) => a.id === action.ammoId);
    if (!ammo) { say(b, 'No such round.', 'miss'); b.turn -= 1; return b.log.slice(from); }

    const { chance } = catchChance(b, ammo);
    b.lastCatch = chance;
    b.spent[ammo.id] = (b.spent[ammo.id] ?? 0) + 1;
    say(b, `You fire a ${ammo.name}.`, 'info');
    if (b.rng() < chance) {
      b.caughtWith = ammo.id;
      say(b, `${b.wild.species.name} is caught!`, 'good');
      resolveMember(b, 'caught');
      // Caught or not, the turn is over — the next one up does not get a free hit.
      return b.log.slice(from);
    }
    // A failed capture still does something: the sedative lands even when the
    // shot does not take, which is what makes a second dart better than the first.
    if (ammo.applies) {
      applyStatus(w, ammo.applies, b.rules.status_turns ?? 4);
      say(b, `It shakes free, but the round takes hold — ${ammo.applies}.`, 'weak');
    } else {
      say(b, 'It shakes free.', 'weak');
    }
    wildTurn(b);
  } else if (action.kind === 'run') {
    const odds = b.rules.flee_base ?? 0.35;
    if (b.rng() < odds + 0.3) {
      b.outcome = 'fled';
      say(b, 'You back away.', 'info');
      return b.log.slice(from);
    }
    say(b, 'You cannot break off yet.', 'miss');
    wildTurn(b);
  } else if (action.kind === 'move') {
    if (b.wardenOnly) {
      const move = b.warden.moves[action.index] ?? b.warden.moves[0];
      if (b.rng() > (move.accuracy ?? 1)) say(b, `You fire — it goes wide.`, 'miss');
      else {
        const gun = b.warden.weapon?.damage ?? 18;
        const dmg = Math.max(1, Math.round((move.power / 50) * (gun * 0.75) * (1 - w.armour)));
        w.hp = Math.max(0, w.hp - dmg);
        w.flash = 1;
        say(b, `You use ${move.name}. −${dmg}`, 'hit');
      }
      if (w.hp <= 0) {
        w.fainted = true;
        say(b, `${w.species.name} is down.`, 'good');
        resolveMember(b, 'defeated');
        return b.log.slice(from);
      }
      wildTurn(b);
    } else {
      const move = mine.moves[action.index] ?? mine.moves[0];
      const wildFirst = speedOf(w) > speedOf(mine)
        || (speedOf(w) === speedOf(mine) && b.rng() < 0.5);
      const byPriority = (move.priority ?? 0) - (wildMove(b).priority ?? 0);

      // Priority beats speed, which is the whole reason a quick move exists.
      const order = byPriority > 0 ? ['mine', 'wild']
        : byPriority < 0 ? ['wild', 'mine']
        : wildFirst ? ['wild', 'mine'] : ['mine', 'wild'];

      for (const side of order) {
        if (b.outcome || b.advanced) break;
        if (side === 'mine') {
          if (mine.fainted) continue;
          // `b.wild` can change under this loop, so read it fresh rather than
          // reusing the `w` captured at the top of the turn.
          const target = b.wild;
          attack(b, mine, target, move, mine.species.name);
          if (target.hp <= 0) {
            target.fainted = true;
            say(b, `${target.species.name} is down.`, 'good');
            resolveMember(b, 'defeated');
          }
        } else {
          wildTurn(b);
        }
      }
    }
  }

  if (!b.outcome) {
    // `b.wild` and not `w`: a member may have been resolved during this turn.
    tickStatuses(b.wild);
    for (const c of b.team) tickStatuses(c);
    checkFlee(b);
  }
  return b.log.slice(from);
}

/** What the player can press right now, so the UI never offers a dead option. */
export function options(b) {
  const mine = activeMon(b);
  return {
    moves: b.wardenOnly ? b.warden.moves : (mine?.moves ?? []),
    canSwap: b.team.filter((c) => !c.fainted).length > 1,
    canCatch: !b.wild.fainted,
    canRun: true,
  };
}
