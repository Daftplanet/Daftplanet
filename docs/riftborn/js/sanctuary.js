/*
 * RIFTBORN phase 2 — Sanctuary rules.
 *
 * Pure functions over a profile's residents. Only catalogued monsters live here,
 * and only residents evolve — which is the whole reason the capture mechanic
 * exists. Culling pays today; this pays in three weeks.
 */

export const STUDY_PER_MINUTE = 1.0;
export const HABITAT_AFFINITY_BONUS = 0.25;
export const STUDY_PER_KM_WALKED = 25;

/** Feeding: materials for a Study burst, doubled when the element matches. */
export const FEED_COST = 3;
export const FEED_STUDY = 40;

/*
 * ---------------------------------------------------------------- study by fighting
 *
 * Study used to accrue three ways, all of them passive: habitat time, walking,
 * and feeding. None of them involved the monster doing anything. Once the
 * turn-based battle became the default that was a hole you could drive a bus
 * through — your monsters got stronger by SITTING IN THEIR PEN while the thing
 * you spend the whole game doing taught them nothing at all.
 *
 * The rates below are calibrated against the two evolution thresholds the
 * bestiary actually uses (400 Study for stage 1->2, 1600 for stage 2->3) with
 * one requirement: an evolution should cost about the same NUMBER OF BATTLES at
 * both tiers, because that count is what a player actually feels. It is the "at
 * both tiers" that picks the shape of the formula.
 *
 * The obvious formula — level x a stage bonus — fails that test. Level already
 * carries stage (wildLevel adds six per stage), so a stage bonus counts it
 * twice and makes the HARDER evolution the cheaper one. Dropping it and letting
 * level do the work lands, measured over 120 accumulation traces per tier with
 * STUDY=1 in balance_sim:
 *
 *     stage 1 -> 2 (400 Study):   29.8 battles, 97% won, 5.2 turns each
 *     stage 2 -> 3 (1600 Study):  33.3 battles, 70% won, 7.8 turns each
 *
 * (Re-measured after STUDY=1's bot was fixed. It had picked purely on damage,
 * which stopped being competent play the moment the wild AI got status moves —
 * it was reporting tier 2 at 57 battles and 26% won, a fifty-point collapse that
 * was entirely the harness being outplayed by the monsters it was farming. See
 * part 10 of 13-phase3-findings.md.)
 *
 * Thirty battles, not the seventeen this comment claimed before anyone ran it.
 * The arithmetic was not wrong so much as naive: dividing a threshold by a
 * nominal per-battle figure ignores that the reward SHRINKS as the monster you
 * are raising outgrows what you are fighting, so the last stretch to a
 * threshold is much slower than the first. Only accumulating it shows that.
 *
 * Against the passive channel, one battle is worth about 13 minutes of habitat
 * time at tier 1 and 52 at tier 2, while taking two or three minutes to play.
 * Per minute spent, active play beats idling by roughly five to one.
 *
 * That ratio is still true and it is no longer the whole story, because it says
 * nothing about how many minutes of each you actually get. Condition now carries
 * across a patrol, so a party runs about two battles and then has to go home and
 * recover — and recovering is the passive channel running. Measured end to end
 * with PROGRESS=1, which plays patrols rather than back-to-back battles:
 *
 *     stage 1 -> 2:  26.0 battles over 7 patrols,  4.4h  — 51% battle / 49% passive
 *     stage 2 -> 3:  38.3 battles over 15 patrols, 8.3h  — 77% battle / 23% passive
 *
 * So half of a player's FIRST evolution still comes from time passing. That is
 * not what the paragraph above implies, and it is worth knowing before anyone
 * quotes the five-to-one figure as though it described the game.
 *
 * It is left alone deliberately. The obvious fix — a hurt monster studies at
 * `hp` of the usual rate, which targets exactly the window the patrol limit
 * creates — does restore active dominance to 73/27 at tier 1. It also takes the
 * first evolution from 26.0 battles to 44.5 and from 4.4 hours to 7.5, which
 * buys a ratio by damaging the one milestone most likely to decide whether a
 * new player stays. The passive share already falls to 28% by tier 2 on its
 * own, because battle Study scales with wild level while idling is flat: the
 * game shifts towards active play as it goes, which is the right shape without
 * paying for it at the front.
 *
 * The relative term is the anti-grind, and it matters more here than in most
 * games: wild level scales with Warden rank, so low-stage species stay low-level
 * forever and would otherwise remain farmable at any point in the game. Beating
 * a Mote at level 24 is worth about 4 Study against an appropriate fight's 100.
 */
