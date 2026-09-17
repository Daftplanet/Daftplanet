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
