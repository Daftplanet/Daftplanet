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
   * The attack term is COMPRESSED, and that is the most important line here.
   *
   * Raw, a Mote's attack of 10 against a Strider's 34 is a 3.4x swing, which
   * quietly buried the 2x type chart underneath it: Tide-on-Ember measured 8
   * damage while Ember-on-Tide measured 11, so "super effective" hit for less
   * than "not very effective" and the headline mechanic of the whole game was
   * invisible. An exponent of 0.55 keeps a bigger monster meaningfully stronger
   * while leaving the type chart the loudest term in the formula.
   */
  const power = Math.pow(Math.max(1, attacker.attack) / 30, 0.55);

  const raw = (rules.base_damage ?? 12)
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

export function createBattle(opts) {
  const { data, rng = Math.random } = opts;
  const rules = data.elements.battle_rules;

  const wild = opts.wild;
  wild.wild = true;
  wild.required = restraintRequired(
    wild.species,
    data.sizes.sizes.find((s) => s.id === wild.species.size),
    data.ammo.restraint_required_scale ?? 1,
  );

  return {
    data, rng, rules,
    team: opts.team ?? [],
    active: 0,
    wild,
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
    b.outcome = 'escaped';
    say(b, `${w.species.name} broke away.`, 'bad');
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

  const mine = activeMon(b);
  const w = b.wild;

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
      b.outcome = 'caught';
      b.caughtWith = ammo.id;
      say(b, `${w.species.name} is caught!`, 'good');
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
      if (w.hp <= 0) { w.fainted = true; b.outcome = 'defeated'; say(b, `${w.species.name} is down.`, 'good'); return b.log.slice(from); }
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
        if (b.outcome) break;
        if (side === 'mine') {
          if (mine.fainted) continue;
          attack(b, mine, w, move, mine.species.name);
          if (w.hp <= 0) {
            w.fainted = true;
            b.outcome = 'defeated';
            say(b, `${w.species.name} is down.`, 'good');
          }
        } else {
          wildTurn(b);
        }
      }
    }
  }

  if (!b.outcome) {
    tickStatuses(w);
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
