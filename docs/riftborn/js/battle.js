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

// ---------------------------------------------------------------- apex phases

/*
 * An apex is not one fight, it is three or four. The bestiary has always said so
 * — "phase 1 breaks armour, phase 2 floods the arena, phase 3 exposes the core" —
 * and the real-time arena has always implemented it. The turn-based battle did
 * not, so a rift boss was a large stat block with the right number of turns in
 * it and none of the shape.
 *
 * A phase is an HP band, exactly as the arena computes it. What changes at a
 * boundary is everything that decides how the next stretch plays:
 *
 *   armour_scale        how much of what you throw actually lands
 *   catch_scale         whether it can be taken AT ALL yet — Karrahk's core is
 *                       exposed only in phase 3, so darting it early is wasted
 *   moves               it fights differently, rather than harder
 *   flat_effectiveness  Aeonrend answers the type chart with 1.0 both ways
 *   conceal             Nyxhollow puts the lights out
 *
 * weak_points and armour_scale are read by the arena out of the same table, so
 * the two combat modes cannot drift apart on what a phase means.
 */
export function apexPhaseTable(data, speciesId) {
  return data.elements.apex_phases?.[speciesId] ?? null;
}

export function phaseCount(species, data) {
  if (!species?.apex) return 1;
  const table = apexPhaseTable(data, species.id);
  return Math.max(1, table?.length ?? species.phases ?? 1);
}

/** Which phase an apex is in at this health. Identical banding to game.js. */
export function phaseAt(hp, maxHp, phases) {
  if (phases < 2) return 1;
  return Math.min(phases, 1 + Math.floor((1 - hp / maxHp) * phases));
}

