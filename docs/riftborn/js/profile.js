/*
 * RIFTBORN phase 2 — Warden profile: progression, inventory, Codex, Sanctuary.
 *
 * Everything persists to localStorage. Reads and writes are wrapped because
 * storage throws in private windows and can come back empty at any time; the game
 * has to work regardless, it just forgets.
 */

import { passiveBonuses, studyRate, STUDY_PER_KM_WALKED, FEED_COST, FEED_STUDY } from './sanctuary.js';
import { speciesHeight } from './rules.js';

const KEY = 'riftborn.profile.v2';

const RANK_ANCHORS = [[1, 0], [3, 1200], [4, 2000], [6, 4500], [8, 8000], [9, 10500],
                      [12, 20000], [16, 40000], [20, 75000], [25, 150000]];

export const RANK_XP = (() => {
  const out = { 1: 0 };
  for (let i = 0; i < RANK_ANCHORS.length - 1; i++) {
    const [r0, x0] = RANK_ANCHORS[i];
    const [r1, x1] = RANK_ANCHORS[i + 1];
    for (let r = r0; r <= r1; r++) out[r] = Math.round(x0 + ((x1 - x0) * (r - r0)) / (r1 - r0));
  }
  return out;
})();

export const WEAPON_UNLOCK = {
  marker_pistol: 1, splitbore: 4, longtooth: 4, sylvan_bow: 4,
  sting_crossbow: 9, lattice_launcher: 9, arcbrand_coil: 9, tether_harpoon: 16,
};

/*
 * Ammunition is now gated on element materials, not a generic currency. Want Rune
 * Arrows? Go and hunt something Lumen. That routing is the point.
 */
export const AMMO_COST = {
  ball_round:          { essence: 2 },
  slug:                { essence: 5,  mats: { stone: 1 } },
  piercing_round:      { essence: 4,  mats: { stone: 1 } },
  incendiary:          { essence: 5,  mats: { ember: 1 } },
  cryo_round:          { essence: 5,  mats: { tide: 1 } },
  arc_cell:            { essence: 3,  mats: { volt: 1 } },
  broadhead:           { essence: 4,  mats: { verdant: 1 } },
  tranq_dart:          { essence: 8,  mats: { verdant: 2 } },
  heavy_sedative_dart: { essence: 14, mats: { verdant: 3 } },
  net_shell:           { essence: 10, mats: { gale: 2 } },
  snare_grenade:       { essence: 16, mats: { gale: 3 } },
  rune_arrow:          { essence: 14, mats: { lumen: 2, gloom: 1 } },
  lullaby_bolt:        { essence: 18, mats: { lumen: 3 } },
  anchor_tether:       { essence: 25, mats: { stone: 4, volt: 2 } },
};

export const RESEARCH_COST = { 1: 1, 2: 3, 3: 6 };

export const XP = {
  cull: (t) => 10 * t,
  catalogue: (t) => 35 * t,
  firstCatch: (t) => 150 * t,
  evolution: (stage) => 200 * stage,
  perKm: 40,
};

const HABITAT_SLOTS_BY_RANK = [[1, 3], [12, 6], [20, 9], [25, 12]];
const RESIDENT_CAP = 9;

const DEFAULT = () => ({
  version: 2,
  seed: Math.floor(Math.random() * 100000) + 1,
  xp: 0,
  essence: 160,
  materials: { ember: 6, tide: 6, verdant: 10, stone: 6, gale: 4, volt: 6, gloom: 2, lumen: 2, rift: 0 },
  researchPoints: 0,
  ammo: { ball_round: 40, tranq_dart: 14 },
  /*
   * Two weapon slots, per 02-weapons-and-ammo.md: "A Warden carries two weapons.
   * This forces a real choice: two lethal profiles, two capture profiles, or one
   * of each." The second slot stays empty until a second weapon is unlocked — at
   * rank 1 you genuinely only have the one gun.
   */
  loadout: {
    slots: [
      { weaponId: 'marker_pistol', lethalId: 'ball_round', captureId: 'tranq_dart', mods: {} },
      null,
    ],
  },
  codex: {},
  residents: [],
  habitats: [{ element: null }, { element: null }, { element: null }],
  contracts: { day: null, list: [] },
  showcase: [],
  biomesVisited: {},
  metresWalked: 0,
  xpFromWalkingKm: 0,
  lastTick: Date.now(),
  resolved: {},
  devUnlockAll: false,
  devStudyRate: 1,
  stats: { encounters: 0, culls: 0, captures: 0, escapes: 0, cleanCaptures: 0, evolutions: 0 },
});

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT();
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 2) return DEFAULT();
    const base = DEFAULT();
    const merged = { ...base, ...parsed, materials: { ...base.materials, ...(parsed.materials ?? {}) } };
    // Migrate the single-weapon loadout saved by earlier builds rather than
    // wiping someone's Warden over a shape change.
    if (merged.loadout && !Array.isArray(merged.loadout.slots)) {
      const old = merged.loadout;
      merged.loadout = {
        slots: [
          old.weaponId ? { weaponId: old.weaponId, lethalId: old.lethalId, captureId: old.captureId } : base.loadout.slots[0],
          null,
        ],
      };
    }
    // Slots saved before mods existed have no `mods` key. Give them an empty
    // one rather than letting every read guess at the shape.
    for (const sl of merged.loadout?.slots ?? []) if (sl && !sl.mods) sl.mods = {};
    return merged;
  } catch {
    return DEFAULT();
  }
}

