/*
 * RIFTBORN — combat rules.
 *
 * Pure maths, no DOM and no globals, so the browser prototype and the headless
 * balance sim (game/tools/balance_sim.mjs) run the exact same numbers. Every
 * function takes its data in; nothing here reaches for state.
 *
 * Formulas mirror game/data/ammo.json -> formulas.
 */

/** Damage/restraint multiplier from the type chart. Dual-element defenders multiply both columns. */
export function elementMultiplier(effectiveness, attackerElement, defenderElements) {
  if (!attackerElement) return 1;
  const row = effectiveness[attackerElement];
  if (!row) return 1;
  return defenderElements.reduce((m, d) => m * (row[d] ?? 1), 1);
}

/** 1.0 at full health, 3.0 at zero. The reason softening a target before darting it works. */
export function woundMultiplier(hp, maxHp) {
  return 1 + 2 * (1 - Math.max(0, hp) / maxHp);
}

export function restraintRequired(species, sizeDef, scale = 1) {
  return species.stats.base_restraint * sizeDef.restraint_multiplier * (1 + 0.15 * species.stage) * scale;
}

export function restraintDecayPerSecond(species) {
  return 4.0 + 0.35 * species.tier;
}

/** Filling the Restraint meter actively holds a monster in place. */
export function fleeChancePerSecond(species, restraint, required) {
  return species.stats.skittishness * Math.max(0, 1 - restraint / required);
}

/** Product of every active status' restraint multiplier, capped. */
export function statusProduct(statusDefs, activeIds, cap) {
  let p = 1;
  for (const id of activeIds) p *= statusDefs[id]?.restraint_multiplier ?? 1;
  return Math.min(p, cap);
}

/**
 * A weak point hit uses the weapon's own crit_multiplier; hit_zones.weak_point.damage
 * is only the fallback for weapons that don't define one.
 */
function damageZoneMultiplier(weapon, hitZone, hitZones) {
  if (hitZone === 'weak_point') return weapon.crit_multiplier ?? hitZones.weak_point.damage;
  return hitZones[hitZone].damage;
}

export function computeDamage({ weapon, ammo, species, hitZone, hitZones, effectiveness, ambush, ambushCfg }) {
  const pierce = ammo.effect === 'halve_armour_reduction' ? 0.5 : 1;
  const armour = species.stats.armour_reduction * pierce;
  return weapon.damage
    * (ammo.damage_multiplier ?? 1)
    * elementMultiplier(effectiveness, ammo.element, species.elements)
    * damageZoneMultiplier(weapon, hitZone, hitZones)
    * (1 - armour)
    * (ambush ? ambushCfg.damage_multiplier : 1);
}

export function computeRestraint({
  weapon, ammo, species, sizeDef, hitZone, hitZones, effectiveness,
  statusDefs, activeStatuses, statusCap, hp, maxHp, ambush, ambushCfg,
}) {
  const bonus = ammo.bonus_vs?.some((e) => species.elements.includes(e)) ? ammo.bonus_multiplier : 1;
  return weapon.restraint
    * (ammo.restraint_multiplier ?? 1)
    * elementMultiplier(effectiveness, ammo.element, species.elements)
    * hitZones[hitZone].restraint
    * statusProduct(statusDefs, activeStatuses, statusCap)
    * woundMultiplier(hp, maxHp)
    * (ambush ? ambushCfg.restraint_multiplier : 1)
    * bonus
    / sizeDef.size_resistance;
}

/** Pull the one species / weapon / round the prototype needs out of the shipped data files. */
export function loadLoadout(data, { speciesId, weaponId, lethalId, captureId }) {
  const species = data.monsters.monsters.find((m) => m.id === speciesId);
  const weapon = data.weapons.weapons.find((w) => w.id === weaponId);
  const lethal = data.ammo.lethal.find((a) => a.id === lethalId);
  const capture = data.ammo.capture.find((a) => a.id === captureId);
  const sizeDef = data.sizes.sizes.find((s) => s.id === species.size);

  if (!species) throw new Error(`unknown species ${speciesId}`);
  if (!weapon) throw new Error(`unknown weapon ${weaponId}`);
  if (!lethal || !capture) throw new Error('unknown ammo');
  if (!weapon.lethal_ammo.includes(lethalId)) throw new Error(`${weaponId} cannot fire ${lethalId}`);
  if (!weapon.capture_ammo.includes(captureId)) throw new Error(`${weaponId} cannot fire ${captureId}`);

  return {
    species, weapon, sizeDef,
    ammo: { lethal, capture },
    hitZones: data.ammo.hit_zones,
    statusDefs: data.ammo.statuses,
    statusCap: data.ammo.status_product_cap,
    ambushCfg: data.ammo.ambush,
    subdueWindow: data.ammo.subdue_window_seconds,
    failedSubdue: data.ammo.failed_subdue,
    effectiveness: data.elements.effectiveness,
    chamberSwapSeconds: data.weapons.chamber_swap_seconds,
    required: restraintRequired(species, sizeDef, data.ammo.restraint_required_scale ?? 1),
    decay: restraintDecayPerSecond(species),
  };
}