/** Apply a phase's effects to the combatant. Returns the phase definition. */
function applyPhase(w, data) {
  const table = apexPhaseTable(data, w.species.id);
  const def = table?.[w.phase - 1];
  if (!def) return null;
  w.phaseLabel = def.label ?? `Phase ${w.phase}`;
  w.armour = (w.species.stats.armour_reduction ?? 0) * (def.armour_scale ?? 1);
  w.catchScale = def.catch_scale ?? 1;
  w.flatEffectiveness = Boolean(def.flat_effectiveness);
  w.conceal = Boolean(def.conceal);
  w.weakPoints = def.weak_points ?? w.species.weak_points;
  if (def.moves?.length) w.moves = def.moves;
  return def;
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
  /*
   * A resident comes into a battle in the condition it left the last one. Full
   * health is still the default — a wild monster has never been in a fight, and
   * a resident with no `hp` recorded is one from a save that predates this.
   */
  const carried = resident && typeof resident.hp === 'number'
    ? Math.max(0, Math.min(1, resident.hp)) : 1;

  return {
    heightM: specimen.heightM,
    percentile: specimen.percentile,
    speciesId: species.id,
    species,
    resident,
    wild,
    level,
    hp: Math.max(carried > 0 ? 1 : 0, Math.round(stats.maxHp * carried)),
    maxHp: stats.maxHp,
    fainted: carried <= 0,
    attack: stats.attack,
    armour: stats.armour,
    speed: stats.speed,
    moves: movesFor(species, data),
    // PP is per battle. `null` means unlimited, which only Strike is.
    pp: {},
    // Apexes only; `armWild` fills these in when the battle starts.
    phases: 1,
    phase: 1,
    phaseLabel: null,
    catchScale: 1,
    flatEffectiveness: false,
    conceal: false,
    statuses: {},          // id -> turns remaining
    restraint: 0,
    required: 0,           // set for the wild side when the battle starts
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
  /*
   * Aeonrend's phases answer the type chart with 1.0 in both directions, which
   * the bestiary calls its whole identity: "no loadout counters it". It is the
   * only thing in the game that turns the chart off, and it does it here rather
   * than by owning a special element, so nothing else has to know about it.
   */
  const eff = defender.flatEffectiveness
    ? 1
    : elementMultiplier(data.elements.effectiveness, move.element, defender.species.elements);
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
  // attackOf, not attacker.attack: `enraged` and `calmed` exist to move this.
  const ratio = Math.max(1, attackOf(attacker)) / Math.max(1, attackOf(defender));
  const power = Math.pow(ratio, rules.attack_ratio_exponent ?? 0.55);

  let raw = defender.maxHp * (rules.hp_fraction_damage ?? 0.15)
    * (move.power / 50)
    * power
    * eff * stab * roll
    * (crit ? (rules.crit_multiplier ?? 1.75) : 1)
    * (1 - defender.armour);

  /*
   * An apex's health bar is a designed fight, so a single move is held inside a
   * band of it. Relative damage means the type chart multiplies a FRACTION of
   * health, and against a dual-element apex a quadruple weakness with the
   * same-element bonus came to 0.9 of the bar in one hit — four hits to fell
   * Karrahk with the right party, against thirty-eight with the wrong one. One
   * end skips the phases the fight exists for; the other is a slog. The band
   * keeps the chart pointing the right way without letting it decide whether
   * the fight happens at all.
   *
   * Ordinary monsters are not banded. Karrahk one-shotting a Glimmerfly is the
   * correct answer to bringing a Mote to an apex, and it stays.
   */
  const band = defender.phases > 1
    ? (data.elements.apex_phase_rules?.damage_fraction_band ?? null) : null;
  if (band) {
    raw = Math.min(Math.max(raw, defender.maxHp * band[0]), defender.maxHp * band[1]);
  } else {
    /*
     * A fight between COMPARABLE monsters cannot end in one hit.
     *
     * Four terms in the formula each reach about 2x — the move's power, the
     * same-element bonus, the type chart and the attack ratio — and they
     * multiply. Measured over 60 fair matchups (same stage, same size class,
     * different element), 35% of fights ended inside two turns and the average
     * was 3.3. There is no room in three turns for a status, a swap, or any of
     * the things the battle offers.
     *
     * The cap is conditional on `outclass_ratio` rather than universal, because
     * a mismatch SHOULD end in one hit: Karrahk one-shotting a Glimmerfly is
     * the correct answer to bringing a Mote to an apex. The attack ratio is
     * already the formula's measure of who outclasses whom, so it decides.
     */
    const rules2 = data.elements.battle_rules ?? {};
    const cap = rules2.comparable_damage_cap;
    if (cap && ratio < (rules2.outclass_ratio ?? 2.5)) {
      raw = Math.min(raw, defender.maxHp * cap);
    }
  }

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
/**
 * Scale an apex to the party that actually turned up.
 *
 * The bestiary gives every apex a `party_size` — Karrahk wants 4 to 8 Wardens —
 * and the real-time arena has always read it through `apexHpScale`. The turn
 * battle read nothing at all and fought each one at its full solo numbers,
 * which measured 85-100% wins for four stage-3 parties. A raid boss you cannot
 * lose is scenery.
 *
 * Health scales with the party's share of the designed three; attack scales
 * with the square root of it, so a full party is the best call at every apex
 * without a short one being hopeless. See `apex_encounter` in elements.json for
 * why both-by-share was wrong.
 */
export function scaleApex(data, w, partySize) {
  const rules = data.elements.apex_encounter;
  if (!rules || !w.species?.apex) return w;
  const designed = rules.designed_party ?? 3;
  const share = Math.max(1, Math.min(designed, partySize || designed)) / designed;
  const atk = rules.attack_scale?.[w.species.id] ?? 1;

  w.maxHp = Math.max(1, Math.round(w.maxHp * Math.pow(share, rules.short_party_hp_exponent ?? 1)));
  w.hp = w.maxHp;
  w.attack *= atk * Math.pow(share, rules.short_party_attack_exponent ?? 0.5);
  w.apexScaled = { share, attack: atk };
  return w;
}

function armWild(data, w) {
  w.wild = true;
  w.required = restraintRequired(
    w.species,
    data.sizes.sizes.find((s) => s.id === w.species.size),
    data.ammo.restraint_required_scale ?? 1,
  );
  w.phases = phaseCount(w.species, data);
  if (w.phases > 1) {
    w.phase = 1;
    applyPhase(w, data);
  }
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
  /*
   * Scale before arming: `armWild` reads health to pick the opening phase, so an
   * apex scaled afterwards would open in the wrong band.
   */
  const partySize = (opts.team ?? []).length;
  const wilds = (opts.wilds ?? [opts.wild]).filter(Boolean)
    .map((w) => armWild(data, scaleApex(data, w, partySize)));
  for (const c of [...(opts.team ?? []), ...wilds]) stockPP(c);

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
    // Field items consumed, by item id. Same contract as `spent`.
    used: {},
  };
}

/** Fill every combatant's PP from its move list. Called once, at the start. */
function stockPP(c) {
  c.pp = {};
  const carried = c.resident?.pp ?? null;
  c.moves.forEach((m, i) => {
    if (m.pp == null) { c.pp[i] = null; return; }              // Strike, always
    c.pp[i] = carried && typeof carried[i] === 'number'
      ? Math.max(0, Math.min(m.pp, carried[i])) : m.pp;
  });
}

/** The condition to write back onto a resident when the battle ends. */
export function conditionOf(c) {
  const pp = {};
  c.moves.forEach((m, i) => { if (m.pp != null) pp[i] = ppLeft(c, i); });
  return { hp: c.maxHp > 0 ? Math.max(0, c.hp) / c.maxHp : 0, pp };
}

/** Can this move be used right now? Strike always can. */
export const ppLeft = (c, i) => (c?.pp?.[i] === null ? Infinity : (c?.pp?.[i] ?? 0));
export const canUse = (c, i) => ppLeft(c, i) > 0;

/** Spend a point of PP for the move this combatant just used. */
function spend(c, move) {
  const i = c.moves.indexOf(move);
  if (i < 0) return;                       // Strike, or a move not on the list
  if (c.pp[i] === null || c.pp[i] === undefined) return;
  c.pp[i] = Math.max(0, c.pp[i] - 1);
}

/** Whatever this one can still do. Strike when everything else is spent. */
export function usableMoves(b, c) {
  const out = c.moves.map((m, i) => ({ move: m, index: i, pp: ppLeft(c, i) }));
  return out.filter((x) => x.pp > 0);
}

const alive = (b) => b.team.filter((c) => !c.fainted);
export const activeMon = (b) => b.team[b.active] ?? null;

function say(b, text, kind = 'info') {
  b.log.push({ text, kind, turn: b.turn });
  return b.log;
}

// ---------------------------------------------------------------- the break

/**
 * Has the apex crossed into a new band this turn? If so, break to it.
 *
 * Returns true when a phase broke, which ENDS THE TURN: the apex takes no
 * further damage and does not act while it re-forms. That is the turn-based
 * reading of the arena's 1.2 seconds of invulnerability, and it exists for the
 * same reason — without it a burst carries you through two bands at once and
 * the phases become a caption on a health bar.
 */
function checkPhaseBreak(b) {
  const w = b.wild;
  if (!w || w.phases < 2 || w.hp <= 0 || b.outcome) return false;
  const want = phaseAt(w.hp, w.maxHp, w.phases);
  if (want <= w.phase) return false;

  const rules = b.data.elements.apex_phase_rules ?? {};
  // One band per turn, so a burst cannot skip a phase the fight exists to show.
  w.phase = rules.one_band_per_turn === false ? want : w.phase + 1;
  const def = applyPhase(w, b.data);

  if (rules.transition_clears_statuses !== false) {
    // It shrugs off whatever hold you had, exactly as the arena wipes Restraint.
    w.statuses = {};
  }
  say(b, `${w.species.name} breaks — ${w.phaseLabel}.`, 'phase');
  if (def?.blurb) say(b, def.blurb, 'phase');
  b.phaseBroke = true;
  return rules.transition_ends_turn !== false;
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

/** Is the apex hiding its numbers from you, and is anything you brought answering it? */
export function concealed(b) {
  const w = b.wild;
  if (!w?.conceal) return false;
  // "Countered by a Lumen carrier keeping a flare up" — so bring one.
  return !b.team.some((c) => !c.fainted && c.species.elements.includes('lumen'));
}

// ---------------------------------------------------------------- statuses

/*
 * `dot` is a share of the sufferer's MAX health per turn, not a flat number, for
 * the same reason move damage is: a flat burn is lethal to a Mote and a rounding
 * error to a Titan.
 */
const STATUS_EFFECT = {
  sedated: { speed: 0.5, label: 'sedated' },
  ensnared: { speed: 0.2, label: 'held' },
  stunned: { skip: true, label: 'stunned' },
  chilled: { speed: 0.6, label: 'chilled' },
  enraged: { attack: 1.4, label: 'enraged' },
  calmed: { attack: 0.7, label: 'calmed' },
  anchored: { speed: 0.1, label: 'anchored' },
  burning: { dot: 0.06, label: 'burning' },
  bleeding: { dot: 0.045, label: 'bleeding' },
};

const attackOf = (c) => {
  let a = c.attack;
  for (const id of Object.keys(c.statuses)) a *= STATUS_EFFECT[id]?.attack ?? 1;
  return a;
};

export function applyStatus(c, id, turns) {
  c.statuses[id] = Math.max(c.statuses[id] ?? 0, turns);
}

/**
 * Burning and bleeding, applied at the end of a turn.
 *
 * The order here is the whole of it, and it is written this way because the
 * arena got it wrong once: a burn that clamped its target to a minimum of 1 HP
 * ABOVE the death check made every killing shot undo itself, and culls fell from
 * 85% to 27% before anyone worked out why. Damage first, then the death check,
 * and nothing clamps.
 */
function tickDamage(b) {
  const bite = (c, who, onDeath) => {
    if (!c || c.fainted || c.hp <= 0) return;
    let total = 0;
    for (const id of Object.keys(c.statuses)) {
      const dot = STATUS_EFFECT[id]?.dot;
      if (dot) total += c.maxHp * dot;
    }
    if (total <= 0) return;
    const dealt = Math.max(1, Math.round(total));
    c.hp = Math.max(0, c.hp - dealt);
    c.flash = 0.7;
    say(b, `${who} takes ${dealt} from ${Object.keys(c.statuses)
      .filter((id) => STATUS_EFFECT[id]?.dot).join(' and ')}.`, 'weak');
    if (c.hp <= 0) onDeath();
  };

  bite(b.wild, b.wild.species.name, () => {
    b.wild.fainted = true;
    say(b, `${b.wild.species.name} is down.`, 'good');
    resolveMember(b, 'defeated');
  });
  if (b.outcome) return;

  for (const c of b.team) {
    if (c.fainted) continue;
    bite(c, c.species.name, () => {
      c.fainted = true;
      say(b, `${c.species.name} is down.`, 'bad');
      if (!alive(b).length) { b.outcome = 'wiped'; say(b, 'You have nothing left to send out.', 'bad'); }
      else if (c === activeMon(b)) {
        const next = b.team.findIndex((x) => !x.fainted);
        b.active = next;
        say(b, `You send out ${b.team[next].species.name}.`, 'info');
      }
    });
    if (b.outcome) return;
  }
}

function tickStatuses(c) {
  for (const id of Object.keys(c.statuses)) {
    c.statuses[id] -= 1;
    if (c.statuses[id] <= 0) delete c.statuses[id];
  }
}

/**
 * Does a slowed monster lose its turn outright?
 *
 * Speed was read in exactly one line of this engine — the turn order — and both
 * sides act every turn regardless, so a status that only slowed its target was
 * worth nearly nothing. Four of the nine (`ensnared`, `anchored`, `sedated`,
 * `chilled`) did nothing else, which made four of the new status moves a wasted
 * turn by construction. A speed penalty now costs the turn itself, in
 * proportion: held is 40%, anchored 45%, sedated 25%, chilled 20%.
 */
function heldStill(b, c) {
  let factor = 1;
  for (const id of Object.keys(c.statuses)) factor *= STATUS_EFFECT[id]?.speed ?? 1;
  if (factor >= 1) return false;
  return b.rng() < (1 - factor) * (b.rules.hold_scale ?? 0.5);
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
function restraintValue(b, ammo, { hp, statuses }) {
  const wild = b.wild;
  const sizeDef = b.data.sizes.sizes.find((s) => s.id === wild.species.size);
  return (ammo.restraint_multiplier ?? 1)
    * elementMultiplier(b.data.elements.effectiveness, ammo.element, wild.species.elements)
    * statusProduct(b.data.ammo.statuses, statuses, b.data.ammo.status_product_cap)
    * woundMultiplier(hp, wild.maxHp, b.data.ammo.wound_multiplier_exponent ?? 1)
    * (ammo.bonus_vs?.some((e) => wild.species.elements.includes(e)) ? ammo.bonus_multiplier : 1)
    / sizeDef.size_resistance;
}

/**
 * An area round reaches the ones still waiting.
 *
 * `aoe_radius_m` has been on the Snare Grenade since phase 2 and the arena has
 * always honoured it — `splashIfNeeded` in game.js catches every monster inside
 * six metres, and a check called "one area snare catches the cluster" defends
 * it. The turn battle read none of it: the catch branch touched `b.wild` and
 * nothing else, so the Lattice Launcher's whole identity, and the multi-capture
 * item the phase 3 roadmap still lists as unbuilt, quietly did nothing in the
 * mode that is now the game.
 *
 * A pack is a queue here rather than a crowd, so "everything nearby" becomes
 * "everything still queued". That makes an area round a SETUP round: it costs
 * the turn like any other, it rolls to catch the one in front as usual, and the
 * two behind step up already ensnared. Which is what firing a grenade into a
 * cluster ought to buy you.
 */
function splashQueue(b, ammo) {
  if (!ammo.aoe_radius_m || !ammo.applies) return;
  const turns = b.rules.status_turns ?? 4;
  let caught = 0;
  for (let i = b.index + 1; i < b.wilds.length; i++) {
    const other = b.wilds[i];
    if (!other || other.fainted) continue;
    applyStatus(other, ammo.applies, turns);
    caught += 1;
  }
  if (caught) {
    say(b, `The burst catches ${caught} more — ${ammo.applies}.`, 'good');
  }
}

export function catchChance(b, ammo) {
  const wild = b.wild;
  const value = restraintValue(b, ammo, {
    hp: wild.hp, statuses: Object.keys(wild.statuses),
  });

  /*
   * An apex's chance is DESIGNED per phase, not derived.
   *
   * The Restraint maths is built for a monster you could plausibly carry home. A
   * Titan with 1100 base Restraint is not that: the derived chance against
   * Karrahk is 0.04%, which the 0.02 floor rounds up to 2% — so every phase read
   * exactly the same and the phase gate did nothing at all.
   *
   * `catch_chance` on the phase is the chance at the ideal moment: nearly dead,
   * every status the rounds can apply, the best dart. The actual roll is that
   * ceiling scaled by how close this shot is to ideal — a RATIO of the same
   * Restraint value, so the arbitrary constants cancel and softening, sedating
   * and picking the right round all still matter. Karrahk's core is exposed in
   * phase 3 and nowhere else, so a dart in phase 1 is a round thrown away. That
   * is the mechanic, not a punishment.
   */
  const phaseDef = wild.phases > 1
    ? apexPhaseTable(b.data, wild.species.id)?.[wild.phase - 1] : null;
  if (phaseDef) {
    const ceiling = phaseDef.catch_chance ?? 0;
    if (ceiling <= 0) return { chance: 0, value, ceiling, sealed: true };
    const ideal = restraintValue(b, ammo, {
      hp: 0, statuses: Object.keys(b.data.ammo.statuses ?? {}),
    });
    const closeness = ideal > 0 ? Math.min(1, value / ideal) : 0;
    return { chance: ceiling * closeness, value, ceiling, closeness };
  }

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
  if (heldStill(b, attacker)) {
    say(b, `${who} cannot get free, and loses the turn.`, 'bad');
    return;
  }
  if (b.rng() > (move.accuracy ?? 1)) {
    say(b, `${who} used ${move.name} — it missed.`, 'miss');
    return;
  }

  /*
   * A move that applies something rather than doing damage. Before this, the
   * only thing in the game that could inflict a status was a capture round, so
   * every one of the nine statuses the data defines was unreachable from the
   * FIGHT menu — and the menu was two damage moves that a "pick the biggest
   * number" policy solved on 83% of turns.
   */
  if (move.applies || move.applies_self) {
    const turns = b.rules.status_turns ?? 4;
    if (move.applies_self) {
      applyStatus(attacker, move.applies_self, turns);
      say(b, `${who} used ${move.name}. ${who} is ${STATUS_EFFECT[move.applies_self]?.label ?? move.applies_self}.`, 'good');
    }
    if (move.applies) {
      applyStatus(defender, move.applies, turns);
      defender.flash = 0.6;
      say(b, `${who} used ${move.name}. ${defender.species.name} is `
           + `${STATUS_EFFECT[move.applies]?.label ?? move.applies}.`, 'good');
    }
    if (!move.power) return;
  }

  if (!move.power) return;
  const res = computeMoveDamage(attacker, defender, move, b.data, b.rng);
  defender.hp = Math.max(0, defender.hp - res.damage);
  defender.flash = 1;
  say(b, `${who} used ${move.name}.${res.crit ? ' A critical hit!' : ''}`
       + `${res.note ? ` It was ${res.note}.` : ''} −${res.damage}`,
      res.effectiveness > 1.4 ? 'good' : res.effectiveness < 0.7 ? 'weak' : 'hit');
}

/*
 * The wild monster's move for THIS TURN, chosen once and remembered.
 *
 * It used to be recomputed on every call, and `takeTurn` calls it twice — once
 * to compare priorities and once to actually act. The scoring has a random
 * factor, so the move the turn order was decided against was frequently not the
 * move that got used: a quick move could lose a race to a heavy one it should
 * have beaten. Choosing once fixes the race and makes PP spending honest.
 */
function chooseWildMove(b) {
  if (b.wildChoice) return b.wildChoice;
  b.wildChoice = wildMove(b);
  return b.wildChoice;
}

function wildMove(b) {
  const w = b.wild;
  // The wild monster favours whatever hurts the current defender most, with a
  // little noise so it is not perfectly predictable.
  const defender = b.wardenOnly ? { species: { elements: [] }, armour: 0 } : activeMon(b);
  const scored = w.moves.map((m, i) => {
    if (!canUse(w, i)) return { m, i, score: -1 };
    const eff = elementMultiplier(b.data.elements.effectiveness, m.element, defender.species?.elements ?? []);
    /*
     * A status move is worth something, but only once — a second Coldshock on an
     * already-chilled target is a wasted turn, and an AI that cannot see that
     * would spend the whole fight reapplying it.
     */
    let score = m.power * eff * (m.accuracy ?? 1);
    if (m.applies || m.applies_self) {
      const already = m.applies ? defender.statuses?.[m.applies] : w.statuses?.[m.applies_self];
      score = already ? 0 : 45 * (m.accuracy ?? 1);
    }
    return { m, i, score: score * (0.8 + b.rng() * 0.4) };
  }).filter((x) => x.score >= 0);
  if (!scored.length) return { ...(b.data.elements.universal_moves?.[0] ?? w.moves[0]) };
  return scored.sort((x, y) => y.score - x.score)[0].m;
}

function wildTurn(b) {
  const w = b.wild;
  if (w.fainted || b.outcome) return;
  const move = chooseWildMove(b);
  spend(w, move);

  if (b.wardenOnly) {
    if (w.statuses.stunned) { say(b, `${w.species.name} is stunned and cannot move.`, 'bad'); return; }
    if (heldStill(b, w)) { say(b, `${w.species.name} cannot get free, and loses the turn.`, 'bad'); return; }
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
  b.phaseBroke = false;
  b.wildChoice = null;

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
    splashQueue(b, ammo);
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
  } else if (action.kind === 'item') {
    /*
     * A field item costs the TURN, and that is the entire balance question.
     * The wild monster deals roughly a fifth of a bar per turn (the comparable
     * damage cap), so a salve that restores less than that is a trap nobody
     * should press, and one that restores far more makes every losing fight
     * winnable by attrition. See the FIELD=1 diagnostic in balance_sim.mjs.
     */
    const item = (b.data.ammo.field ?? []).find((f) => f.id === action.itemId);
    const target = action.index === undefined ? mine : b.team[action.index];
    if (!item || !target || !item.in_battle) {
      // The generous restores are deliberately not reachable here: measured at
      // 40%, healing mid-fight was worth +15 points and the dumbest policy won.
      say(b, item && !item.in_battle ? `${item.name} is no use in the middle of this.`
        : 'Nothing to use.', 'miss');
      b.turn -= 1;
      return b.log.slice(from);
    }
    const bad = item.revives_to ? !target.fainted : target.fainted;
    if (bad) {
      say(b, item.revives_to ? `${target.species.name} is still standing.`
        : `${target.species.name} is down — that will not reach it.`, 'miss');
      b.turn -= 1;
      return b.log.slice(from);
    }

    b.used[item.id] = (b.used[item.id] ?? 0) + 1;
    say(b, `You use a ${item.name}.`, 'info');

    if (item.revives_to) {
      target.fainted = false;
      target.hp = Math.max(1, Math.round(target.maxHp * item.revives_to));
      say(b, `${target.species.name} is back on its feet.`, 'good');
    }
    if (item.restores_hp) {
      const before = target.hp;
      target.hp = Math.min(target.maxHp, target.hp + target.maxHp * item.restores_hp);
      const back = Math.round(target.hp - before);
      say(b, back > 0 ? `${target.species.name} recovers ${back}.`
        : `${target.species.name} is already whole.`, back > 0 ? 'good' : 'miss');
    }
    if (item.restores_pp) {
      let any = false;
      target.moves.forEach((m, i) => {
        if (m.pp == null || target.pp[i] == null) return;       // Strike has none
        const was = target.pp[i];
        target.pp[i] = Math.min(m.pp, was + item.restores_pp);
        if (target.pp[i] > was) any = true;
      });
      say(b, any ? `${target.species.name} has its rounds back.`
        : `${target.species.name} has nothing to restore.`, any ? 'good' : 'miss');
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
      if (checkPhaseBreak(b)) return b.log.slice(from);
      wildTurn(b);
    } else {
      let move = mine.moves[action.index] ?? mine.moves[0];
      if (!canUse(mine, action.index)) {
        // Out of PP: Strike is what is left, and it says so rather than refusing.
        move = b.data.elements.universal_moves?.[0] ?? move;
        say(b, `${mine.species.name} is out of that one — it falls back to ${move.name}.`, 'miss');
      } else {
        spend(mine, move);
      }
      const wildFirst = speedOf(w) > speedOf(mine)
        || (speedOf(w) === speedOf(mine) && b.rng() < 0.5);
      const byPriority = (move.priority ?? 0) - (chooseWildMove(b).priority ?? 0);

      // Priority beats speed, which is the whole reason a quick move exists.
      const order = byPriority > 0 ? ['mine', 'wild']
        : byPriority < 0 ? ['wild', 'mine']
        : wildFirst ? ['wild', 'mine'] : ['mine', 'wild'];

      for (const side of order) {
        if (b.outcome || b.advanced || b.phaseBroke) break;
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
          } else {
            checkPhaseBreak(b);
          }
        } else {
          wildTurn(b);
        }
      }
    }
  }

  if (!b.outcome) {
    // `b.wild` and not `w`: a member may have been resolved during this turn.
    tickDamage(b);
    if (!b.outcome) {
      tickStatuses(b.wild);
      for (const c of b.team) tickStatuses(c);
      checkFlee(b);
    }
  }
  return b.log.slice(from);
}

/** What the player can press right now, so the UI never offers a dead option. */
export function options(b) {
  const mine = activeMon(b);
  return {
    moves: b.wardenOnly ? b.warden.moves : (mine?.moves ?? []),
    pp: b.wardenOnly ? [] : (mine?.moves ?? []).map((m, i) => ppLeft(mine, i)),
    canSwap: b.team.filter((c) => !c.fainted).length > 1,
    canCatch: !b.wild.fainted,
    canRun: true,
    items: b.wardenOnly ? [] : (b.data.ammo.field ?? []).filter((f) => f.in_battle),
  };
}
