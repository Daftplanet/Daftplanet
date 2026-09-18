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

/**
 * 1.0 at full health, 3.0 at zero. The reason softening a target before darting it
 * works — and the exponent is what gives the swap timing a gradient. Linear, the
 * difference between darting at 50% and at 30% was too small to be a decision.
 */
export function woundMultiplier(hp, maxHp, exponent = 1) {
  return 1 + 2 * Math.pow(1 - Math.max(0, hp) / maxHp, exponent);
}

export function restraintRequired(species, sizeDef, scale = 1) {
  return species.stats.base_restraint * sizeDef.restraint_multiplier * (1 + 0.15 * species.stage) * scale;
}

/**
 * Decay scales with the target's health: a healthy monster shakes off sedative
 * faster than a wounded one. Without this, swapping to darts early is a strategy
 * with no failure mode.
 */
export function restraintDecayPerSecond(species, hpFraction = 1, healthScale = null) {
  const base = 4.0 + 0.35 * species.tier;
  if (!healthScale) return base;
  const { at_zero_hp: lo, at_full_hp: hi } = healthScale;
  return base * (lo + (hi - lo) * Math.max(0, Math.min(1, hpFraction)));
}

/** Filling the Restraint meter actively holds a monster in place. */
export function fleeChancePerSecond(species, restraint, required, scale = 1) {
  return species.stats.skittishness * scale * Math.max(0, 1 - restraint / required);
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

export function computeDamage({ weapon, ammo, species, hitZone, hitZones, effectiveness, ambush, ambushCfg, armourScale = 1 }) {
  const pierce = ammo.effect === 'halve_armour_reduction' ? 0.5 : 1;
  // armourScale is the apex armour break: each phase strips more of its plating.
  const armour = species.stats.armour_reduction * pierce * armourScale;
  return weapon.damage
    * (ammo.damage_multiplier ?? 1)
    * elementMultiplier(effectiveness, ammo.element, species.elements)
    * damageZoneMultiplier(weapon, hitZone, hitZones)
    * (1 - armour)
    * (ambush ? ambushCfg.damage_multiplier : 1);
}

export function computeRestraint({
  weapon, ammo, species, sizeDef, hitZone, hitZones, effectiveness,
  statusDefs, activeStatuses, statusCap, hp, maxHp, ambush, ambushCfg, woundExponent = 1,
}) {
  const bonus = ammo.bonus_vs?.some((e) => species.elements.includes(e)) ? ammo.bonus_multiplier : 1;
  return weapon.restraint
    * (ammo.restraint_multiplier ?? 1)
    * elementMultiplier(effectiveness, ammo.element, species.elements)
    * hitZones[hitZone].restraint
    * statusProduct(statusDefs, activeStatuses, statusCap)
    * woundMultiplier(hp, maxHp, woundExponent)
    * (ambush ? ambushCfg.restraint_multiplier : 1)
    * bonus
    / sizeDef.size_resistance;
}

/** Pull the one species / weapon / round the prototype needs out of the shipped data files. */
export function loadLoadout(data, { speciesId, weaponId, lethalId, captureId, mods }) {
  const species = data.monsters.monsters.find((m) => m.id === speciesId);
  const baseWeapon = data.weapons.weapons.find((w) => w.id === weaponId);
  const fitted = baseWeapon
    ? applyMods(baseWeapon, Object.values(mods ?? {}).filter(Boolean), data.weapons.mods)
    : null;
  const weapon = fitted?.weapon ?? baseWeapon;
  const lethal = data.ammo.lethal.find((a) => a.id === lethalId);
  const sizeDef = data.sizes.sizes.find((s) => s.id === species.size);

  if (!species) throw new Error(`unknown species ${speciesId}`);
  if (!baseWeapon) throw new Error(`unknown weapon ${weaponId}`);
  if (!lethal) throw new Error(`unknown lethal round ${lethalId}`);
  if (!baseWeapon.lethal_ammo.includes(lethalId)) throw new Error(`${weaponId} cannot fire ${lethalId}`);

  /*
   * A weapon may legitimately have no capture chamber — the Arcbrand Coil is
   * "pure setup. No capture round at all." Requiring one made picking it at the
   * bench reject every loadout and lock the player out of engaging anything.
   */
  const hasCapture = baseWeapon.capture_ammo.length > 0;
  const capture = hasCapture ? data.ammo.capture.find((a) => a.id === captureId) : null;
  if (hasCapture && !capture) throw new Error(`unknown capture round ${captureId}`);
  if (hasCapture && !baseWeapon.capture_ammo.includes(captureId)) {
    throw new Error(`${weaponId} cannot fire ${captureId}`);
  }

  return {
    species, weapon, sizeDef,
    baseWeapon,
    mods: mods ?? {},
    spreadScale: fitted?.spreadScale ?? 1,
    armourPierce: fitted?.armourPierce ?? 0,
    recoil: fitted?.recoil ?? 0,
    modFlags: fitted?.flags ?? {},
    ammo: { lethal, capture },
    hasCapture,
    hitZones: data.ammo.hit_zones,
    statusDefs: data.ammo.statuses,
    statusCap: data.ammo.status_product_cap,
    ambushCfg: data.ammo.ambush,
    subdueWindow: data.ammo.subdue_window_seconds,
    failedSubdue: data.ammo.failed_subdue,
    effectiveness: data.elements.effectiveness,
    // Apex phases live in elements.json so BOTH combat modes read the same
    // definition of what a phase is. See apex_phases there.
    apexPhases: data.elements.apex_phases?.[species.id] ?? null,
    chamberSwapSeconds: data.weapons.chamber_swap_seconds,
    required: restraintRequired(species, sizeDef, data.ammo.restraint_required_scale ?? 1),
    decay: restraintDecayPerSecond(species),
    decayHealthScale: data.ammo.restraint_decay_health_scale ?? null,
    fleeScale: data.ammo.flee_chance_scale ?? 1,
    woundExponent: data.ammo.wound_multiplier_exponent ?? 1,
  };
}

// ---------------------------------------------------------------- weapon mods

const NOISE_LADDER = ['silent', 'low', 'medium', 'high'];

function stepNoise(noise, step, floor = 0) {
  const i = NOISE_LADDER.indexOf(noise);
  if (i < 0) return noise;
  return NOISE_LADDER[Math.max(floor, Math.min(NOISE_LADDER.length - 1, i + step))];
}

/**
 * Apply fitted mods to a weapon.
 *
 * Numeric effects are proportional deltas on the base stat. Two of them have no
 * meaning in a top-down arena and are mapped honestly rather than faked: `zoom`
 * becomes reach, and `reveal_through_cover` does nothing because there is no cover.
 *
 * Recoil is deliberately **mod-only**: a stock weapon has none, so fitting
 * `fast_cycle` is a real trade (rate of fire for accuracy) and `stabiliser` only
 * earns its slot alongside something that generates recoil.
 *
 * A Suppressor steps a weapon TOWARDS silence but can never reach it. Without the
 * floor, fitting one to the Sting Crossbow (`low`) made it `silent`, which zeroes
 * the alert radius and hands every shot the Ambush multiplier — the Sylvan Bow's
 * whole identity, bought for one barrel slot. Only a weapon that ships silent is.
 */
export function applyMods(weapon, modIds, modTable) {
  const out = { ...weapon };
  const flags = {
    highlightWeakPoints: false,
    showRestraintNumbers: false,
    showFleeThreshold: false,
    revealHidden: false,
  };
  let spreadScale = 1;
  let armourPierce = 0;
  let recoil = 0;

  const noiseFloor = weapon.noise === 'silent' ? 0 : 1;
  const all = Object.values(modTable ?? {}).flat();
  for (const id of modIds ?? []) {
    const mod = all.find((m) => m.id === id);
    if (!mod) continue;
    for (const [key, value] of Object.entries(mod.effect ?? {})) {
      switch (key) {
        case 'range_m': out.range_m *= 1 + value; break;
        case 'rpm': out.rpm *= 1 + value; break;
        case 'magazine': out.magazine = Math.max(1, Math.round(out.magazine * (1 + value))); break;
        case 'reload_seconds': out.reload_seconds *= 1 + value; break;
        case 'restraint': out.restraint *= 1 + value; break;
        case 'damage': out.damage *= 1 + value; break;
        case 'spread': spreadScale *= 1 + value; break;
        case 'noise_step': out.noise = stepNoise(out.noise, value, noiseFloor); break;
        case 'armour_pierce': armourPierce += value; break;
        case 'recoil': recoil += value; break;
        case 'zoom': out.range_m *= 1.15; break;              // top-down: zoom reads as reach
        case 'highlight_weak_points': flags.highlightWeakPoints = true; break;
        case 'show_restraint_meter': flags.showRestraintNumbers = true; break;
        case 'show_flee_threshold': flags.showFleeThreshold = true; break;
        case 'reveal_gloom': flags.revealHidden = true; break;
        case 'reveal_through_cover': break;                   // no cover in this arena
        default: break;
      }
    }
  }

  return { weapon: out, spreadScale, armourPierce: Math.min(0.9, armourPierce), recoil: Math.max(0, recoil), flags };
}

/**
 * Whether a mod's `requires` is satisfied. The data says `research_1` and
 * `research_2`, which the bible describes as sitting "behind Codex research" —
 * so they are read as Codex progress, not a rank.
 */
export function modUnlocked(mod, codexProgress) {
  if (!mod?.requires) return true;
  // A completion reward can hand you a mod outright: 07's "all 12 families stage 1
  // — Bio-Scanner sight, permanently" outranks the research gate.
  if (codexProgress.permanent?.includes(mod.id)) return true;
  if (mod.requires === 'research_1') return (codexProgress.researchI ?? 0) >= 5;
  if (mod.requires === 'research_2') return (codexProgress.researchII ?? 0) >= 3;
  return true;
}

// ------------------------------------------------------------ specimen identity

/*
 * Every monster you meet is an individual with a measured height, and the Codex
 * keeps your largest. `07-codex-wiki.md` shows it as a record — "Largest 2.31 m
 * (98th percentile)" — and that is all it is. It changes no stat and not even the
 * drawn radius: tying it to HP or to hitbox size would silently re-open every
 * balance figure measured so far, for a number the design deliberately frames as
 * a brag rather than a mechanic.
 */

const HEIGHT_SIGMA = 0.085;          // ~±8.5% of the species mean, one standard deviation

/**
 * Where a species sits inside its size class, derived rather than authored: a
 * species' HP within its class's `hp_band` places it within the class's
 * `height_m` band. A heavier animal is a bigger animal, and no new data file is
 * needed to say so.
 */
export function speciesHeight(species, sizeDef) {
  const [hpLo, hpHi] = sizeDef.hp_band;
  const [hLo, hHi] = sizeDef.height_m;
  const t = hpHi > hpLo ? (species.stats.hp - hpLo) / (hpHi - hpLo) : 0.5;
  return hLo + Math.max(0, Math.min(1, t)) * (hHi - hLo);
}

/** Standard normal CDF, good to ~7 decimal places. Used to turn a height into a percentile. */
function normalCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-z * z / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937
          + t * (-1.821255978 + t * 1.330274429))));
  return z > 0 ? 1 - p : p;
}

/**
 * The percentile is against the *species*, not against your own catalogue. Five
 * captures should not make your third-biggest the 40th percentile.
 */
export function heightPercentile(species, sizeDef, heightM) {
  const mean = speciesHeight(species, sizeDef);
  return normalCdf((heightM / mean - 1) / HEIGHT_SIGMA);
}

/** Roll one specimen. Deterministic given `rng`, so a seeded fight reproduces exactly. */
export function rollSpecimen(species, sizeDef, rng) {
  // Box-Muller from two uniforms, clamped to the size class's own band: a Strider
  // is never taller than a Strider.
  const u = Math.max(1e-9, rng());
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
  const mean = speciesHeight(species, sizeDef);
  const [lo, hi] = sizeDef.height_m;
  const heightM = Math.max(lo, Math.min(hi, mean * (1 + z * HEIGHT_SIGMA)));
  return { heightM, percentile: heightPercentile(species, sizeDef, heightM) };
}
