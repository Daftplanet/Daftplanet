/*
 * RIFTBORN phase 1 — Warden profile: progression, inventory and the Codex.
 *
 * Everything persists to localStorage. Reads and writes are wrapped because
 * storage throws in private windows and can come back empty at any time; the game
 * has to work regardless, it just forgets.
 */

const KEY = 'riftborn.profile.v1';

/* Rank thresholds from 08-world-and-progression.md, interpolated between the
 * published anchors so every rank has a number. */
const RANK_ANCHORS = [[1, 0], [3, 1200], [4, 2000], [6, 4500], [8, 8000], [9, 10500],
                      [12, 20000], [16, 40000], [20, 75000], [25, 150000]];

export const RANK_XP = (() => {
  const out = { 1: 0 };
  for (let i = 0; i < RANK_ANCHORS.length - 1; i++) {
    const [r0, x0] = RANK_ANCHORS[i];
    const [r1, x1] = RANK_ANCHORS[i + 1];
    for (let r = r0; r <= r1; r++) {
      out[r] = Math.round(x0 + ((x1 - x0) * (r - r0)) / (r1 - r0));
    }
  }
  return out;
})();

export const WEAPON_UNLOCK = { marker_pistol: 1, longtooth: 4, sylvan_bow: 4 };

/* Phase 1 uses two generic currencies. Element-gated materials are a phase 2
 * concern, and inventing them now would mean inventing content to spend them on. */
export const AMMO_COST = {
  ball_round:     { essence: 2,  alloy: 0 },
  piercing_round: { essence: 4,  alloy: 1 },
  incendiary:     { essence: 5,  alloy: 1 },
  cryo_round:     { essence: 5,  alloy: 1 },
  broadhead:      { essence: 4,  alloy: 1 },
  tranq_dart:     { essence: 8,  alloy: 2 },
  rune_arrow:     { essence: 14, alloy: 3 },
};

export const XP = {
  cull: (tier) => 10 * tier,
  catalogue: (tier) => 35 * tier,
  firstCatch: (tier) => 150 * tier,
  perKm: 40,
};

const DEFAULT = () => ({
  version: 1,
  seed: Math.floor(Math.random() * 100000) + 1,
  xp: 0,
  essence: 120,
  alloy: 20,
  researchPoints: 0,
  ammo: { ball_round: 40, tranq_dart: 14, piercing_round: 0, incendiary: 0, cryo_round: 0, broadhead: 0, rune_arrow: 0 },
  loadout: { weaponId: 'marker_pistol', lethalId: 'ball_round', captureId: 'tranq_dart' },
  codex: {},
  metresWalked: 0,
  devUnlockAll: false, // prototype affordance, see unlockedWeapons
  resolved: {},        // spawnId -> true, so a fought spawn does not come back
  stats: { encounters: 0, culls: 0, captures: 0, escapes: 0, cleanCaptures: 0 },
});

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT();
    const parsed = JSON.parse(raw);
    return parsed?.version === 1 ? { ...DEFAULT(), ...parsed } : DEFAULT();
  } catch {
    return DEFAULT();
  }
}

function write(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private window: play on, forget later */ }
}

export function createProfile() {
  const state = read();
  const listeners = new Set();
  const notify = () => { write(state); listeners.forEach((fn) => fn(state)); };

  const api = {
    get state() { return state; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    save: notify,

    reset() {
      Object.assign(state, DEFAULT());
      notify();
    },

    // ---- progression
    get rank() {
      let r = 1;
      for (const [rank, xp] of Object.entries(RANK_XP)) {
        if (state.xp >= xp) r = Math.max(r, Number(rank));
      }
      return r;
    },
    get nextRankAt() { return RANK_XP[this.rank + 1] ?? null; },
    get unlockedWeapons() {
      // The rank gate is the design's; the override is a prototype affordance so all
      // three weapons can be evaluated in one sitting without grinding to rank 4.
      if (state.devUnlockAll) return Object.keys(WEAPON_UNLOCK);
      return Object.entries(WEAPON_UNLOCK).filter(([, r]) => r <= this.rank).map(([id]) => id);
    },

    addXp(n) { state.xp += Math.round(n); notify(); },

    walk(metres) {
      state.metresWalked += metres;
      const km = Math.floor(state.metresWalked / 1000);
      const paid = Math.floor((state.xpFromWalkingKm ?? 0));
      if (km > paid) {
        state.xpFromWalkingKm = km;
        state.xp += XP.perKm * (km - paid);
      }
    },

    // ---- inventory
    ammoCount(id) { return state.ammo[id] ?? 0; },
    spendAmmo(id, n) { state.ammo[id] = Math.max(0, (state.ammo[id] ?? 0) - n); },

    canCraft(id, n = 1) {
      const c = AMMO_COST[id];
      return Boolean(c) && state.essence >= c.essence * n && state.alloy >= c.alloy * n;
    },
    craft(id, n = 1) {
      if (!this.canCraft(id, n)) return false;
      const c = AMMO_COST[id];
      state.essence -= c.essence * n;
      state.alloy -= c.alloy * n;
      state.ammo[id] = (state.ammo[id] ?? 0) + n;
      notify();
      return true;
    },

    // ---- Codex
    entry(speciesId) {
      return state.codex[speciesId] ?? { state: 'unknown', catalogued: 0, culled: 0, research: 0, seen: 0 };
    },
    /** Rank the entry states so a sighting can never downgrade a capture. */
    _rank(s) { return ['unknown', 'sighted', 'encountered', 'data_lost', 'catalogued', 'researched'].indexOf(s); },

    sight(speciesId) {
      const e = { ...this.entry(speciesId) };
      e.seen += 1;
      if (this._rank(e.state) < this._rank('sighted')) e.state = 'sighted';
      state.codex[speciesId] = e;
    },

    recordOutcome(species, outcome, detail = {}) {
      const e = { ...this.entry(species.id) };
      const tier = species.tier;
      state.stats.encounters += 1;

      if (outcome === 'culled') {
        e.culled += 1;
        state.stats.culls += 1;
        // Culling a species you have never catalogued costs the entry.
        if (this._rank(e.state) < this._rank('catalogued')) e.state = 'data_lost';
        state.xp += XP.cull(tier);
        state.essence += 8 * tier;
        state.alloy += 3 * tier;                       // culling is the material route
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
          e.bestHp = Math.max(e.bestHp ?? 0, detail.hpFraction ?? 0);
        }
        e.bestHp = Math.max(e.bestHp ?? 0, detail.hpFraction ?? 0);
        state.xp += Math.round(xp);
        state.essence += 12 * tier;
        state.alloy += 1 * tier;
      } else {
        if (outcome === 'escaped') state.stats.escapes += 1;
        if (this._rank(e.state) < this._rank('encountered')) e.state = 'encountered';
      }

      state.codex[species.id] = e;
      notify();
    },

    canResearch(speciesId) {
      const e = this.entry(speciesId);
      return this._rank(e.state) >= this._rank('catalogued') && e.research < 1 && state.researchPoints >= 1;
    },
    research(speciesId) {
      if (!this.canResearch(speciesId)) return false;
      const e = { ...this.entry(speciesId) };
      e.research = 1;
      e.state = 'researched';
      state.researchPoints -= 1;
      state.codex[speciesId] = e;
      notify();
      return true;
    },
    /** Research I is what reveals weak points in the field. */
    weakPointsKnown(speciesId) { return this.entry(speciesId).research >= 1; },

    resolve(spawnId) { state.resolved[spawnId] = true; notify(); },
    isResolved(spawnId) { return Boolean(state.resolved[spawnId]); },
  };

  return api;
}