export const STUDY_PER_WILD_LEVEL = 5.5;

/**
 * How far the level gap can swing the reward. The floor stops high-level
 * grinding on trivial spawns; the ceiling stops a single giant-killing from
 * being unbounded — beating something six times your level is a whole
 * evolution in one fight, which is a story, and capping it there keeps it one.
 */
export const STUDY_RELATIVE_CLAMP = [0.25, 2.5];

/**
 * What each ending is worth. Winning is winning, however it ended: this game's
 * thesis is that culling and cataloguing are both legitimate, so a kill teaches
 * a monster exactly what a capture does. Losing still teaches something, and
 * deliberately teaches more than running away, because you stayed in it.
 */
export const STUDY_OUTCOME_SCALE = {
  caught: 1,
  defeated: 1,
  escaped: 0.35,   // it broke away — you did the work, it left
  wiped: 0.25,     // you lost, but you were in the fight
  fled: 0.15,      // you backed out
};

/**
 * Study one participating monster earns from one resolved opponent.
 *
 * Participation is the gate, and it is applied by the caller: a monster that
 * never left the bench learns nothing, so bringing a weak one in to share the
 * lesson costs you the turn it takes to swap. That trade is the decision.
 */
export function studyFromBattle(wildLevel, myLevel, outcome) {
  const scale = STUDY_OUTCOME_SCALE[outcome] ?? 0;
  if (!scale) return 0;
  const [lo, hi] = STUDY_RELATIVE_CLAMP;
  const relative = Math.max(lo, Math.min(hi, wildLevel / Math.max(1, myLevel)));
  return Math.round(STUDY_PER_WILD_LEVEL * wildLevel * relative * scale);
}

/** The same number expressed as habitat time, which is how the Sanctuary reads it. */
export const studyAsMinutes = (study) => study / STUDY_PER_MINUTE;

/**
 * Evolution conditions, keyed by the `condition` field in monsters.json.
 * Each returns { met, label } so the UI can explain what is still missing rather
 * than just refusing.
 */
export const CONDITIONS = {
  none: () => ({ met: true, label: 'No special condition' }),

  evolve_between_local_time: (ctx, params) => {
    const h = ctx.date.getHours();
    const [sh] = params.start.split(':').map(Number);
    const [eh] = params.end.split(':').map(Number);
    // Windows that cross midnight (22:00 -> 04:00) wrap.
    const met = sh > eh ? (h >= sh || h < eh) : (h >= sh && h < eh);
    return { met, label: `Between ${params.start} and ${params.end} local time` };
  },

  captured_with_ammo: (ctx, params, resident) => ({
    met: resident.method === params.ammo,
    label: `This specimen must have been taken with a ${ctx.ammoName(params.ammo)}`,
  }),

  evolve_during_weather: (ctx, params) => ({
    met: ctx.weather === params.weather,
    label: `During a ${params.weather.replace(/_/g, ' ')}`,
  }),

  evolve_below_temperature: (ctx, params) => ({
    met: Boolean(ctx.freezing),
    label: `While below ${params.celsius}°C`,
  }),
};

export function evaluateCondition(option, ctx, resident) {
  const fn = CONDITIONS[option.condition] ?? CONDITIONS.none;
  return fn(ctx, option.params ?? {}, resident);
}

/**
 * Everything blocking this resident from becoming `option`. Returns an empty list
 * when it is ready.
 */
export function blockers(resident, species, option, ctx) {
  const out = [];
  if (resident.study < option.study_required) {
    out.push(`${Math.ceil(option.study_required - resident.study)} more Study`);
  }
  if (ctx.rank < option.rank_required) {
    out.push(`Warden rank ${option.rank_required}`);
  }
  const cond = evaluateCondition(option, ctx, resident);
  if (!cond.met) out.push(cond.label);
  return out;
}

