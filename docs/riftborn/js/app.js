/*
 * RIFTBORN phase 2 — app shell.
 *
 * Patrol, fight, Codex, Sanctuary, bench. The loop that phase 1 opened now closes
 * on itself: culling funds the darts, darts fill the Codex, the Codex reveals weak
 * points and spawn windows, captures become residents, residents evolve into things
 * you have never seen — which need catalogueing too.
 */

import { loadLoadout, applyMods, modUnlocked, speciesHeight, rollSpecimen, heightPercentile } from './rules.js';
import {
  createFight, step, readouts, activeStatuses, useEscort, applyLethal, cycleLock,
  assistPhase, assistMiss, ringSeconds, weakPointPositions, WEAPON_SWAP_SECONDS,
} from './game.js';
import { fitCanvas, draw } from './render.js';
import { createInput } from './input.js';
import { createProfile, AMMO_COST, ITEM_COST, RANK_XP, WEAPON_UNLOCK, RESEARCH_COST } from './profile.js';
import { drawFieldReport, toPng } from './report.js';
import { buildModel, modelFor, fitModel, spriteFor, clearVoxelCache, ELEMENT_RAMP, setBiomeCoats, biomeCoat } from './voxel.js';
import { TILT, structuresOn, drawStructures, drawTileSkyline, standsUp } from './city.js';
import {
  createBattle, makeCombatant, takeTurn, options, catchChance,
  levelOf, wildLevel, activeMon, movesFor, computeMoveDamage, remaining, concealed,
  phaseAt, phaseCount, apexPhaseTable, canUse, ppLeft, usableMoves, conditionOf,
} from './battle.js';
import {
  buildPool, apexForecast, riftForCell, placementFits, inTimeWindow, weatherIs, biomeAt,
  PLACEMENT_VOCABULARY, WEATHER, RIFT_RANK, RIFT_RADIUS_M, TILE_M, visibleSpawns, BIOMES,
  setRiftTouchedRate,
} from './world.js';
import { blockers, escortAbility, studyFromBattle, studyAsMinutes } from './sanctuary.js';
import {
  createPatrol, stepPatrol, drawPatrol, drawTileSkin, patrolClock, biomeUnderfoot, biomeAtWorld, placePatrol, PX_PER_M,
  VIEW as MAP_VIEW, ELEMENT_COLOUR,
} from './patrol.js';
import { createTileSource, MAP_ZOOM } from './tiles.js';
import { createLocator } from './locate.js';
import {
  lonLatToWorld, worldToLonLat, groundScale, groundMetres,
  tileAt, tileOrigin, tileSpan, tileUrl, normaliseTile, biomeFromPixel,
  TILE_PROVIDERS, DEFAULT_PROVIDER, SUGGESTED_PROVIDER,
} from './geo.js';

const DATA_FILES = ['elements', 'sizes', 'weapons', 'ammo', 'monsters'];
const CARRY = { lethal: 24, capture: 12 };
const FIXED_DT = 1 / 60;

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString();
const title = (s) => String(s).replace(/_/g, ' ');
const dateOf = (ms) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
function ordinal(pct) {
  const v = Math.max(1, Math.min(99, Math.round(pct)));
  if (v % 100 >= 11 && v % 100 <= 13) return `${v}th`;
  return `${v}${['th', 'st', 'nd', 'rd'][v % 10] ?? 'th'}`;
}

const VERDICTS = {
  resolved: ['ENCOUNTER OVER', 'The pack is dealt with.'],
  culled: ['CULLED', 'Materials banked, fast and certain. Nothing for the Codex.'],
  catalogued: ['CATALOGUED', 'Tagged and recorded. It goes to the Sanctuary.'],
  escaped: ['ESCAPED', 'It got out. All that ammunition spent and the entry is still blank.'],
  driven_off: ['DRIVEN OFF', 'Out of rounds or out of health. The spawn is gone either way.'],
};
const STATE_LABEL = {
  unknown: 'Unknown', sighted: 'Sighted', encountered: 'Encountered',
  data_lost: 'Data Lost', catalogued: 'Catalogued', researched: 'Researched',
};

/* Contracts exist to push a Warden towards the part of the system they are
 * avoiding, so the board always carries one cull and one catalogue. */
const CONTRACT_TEMPLATES = [
  { id: 'cull_element', kind: 'cull', make: (rng) => {
      const el = ['ember', 'stone', 'volt', 'tide', 'verdant', 'gale'][Math.floor(rng() * 6)];
      return { text: `Cull 4 ${title(el)}-element monsters`, target: 4, match: { element: el },
               reward: { xp: 180, essence: 40, mats: { [el]: 4 } } };
    } },
  { id: 'catalogue_size', kind: 'catalogue', make: (rng) => {
      const size = ['mote', 'whelp', 'strider'][Math.floor(rng() * 3)];
      return { text: `Catalogue 2 ${title(size)}-class monsters`, target: 2, match: { size },
               reward: { xp: 260, essence: 30, rp: 2 } };
    } },
  { id: 'clean', kind: 'catalogue', make: () => ({
      text: 'Catalogue anything above 80% health', target: 1, match: { clean: true },
      reward: { xp: 320, rp: 3 } }) },
  { id: 'walk', kind: 'walk', make: () => ({
      text: 'Cover 3 km on patrol', target: 3, reward: { xp: 200, essence: 50 } }) },
  { id: 'evolve', kind: 'evolve', make: () => ({
      text: 'Evolve a resident', target: 1, reward: { xp: 400, essence: 60, rp: 2 } }) },
  { id: 'catalogue_any', kind: 'catalogue', make: () => ({
      text: 'Catalogue 3 monsters of any kind', target: 3,
      reward: { xp: 240, essence: 40, mats: { verdant: 4 } } }) },
];