function write(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private window: play on, forget later */ }
}

let uidCounter = 0;

/**
 * Inverse standard normal (Acklam's rational approximation, ~1e-9 absolute).
 * Used to put an evolved specimen back on the ladder at the percentile it earned.
 */
function inverseNormal(p) {
  const q = Math.min(0.999999, Math.max(0.000001, p));
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
             1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
             6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
             -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const lo = 0.02425;
  if (q < lo) {
    const s = Math.sqrt(-2 * Math.log(q));
    return (((((c[0] * s + c[1]) * s + c[2]) * s + c[3]) * s + c[4]) * s + c[5])
         / ((((d[0] * s + d[1]) * s + d[2]) * s + d[3]) * s + 1);
  }
  if (q > 1 - lo) {
    const s = Math.sqrt(-2 * Math.log(1 - q));
    return -(((((c[0] * s + c[1]) * s + c[2]) * s + c[3]) * s + c[4]) * s + c[5])
          / ((((d[0] * s + d[1]) * s + d[2]) * s + d[3]) * s + 1);
  }
  const s = q - 0.5;
  const r = s * s;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * s
       / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

export function createProfile(content) {
  const state = read();
  const listeners = new Set();
  const notify = () => { write(state); listeners.forEach((fn) => fn(state)); };
  const speciesById = content.speciesById;
  const allSpecies = content.allSpecies ?? Object.values(speciesById);
  const sizeById = content.sizeById ?? {};

  const api = {
    get state() { return state; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    save: notify,
    reset() { Object.assign(state, DEFAULT()); notify(); },

    // ---------------------------------------------------------- progression
    get rank() {
      let r = 1;
      for (const [rank, xp] of Object.entries(RANK_XP)) if (state.xp >= xp) r = Math.max(r, Number(rank));
      return r;
    },
    get nextRankAt() { return RANK_XP[this.rank + 1] ?? null; },
    get unlockedWeapons() {
      if (state.devUnlockAll) return Object.keys(WEAPON_UNLOCK);
      return Object.entries(WEAPON_UNLOCK).filter(([, r]) => r <= this.rank).map(([id]) => id);
    },
    get habitatSlots() {
      let n = 3;
      for (const [rank, slots] of HABITAT_SLOTS_BY_RANK) if (this.rank >= rank) n = slots;
      // 07-codex-wiki.md: "Family complete (3 stages) — family banner, +1 Sanctuary
      // habitat slot." The Codex pays out, not just the rank track.
      return n + this.completedFamilies.length;
    },
    get residentCap() { return RESIDENT_CAP + Math.max(0, this.habitatSlots - 3); },

    addXp(n) { state.xp += Math.round(n); notify(); },

    walk(metres, biome) {
      state.metresWalked += metres;
      if (biome) state.biomesVisited[biome] = true;
      const km = Math.floor(state.metresWalked / 1000);
      if (km > state.xpFromWalkingKm) {
        const gained = km - state.xpFromWalkingKm;
        state.xpFromWalkingKm = km;
        state.xp += XP.perKm * gained;
        // Walking is also how a resident gets out of the Sanctuary.
        for (const r of state.residents) r.study += STUDY_PER_KM_WALKED * gained;
        this.progressContracts('walk', { km: gained });
      }
    },

    /** The configured weapon slots, empty ones filtered out. */
    get slots() { return (state.loadout.slots ?? []).filter(Boolean); },
    slotAt(i) { return state.loadout.slots?.[i] ?? null; },
    setSlot(i, config) {
      state.loadout.slots = state.loadout.slots ?? [null, null];
      state.loadout.slots[i] = config;
      notify();
    },
    /** Fit or clear one mod on a slot. Passing the id already fitted takes it off. */
    setMod(i, category, modId) {
      const sl = state.loadout.slots?.[i];
      if (!sl) return;
      sl.mods = sl.mods ?? {};
      if (modId && sl.mods[category] !== modId) sl.mods[category] = modId;
      else delete sl.mods[category];
      notify();
    },
    /*
     * What a mod's `requires` is measured against. The bible puts the two gated
     * sights "behind Codex research", so they are earned by studying monsters,
     * not by rank — the one unlock in the game that a walk alone cannot buy.
     */
    get codexProgress() {
      let researchI = 0;
      let researchII = 0;
      for (const e of Object.values(state.codex)) {
        if ((e.research ?? 0) >= 1) researchI += 1;
        if ((e.research ?? 0) >= 2) researchII += 1;
      }
      return { researchI, researchII, permanent: this.permanentMods };
    },

    // ---------------------------------------------------------- inventory
    ammoCount(id) { return state.ammo[id] ?? 0; },
    spendAmmo(id, n) { state.ammo[id] = Math.max(0, (state.ammo[id] ?? 0) - n); },
    material(el) { return state.materials[el] ?? 0; },

    canCraft(id, n = 1) {
      const c = AMMO_COST[id];
      if (!c) return false;
      if (state.essence < c.essence * n) return false;
      for (const [el, amt] of Object.entries(c.mats ?? {})) {
        if ((state.materials[el] ?? 0) < amt * n) return false;
      }
      return true;
    },
    craft(id, n = 1) {
      if (!this.canCraft(id, n)) return false;
      const c = AMMO_COST[id];
      state.essence -= c.essence * n;
      for (const [el, amt] of Object.entries(c.mats ?? {})) state.materials[el] -= amt * n;
      state.ammo[id] = (state.ammo[id] ?? 0) + n;
      notify();
      return true;
    },

    // ---------------------------------------------------------- Codex
    entry(id) {
      return state.codex[id] ?? { state: 'unknown', catalogued: 0, culled: 0, research: 0, seen: 0 };
    },
    _rank(s) { return ['unknown', 'sighted', 'encountered', 'data_lost', 'catalogued', 'researched'].indexOf(s); },

    sight(id) {
      const e = { ...this.entry(id) };
      e.seen += 1;
      if (this._rank(e.state) < this._rank('sighted')) e.state = 'sighted';
      state.codex[id] = e;
    },

    recordOutcome(species, outcome, detail = {}) {
      const e = { ...this.entry(species.id) };
      const tier = species.tier;
      state.stats.encounters += 1;

      if (outcome === 'culled') {
        e.culled += 1;
        // A culled specimen still counts as measured — you had it in front of you.
        this.recordSpecimen(e, detail, 'culled');
        state.stats.culls += 1;
        if (this._rank(e.state) < this._rank('catalogued')) e.state = 'data_lost';
        state.xp += XP.cull(tier);
        state.essence += 8 * tier;
        this.grantMaterials(species, 3 * tier);        // culling is the material route
        this.progressContracts('cull', { species });
      } else if (outcome === 'catalogued') {
        const first = e.catalogued === 0;
        e.catalogued += 1;
        state.stats.captures += 1;
        if (this._rank(e.state) < this._rank('catalogued')) e.state = 'catalogued';
        if (first) {
          e.firstMethod = detail.method ?? null;
          e.firstAt = Date.now();
          state.xp += XP.firstCatch(tier);
          state.researchPoints += 5;
        } else {
          state.researchPoints += 1;
        }
        let xp = XP.catalogue(tier);
        if (detail.clean) {
          xp *= 1.5;
          state.researchPoints += 1;
          state.stats.cleanCaptures += 1;
        }
        e.bestHp = Math.max(e.bestHp ?? 0, detail.hpFraction ?? 0);
        if (detail.weaponId) e.firstWeapon = e.firstWeapon ?? detail.weaponId;
        if (detail.biome) e.lastArea = detail.biome;
        this.recordSpecimen(e, detail, 'catalogued');
        state.xp += Math.round(xp);
        state.essence += 12 * tier;
        this.grantMaterials(species, 1 * tier);
        this.admit(species, detail);
        this.progressContracts('catalogue', { species, detail });
      } else {
        if (outcome === 'escaped') state.stats.escapes += 1;
        if (this._rank(e.state) < this._rank('encountered')) e.state = 'encountered';
      }

      state.codex[species.id] = e;
      notify();
    },

    /*
     * "Largest 2.31 m (98th percentile)" from 07-codex-wiki.md. The percentile is
     * against the species, computed at roll time, so it does not drift as your own
     * catalogue grows.
     */
    recordSpecimen(entry, detail, outcome) {
      if (!(detail.heightM > 0)) return;
      const seen = entry.specimens ?? { count: 0, sumM: 0 };
      seen.count += 1;
      seen.sumM += detail.heightM;
      entry.specimens = seen;
      if (!entry.largest || detail.heightM > entry.largest.heightM) {
        entry.largest = {
          heightM: detail.heightM,
          percentile: detail.percentile ?? 0,
          at: Date.now(),
          outcome,
        };
      }
    },

    grantMaterials(species, amount) {
      const per = Math.max(1, Math.round(amount / species.elements.length));
      for (const el of species.elements) state.materials[el] = (state.materials[el] ?? 0) + per;
    },

    // ---------------------------------------------------------- completion
    /** Every family whose whole line — every stage, every branch — is catalogued. */
    get completedFamilies() {
      const byFamily = {};
      for (const sp of allSpecies) (byFamily[sp.family] ??= []).push(sp);
      return Object.entries(byFamily)
        .filter(([, list]) => list.every((sp) => this._rank(this.entry(sp.id).state) >= this._rank('catalogued')))
        .map(([family]) => family);
    },
    /** Families with at least their stage 1 catalogued — what the Bio-Scanner reward counts. */
    get stageOneFamilies() {
      const done = new Set();
      for (const sp of allSpecies) {
        if (sp.stage === 1 && this._rank(this.entry(sp.id).state) >= this._rank('catalogued')) done.add(sp.family);
      }
      return [...done];
    },
    get familyCount() { return new Set(allSpecies.map((sp) => sp.family)).size; },
    /*
     * "All 12 families stage 1 — Bio-Scanner sight, permanently." This is the one
     * reward that reaches back into the bench: it opens a mod the research gate
     * would otherwise still be holding.
     */
    get permanentMods() {
      return this.stageOneFamilies.length >= this.familyCount ? ['bio_scanner'] : [];
    },

    // ---------------------------------------------------------- showcase
    /** Up to three pinned residents, per 07's "specimen showcase". */
    get showcase() { return (state.showcase ?? []).filter((uid) => state.residents.some((r) => r.uid === uid)); },
    togglePin(uid) {
      const list = [...this.showcase];
      const i = list.indexOf(uid);
      if (i >= 0) list.splice(i, 1);
      else if (list.length < 3) list.push(uid);
      else return false;
      state.showcase = list;
      notify();
      return true;
    },

    researchTier(id) { return this.entry(id).research; },
    canResearch(id) {
      const e = this.entry(id);
      const next = e.research + 1;
      return this._rank(e.state) >= this._rank('catalogued')
        && next <= 3 && state.researchPoints >= RESEARCH_COST[next];
    },
    research(id) {
      if (!this.canResearch(id)) return false;
      const e = { ...this.entry(id) };
      const next = e.research + 1;
      state.researchPoints -= RESEARCH_COST[next];
      e.research = next;
      e.state = 'researched';
      state.codex[id] = e;
      notify();
      return true;
    },
    weakPointsKnown(id) { return this.entry(id).research >= 1; },

    // ---------------------------------------------------------- Sanctuary
    /** A catalogued monster goes to the Sanctuary, if there is room for it. */
    admit(species, detail = {}) {
      if (state.residents.length >= this.residentCap) return false;
      state.residents.push({
        uid: `r${Date.now().toString(36)}${(uidCounter++).toString(36)}`,
        speciesId: species.id,
        study: 0,
        capturedAt: Date.now(),
        method: detail.methodAmmo ?? null,
        weaponId: detail.weaponId ?? null,
        hpFraction: detail.hpFraction ?? null,
        heightM: detail.heightM ?? null,
        percentile: detail.percentile ?? null,
        biome: detail.biome ?? null,
        habitat: null,
      });
      notify();      // every public mutator persists; admit was the one that did not
      return true;
    },

    release(uid) {
      const i = state.residents.findIndex((r) => r.uid === uid);
      if (i < 0) return;
      const r = state.residents[i];
      state.essence += Math.round(r.study * 0.4);      // ~40% of Study back as Essence
      state.residents.splice(i, 1);
      notify();
    },

    assignHabitat(uid, index) {
      const r = state.residents.find((x) => x.uid === uid);
      if (!r) return;
      // One resident per habitat.
      for (const other of state.residents) if (other.habitat === index) other.habitat = null;
      r.habitat = index;
      notify();
    },
    setHabitatElement(index, element) {
      if (index >= this.habitatSlots) return;
      state.habitats[index] = { element };
      notify();
    },

    /** Study accrues in real time. Called on load and each frame; cheap and idempotent. */
    tickStudy(now = Date.now()) {
      const minutes = ((now - state.lastTick) / 60000) * (state.devStudyRate || 1);
      if (minutes <= 0) return false;
      state.lastTick = now;
      let changed = false;
      for (const r of state.residents) {
        const sp = speciesById[r.speciesId];
        if (!sp) continue;
        const hab = r.habitat !== null ? state.habitats[r.habitat] : null;
        r.study += studyRate(r, sp, hab?.element ?? null) * minutes;
        changed = true;
      }
      return changed;
    },

    canFeed(resident, element) {
      return (state.materials[element] ?? 0) >= FEED_COST;
    },
    feed(uid, element) {
      const r = state.residents.find((x) => x.uid === uid);
      if (!r || !this.canFeed(r, element)) return false;
      const sp = speciesById[r.speciesId];
      state.materials[element] -= FEED_COST;
      r.study += FEED_STUDY * (sp.elements.includes(element) ? 2 : 1);
      notify();
      return true;
    },

    /** Evolution consumes the specimen: you have the new one, not both. */
    evolve(uid, targetId) {
      const r = state.residents.find((x) => x.uid === uid);
      if (!r) return null;
      const target = speciesById[targetId];
      if (!target) return null;

      r.evolvedFrom = r.evolvedFrom ?? [];
      r.evolvedFrom.push(r.speciesId);
      /*
       * Carry the specimen's percentile across the evolution, don't carry its
       * height. A 0.66 m Sootpup that becomes a Cinderfang is not still 0.66 m —
       * it would read as the smallest Cinderfang ever recorded. A runt stays a
       * runt and the giant you raised stays a giant, measured against the animal
       * it has become.
       */
      const size = sizeById[target.size];
      if (size && r.percentile != null) {
        const mean = speciesHeight(target, size);
        const z = inverseNormal(r.percentile);
        const [lo, hi] = size.height_m;
        r.heightM = Math.max(lo, Math.min(hi, mean * (1 + z * 0.085)));
      }
      r.speciesId = targetId;
      r.study = 0;

      const e = { ...this.entry(targetId) };
      e.catalogued += 1;
      if (this._rank(e.state) < this._rank('catalogued')) e.state = 'catalogued';
      if (!e.firstAt) { e.firstAt = Date.now(); state.researchPoints += 5; }
      state.codex[targetId] = e;

      state.xp += XP.evolution(target.stage);
      state.stats.evolutions += 1;
      this.progressContracts('evolve', { species: target });
      notify();
      return target;
    },

    get bonuses() {
      return passiveBonuses(state.residents, speciesById, content.elementDefs, content.bonusCap);
    },
    bonus(name) { return this.bonuses[name] ?? 0; },

    // ---------------------------------------------------------- contracts
    ensureContracts(templates, today) {
      if (state.contracts.day === today && state.contracts.list.length) return;
      const rng = mulberry(hashString(`${state.seed}:${today}`));
      const picked = [];
      const pool = [...templates];
      while (picked.length < 3 && pool.length) {
        picked.push(...pool.splice(Math.floor(rng() * pool.length), 1));
      }
      state.contracts = {
        day: today,
        list: picked.map((t) => ({ ...t.make(rng), id: t.id, progress: 0, claimed: false })),
      };
      notify();
    },
    progressContracts(kind, payload) {
      let changed = false;
      for (const c of state.contracts.list) {
        if (c.claimed || c.kind !== kind) continue;
        if (c.match && !matches(c, payload)) continue;
        c.progress = Math.min(c.target, c.progress + (payload.km ?? 1));
        changed = true;
      }
      return changed;
    },
    claimContract(id) {
      const c = state.contracts.list.find((x) => x.id === id);
      if (!c || c.claimed || c.progress < c.target) return false;
      c.claimed = true;
      state.xp += c.reward.xp ?? 0;
      state.essence += c.reward.essence ?? 0;
      state.researchPoints += c.reward.rp ?? 0;
      for (const [el, n] of Object.entries(c.reward.mats ?? {})) {
        state.materials[el] = (state.materials[el] ?? 0) + n;
      }
      notify();
      return true;
    },

    resolve(id) { state.resolved[id] = true; notify(); },
    isResolved(id) { return Boolean(state.resolved[id]); },
  };

  api.tickStudy();
  return api;
}

function matches(contract, payload) {
  const sp = payload.species;
  if (!sp) return false;
  const m = contract.match;
  if (m.element && !sp.elements.includes(m.element)) return false;
  if (m.size && sp.size !== m.size) return false;
  if (m.clean && !payload.detail?.clean) return false;
  return true;
}

function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function mulberry(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