/** Study accrued by one resident over `minutes`, including habitat affinity. */
export function studyRate(resident, species, habitatElement) {
  const affinity = habitatElement && species.elements.includes(habitatElement);
  return STUDY_PER_MINUTE * (affinity ? 1 + HABITAT_AFFINITY_BONUS : 1);
}

/**
 * Account-wide passive bonuses from residents, by element.
 * Evolved residents count double; each element caps so a monoculture cannot run away.
 */
export function passiveBonuses(residents, speciesById, elementDefs, cap) {
  const perElement = {};
  for (const r of residents) {
    const sp = speciesById[r.speciesId];
    if (!sp) continue;
    const weight = sp.stage > 1 ? 2 : 1;
    for (const el of sp.elements) perElement[el] = (perElement[el] ?? 0) + weight;
  }

  const out = {};
  for (const def of elementDefs) {
    const count = perElement[def.id] ?? 0;
    if (!count) continue;
    const value = Math.min(cap, count * def.bonus_per_resident);
    if (def.sanctuary_bonus === 'all') {
      for (const other of elementDefs) {
        if (other.sanctuary_bonus === 'all') continue;
        out[other.sanctuary_bonus] = (out[other.sanctuary_bonus] ?? 0) + value;
      }
    } else {
      out[def.sanctuary_bonus] = (out[def.sanctuary_bonus] ?? 0) + value;
    }
  }
  return out;
}

// ---------------------------------------------------------------- the escort

/*
 * Decision 1 in 09-risks-and-roadmap.md — "Do Sanctuary residents fight alongside
 * you?" — leaned **Limited: one resident gives an active ability**, on the grounds
 * that full pet combat doubles the combat scope. This is that answer, built so it
 * can be measured rather than argued about.
 *
 * The limits are the design:
 *   - one escort at a time, chosen out of combat;
 *   - one charge per encounter, so it is a decision and never a rotation;
 *   - it never acts on its own. Nothing the escort does happens without a press.
 *
 * The ability comes from the resident's first element, so what you raise decides
 * what you can do — and its strength comes from its stage, which is the first time
 * evolving something has paid off inside a fight.
 */

/** The ability an escort brings, already scaled for its stage. Null if it has none. */
export function escortAbility(species, abilities, rules) {
  if (!species) return null;
  const base = abilities?.[species.elements[0]];
  if (!base) return null;
  const scale = rules?.stage_scale?.[Math.max(0, (species.stage ?? 1) - 1)]
    ?? rules?.stage_scale?.at(-1) ?? 1;
  /*
   * An ability scales on its magnitude. One that has no magnitude — Rootgrasp is a
   * duration, Kindle is a duration — scales on its duration instead, and at half
   * rate: a stage 3 Rootgrasp holding a target for four and a quarter seconds
   * would stop being a window and start being a stun, which is a different
   * ability. Both never applies, or Scorch would compound to 2.3x.
   *
   * Shroud and Jolt scale on nothing, because they are binary: awareness is reset
   * or it is not, the magazine is full or it is not. That is a real property of
   * those two and not an oversight — a Gloom escort is worth evolving for its
   * passive and its Study, not for a bigger Shroud.
   */
  const MAGNITUDES = ['damage_per_second', 'restraint', 'hp', 'knockback', 'armour_pierce'];
  const hasMagnitude = MAGNITUDES.some((k) => base[k] != null);
  const durationScale = hasMagnitude ? 1 : 1 + (scale - 1) / 2;

  return {
    ...base,
    scale,
    seconds: base.seconds == null ? null : base.seconds * durationScale,
    damage_per_second: base.damage_per_second == null ? null : base.damage_per_second * scale,
    restraint: base.restraint == null ? null : base.restraint * scale,
    hp: base.hp == null ? null : base.hp * scale,
    knockback: base.knockback == null ? null : base.knockback * scale,
    armour_pierce: base.armour_pierce == null ? null : Math.min(0.75, base.armour_pierce * scale),
  };
}