async function loadData() {
  const entries = await Promise.all(DATA_FILES.map(async (name) => {
    const res = await fetch(`data/${name}.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`data/${name}.json → HTTP ${res.status}`);
    return [name, await res.json()];
  }));
  return Object.fromEntries(entries);
}

function boot(data) {
  const allSpecies = data.monsters.monsters;
  const speciesById = Object.fromEntries(allSpecies.map((m) => [m.id, m]));
  const ammoById = Object.fromEntries([...data.ammo.lethal, ...data.ammo.capture].map((a) => [a.id, a]));
  const weaponById = Object.fromEntries(data.weapons.weapons.map((w) => [w.id, w]));
  const sizeById = Object.fromEntries(data.sizes.sizes.map((z) => [z.id, z]));
  const MOD_SLOTS = ['barrel', 'core', 'sight'];
  const modById = Object.fromEntries(Object.values(data.weapons.mods ?? {}).flat().map((m) => [m.id, m]));

  /*
   * The mods a slot actually gets to use. Anything still behind Codex research is
   * dropped here rather than at the bench alone, so an old save — or a hand-edited
   * one — can't carry an unearned sight into a fight.
   */
  function fittedMods(sl) {
    const out = {};
    for (const cat of MOD_SLOTS) {
      const mod = modById[sl?.mods?.[cat]];
      if (mod && modUnlocked(mod, profile.codexProgress)) out[cat] = mod.id;
    }
    return out;
  }
  const families = [...new Set(allSpecies.map((m) => m.family))].filter((f) => f !== 'apex');
  const pool = buildPool(allSpecies, families);
  const codexSpecies = allSpecies.filter((m) => m.family !== 'apex');

  // The rare-colourway rate and the biome coats are data, like every other
  // tuning number. Both are set once, from the loaded content.
  setRiftTouchedRate(data.elements.rift_touched?.rate);
  setBiomeCoats(data.elements.biome_coats);

  const profile = createProfile({
    speciesById,
    allSpecies: codexSpecies,
    sizeById,
    escortAbilities: data.elements.escort_abilities,
    escortRules: data.elements.escort_ability_rules,
    elementDefs: data.elements.elements,
    bonusCap: data.elements.sanctuary_bonus_cap_per_element ?? 0.15,
    battleRules: data.elements.battle_rules,
    fieldItems: data.ammo.field ?? [],
  });

  const mapCanvas = $('map');
  const fightCanvas = $('stage');
  const mapCtx = mapCanvas.getContext('2d');
  const fightCtx = fightCanvas.getContext('2d');
  const input = createInput(fightCanvas);
  const mapInput = createInput(mapCanvas, { allTouchSteers: true });

  // The rift pool carries the two Rift-element species plus the three apexes, none
  // of which exist anywhere outside an event.
  const riftPool = allSpecies.filter((m) => m.spawn.biomes.includes('rift_event'));
  const apexById = Object.fromEntries(allSpecies.filter((m) => m.apex).map((m) => [m.id, m]));
  /*
   * The map. `fallbackBiome` hands the tile classifier the synthetic generator so
   * it can tell industrial from works from transit, which colour alone cannot —
   * the map decides water/green/built, the noise decides which kind of built.
   */
  const tiles = createTileSource({
    provider: profile.state.mapProvider ?? DEFAULT_PROVIDER,
    fallbackBiome: (wx, wy) => biomeAt(Math.floor(wx / TILE_M), Math.floor(wy / TILE_M), profile.state.seed),
  });
  const patrol = createPatrol(profile, [...pool, ...riftPool], apexById, { tiles });

  const locator = createLocator({
    onUpdate(fix) {
      if (!fix) { renderLocation(); return; }
      placePatrol(patrol, fix.x, fix.y, {
        jumped: fix.jumped, accuracyM: fix.accuracyM, live: true,
      });
      patrol.lockedOut = fix.lockedOut;
      tiles.prefetch(patrol.x, patrol.y, patrol.mapZoom, 1);
      renderLocation();
    },
  });
  let view = 'patrol';
  let fight = null;
  let fightSpawn = null;
  let fightBiome = null;
  let mapView = fitCanvas(mapCanvas);
  let fightView = fitCanvas(fightCanvas);
  let restraintPeak = 0;
  let shownOutcome = null;

  const ctxFor = () => {
    const { date, weather } = patrolClock(patrol);
    return {
      date, weather, freezing: Boolean(WEATHER[weather]?.freezing), rank: profile.rank,
      ammoName: (id) => ammoById[id]?.name ?? id,
    };
  };

  // ---------------------------------------------------------------- routing
  const VIEWS = ['patrol', 'fight', 'battle', 'codex', 'sanctuary', 'loadout'];
  function show(next) {
    view = next;
    for (const v of VIEWS) $(`view-${v}`).hidden = v !== next;
    for (const t of document.querySelectorAll('.tab')) t.dataset.active = String(t.dataset.view === next);
    if (next === 'battle') renderBattle();
    if (next === 'codex') renderCodex();
    if (next === 'sanctuary') renderSanctuary();
    if (next === 'loadout') renderLoadout();
    if (next === 'patrol') { mapView = fitCanvas(mapCanvas); renderParty(); }
    if (next === 'fight') fightView = fitCanvas(fightCanvas);
  }
  for (const t of document.querySelectorAll('.tab')) {
    t.addEventListener('click', () => { if (view !== 'fight') show(t.dataset.view); });
  }

  // ---------------------------------------------------------------- warden bar
  function renderWarden() {
    const s = profile.state;
    const rank = profile.rank;
    const next = profile.nextRankAt;
    const floor = RANK_XP[rank] ?? 0;
    $('rank').textContent = rank;
    $('rank-fill').style.width = next ? `${Math.min(100, ((s.xp - floor) / (next - floor)) * 100)}%` : '100%';
    $('rank-xp').textContent = next ? `${fmt(s.xp)} / ${fmt(next)} XP` : `${fmt(s.xp)} XP`;
    $('essence').textContent = fmt(s.essence);
    $('rp').textContent = fmt(s.researchPoints);
    $('mats').innerHTML = Object.entries(s.materials)
      .filter(([, n]) => n > 0)
      .map(([el, n]) => `<span class="mat" style="--c:${ELEMENT_COLOUR[el]}" title="${title(el)}">${n}</span>`)
      .join('') || '<span class="mat mat--none">no materials</span>';
  }
  profile.onChange(renderWarden);
  renderWarden();

  // ---------------------------------------------------------------- patrol
  $('patrol-dev-toggle').addEventListener('click', (e) => {
    const d = $('patrol-dev');
    d.hidden = !d.hidden;
    e.currentTarget.setAttribute('aria-expanded', String(!d.hidden));
  });
  $('opt-hour').addEventListener('input', (e) => {
    patrol.hourOffset = Number(e.target.value);
    $('hour-label').textContent = `${patrol.hourOffset >= 0 ? '+' : ''}${patrol.hourOffset}h`;
  });
  $('opt-pace').addEventListener('input', (e) => {
    patrol.walkMultiplier = Number(e.target.value);
    $('pace-label').textContent = `×${patrol.walkMultiplier}`;
  });
  $('opt-study').addEventListener('input', (e) => {
    profile.state.devStudyRate = Number(e.target.value);
    $('study-label').textContent = `×${profile.state.devStudyRate}`;
    profile.save();
  });
  $('opt-weather').addEventListener('change', (e) => {
    patrol.weatherOverride = e.target.value || null;
  });
  $('opt-aim').addEventListener('change', (e) => {
    profile.state.aimMode = e.target.value === 'assisted' ? 'assisted' : 'free';
    profile.save();
  });
  $('opt-unlock').addEventListener('change', (e) => {
    profile.state.devUnlockAll = e.target.checked;
    profile.save();
    if (view === 'loadout') renderLoadout();
  });
  $('reset-profile').addEventListener('click', () => {
    if (confirm('Reset this Warden? Codex, rank, Sanctuary and inventory are all lost.')) {
      profile.reset();
      location.reload();
    }
  });
  $('engage-go').addEventListener('click', () => {
    if (!patrol.nearest) return;
    if ((profile.state.combatMode ?? 'turn') === 'arena') startFight(patrol.nearest);
    else startBattle(patrol.nearest);
  });
  $('opt-combat').addEventListener('change', (e) => {
    profile.state.combatMode = e.target.value === 'arena' ? 'arena' : 'turn';
    profile.save();
  });

  let flashTimer = null;
  function flash(text) {
    const el = $('patrol-flash');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { el.hidden = true; }, 4000);
  }

  function renderPatrolHud() {
    const { date, window: win, weather } = patrolClock(patrol);
    const w = WEATHER[weather];
    $('clock').textContent =
      `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')} ${win}`;
    $('weather').textContent = w.name;
    $('biome').textContent = title(biomeUnderfoot(patrol));
    $('spawn-count').textContent = `${patrol.spawns.length} in range`;

    const riftEl = $('rift-status');
    if (patrol.rift) {
      const left = Math.max(0, Math.round((patrol.rift.endMs - date.getTime()) / 60000));
      riftEl.textContent = patrol.rift.apexUp
        ? `INSIDE A RIFT · apex up · ${left}m left`
        : `INSIDE A RIFT · ${left}m left`;
      riftEl.dataset.state = patrol.rift.apexUp ? 'apex' : 'open';
      riftEl.hidden = false;
    } else if (patrol.upcoming) {
      const r = patrol.upcoming;
      const km = (r.distance / 1000).toFixed(1);
      riftEl.textContent = r.active
        ? `rift open · ${km} km away`
        : `next rift · ${km} km · opens in ${Math.round(r.opensInMs / 60000)}m`;
      riftEl.dataset.state = 'pending';
      riftEl.hidden = false;
    } else {
      riftEl.textContent = `rift events unlock at Warden rank ${RIFT_RANK}`;
      riftEl.dataset.state = 'locked';
      riftEl.hidden = false;
    }

    renderForecast(date);

    const near = patrol.nearest;
    $('engage').hidden = !near;
    if (near) {
      const sp = speciesById[near.speciesId];
      const e = profile.entry(sp.id);
      const pack = near.packSize ?? 1;
      const touched = !!near.riftTouched;
      $('engage-name').textContent = (pack > 1 ? `${sp.name} ×${pack}` : sp.name)
        + (touched ? ` · ${data.elements.rift_touched?.name ?? 'Rift-touched'}` : '');
      $('engage-name').dataset.touched = String(touched);
      $('engage-meta').textContent = sp.apex
        ? `APEX · ${sp.elements.join('/')} · ${sp.phases} phases · needs a Tether Harpoon to take alive`
        : `${sp.elements.join('/')} · ${sp.size} · ${title(sp.rarity)} · ${STATE_LABEL[e.state]}`;
    }
  }

  function renderContracts() {
    const today = new Date().toISOString().slice(0, 10);
    profile.ensureContracts(CONTRACT_TEMPLATES, today);
    $('contracts').innerHTML = profile.state.contracts.list.map((c) => {
      const done = c.progress >= c.target;
      const reward = [
        c.reward.xp && `${c.reward.xp} XP`,
        c.reward.essence && `${c.reward.essence} ess`,
        c.reward.rp && `${c.reward.rp} RP`,
        ...Object.entries(c.reward.mats ?? {}).map(([el, n]) => `${n} ${el}`),
      ].filter(Boolean).join(' · ');
      return `
        <div class="contract" data-done="${done}" data-claimed="${c.claimed}">
          <div>
            <p class="contract__text">${c.text}</p>
            <p class="contract__reward">${reward}</p>
          </div>
          <span class="contract__progress">${Math.min(c.progress, c.target)}/${c.target}</span>
          ${c.claimed ? '<span class="contract__done">claimed</span>'
            : done ? `<button class="ghost" data-claim="${c.id}" type="button">Claim</button>` : ''}
        </div>`;
    }).join('');
    for (const b of document.querySelectorAll('[data-claim]')) {
      b.addEventListener('click', () => { profile.claimContract(b.dataset.claim); renderContracts(); });
    }
  }

  /*
   * The field kit, on the patrol view rather than in the Sanctuary.
   *
   * Mend already exists at home and is cheaper; this is the same problem solved
   * where you actually have it — two miles out, with a party at 20% and a spawn
   * in front of you. The generous restores are the ones that appear here,
   * because between fights is the only place they are allowed to work: measured
   * inside a battle an 85% heal was worth +15 points of win rate and the dumbest
   * policy scored best, which cancels the patrol limit outright.
   */
  function renderParty() {
    const party = profile.party;
    const board = $('party-board');
    if (!board) return;
    board.hidden = party.length === 0;
    if (!party.length) { $('party-strip').innerHTML = ''; return; }

    const usable = (data.ammo.field ?? []).filter((f) => !f.in_battle && profile.itemCount(f.id) > 0);
    $('party-strip').innerHTML = party.map((r) => {
      const sp = speciesById[r.speciesId];
      const cond = Math.max(0, Math.min(1, r.hp ?? 1));
      const down = cond <= 0;
      const buttons = usable.map((f) => {
        // Offer only what would actually do something: a revive on a standing
        // monster and a salve on a downed one are both dead buttons.
        const ok = f.revives_to ? down : (!down && cond < 1);
        return `<button class="ghost" data-use="${f.id}" data-uid="${r.uid}" type="button" ${ok ? '' : 'disabled'}>${f.name} (${profile.itemCount(f.id)})</button>`;
      }).join('');
      return `
        <div class="partyrow" data-down="${down}">
          <b>${sp?.name ?? '?'}</b>
          <div class="meter__track meter__track--slim">
            <div class="meter__fill meter__fill--hp" style="width:${cond * 100}%"
                 data-state="${down ? 'critical' : cond > 0.5 ? 'ok' : 'low'}"></div>
          </div>
          <span>${down ? 'down' : `${Math.round(cond * 100)}%`}</span>
          ${buttons || '<span class="partyrow__none">no field kit — craft some at the bench</span>'}
        </div>`;
    }).join('');

    for (const b of document.querySelectorAll('[data-use]')) {
      b.addEventListener('click', () => {
        if (profile.useItem(b.dataset.use, b.dataset.uid)) { renderParty(); renderWarden(); }
        else flash('That would not do anything.');
      });
    }
  }

  // ---------------------------------------------------------------- battle
  /*
   * The turn-based battle, and the default way an encounter plays. Your Sanctuary
   * residents fight; the weapons became the capture step.
   *
   * The real-time arena is still here and still reachable from the world panel,
   * because it is four phases of measured balance work and five test suites, and
   * retiring it would mean deleting all of that to make a point.
   */
  let battle = null;
  let battleSpawn = null;
  let battleBusy = false;
  let battleMenu = 'root';

  function startBattle(spawn) {
    const sp = speciesById[spawn.speciesId];
    const slot = profile.slots[0];
    const weapon = slot ? weaponById[slot.weaponId] : null;

    /*
     * Who goes out. A party chosen in the Sanctuary if there is one, in the
     * order it was chosen; otherwise the old behaviour — escort first, then
     * whatever comes next in storage order — so a Warden who has never opened
     * the Sanctuary can still fight.
     */
    const size = data.elements.battle_rules.party_size ?? 3;
    const chosen = profile.party;
    // A monster that is down cannot go out. It will come back on its own, or
    // you can pay to mend it — either way it is not coming to this fight.
    const fit = (r) => (r.hp ?? 1) > 0;
    const residents = (chosen.length
      ? chosen
      : [...profile.state.residents]
        .sort((a, c) => (a.uid === profile.state.escortUid ? -1 : c.uid === profile.state.escortUid ? 1 : 0))
    ).filter(fit).slice(0, size);
    const team = residents
      .map((r) => {
        const rsp = speciesById[r.speciesId];
        return rsp ? makeCombatant(rsp, levelOf(r, rsp), data, { resident: r }) : null;
      })
      .filter(Boolean);

    /*
     * A pack comes up one at a time. Each member is its own individual — its own
     * measured height, its own Restraint requirement — because the Codex records
     * specimens and a pack of three is three specimens, not one fought thrice.
     */
    const packSize = Math.max(1, spawn.packSize ?? 1);
    const level = wildLevel(sp, profile.rank);
    const wilds = Array.from({ length: packSize }, () => makeCombatant(sp, level, data, { wild: true }));

    battle = createBattle({ data, team, wilds, weapon });
    battleSpawn = spawn;
    // Captured once, at engage: the card names a biome and never a position.
    fightBiome = biomeUnderfoot(patrol);
    battleMenu = 'root';
    battleBusy = false;

    $('battle-where').textContent = `${title(fightBiome)} · ${WEATHER[patrol.weather]?.name ?? ''}`
      + (battleSpawn?.riftTouched ? ` · ${data.elements.rift_touched?.name ?? 'Rift-touched'}` : '');
    $('battle-log').innerHTML = `<p data-kind="info">${packSize > 1
      ? `A pack of ${packSize} ${sp.name} blocks your way. They come at you one at a time.`
      : `A wild ${sp.name} blocks your way.`}</p>`;
    renderBattle();
    show('battle');
  }

  const hpClass = (frac) => (frac > 0.5 ? 'ok' : frac > 0.2 ? 'low' : 'critical');

  function renderBattle() {
    const b = battle;
    if (!b) return;
    const w = b.wild;
    const mine = activeMon(b);

    $('battle-turn').textContent = `Turn ${Math.max(1, b.turn)}`;
    const packed = b.wilds.length > 1;
    $('battle-pack').hidden = !packed;
    $('battle-pack-sep').hidden = !packed;
    if (packed) {
      // Filled pips for what is still coming, hollow for what is dealt with.
      const done = b.results.length;
      $('battle-pack').textContent = `${'●'.repeat(b.wilds.length - done)}${'○'.repeat(done)} `
        + `${remaining(b)} of ${b.wilds.length} left`;
    }
    $('wild-name').textContent = w.species.name;
    $('wild-level').textContent = `Lv.${w.level}`;

    // An apex says which of its phases you are in, and how many are left.
    const phased = w.phases > 1;
    $('wild-phase').hidden = !phased;
    if (phased) {
      $('wild-phase').textContent = `${'◆'.repeat(w.phase)}${'◇'.repeat(w.phases - w.phase)} ${w.phaseLabel}`;
    }

    /*
     * Nyxhollow "extinguishes light in a radius, blanking the weak-point
     * overlay... countered by a Lumen carrier keeping a flare up." In a turn
     * battle the thing it can take from you is information, so while the shroud
     * is up you do not get to see its health — unless you brought the counter.
     */
    const hide = concealed(b);
    $('wild-hp').style.width = hide ? '100%' : `${(w.hp / w.maxHp) * 100}%`;
    $('wild-hp').dataset.state = hide ? 'shrouded' : hpClass(w.hp / w.maxHp);
    $('wild-hp-text').textContent = hide ? '???' : `${Math.ceil(w.hp)} / ${w.maxHp}`;
    $('wild-statuses').innerHTML = (hide ? '<span class="chip chip--warn">shrouded — bring a Lumen</span>' : '')
      + Object.entries(w.statuses)
        .map(([id, t]) => `<span class="chip chip--good">${id} ${t}</span>`).join('');

    if (b.wardenOnly) {
      $('mine-name').textContent = 'Warden';
      $('mine-level').textContent = weaponLabel();
      $('mine-hp').style.width = `${(b.warden.hp / b.warden.maxHp) * 100}%`;
      $('mine-hp-text').textContent = `${Math.ceil(b.warden.hp)} / ${b.warden.maxHp}`;
      $('mine-statuses').innerHTML = '<span class="chip chip--warn">no monster — catch one</span>';
      $('mine-model').hidden = true;
    } else {
      $('mine-model').hidden = false;
      $('mine-name').textContent = mine.species.name;
      $('mine-level').textContent = `Lv.${mine.level}`;
      $('mine-hp').style.width = `${(mine.hp / mine.maxHp) * 100}%`;
      $('mine-hp').dataset.state = hpClass(mine.hp / mine.maxHp);
      $('mine-hp-text').textContent = `${Math.ceil(mine.hp)} / ${mine.maxHp}`;
      $('mine-statuses').innerHTML = Object.entries(mine.statuses)
        .map(([id, t]) => `<span class="chip chip--good">${id} ${t}</span>`).join('');
    }

    paintBattleModels();
    renderBattleMenu();
  }

  const weaponLabel = () => {
    const slot = profile.slots[0];
    return slot ? (weaponById[slot.weaponId]?.name ?? '—') : 'unarmed';
  };

  let battleTurns = 0.12;
  function paintBattleModels() {
    const b = battle;
    if (!b) return;
    /*
     * The hit flash decays here rather than being cleared by whoever played the
     * animation. Relying on the caller left every model painted solid white
     * whenever a turn was taken by anything other than the click handler — a test,
     * the console, a future auto-battler.
     */
    const fade = (c) => { if (c && c.flash > 0) c.flash = Math.max(0, c.flash - 0.18); };
    fade(b.wild);
    for (const c of b.team) fade(c);
    const wildC = $('wild-model');
    const wc = wildC.getContext('2d');
    wc.clearRect(0, 0, wildC.width, wildC.height);
    fitModel(wc, modelFor(b.wild.species, {
      riftTouched: !!battleSpawn?.riftTouched, biome: battleSpawn?.biome ?? null,
    }), {
      turns: battleTurns, width: wildC.width, height: wildC.height, pad: 0.88,
      alpha: b.wild.fainted ? 0.25 : 1, flash: b.wild.flash,
    });

    const mine = activeMon(b);
    if (!b.wardenOnly && mine) {
      const c = $('mine-model');
      const mc = c.getContext('2d');
      mc.clearRect(0, 0, c.width, c.height);
      // Your own monster faces away, which is the convention and also reads as
      // "this one is on your side" without needing a label.
      fitModel(mc, modelFor(mine.species, {
        riftTouched: !!mine.resident?.riftTouched, biome: mine.resident?.biome ?? null,
      }), {
        turns: battleTurns + 0.5, width: c.width, height: c.height, pad: 0.88,
        alpha: mine.fainted ? 0.25 : 1, flash: mine.flash,
      });
    }
  }

  function bchoice(label, sub, handler, { disabled = false, kind = '' } = {}) {
    return { label, sub, handler, disabled, kind };
  }

  function renderBattleMenu() {
    const b = battle;
    if (!b) return;
    const o = options(b);
    let items = [];

    if (b.outcome) {
      items = [bchoice('Continue', outcomeLine(b), () => finishBattle())];
    } else if (battleMenu === 'root') {
      items = [
        bchoice('Fight', 'attack with a move', () => { battleMenu = 'moves'; renderBattleMenu(); }),
        bchoice('Bag', 'throw a capture round', () => { battleMenu = 'bag'; renderBattleMenu(); },
                { disabled: !o.canCatch }),
        bchoice('Swap', 'send out another', () => { battleMenu = 'swap'; renderBattleMenu(); },
                { disabled: !o.canSwap }),
        bchoice('Run', 'break off', () => act({ kind: 'run' })),
      ];
    } else if (battleMenu === 'moves') {
      items = o.moves.map((m, i) => {
        const pp = o.pp?.[i];
        const spent = pp === 0;
        // A move that is not damage should not advertise "0 pw" — say what it does.
        const what = (m.applies || m.applies_self)
          ? (m.applies_self ? `${title(m.applies_self)} — on yourself` : `leaves it ${m.applies}`)
          : `${m.power} pw`;
        return bchoice(
          m.name,
          `${m.element ? title(m.element) : 'untyped'} · ${what} · ${Math.round((m.accuracy ?? 1) * 100)}%`
          + `${m.priority > 0 ? ' · quick' : m.priority < 0 ? ' · slow' : ''}`
          + `${pp === undefined || pp === Infinity ? '' : ` · ${pp} left`}`,
          () => act({ kind: 'move', index: i }),
          { disabled: spent },
        );
      });
      items.push(bchoice('Back', '', () => { battleMenu = 'root'; renderBattleMenu(); }, { kind: 'back' }));
    } else if (battleMenu === 'bag') {
      const rounds = data.ammo.capture.filter((a) => profile.ammoCount(a.id) > 0);
      items = rounds.map((a) => {
        const { chance, sealed } = catchChance(b, a);
        // A sealed phase is a real answer, not a 0% to squint at: there is no way
        // into Karrahk until the core is exposed, and the menu should say so
        // rather than let you spend the round finding out.
        const sub = sealed
          ? `${profile.ammoCount(a.id)} left · nothing to take hold of yet`
          : `${profile.ammoCount(a.id)} left · about ${
            chance < 0.01 ? '<1' : Math.round(chance * 100)}% to take it`;
        return bchoice(a.name, sub, () => act({ kind: 'catch', ammoId: a.id }), { disabled: Boolean(sealed) });
      });
      /*
       * Field items sit in the same bag as the rounds, because they compete for
       * the same thing: the turn. Only the in_battle ones are here — the generous
       * restores are deliberately unreachable mid-fight (see ammo.json).
       */
      const mine = b.team[b.active];
      for (const f of (data.ammo.field ?? []).filter((x) => x.in_battle)) {
        const have = profile.itemCount(f.id);
        if (!have) continue;
        const full = f.restores_hp && mine && mine.hp >= mine.maxHp;
        items.push(bchoice(
          f.name,
          `${have} left · ${f.restores_hp ? `back ${Math.round(f.restores_hp * 100)}% of the bar`
            : `+${f.restores_pp} PP on every move`}${full ? ' · already whole' : ''} · costs the turn`,
          () => act({ kind: 'item', itemId: f.id }),
          { disabled: Boolean(full) || b.wardenOnly },
        ));
      }
      if (!items.length) items = [bchoice('Nothing in the bag', 'craft rounds and salves at the bench', () => {}, { disabled: true })];
      items.push(bchoice('Back', '', () => { battleMenu = 'root'; renderBattleMenu(); }, { kind: 'back' }));
    } else if (battleMenu === 'swap') {
      items = b.team.map((c, i) => bchoice(
        c.species.name,
        c.fainted ? 'down' : `Lv.${c.level} · ${Math.ceil(c.hp)}/${c.maxHp}`,
        () => act({ kind: 'swap', index: i }),
        { disabled: c.fainted || i === b.active },
      ));
      items.push(bchoice('Back', '', () => { battleMenu = 'root'; renderBattleMenu(); }, { kind: 'back' }));
    }

    $('battle-menu').innerHTML = items.map((it, i) => `
      <button class="bchoice" data-i="${i}" data-kind="${it.kind}" type="button" ${it.disabled ? 'disabled' : ''}>
        <b>${it.label}</b>${it.sub ? `<small>${it.sub}</small>` : ''}
      </button>`).join('');
    for (const el of document.querySelectorAll('.bchoice')) {
      el.addEventListener('click', () => { if (!battleBusy) items[Number(el.dataset.i)].handler(); });
    }
  }

  const outcomeLine = (b) => {
    if (b.wilds.length > 1) {
      // A pack can end as two culls and a capture; say which, not just "caught".
      const n = (o) => b.results.filter((r) => r.outcome === o).length;
      const bits = [
        n('caught') && `${n('caught')} caught`,
        n('defeated') && `${n('defeated')} down`,
        n('escaped') && `${n('escaped')} got away`,
      ].filter(Boolean);
      if (bits.length) return bits.join(' · ');
    }
    return {
      caught: 'It is yours.',
      defeated: 'It goes down.',
      fled: 'You broke off.',
      escaped: 'It got away.',
      wiped: 'You have nothing left.',
    }[b.outcome] ?? '';
  };

  /** Take a turn and play its log out, a line at a time, so the fight reads. */
  async function act(action) {
    const b = battle;
    if (!b || battleBusy) return;
    battleBusy = true;
    battleMenu = 'root';
    $('battle-menu').innerHTML = '';

    const lines = takeTurn(b, action);
    for (const line of lines) {
      const p = document.createElement('p');
      p.dataset.kind = line.kind;
      p.textContent = line.text;
      $('battle-log').append(p);
      $('battle-log').scrollTop = $('battle-log').scrollHeight;
      renderBattle();
      await new Promise((r) => setTimeout(r, 520));
    }
    battleBusy = false;
    renderBattle();
  }

  /** How a member's battle ending is written into the Codex. */
  const CODEX_OUTCOME = { caught: 'catalogued', defeated: 'culled', escaped: 'escaped', wiped: 'escaped' };

  function finishBattle() {
    const b = battle;
    const sp = b.wild.species;
    const biome = fightBiome ?? biomeUnderfoot(patrol);
    const before = { xp: profile.state.xp, ess: profile.state.essence, rp: profile.state.researchPoints };

    // Every round fired is gone, landed or not.
    for (const [id, n] of Object.entries(b.spent)) profile.spendAmmo(id, n);
    for (const [id, n] of Object.entries(b.used ?? {})) profile.spendItem(id, n);

    /*
     * Members that reached an ending, plus the one still standing when the
     * encounter was called. Being driven off or backing out is an ending too —
     * for the Codex it reads as "it got away", and for Study it is worth less
     * than a win but more than nothing, because you were in the fight.
     */
    const resolved = [...b.results];
    if ((b.outcome === 'wiped' || b.outcome === 'fled') && b.wild && !b.wild.resolved) {
      resolved.push({
        speciesId: b.wild.speciesId, outcome: b.outcome, level: b.wild.level,
        clean: false, hpFraction: b.wild.hp / b.wild.maxHp,
        heightM: b.wild.heightM, percentile: b.wild.percentile, caughtWith: null,
      });
    }

    // A pack resolves per member, exactly as the arena does, so the Codex cannot
    // tell which combat mode you played.
    for (const r of resolved) {
      const kind = CODEX_OUTCOME[r.outcome];
      if (!kind) continue;                              // 'fled' records nothing
      // Per result rather than per battle: packs are one species today, and
      // reading it off the member costs nothing and stops being a trap later.
      const rsp = speciesById[r.speciesId] ?? sp;
      // The rare colourway belongs to the spawn, so every member of it wears it
      // and every ending records it — including the ones that got away.
      const riftTouched = !!battleSpawn?.riftTouched;
      profile.recordOutcome(rsp, kind, kind === 'catalogued' ? {
        clean: r.clean,
        hpFraction: r.hpFraction,
        method: `${weaponLabel()} · ${data.ammo.capture.find((a) => a.id === r.caughtWith)?.name ?? ''}`,
        methodAmmo: r.caughtWith,
        weaponId: profile.slots[0]?.weaponId ?? null,
        heightM: r.heightM, percentile: r.percentile,
        biome, riftTouched,
      } : kind === 'culled' ? { biome, riftTouched } : { riftTouched });
    }

    /*
     * Study for whoever was on the field. Before this, winning a battle taught
     * your monsters nothing at all — level is a function of Study, and Study
     * only came from habitat time, walking and feeding, so a monster got
     * stronger by sitting in its pen while the thing you spend the whole game
     * doing counted for zero.
     */
    /*
     * Wounds and spent rounds go home with them. This is what makes a patrol a
     * unit of play rather than a series of unrelated battles: a party of three
     * sustains about four fights, and then you are walking back or paying up.
     */
    const hurt = [];
    for (const c of b.team) {
      if (!c.resident) continue;
      const cond = conditionOf(c);
      c.resident.hp = cond.hp;
      c.resident.pp = cond.pp;
      if (cond.hp <= 0) hurt.push(c.species.name);
    }

    const taught = [];
    for (const c of b.team) {
      if (!c.participated || !c.resident) continue;
      let gained = 0;
      for (const r of resolved) gained += studyFromBattle(r.level, c.level, r.outcome);
      if (gained <= 0) continue;
      c.resident.study += gained;
      taught.push({ name: c.species.name, gained });
    }

    if (b.outcome !== 'fled') profile.resolve(battleSpawn.id);
    profile.save();

    const after = profile.state;
    const gains = [
      after.xp - before.xp && `+${fmt(after.xp - before.xp)} XP`,
      after.essence - before.ess && `+${fmt(after.essence - before.ess)} essence`,
      after.researchPoints - before.rp && `+${fmt(after.researchPoints - before.rp)} RP`,
      taught.length && `${taught.map((t) => `${t.name} +${fmt(t.gained)} Study`).join(' · ')}`,
      hurt.length && `${hurt.join(' and ')} went down — mend or wait`,
    ].filter(Boolean).join(' · ');
    if (gains) flash(gains);

    battle = null;
    show('patrol');
  }

  // ---------------------------------------------------------------- fight
  function startFight(spawn) {
    const sp = speciesById[spawn.speciesId];
    const slots = profile.slots;
    if (!slots.length) {
      flash('No weapon equipped — set one up at the bench.');
      show('loadout');
      return;
    }

    let loadouts;
    try {
      loadouts = slots.map((sl) => loadLoadout(data, {
        speciesId: sp.id, weaponId: sl.weaponId, lethalId: sl.lethalId, captureId: sl.captureId,
        mods: fittedMods(sl),
      }));
    } catch (err) {
      flash(`Loadout invalid: ${err.message}`);
      show('loadout');
      return;
    }

    const carried = slots.map((sl) => ({
      lethal: Math.min(profile.ammoCount(sl.lethalId), CARRY.lethal),
      capture: sl.captureId ? Math.min(profile.ammoCount(sl.captureId), CARRY.capture) : 0,
    }));
    if (carried.every((c) => c.lethal + c.capture === 0)) {
      flash('No rounds for this loadout — craft some at the bench.');
      show('loadout');
      return;
    }

    const escortResident = profile.escort;
    fight = createFight(loadouts, {
      carried, bonuses: profile.bonuses,
      packSize: spawn.packSize ?? 1,
      partySize: 1,                       // solo is the only party this build can field
      aimMode: profile.state.aimMode ?? 'free',
      escort: escortResident ? {
        uid: escortResident.uid,
        speciesId: escortResident.speciesId,
        name: speciesById[escortResident.speciesId]?.name ?? 'Escort',
        element: speciesById[escortResident.speciesId]?.elements[0] ?? null,
        ability: profile.escortAbility,
      } : null,
      escortRules: data.elements.escort_ability_rules,
    });
    const loadout = fight.loadout;
    fightSpawn = spawn;
    // Captured once, at engage: the card names a biome and never a position.
    fightBiome = biomeUnderfoot(patrol);
    restraintPeak = 0;
    shownOutcome = null;
    $('overlay').hidden = true;
    $('monster-name').textContent = sp.name;
    const pack = spawn.packSize ?? 1;
    $('monster-name').textContent = pack > 1 ? `${sp.name} ×${pack}` : sp.name;
    $('monster-meta').textContent = `${sp.elements.join('/')} · ${loadout.sizeDef.name} · ${sp.aggression}`;
    $('lethal-round').textContent = loadout.ammo.lethal.name;
    $('capture-round').textContent = loadout.ammo.capture ? loadout.ammo.capture.name : 'none — pure setup';
    show('fight');
  }

  function spendFired() {
    const slots = profile.slots;
    fight.weapons.forEach((w, i) => {
      const sl = slots[i];
      if (!sl) return;
      profile.spendAmmo(sl.lethalId, w.carried.lethal - (w.mag.lethal + w.reserve.lethal));
      if (sl.captureId) profile.spendAmmo(sl.captureId, w.carried.capture - (w.mag.capture + w.reserve.capture));
    });
  }

  function withdraw() {
    if (!fight || fight.outcome) return;
    const spooked = fight.monster.aware;
    spendFired();
    if (spooked) {
      profile.recordOutcome(fight.loadout.species, 'escaped');
      profile.resolve(fightSpawn.id);
    }
    profile.save();
    fight = null;
    show('patrol');
    if (spooked) flash('It had already seen you — the spawn cleared off.');
  }

  function finishFight() {
    const sp = fight.loadout.species;
    const active = profile.slots[fight.activeSlot] ?? profile.slots[0];
    spendFired();

    const before = { xp: profile.state.xp, ess: profile.state.essence, rp: profile.state.researchPoints };
    const residentsBefore = profile.state.residents.length;

    // A pack resolves per member: three Sparkmites can end as two culls and a capture.
    for (const r of fight.results) {
      profile.recordOutcome(sp, r.outcome, {
        clean: r.clean,
        hpFraction: r.hpFraction,
        method: `${fight.loadout.weapon.name} · ${fight.loadout.ammo.capture?.name ?? 'no capture round'}`,
        methodAmmo: active?.captureId ?? null,
        riftTouched: !!fightSpawn?.riftTouched,
        weaponId: active?.weaponId ?? null,
        heightM: r.heightM,
        percentile: r.percentile,
        // Biome only — never the tile, never the coordinates. See report.js.
        biome: fightBiome,
      });
    }
    profile.resolve(fightSpawn.id);

    const after = profile.state;
    const gains = [];
    if (after.xp - before.xp) gains.push(`+${fmt(after.xp - before.xp)} XP`);
    if (after.essence - before.ess) gains.push(`+${fmt(after.essence - before.ess)} essence`);
    if (after.researchPoints - before.rp) gains.push(`+${fmt(after.researchPoints - before.rp)} RP`);
    if (after.residents.length > residentsBefore) gains.push('→ Sanctuary');
    else if (fight.outcome === 'catalogued') gains.push('Sanctuary full — not admitted');
    $('rewards').textContent = gains.join(' · ') || 'Nothing gained.';
  }

  $('again').addEventListener('click', () => show('patrol'));
  $('withdraw').addEventListener('click', withdraw);
  $('btn-swap').addEventListener('click', () => input.pulse('swap'));
  $('btn-weapon').addEventListener('click', () => input.pulse('swapWeapon'));
  $('weapons').addEventListener('click', (e) => {
    const b = e.target.closest('[data-slot]');
    if (b) input.pulse('swapWeapon', Number(b.dataset.slot));
  });
  $('btn-reload').addEventListener('click', () => input.pulse('reload'));
  $('btn-tag').addEventListener('click', () => input.pulse('tag'));
  $('btn-escort').addEventListener('click', () => input.pulse('escort'));
  $('btn-lock').addEventListener('click', () => input.pulse('cycleLock'));
  for (const el of [$('chamber-lethal'), $('chamber-capture')]) {
    el.addEventListener('click', () => {
      if (fight && fight.weapon.chamber !== el.dataset.chamber) input.pulse('swap');
    });
  }
  $('dev-toggle').addEventListener('click', (e) => {
    const d = $('dev');
    d.hidden = !d.hidden;
    e.currentTarget.setAttribute('aria-expanded', String(!d.hidden));
  });
  window.addEventListener('keydown', (e) => {
    if (view !== 'fight') return;
    if (fight?.outcome && (e.code === 'Enter' || e.code === 'Space')) { e.preventDefault(); show('patrol'); }
    else if (e.code === 'Escape') { e.preventDefault(); withdraw(); }
  });
  window.addEventListener('resize', () => {
    if (view === 'patrol') mapView = fitCanvas(mapCanvas);
    if (view === 'fight') fightView = fitCanvas(fightCanvas);
  });

  function renderFightHud(elapsed) {
    const f = fight;
    const r = readouts(f);
    const m = f.monster;

    $('hp-fill').style.width = `${Math.max(0, m.hp / m.maxHp) * 100}%`;
    $('hp-value').textContent = `${Math.ceil(Math.max(0, m.hp))} / ${m.maxHp}`;

    /*
     * Restraint reads coarse by default and exact with a Bio-Scanner fitted. The
     * mod is worthless if the stock HUD already shows the number, so the stock
     * HUD doesn't: you get quarter-bar notches and have to judge the swap. This
     * is the one readout in the game you can buy precision on.
     */
    const exact = !!f.loadout.modFlags?.showRestraintNumbers;
    const rFrac = Math.min(1, m.restraint / r.required);
    const shown = exact ? rFrac : Math.floor(rFrac * 4) / 4;
    restraintPeak = Math.max(shown, restraintPeak - elapsed * 0.6);
    $('restraint-fill').style.width = `${shown * 100}%`;
    $('restraint-decay').style.width = `${restraintPeak * 100}%`;
    $('restraint-bar').dataset.coarse = String(!exact);
    $('restraint-value').textContent = exact
      ? `${m.restraint.toFixed(0)} / ${r.required.toFixed(0)}`
      : `${'\u25a0'.repeat(Math.floor(rFrac * 4))}${'\u25a1'.repeat(4 - Math.floor(rFrac * 4))}`;

    const chips = activeStatuses(m).map((id) => {
      const cls = id === 'enraged' ? 'chip--bad'
        : ['sedated', 'ensnared', 'stunned', 'anchored', 'chilled', 'calmed'].includes(id) ? 'chip--good' : 'chip--warn';
      return `<span class="chip ${cls}">${id}</span>`;
    });
    if (f.monsters.length > 1) {
      const pips = f.monsters.map((o) => {
        const done = ['dead', 'tagged', 'escaped'].includes(o.state);
        const kind = o.state === 'dead' ? 'culled' : o.state === 'tagged' ? 'tagged'
          : o.state === 'escaped' ? 'gone' : o.state === 'subdued' ? 'subdued' : 'live';
        const frac = done ? 0 : Math.max(0, o.hp / o.maxHp);
        return `<span class="pip pip--${kind}${o === m ? ' pip--focus' : ''}" style="--hp:${frac * 100}%"></span>`;
      }).join('');
      $('pack').innerHTML = pips;
      $('pack').hidden = false;
    } else {
      $('pack').hidden = true;
    }

    if (f.loadout.modFlags?.showFleeThreshold && !['dead', 'tagged', 'escaped'].includes(m.state)) {
      const pct = r.fleeChance * 100;
      chips.push(`<span class="chip ${pct > 8 ? 'chip--bad' : 'chip--good'}">bolt risk ${pct.toFixed(0)}%/s</span>`);
    }
    if (m.state === 'flee') chips.push('<span class="chip chip--bad">fleeing</span>');
    if (!m.aware) chips.push('<span class="chip chip--warn">unaware</span>');
    if (f.isApex) {
      chips.unshift(`<span class="chip chip--warn">phase ${m.phase} / ${m.phases}</span>`);
      if (m.phaseShield > 0) chips.push('<span class="chip chip--bad">shielded — breaking</span>');
    }
    if (f.phaseBlocked) chips.push('<span class="chip chip--bad">break it down further before subduing</span>');
    if (f.anchorBlocked) chips.push('<span class="chip chip--bad">needs a Tether Harpoon to subdue</span>');
    $('statuses').innerHTML = chips.join('');

    $('weapons').innerHTML = f.loadouts.map((l, i) => {
      const w = f.weapons[i];
      const total = w.mag.lethal + w.reserve.lethal + w.mag.capture + w.reserve.capture;
      return `<button class="wslot" data-slot="${i}" data-active="${i === f.activeSlot}" data-dry="${total === 0}" type="button">
                <span class="wslot__key">${i + 1}</span>
                <span class="wslot__name">${l.weapon.name}</span>
                <span class="wslot__ammo">${total}</span>
              </button>`;
    }).join('');
    $('weapons').hidden = !f.hasTwoWeapons;

    $('lethal-round').textContent = f.loadout.ammo.lethal.name;
    $('capture-round').textContent = f.loadout.ammo.capture ? f.loadout.ammo.capture.name : 'none — pure setup';
    for (const kind of ['lethal', 'capture']) {
      $(`chamber-${kind}`).dataset.active = String(f.weapon.chamber === kind);
      $(`${kind}-ammo`).textContent = `${f.weapon.mag[kind]} / ${f.weapon.reserve[kind]}`;
    }
    $('warden-fill').style.width = `${(f.player.hp / f.player.maxHp) * 100}%`;

    // The target-cycle pad only exists in the mode that has a lock to cycle.
    $('btn-lock').hidden = f.aimMode !== 'assisted' || f.monsters.length < 2;

    const esc = f.escort;
    const escBtn = $('btn-escort');
    escBtn.hidden = !esc;
    if (esc) {
      const spent = esc.charges <= 0;
      const arming = esc.readyIn > 0;
      escBtn.textContent = spent ? `${esc.ability?.name ?? 'ESCORT'} — SPENT`
        : arming ? `${esc.ability?.name ?? 'ESCORT'} ${esc.readyIn.toFixed(1)}s`
        : `F · ${esc.ability?.name ?? 'ESCORT'}`;
      escBtn.dataset.ready = String(!spent && !arming);
      escBtn.disabled = spent;
      escBtn.style.setProperty('--c', ELEMENT_COLOUR[esc.element] ?? '#9aa3ad');
    }
    // A Stone escort's Bulwark sits on top of the Warden bar rather than beside it.
    $('warden-shield').style.width = `${Math.min(100, (f.player.shield / f.player.maxHp) * 100)}%`;
    $('warden-shield').hidden = f.player.shield <= 0;

    const w = f.weapon;
    const drawT = f.loadout.weapon.charge_seconds ?? 0;
    $('busy').textContent = w.swapT > 0 ? `SWAPPING ${w.swapT.toFixed(1)}s`
      : w.reloadT > 0 ? `RELOADING ${w.reloadT.toFixed(1)}s`
      : drawT && w.charge > 0 ? `DRAWING ${Math.round((w.charge / drawT) * 100)}%`
      : f.slotSwapT > 0 ? `SWITCHING WEAPON ${f.slotSwapT.toFixed(1)}s`
      : w.mag[w.chamber] === 0 ? (w.reserve[w.chamber] > 0 ? 'EMPTY — RELOAD' : 'OUT OF ROUNDS') : '';

    if (!$('dev').hidden) {
      $('dev-readout').innerHTML = [
        ['chamber', f.weapon.chamber],
        ['wound ×', r.wound.toFixed(2)],
        ['status ×', r.statusProduct.toFixed(2)],
        ['per body hit', r.bodyValue.toFixed(1)],
        ['per weak hit', r.weakValue.toFixed(1)],
        ['decay /s', r.decay.toFixed(2)],
        ['flee /s', `${(r.fleeChance * 100).toFixed(0)}%`],
        ['monster', m.state],
        ['hits', `${f.stats.hits}/${f.stats.shots}`],
      ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    }

  }

  /*
   * Show the result card the moment the fight has one.
   *
   * This used to live at the BOTTOM of renderFightHud, after a hundred lines of
   * bars, chips, pack pips and escort buttons — all inside the frame loop's
   * try/catch. So any HUD line that threw took the result card with it: the
   * fight was over, `outcome` was set correctly, and the player was left looking
   * at a finished fight with no way out of it. That is the shape of the one
   * unexplained `phase1` failure on this branch — a lost fight that set
   * `driven_off` and never showed the overlay.
   *
   * It is a state transition, not a readout, so it no longer depends on the
   * readouts rendering. The frame loop calls this first and separately.
   */
  function checkFightResolved() {
    const f = fight;
    if (!f || !f.outcome || shownOutcome === f.outcome) return;
    shownOutcome = f.outcome;
    finishFight();
    showOutcome(f);
  }

  function showOutcome(f) {
    const [t, blurb] = VERDICTS[f.outcome] ?? VERDICTS.resolved;
    const sp = f.loadout.species;
    const e = profile.entry(sp.id);
    const pack = f.monsters.length > 1;
    $('verdict').textContent = f.stats.cleanCapture && !pack ? 'CLEAN CAPTURE' : t;
    if (pack) {
      const bits = [];
      if (f.stats.catalogued) bits.push(`${f.stats.catalogued} catalogued`);
      if (f.stats.culled) bits.push(`${f.stats.culled} culled`);
      if (f.stats.escaped) bits.push(`${f.stats.escaped} got away`);
      $('verdict-blurb').textContent = bits.join(' · ') || blurb;
    } else $('verdict-blurb').textContent = f.outcome === 'culled' && e.state === 'data_lost'
      ? 'Culled before it was ever catalogued. The entry is marked Data Lost — repairable by catalogueing one later, but the first-capture bonus is gone.'
      : f.stats.cleanCapture
        ? 'Subdued above 80% health. That is the flex — and it cost you every material the kill would have dropped.'
        : blurb;

    const acc = f.stats.shots ? (f.stats.hits / f.stats.shots) * 100 : 0;
    const rows = [
      ['Time', `${f.outcomeAt.toFixed(1)}s`],
      ['Shots fired', f.stats.shots],
      ['Hits', `${f.stats.hits} (${acc.toFixed(0)}%)`],
      ['Weak point hits', f.stats.weakHits],
      ['Times hit', f.stats.playerHits],
    ];
    if (f.stats.failedSubdues) rows.push(['Missed tag windows', f.stats.failedSubdues]);
    if (f.outcome === 'catalogued') rows.push(['HP at subdue', `${(f.stats.hpFractionAtResolve * 100).toFixed(0)}%`]);
    $('results').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');

    /*
     * A pack can end as two culls and a capture; the card shows the one worth
     * showing — a capture over a cull, and the biggest of whichever it is.
     */
    const best = [...f.results]
      .filter((r) => r.outcome === 'catalogued' || r.outcome === 'culled')
      .sort((a, b) => (a.outcome === b.outcome ? b.heightM - a.heightM
                                               : a.outcome === 'catalogued' ? -1 : 1))[0];
    const btn = $('field-report');
    btn.hidden = !best;
    if (best) {
      btn.onclick = () => openReport({
        species: sp,
        outcome: best.outcome,
        method: `${f.loadout.weapon.name} · ${best.outcome === 'catalogued'
          ? (f.loadout.ammo.capture?.name ?? 'no capture round') : f.loadout.ammo.lethal.name}`,
        heightM: best.heightM,
        percentile: best.percentile,
        hpFraction: best.hpFraction,
        biome: fightBiome,
        at: Date.now(),
      });
    }

    $('overlay').hidden = false;
  }

  // ---------------------------------------------------------------- location
  /*
   * Two ways to be somewhere, and the game does not care which. Live GPS walks the
   * avatar for real; dragging it is the fallback for a refusal, no fix, or playing
   * at a desk. The coordinate is never sent anywhere — see locate.js — but asking
   * for map tiles does tell the tile host roughly where you are, and the bar says
   * so rather than leaving it implied.
   */
  function renderLocation() {
    const st = locator.state;
    const { lon, lat } = worldToLonLat(patrol.x, patrol.y);
    const live = st.mode === 'live' && st.status === 'tracking';

    $('btn-locate').textContent = live ? 'Stop tracking' : 'Use my location';
    $('btn-locate').dataset.active = String(live);
    $('locate-bar').dataset.state = live ? 'live' : st.status;

    $('locate-state').textContent = st.message || (live
      ? `Walking live · fix ±${Math.round(st.accuracyM ?? 0)} m`
      : 'Drag the marker to move · turn on location to walk for real');
    // Four decimal places is about 11 m — enough to find yourself, coarse enough
    // not to be a pinpoint if someone screenshots the bar.
    $('locate-where').textContent = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  }

  $('btn-locate').addEventListener('click', async () => {
    if (locator.state.mode === 'live') {
      locator.setManual();
      patrol.live = false;
      patrol.accuracyM = null;
      patrol.lockedOut = false;
    } else {
      renderLocation();
      const got = await locator.start();
      if (!got) flash(locator.state.message || 'Could not get a position.');
      else if (!tiles.live) {
        // Walking a real street with no street drawn is a strange experience, so
        // this is the moment to offer the map — and the moment the player is
        // consenting to a tile host learning roughly where they are.
        flash('Location on. Turn on a basemap under "world" to see real streets.');
      }
    }
    renderLocation();
    profile.save();
  });

  /*
   * Drag to move. The whole map canvas is the handle rather than the marker
   * itself: a 9-pixel dot is not a touch target, and anyone in manual mode is
   * trying to move somewhere, not to grab a sprite.
   */
  {
    let dragging = null;
    const worldAt = (ev) => {
      const r = mapCanvas.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * MAP_VIEW.w;
      const py = ((ev.clientY - r.top) / r.height) * MAP_VIEW.h;
      return { px, py };
    };
    mapCanvas.addEventListener('pointerdown', (ev) => {
      if (view !== 'patrol' || locator.state.mode === 'live') return;
      mapCanvas.setPointerCapture(ev.pointerId);
      dragging = { ...worldAt(ev), x: patrol.x, y: patrol.y, moved: 0 };
    });
    mapCanvas.addEventListener('pointermove', (ev) => {
      if (!dragging) return;
      const now = worldAt(ev);
      /*
       * Screen back to world. The camera is tipped forward, so a pixel of
       * vertical movement covers more ground than a pixel of horizontal — divide
       * both by the same number and the map slips under your finger as you drag
       * north, which is the sort of thing that feels broken without being
       * obviously wrong in a screenshot.
       */
      const dx = (now.px - dragging.px) / PX_PER_M;
      const dy = (now.py - dragging.py) / (PX_PER_M * TILT);
      dragging.moved = Math.hypot(dx, dy);
      placePatrol(patrol, dragging.x - dx, dragging.y - dy, { jumped: false, live: false });
      renderLocation();
    });
    const end = (ev) => {
      if (!dragging) return;
      if (dragging.moved > 2) tiles.prefetch(patrol.x, patrol.y, patrol.mapZoom, 1);
      dragging = null;
      profile.save();
      if (ev?.pointerId != null && mapCanvas.hasPointerCapture?.(ev.pointerId)) {
        mapCanvas.releasePointerCapture(ev.pointerId);
      }
    };
    mapCanvas.addEventListener('pointerup', end);
    mapCanvas.addEventListener('pointercancel', end);
  }

  $('opt-map').innerHTML = Object.entries(TILE_PROVIDERS)
    .map(([id, p]) => `<option value="${id}">${p.name}</option>`).join('');
  $('opt-map').value = profile.state.mapProvider ?? DEFAULT_PROVIDER;
  $('opt-map').addEventListener('change', (e) => {
    profile.state.mapProvider = e.target.value;
    profile.save();
    flash('Basemap changed — reload to apply.');
  });

  tiles.prefetch(patrol.x, patrol.y, patrol.mapZoom, 1);
  renderLocation();

  // ---------------------------------------------------------------- rift forecast
  /*
   * Rifts are "scheduled, announced ahead" in 09-risks-and-roadmap.md, and now
   * that each apex's published placement is honoured, being told in advance is the
   * only way Karrahk and Nyxhollow are findable at all: they are 0.4% and 1.1% of
   * rifts. The board scans wider than the live rift list — about 8 km of city over
   * four days — and says when and where each is next due.
   *
   * What it will NOT say, until you have researched the species to II, is *why* a
   * rift carries that apex. The conditions are the Codex's to sell.
   */
  let forecastAt = 0;
  let forecastRows = [];

  function renderForecast(date) {
    const board = $('forecast-board');
    if (profile.rank < RIFT_RANK && !profile.state.devUnlockAll) { board.hidden = true; return; }
    board.hidden = false;

    /*
     * Scanning 49 cells across four days is cheap but not free; once a minute is
     * far more often than a forecast can change.
     *
     * The freshness test is the timer and ONLY the timer. An earlier version also
     * recomputed when `forecastRows` was empty, which looks like a sensible
     * fallback and is a page-freezing bug: on a world seed where no apex is due
     * within range, the empty result is the correct answer and is never cached, so
     * 196 rift schedules were rebuilt on every frame. It presented as the whole app
     * locking up on some profiles and not others.
     */
    const now = date.getTime();
    if (now - forecastAt > 60000) {
      forecastAt = now;
      forecastRows = apexForecast(patrol.x, patrol.y, date, profile.state.seed, patrol.apexById);
    }

    $('forecast').innerHTML = forecastRows.map((r) => {
      const sp = speciesById[r.apexId];
      const when = new Date(r.apexFromMs);
      const mins = Math.round(r.apexInMs / 60000);
      const due = r.apexInMs <= 0 ? 'now'
        : mins < 90 ? `in ${mins}m`
        : when.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
      const researched = profile.researchTier(r.apexId) >= 2;
      const why = researched
        ? `${title(r.biome)} · ${WEATHER[r.weather]?.name ?? r.weather}`
        : 'Research II reveals its conditions';
      return `
        <article class="cast" data-live="${r.apexInMs <= 0}">
          <div class="entry__dot" style="--c:${ELEMENT_COLOUR[sp?.elements[0]] ?? '#888'}"></div>
          <div class="cast__body">
            <b>${sp?.name ?? r.apexId}</b>
            <span>${due} · ${(r.distance / 1000).toFixed(1)} km</span>
            <span class="cast__why" data-known="${researched}">${why}</span>
          </div>
        </article>`;
    }).join('') || '<p class="empty">No apex due in the next four days within range.</p>';
  }

  // ---------------------------------------------------------------- field report
  let reportState = null;

  function openReport(report) {
    reportState = report;
    drawFieldReport($('report-canvas'), report);
    $('report').hidden = false;
  }
  $('report-close').addEventListener('click', () => { $('report').hidden = true; });
  $('report').addEventListener('click', (e) => { if (e.target === $('report')) $('report').hidden = true; });

  const reportName = () =>
    `riftborn-${reportState.species.id}-${new Date(reportState.at ?? Date.now()).toISOString().slice(0, 10)}.png`;

  $('report-save').addEventListener('click', async () => {
    const blob = await toPng($('report-canvas'));
    if (!blob) { flash('Could not render the card on this device.'); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = reportName();
    a.click();
    // Revoke on the next turn of the loop: revoking synchronously races the download.
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });

  $('report-share').addEventListener('click', async () => {
    const blob = await toPng($('report-canvas'));
    if (!blob) { flash('Could not render the card on this device.'); return; }
    const file = new File([blob], reportName(), { type: 'image/png' });
    // navigator.share is the only route off this device, and it is the player
    // pressing it. canShare gates on files because iOS advertises share without them.
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: `RIFTBORN — ${reportState.species.name}` });
        return;
      } catch (err) {
        if (err?.name === 'AbortError') return;     // they changed their mind; not an error
      }
    }
    $('report-save').click();
    flash('This browser cannot share files — the card was saved instead.');
  });

  /** Turn a Codex entry's largest specimen into a card. */
  function reportFromEntry(sp) {
    const e = profile.entry(sp.id);
    if (!e.largest) return null;
    return {
      species: sp,
      outcome: e.largest.outcome,
      method: e.firstMethod ?? '—',
      heightM: e.largest.heightM,
      percentile: e.largest.percentile,
      hpFraction: e.bestHp ?? 0,
      biome: e.lastArea ?? null,
      riftTouched: !!e.largest.riftTouched,
      at: e.largest.at,
      note: `Your largest of ${e.specimens?.count ?? 1}. Catalogued ${e.catalogued}, culled ${e.culled}.`,
    };
  }

  // ---------------------------------------------------------------- codex
  function renderCodex() {
    const done = codexSpecies.filter((s) => ['catalogued', 'researched'].includes(profile.entry(s.id).state)).length;
    $('codex-progress').textContent = `${done} / ${codexSpecies.length} catalogued`;

    $('codex-list').innerHTML = codexSpecies.map((sp) => {
      const e = profile.entry(sp.id);
      const known = ['catalogued', 'researched'].includes(e.state);
      const seen = e.state !== 'unknown';
      const colour = ELEMENT_COLOUR[sp.elements[0]] ?? '#888';
      const next = e.research + 1;

      const lines = [];
      if (known && e.research >= 1) {
        lines.push(`<p class="entry__wp"><b>Weak points:</b> ${sp.weak_points.map(title).join(', ') || 'none'}</p>`);
      }
      if (known && e.research >= 2) {
        lines.push(`<p class="entry__wp"><b>Spawns:</b> ${sp.spawn.biomes.map(title).join(', ')} · ${sp.spawn.time_windows.join('/')}</p>`);
      }
      if (known && e.research >= 3 && sp.evolves_to.length) {
        lines.push(`<p class="entry__wp"><b>Evolves to:</b> ${sp.evolves_to.map((o) =>
          `${speciesById[o.id].name} (${o.study_required} Study, rank ${o.rank_required}${o.condition !== 'none' ? `, ${o.description ?? title(o.condition)}` : ''})`).join('; ')}</p>`);
      }
      if (sp.is_branch_form) lines.push('<p class="entry__first">Branch form — evolution only, never spawns wild</p>');

      /*
       * "Note the bottom panel. The species data is the same for everyone; Your
       * Records is not, and that is what makes the Codex worth opening more than
       * once." — 07-codex-wiki.md.
       */
      const records = [];
      if (e.firstMethod) records.push(['First taken', `${e.firstMethod}${e.firstAt ? ` · ${dateOf(e.firstAt)}` : ''}`]);
      if (e.bestHp) records.push(['Best capture', `${(e.bestHp * 100).toFixed(0)}% HP`]);
      if (e.largest) {
        records.push(['Largest', `${e.largest.heightM.toFixed(2)} m · ${ordinal(e.largest.percentile * 100)} percentile`]);
      }
      if (e.specimens?.count > 1) {
        records.push(['Your average', `${(e.specimens.sumM / e.specimens.count).toFixed(2)} m over ${e.specimens.count}`]);
      }
      if (known) {
        const typical = speciesHeight(sp, sizeById[sp.size]);
        records.push(['Species typical', `${typical.toFixed(2)} m`]);
      }
      if (records.length) {
        lines.push(`<div class="records">
          <h4>Your records</h4>
          <dl>${records.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
          ${e.largest ? `<button class="ghost records__card" data-card="${sp.id}" type="button">Field report</button>` : ''}
        </div>`);
      }

      return `
        <article class="entry" data-state="${e.state}">
          ${seen
            ? `<canvas class="entry__model" width="72" height="72" data-model="${sp.id}" data-touched="${!!e.touchedKept}" data-biome="${e.lastArea ?? ''}"></canvas>`
            : `<div class="entry__dot" style="--c:${colour}"></div>`}
          <div class="entry__body">
            <h3>${seen ? sp.name : '???'} <span class="entry__no">№ ${String(sp.dex).padStart(3, '0')}</span></h3>
            <p class="entry__meta">${seen ? `${sp.elements.join('/')} · ${sp.size} · stage ${sp.stage} · ${title(sp.rarity)}` : 'Not yet sighted'}</p>
            <p class="entry__state">${STATE_LABEL[e.state]}${e.catalogued ? ` · ${e.catalogued} catalogued` : ''}${e.culled ? ` · ${e.culled} culled` : ''}${known ? ` · Research ${e.research}/3` : ''}</p>
            ${e.touchedSeen ? `<p class="entry__touched">${data.elements.rift_touched?.name ?? 'Rift-touched'}: ${
              e.touchedKept ? `${e.touchedKept} kept` : `${e.touchedSeen} seen, none kept`
            }${e.touchedKept && e.touchedSeen > e.touchedKept ? ` · ${e.touchedSeen - e.touchedKept} got away` : ''}</p>` : ''}
            ${lines.join('')}
          </div>
          ${profile.canResearch(sp.id)
            ? `<button class="ghost entry__research" data-species="${sp.id}" type="button">Research ${'I'.repeat(next)} · ${RESEARCH_COST[next]} RP</button>` : ''}
        </article>`;
    }).join('');

    for (const b of document.querySelectorAll('.entry__research')) {
      b.addEventListener('click', () => { profile.research(b.dataset.species); renderCodex(); });
    }
    paintModels();
    for (const b of document.querySelectorAll('.records__card')) {
      b.addEventListener('click', () => {
        const card = reportFromEntry(speciesById[b.dataset.card]);
        if (card) openReport(card);
      });
    }
  }

  /*
   * Every model canvas on screen, drawn once and then only when the angle changes.
   * The Codex is forty entries; redrawing all of them every frame would be forty
   * isometric scenes a frame for a screen that is mostly not moving.
   */
  function paintModels(turns = modelTurns) {
    for (const c of document.querySelectorAll('[data-model]')) {
      const sp = speciesById[c.dataset.model];
      if (!sp) continue;
      const ctx2 = c.getContext('2d');
      ctx2.clearRect(0, 0, c.width, c.height);
      // `data-touched` is what makes a rare specimen stay rare once it is yours.
      // Without it the Codex and the Sanctuary both drew the ordinary model, so
      // the prize disappeared the moment you won it.
      const riftTouched = c.dataset.touched === 'true';
      const biome = c.dataset.biome || null;
      fitModel(ctx2, modelFor(sp, { riftTouched, biome }), { turns, width: c.width, height: c.height, pad: 0.88 });
    }
  }

  let modelTurns = 0.125;
  let spinning = null;
  function startSpin() {
    if (spinning) return;
    spinning = setInterval(() => {
      if (view === 'battle') {
        battleTurns = (battleTurns + 0.006) % 1;
        paintBattleModels();
        return;
      }
      if (view !== 'codex' && view !== 'sanctuary') return;
      modelTurns = (modelTurns + 0.012) % 1;
      paintModels();
    }, 90);
  }
  startSpin();

  // ---------------------------------------------------------------- sanctuary
  function renderSanctuary() {
    const s = profile.state;
    const ctx = ctxFor();
    const bonuses = profile.bonuses;

    const complete = profile.completedFamilies;
    const stageOne = profile.stageOneFamilies;
    $('sanctuary-summary').textContent =
      `${s.residents.length} / ${profile.residentCap} residents · ${profile.habitatSlots} habitats`
      + ` · ${s.stats.evolutions} evolutions · ${complete.length} / ${profile.familyCount} families complete`
      + (complete.length ? ` (+${complete.length} habitat)` : '')
      + ` · ${stageOne.length} / ${profile.familyCount} first stages`
      + (() => {
        // Say who actually goes out, since the answer used to be "whoever was
        // caught first" and nothing anywhere said so.
        const party = profile.party;
        const down = s.residents.filter((r) => (r.hp ?? 1) <= 0).length;
        const tail = down ? ` · ${down} down` : '';
        if (party.length) {
          return ` · party: ${party.map((r) => speciesById[r.speciesId]?.name ?? '?').join(' → ')}${tail}`;
        }
        return (s.residents.length ? ' · no party chosen — the first three go out' : '') + tail;
      })()
      + (profile.permanentMods.length ? ' · Bio-Scanner earned' : '')
      + (profile.escort ? ` · escorting ${speciesById[profile.escort.speciesId]?.name} (${profile.escortAbility?.name ?? '—'})` : ' · no escort');
    $('bonus-list').innerHTML = Object.entries(bonuses).length
      ? Object.entries(bonuses).map(([k, v]) => `<span class="chip chip--good">${title(k)} +${(v * 100).toFixed(0)}%</span>`).join('')
      : '<span class="dev__note">No residents yet — catalogue something and it will live here.</span>';

    $('habitats').innerHTML = Array.from({ length: profile.habitatSlots }, (_, i) => {
      const h = s.habitats[i] ?? { element: null };
      const occupant = s.residents.find((r) => r.habitat === i);
      return `
        <div class="habitat">
          <select data-habitat="${i}">
            <option value="">no affinity</option>
            ${data.elements.elements.filter((e) => e.id !== 'rift').map((e) =>
              `<option value="${e.id}" ${h.element === e.id ? 'selected' : ''}>${e.name}</option>`).join('')}
          </select>
          <span class="habitat__who">${occupant ? speciesById[occupant.speciesId].name : 'empty'}</span>
        </div>`;
    }).join('');

    const pinned = profile.showcase;
    const escortUid = profile.state.escortUid;
    $('residents').innerHTML = s.residents.length ? s.residents.map((r) => {
      const sp = speciesById[r.speciesId];
      const colour = ELEMENT_COLOUR[sp.elements[0]] ?? '#888';
      const options = sp.evolves_to.map((o) => {
        const blocking = blockers(r, sp, o, ctx);
        const target = speciesById[o.id];
        return `
          <div class="evo" data-ready="${blocking.length === 0}">
            <span class="evo__name">→ ${target.name}</span>
            ${blocking.length === 0
              ? `<button class="primary evo__go" data-evolve="${r.uid}" data-target="${o.id}" type="button">Evolve</button>`
              : `<span class="evo__block">${blocking.join(' · ')}</span>`}
          </div>`;
      }).join('');

      const nextGate = sp.evolves_to[0]?.study_required ?? null;
      const pct = nextGate ? Math.min(100, (r.study / nextGate) * 100) : 100;

      return `
        <article class="resident" data-touched="${!!r.riftTouched}">
          <canvas class="entry__model" width="72" height="72" data-model="${sp.id}" data-touched="${!!r.riftTouched}" data-biome="${r.biome ?? ''}"></canvas>
          <div class="resident__body">
            <h3>${sp.name}${r.riftTouched ? ` <span class="touched">${data.elements.rift_touched?.name ?? 'Rift-touched'}</span>` : ''}${
              biomeCoat(r.biome) ? ` <span class="coat">${biomeCoat(r.biome).name}</span>` : ''
            } <span class="entry__no">${sp.elements.join('/')} · stage ${sp.stage}</span></h3>
            <div class="resident__study">
              <div class="meter__track meter__track--slim"><div class="meter__fill meter__fill--restraint" style="width:${pct}%"></div></div>
              <span>${Math.floor(r.study)}${nextGate ? ` / ${nextGate}` : ''} Study</span>
            </div>
            <p class="entry__first">
              ${r.heightM ? `${r.heightM.toFixed(2)} m · ${ordinal((r.percentile ?? 0) * 100)} percentile` : 'unmeasured'}
              ${r.method ? ` · taken with ${ammoById[r.method]?.name ?? r.method}` : ''}
              ${r.biome ? ` · ${title(r.biome)}` : ''}
            </p>
            ${/* Nothing surfaced lineage before: a specimen that had been through two
                 evolutions looked exactly like one caught this morning. */ ''}
            ${(() => {
              const a = escortAbility(sp, data.elements.escort_abilities, data.elements.escort_ability_rules);
              if (!a) return '';
              const bits = [];
              if (a.damage_per_second) bits.push(`${a.damage_per_second.toFixed(0)}/s for ${a.seconds}s`);
              if (a.restraint) bits.push(`+${a.restraint.toFixed(0)} Restraint`);
              if (a.hp) bits.push(`${a.hp.toFixed(0)} absorbed`);
              if (a.status) bits.push(`${a.status} for ${a.seconds.toFixed(1)}s`);
              if (a.armour_pierce) bits.push(`${Math.round(a.armour_pierce * 100)}% armour off for ${a.seconds}s`);
              if (a.effect === 'illuminate') bits.push(`${a.seconds.toFixed(1)}s`);
              return `<p class="entry__first ability"><b style="--c:${ELEMENT_COLOUR[sp.elements[0]]}">${a.name}</b> — ${a.blurb}${bits.length ? ` (${bits.join(' · ')})` : ''}</p>`;
            })()}
            ${(() => {
              /*
               * What this one brings to a battle. None of it was anywhere in the
               * game: the turn-based fight reads level off Study and gives every
               * monster four moves with their own PP, and the Sanctuary showed a
               * Study bar and the ARENA's escort ability and nothing else. You
               * could not find out what your own monster could do without taking
               * it into a fight and opening the menu.
               */
              const lvl = levelOf(r, sp);
              const c = makeCombatant(sp, lvl, data, { resident: r });
              const moves = movesFor(sp, data).map((m) => {
                const what = m.applies ? `leaves it ${m.applies}`
                  : m.applies_self ? `${m.applies_self} on itself`
                  : `${m.power} pw`;
                const pp = m.pp == null ? '∞' : m.pp;
                return `<li><b style="--c:${ELEMENT_COLOUR[m.element] ?? '#888'}">${m.name}</b>`
                  + `<span>${m.element ? title(m.element) : 'untyped'} · ${what}`
                  + `${m.priority > 0 ? ' · quick' : m.priority < 0 ? ' · slow' : ''} · ${pp} PP</span></li>`;
              }).join('');
              // Condition: what it walked out of its last fight with.
              const cond = Math.max(0, Math.min(1, r.hp ?? 1));
              const down = cond <= 0;
              const cost = profile.mendCost(r.uid);
              return `
                <div class="kit" data-down="${down}">
                  <p class="kit__head">Lv.${lvl} · ${c.maxHp} HP · ${c.attack.toFixed(0)} atk`
                   + ` · ${Math.round(c.armour * 100)}% armour · ${c.speed} spd</p>
                  <div class="kit__cond">
                    <div class="meter__track meter__track--slim">
                      <div class="meter__fill meter__fill--hp" style="width:${cond * 100}%"
                           data-state="${down ? 'critical' : cond > 0.5 ? 'ok' : 'low'}"></div>
                    </div>
                    <span>${down ? 'down' : `${Math.round(cond * 100)}% fit`}</span>
                    ${cost > 0
                      ? `<button class="ghost" data-mend="${r.uid}" type="button"
                           ${profile.state.essence >= cost ? '' : 'disabled'}>Mend ${cost} ess</button>`
                      : '<span class="kit__ready">ready</span>'}
                  </div>
                  <ul class="kit__moves">${moves}</ul>
                </div>`;
            })()}
            ${(r.evolvedFrom ?? []).length
              ? `<p class="entry__first">Raised from ${r.evolvedFrom.map((id) => speciesById[id]?.name ?? id).join(' → ')} → ${sp.name}</p>`
              : ''}
            ${options || '<p class="entry__first">Fully evolved</p>'}
            <div class="resident__actions">
              <select data-assign="${r.uid}">
                <option value="">unassigned</option>
                ${Array.from({ length: profile.habitatSlots }, (_, i) =>
                  `<option value="${i}" ${r.habitat === i ? 'selected' : ''}>Habitat ${i + 1}${s.habitats[i]?.element ? ` (${s.habitats[i].element})` : ''}</option>`).join('')}
              </select>
              ${sp.elements.map((el) => `<button class="ghost" data-feed="${r.uid}" data-el="${el}" type="button" ${profile.canFeed(r, el) ? '' : 'disabled'}>Feed ${el}</button>`).join('')}
              ${(() => {
                const at = profile.partyIndex(r.uid);
                const label = at < 0 ? 'Add to party' : ['Lead', '2nd', '3rd'][at] ?? `#${at + 1}`;
                return `<button class="ghost" data-party="${r.uid}" data-active="${at >= 0}" type="button">${label}</button>`;
              })()}
              <button class="ghost" data-escort="${r.uid}" data-active="${escortUid === r.uid}" type="button">${escortUid === r.uid ? 'Escorting' : 'Escort'}</button>
              <button class="ghost" data-pin="${r.uid}" data-active="${pinned.includes(r.uid)}" type="button">${pinned.includes(r.uid) ? 'Unpin' : 'Showcase'}</button>
              <button class="ghost" data-release="${r.uid}" type="button">Release</button>
            </div>
          </div>
        </article>`;
    }).join('') : '<p class="empty">No residents. Catalogue something and it will live here.</p>';

    paintModels();
    for (const el of document.querySelectorAll('[data-habitat]')) {
      el.addEventListener('change', () => { profile.setHabitatElement(Number(el.dataset.habitat), el.value || null); renderSanctuary(); });
    }
    for (const el of document.querySelectorAll('[data-assign]')) {
      el.addEventListener('change', () => { profile.assignHabitat(el.dataset.assign, el.value === '' ? null : Number(el.value)); renderSanctuary(); });
    }
    for (const b of document.querySelectorAll('[data-escort]')) {
      b.addEventListener('click', () => { profile.setEscort(b.dataset.escort); renderSanctuary(); });
    }
    for (const b of document.querySelectorAll('[data-mend]')) {
      b.addEventListener('click', () => {
        if (profile.mend(b.dataset.mend)) { renderSanctuary(); renderWarden(); }
      });
    }
    for (const b of document.querySelectorAll('[data-party]')) {
      b.addEventListener('click', () => {
        profile.toggleParty(b.dataset.party, data.elements.battle_rules.party_size ?? 3);
        renderSanctuary();
      });
    }
    for (const b of document.querySelectorAll('[data-pin]')) {
      b.addEventListener('click', () => {
        if (!profile.togglePin(b.dataset.pin)) flash('Three specimens is the whole showcase — unpin one first.');
        renderSanctuary();
      });
    }
    for (const b of document.querySelectorAll('[data-feed]')) {
      b.addEventListener('click', () => { profile.feed(b.dataset.feed, b.dataset.el); renderSanctuary(); });
    }
    for (const b of document.querySelectorAll('[data-release]')) {
      b.addEventListener('click', () => { profile.release(b.dataset.release); renderSanctuary(); });
    }
    for (const b of document.querySelectorAll('[data-evolve]')) {
      b.addEventListener('click', () => {
        const target = profile.evolve(b.dataset.evolve, b.dataset.target);
        renderSanctuary();
        if (target) flash(`It became a ${target.name}.`);
      });
    }
  }


  // ---------------------------------------------------------------- mods
  const PCT = (v) => `${v > 0 ? '+' : '\u2212'}${Math.round(Math.abs(v) * 100)}%`;

  const MOD_EFFECT_TEXT = {
    range_m: (v) => `${PCT(v)} range`,
    rpm: (v) => `${PCT(v)} rate of fire`,
    magazine: (v) => `${PCT(v)} magazine`,
    reload_seconds: (v) => `${PCT(v)} reload time`,
    restraint: (v) => `${PCT(v)} Restraint`,
    damage: (v) => `${PCT(v)} damage`,
    spread: (v) => `${PCT(v)} spread`,
    noise_step: (v) => (v < 0 ? 'a step quieter' : 'a step louder'),
    armour_pierce: (v) => `${PCT(v)} armour pierce`,
    recoil: (v) => `${PCT(v)} recoil`,
    zoom: () => '+15% reach',
    highlight_weak_points: () => 'marks weak points you have researched',
    show_restraint_meter: () => 'exact Restraint figures, not a coarse bar',
    show_flee_threshold: () => 'reads the flee chance live',
    reveal_gloom: () => 'holds a hidden weak point lit',
    reveal_through_cover: () => null,          // no cover in this arena; footnoted below
  };

  const MOD_REQUIREMENT = {
    research_1: (p) => ['Research 5 species to Research I', `${p.researchI} / 5`],
    research_2: (p) => ['Research 3 species to Research II', `${p.researchII} / 3`],
  };

  function modEffectText(mod) {
    return Object.entries(mod.effect ?? {})
      // `?? k` would resurrect a key whose formatter deliberately returns null.
      .map(([k, v]) => (k in MOD_EFFECT_TEXT ? MOD_EFFECT_TEXT[k](v) : k))
      .filter(Boolean)
      .join(' \u00b7 ');
  }

  // ---------------------------------------------------------------- loadout
  let editingSlot = 0;

  function renderLoadout() {
    const slots = profile.state.loadout.slots ?? [null, null];
    const unlocked = profile.unlockedWeapons;
    const current = slots[editingSlot];
    const weapon = current ? weaponById[current.weaponId] : null;

    const slotCards = [0, 1].map((i) => {
      const sl = slots[i];
      const w = sl ? weaponById[sl.weaponId] : null;
      const fitted = sl ? Object.values(fittedMods(sl)).length : 0;
      const rounds = sl
        ? [ammoById[sl.lethalId]?.name, sl.captureId ? ammoById[sl.captureId]?.name : 'no capture round',
           fitted ? `${fitted} mod${fitted > 1 ? 's' : ''}` : null]
            .filter(Boolean).join(' · ')
        : 'empty';
      return `
        <button class="slotcard" data-slot="${i}" data-active="${i === editingSlot}" type="button">
          <span class="slotcard__key">${i + 1}</span>
          <span class="slotcard__body">
            <b>${w ? w.name : 'No weapon'}</b>
            <span>${rounds}</span>
          </span>
        </button>`;
    }).join('');

    const weaponCards = data.weapons.weapons.map((w) => {
      const open = unlocked.includes(w.id);
      const inOther = slots.some((sl, i) => sl && i !== editingSlot && sl.weaponId === w.id);
      return `
        <button class="wcard" data-weapon="${w.id}" data-active="${current?.weaponId === w.id}" ${open ? '' : 'disabled'} type="button">
          <b>${w.name}${inOther ? ' <span class="wcard__dup">(in the other slot)</span>' : ''}</b>
          <span>${w.damage}${w.projectiles > 1 ? `×${w.projectiles}` : ''} dmg · ${w.restraint || '—'} res · ${w.rpm} rpm · ${w.range_m}m · mag ${w.magazine}${w.noise === 'silent' ? ' · silent' : ''}</span>
          <span class="wcard__note">${open ? w.identity : `Locked — Warden rank ${WEAPON_UNLOCK[w.id]}`}</span>
        </button>`;
    }).join('');

    const rounds = (kind) => {
      if (!weapon) return '<p class="empty">Pick a weapon for this slot first.</p>';
      const list = kind === 'lethal' ? weapon.lethal_ammo : weapon.capture_ammo;
      if (!list.length) return '<p class="empty">This weapon takes no round of that kind — it is pure setup.</p>';
      return list.map((id) => {
        const a = ammoById[id];
        const cost = AMMO_COST[id] ?? { essence: 0 };
        const owned = profile.ammoCount(id);
        const active = (kind === 'lethal' ? current.lethalId : current.captureId) === id;
        const price = [`${cost.essence * 5}e`, ...Object.entries(cost.mats ?? {}).map(([el, n]) => `${n * 5} ${el}`)].join(' ');
        return `
          <div class="round" data-active="${active}">
            <button class="round__pick" data-kind="${kind}" data-ammo="${id}" type="button">
              <b>${a.name}</b>
              <span>${kind === 'lethal' ? `×${a.damage_multiplier} dmg` : `×${a.restraint_multiplier} res`}${a.element ? ` · ${a.element}` : ''}${a.applies ? ` · ${a.applies}` : ''}${a.silent ? ' · silent' : ''}</span>
            </button>
            <span class="round__owned">${owned}</span>
            <button class="ghost round__craft" data-ammo="${id}" type="button" ${profile.canCraft(id, 5) ? '' : 'disabled'}>+5 · ${price}</button>
          </div>`;
      }).join('');
    };

    /*
     * The field kit is what a patrol can do about a wounded party without
     * walking home. Crafted one at a time rather than five, because these are
     * dear on purpose: a Deep Salve costs more than mending the same monster at
     * the Sanctuary, and what you are paying the difference for is the walk.
     */
    const fieldKit = () => (data.ammo.field ?? []).map((f) => {
      const cost = ITEM_COST[f.id] ?? { essence: 0 };
      const price = [`${cost.essence}e`, ...Object.entries(cost.mats ?? {}).map(([el, n]) => `${n} ${el}`)].join(' ');
      const what = f.revives_to ? `back up at ${Math.round(f.revives_to * 100)}%`
        : f.restores_hp ? `${Math.round(f.restores_hp * 100)}% of the bar`
        : `+${f.restores_pp} PP on every move`;
      return `
        <div class="round">
          <span class="round__pick" data-static="true">
            <b>${f.name}</b>
            <span>${what} \u00b7 ${f.in_battle ? 'usable in a fight, costs the turn' : 'between fights only'}</span>
          </span>
          <span class="round__owned">${profile.itemCount(f.id)}</span>
          <button class="ghost round__craftitem" data-item="${f.id}" type="button" ${profile.canCraft(f.id, 1) ? '' : 'disabled'}>+1 \u00b7 ${price}</button>
        </div>`;
    }).join('');

    const modCards = () => {
      if (!weapon) return '<p class="empty">Pick a weapon for this slot first.</p>';
      const progress = profile.codexProgress;
      return MOD_SLOTS.map((cat) => {
        const cards = (data.weapons.mods[cat] ?? []).map((mod) => {
          const open = modUnlocked(mod, progress);
          const [why, count] = open ? ['', ''] : (MOD_REQUIREMENT[mod.requires]?.(progress) ?? ['Locked', '']);
          const fitted = current.mods?.[cat] === mod.id;
          return `
            <button class="modcard" data-mod="${mod.id}" data-cat="${cat}" data-active="${fitted}"
                    ${open ? '' : 'disabled'} type="button">
              <b>${mod.name}</b>
              <span>${modEffectText(mod)}</span>
              ${open ? '' : `<span class="modcard__lock">${why} \u00b7 ${count}</span>`}
            </button>`;
        }).join('');
        return `<h3 class="modrail__head">${cat}</h3><div class="modcards">${cards}</div>`;
      }).join('')
      + '<p class="dev__note">One mod per category. A stock weapon has no recoil at all, so Fast Cycle'
      + ' is a real trade and Stabiliser only earns its slot next to something that shakes. A Suppressor'
      + ' steps you towards silence and stops one rung short of it \u2014 true silence, and the Ambush'
      + ' multiplier that comes with it, stays the Sylvan Bow\u2019s. Thermal\u2019s see-through-cover'
      + ' line does nothing here: this arena has no cover.</p>';
    };

    const fittedLine = () => {
      if (!weapon) return '';
      const ids = Object.values(fittedMods(current)).filter(Boolean);
      if (!ids.length) return '<p class="dev__note">Stock \u2014 no mods fitted. A stock weapon has no recoil at all.</p>';
      const fit = applyMods(weapon, ids, data.weapons.mods);
      const w2 = fit.weapon;
      const delta = (label, a, b, unit = '') => (Math.abs(a - b) < 0.05 ? ''
        : `<span class="fitted__d" data-up="${b > a}">${label} ${a}${unit} \u2192 ${Math.round(b * 10) / 10}${unit}</span>`);
      const extras = [
        delta('dmg', weapon.damage, w2.damage),
        delta('res', weapon.restraint, w2.restraint),
        delta('rpm', weapon.rpm, w2.rpm),
        delta('range', weapon.range_m, w2.range_m, 'm'),
        delta('mag', weapon.magazine, w2.magazine),
        weapon.noise !== w2.noise ? `<span class="fitted__d" data-up="true">noise ${weapon.noise} \u2192 ${w2.noise}</span>` : '',
        fit.armourPierce ? `<span class="fitted__d" data-up="true">pierce ${Math.round(fit.armourPierce * 100)}%</span>` : '',
        fit.recoil ? `<span class="fitted__d" data-up="false">recoil ${Math.round(fit.recoil * 100)}%</span>` : '',
      ].filter(Boolean).join('');
      return `<div class="fitted">${extras || '<span class="fitted__d">sight only \u2014 no change to the numbers</span>'}</div>`;
    };

    $('loadout-body').innerHTML = `
      <h2>Weapon slots</h2>
      <div class="slotcards">${slotCards}</div>
      ${slots[editingSlot] ? `<button class="ghost" id="clear-slot" type="button">Empty this slot</button>` : ''}
      <h2>Weapon for slot ${editingSlot + 1}</h2>
      <div class="wcards">${weaponCards}</div>
      <h2>Chamber A — lethal</h2>
      <div class="rounds">${rounds('lethal')}</div>
      <h2>Chamber B — capture</h2>
      <div class="rounds">${rounds('capture')}</div>
      <h2>Field kit</h2>
      <div class="rounds">${fieldKit()}</div>
      <h2>Mods for slot ${editingSlot + 1}</h2>
      ${fittedLine()}
      <div class="modrail">${modCards()}</div>
      <p class="dev__note">Two slots, per the design: two lethal profiles, two capture profiles, or one of each. <b>Q</b> cycles weapons mid-fight and takes ${WEAPON_SWAP_SECONDS}s — longer than the ${data.weapons.chamber_swap_seconds}s chamber swap. This is what makes an apex takeable: anchor it with the Tether Harpoon, switch, and subdue with something that actually restrains. You carry ${CARRY.lethal} lethal and ${CARRY.capture} capture rounds per weapon.</p>`;

    for (const b of document.querySelectorAll('.slotcard')) {
      b.addEventListener('click', () => { editingSlot = Number(b.dataset.slot); renderLoadout(); });
    }
    const clear = $('clear-slot');
    if (clear) clear.addEventListener('click', () => {
      if (profile.slots.length <= 1) { flash('You need at least one weapon.'); return; }
      profile.setSlot(editingSlot, null);
      renderLoadout();
    });
    for (const b of document.querySelectorAll('[data-weapon]')) {
      b.addEventListener('click', () => {
        const w = weaponById[b.dataset.weapon];
        profile.setSlot(editingSlot, {
          weaponId: w.id,
          lethalId: w.lethal_ammo[0] ?? null,
          captureId: w.capture_ammo[0] ?? null,
          // Mods are fitted to the weapon, not the slot: a new gun comes stock.
          mods: current?.weaponId === w.id ? (current.mods ?? {}) : {},
        });
        renderLoadout();
      });
    }
    for (const b of document.querySelectorAll('.round__pick')) {
      b.addEventListener('click', () => {
        const sl = { ...profile.slotAt(editingSlot) };
        sl[b.dataset.kind === 'lethal' ? 'lethalId' : 'captureId'] = b.dataset.ammo;
        profile.setSlot(editingSlot, sl);
        renderLoadout();
      });
    }
    for (const b of document.querySelectorAll('.round__craft')) {
      b.addEventListener('click', () => { profile.craft(b.dataset.ammo, 5); renderLoadout(); });
    }
    for (const b of document.querySelectorAll('.round__craftitem')) {
      b.addEventListener('click', () => { profile.craft(b.dataset.item, 1); renderLoadout(); });
    }
    for (const b of document.querySelectorAll('.modcard')) {
      b.addEventListener('click', () => { profile.setMod(editingSlot, b.dataset.cat, b.dataset.mod); renderLoadout(); });
    }
  }

  // ---------------------------------------------------------------- loop
  let last = performance.now();
  let accumulator = 0;
  let studyClock = 0;

  function frame(now) {
    let elapsed = (now - last) / 1000;
    last = now;
    if (elapsed > 0.25) elapsed = 0.25;
    accumulator += elapsed;

    try {
      while (accumulator >= FIXED_DT) {
        if (view === 'patrol') stepPatrol(patrol, FIXED_DT, mapInput.getIntent({ player: { x: 0, y: 0, aim: 0 } }));
        else if (view === 'fight' && fight) step(fight, FIXED_DT, input.getIntent(fight));
        accumulator -= FIXED_DT;
      }
    } catch (err) {
      accumulator = 0;
      // Log each DISTINCT failure rather than only the first ever seen. The
      // one-shot guard kept the console quiet, which is what it was for, but it
      // also meant an early unrelated throw silenced the one that would have
      // explained a later failure.
      frame.seen = frame.seen ?? new Set();
      if (!frame.seen.has(`step:${err.message}`)) {
        frame.seen.add(`step:${err.message}`);
        console.error('[riftborn] step error', err);
      }
    }

    /*
     * The periodic study tick. This used to sit here unguarded, between the two
     * try blocks rather than inside either — so a throw from tickStudy or from a
     * save escaped `frame` entirely, the requestAnimationFrame at the bottom was
     * never reached, and the app froze mid-fight with the outcome already set and
     * no result card. That is the same stranded-in-a-finished-fight symptom this
     * branch already fixed once in the HUD, surviving in the five lines between
     * the two guards, and firing only every five seconds, which is why it showed
     * up as an occasional unreproducible failure rather than a bug.
     *
     * The whole body is guarded now and the loop re-arms in a finally, so the
     * question "is every line covered" has one answer instead of one per block.
     */
    studyClock += elapsed;
    if (studyClock > 5) { studyClock = 0; if (profile.tickStudy()) profile.save(); }

    try {
      if (view === 'patrol') {
        drawPatrol(mapCtx, patrol, mapView, speciesById);
        renderPatrolHud();
      } else if (view === 'fight' && fight) {
        // Before the drawing, and in its own try: a fight that has ended must
        // say so even if the HUD cannot render.
        try { checkFightResolved(); } catch (err) { console.error('[riftborn] resolve error', err); }
        draw(fightCtx, fight, {
          ...fightView,
          // The Tracker Lens marks what you already researched; it doesn't teach
          // you a weak point you have never studied.
          showWeakPoints: profile.weakPointsKnown(fight.loadout.species.id),
          markWeakPoints: !!fight.loadout.modFlags?.highlightWeakPoints,
          coarseRestraint: !fight.loadout.modFlags?.showRestraintNumbers,
        });
        renderFightHud(elapsed);
      }
    } catch (err) {
      frame.seen = frame.seen ?? new Set();
      if (!frame.seen.has(`frame:${err.message}`)) {
        frame.seen.add(`frame:${err.message}`);
        console.error('[riftborn] frame error', err);
      }
    }
    requestAnimationFrame(frame);
  }

  /* Test/console helper: evaluate a resident's evolution blockers, optionally at a
     given hour, so branch conditions can be checked without waiting for midnight. */
  window.__riftbornBlockers = (resident, species, hour) => {
    const ctx = ctxFor();
    if (hour !== undefined) { ctx.date = new Date(ctx.date); ctx.date.setHours(hour); }
    const option = species.evolves_to.find((o) => (hour === undefined ? true : o.condition !== 'none'))
      ?? species.evolves_to[0];
    return option ? blockers(resident, species, option, ctx) : ['fully evolved'];
  };

  window.__riftborn = {
    profile, patrol, speciesById, data,
    get view() { return view; },
    get fight() { return fight; },
    show, startFight, startBattle, renderSanctuary, renderContracts, renderParty,
    /*
     * Regenerate the spawns around the Warden, synchronously. The browser suites
     * used to walk by nudging patrol.x and then sleeping 60ms per step to let the
     * animation frame catch up — up to 2.65 seconds of doing nothing per
     * encounter, in checks that set up dozens of them. This is the same work
     * without the waiting.
     */
    refreshSpawns: () => stepPatrol(patrol, 0, { moveX: 0, moveY: 0 }),
    drawTileSkin, drawPatrol, BIOMES, reportFromEntry,
    TILT, structuresOn, drawStructures, drawTileSkyline, standsUp,
    get battle() { return battle; },
    takeTurn: (a) => takeTurn(battle, a), battleOptions: () => options(battle),
    // For driving a battle the app does not own — a harness building its own.
    takeTurnOn: (b, a) => takeTurn(b, a), optionsOn: (b) => options(b),
    finishBattle, renderBattle,
    catchChance: (ammo) => catchChance(battle, ammo),
    makeCombatant, createBattle, levelOf, wildLevel, movesFor, activeMon,
    computeMoveDamage, remaining, studyFromBattle, studyAsMinutes, concealed,
    phaseAt, phaseCount, apexPhaseTable, canUse, ppLeft, usableMoves, conditionOf,
    loadLoadout, applyMods, modUnlocked, fittedMods,
    speciesHeight, rollSpecimen, heightPercentile, createFight, drawFieldReport,
    escortAbility, useEscort, cycleLock, assistPhase, assistMiss, ringSeconds,
    buildModel, modelFor, fitModel, spriteFor, clearVoxelCache, ELEMENT_RAMP,
    apexForecast, riftForCell, placementFits, inTimeWindow, weatherIs, biomeAt,
    PLACEMENT_VOCABULARY, WEATHER, visibleSpawns,
    locator, tiles, createTileSource, placePatrol, biomeUnderfoot, biomeAtWorld,
    lonLatToWorld, worldToLonLat, groundScale, groundMetres,
    tileAt, tileOrigin, tileSpan, tileUrl, normaliseTile, biomeFromPixel, TILE_PROVIDERS,
    step, weakPointPositions,
    /** One modelled body shot, for suites that need a damage number without a trigger pull. */
    applyLethalForTest: (f, m) => applyLethal(f, m, f.loadout.ammo.lethal, 'body'),
    teleportTo(spawn) { patrol.x = spawn.x; patrol.y = spawn.y; },
  };

  $('opt-combat').value = profile.state.combatMode ?? 'turn';
  $('opt-aim').value = profile.state.aimMode ?? 'free';
  $('opt-unlock').checked = Boolean(profile.state.devUnlockAll);
  $('opt-study').value = profile.state.devStudyRate;
  $('study-label').textContent = `×${profile.state.devStudyRate}`;
  $('opt-weather').innerHTML = '<option value="">live (simulated)</option>'
    + Object.entries(WEATHER).map(([id, w]) => `<option value="${id}">${w.name}</option>`).join('');
  renderContracts();
  renderParty();
  show('patrol');
  $('boot').hidden = true;
  requestAnimationFrame(frame);
}

/*
 * Register the service worker so the game installs to a home screen and keeps
 * working with no signal. Failure here is never fatal — the page runs fine
 * without it, and it simply will not be available over file://.
 */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          // A new build is ready and an old one is still controlling the page.
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            const el = $('patrol-flash');
            if (el) {
              el.textContent = 'Update ready — reload to apply.';
              el.hidden = false;
            }
          }
        });
      });
    }).catch((err) => console.warn('[sw] registration failed', err));
  });
}

loadData()
  .then(boot)
  .catch((err) => {
    const el = $('boot');
    el.className = 'boot boot--error';
    el.textContent = `Could not start.\n\n${err.message}\n\n`
      + 'This page fetches its data files, so it needs serving over http:\n\n'
      + '    python3 -m http.server -d docs 8000\n\n'
      + 'then open http://localhost:8000/riftborn/';
  });
