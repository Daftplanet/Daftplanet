/*
 * RIFTBORN phase 2 — Warden profile: progression, inventory, Codex, Sanctuary.
 *
 * Everything persists to localStorage. Reads and writes are wrapped because
 * storage throws in private windows and can come back empty at any time; the game
 * has to work regardless, it just forgets.
 */

import { passiveBonuses, studyRate, STUDY_PER_KM_WALKED, FEED_COST, FEED_STUDY } from './sanctuary.js';

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
      { weaponId: 'marker_pistol', lethalId: 'ball_round', captureId: 'tranq_dart' },
      null,
    ],
  },
  codex: {},
  residents: [],
  habitats: [{ element: null }, { element: null }, { element: null }],
  contracts: { day: null, list: [] },
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
    return merged;
  } catch {
    return DEFAULT();
  }
}

function write(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private window: play on, forget later */ }
}

let uidCounter = 0;

export function createProfile(content) {
  const state = read();
  const listeners = new Set();
  const notify = () => { write(state); listeners.forEach((fn) => fn(state)); };
  const speciesById = content.speciesById;

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
      return n;
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

    grantMaterials(species, amount) {
      const per = Math.max(1, Math.round(amount / species.elements.length));
      for (const el of species.elements) state.materials[el] = (state.materials[el] ?? 0) + per;
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
