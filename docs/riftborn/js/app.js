/*
 * RIFTBORN phase 2 — app shell.
 *
 * Patrol, fight, Codex, Sanctuary, bench. The loop that phase 1 opened now closes
 * on itself: culling funds the darts, darts fill the Codex, the Codex reveals weak
 * points and spawn windows, captures become residents, residents evolve into things
 * you have never seen — which need catalogueing too.
 */

import { loadLoadout, applyMods, modUnlocked } from './rules.js';
import { createFight, step, readouts, activeStatuses, WEAPON_SWAP_SECONDS } from './game.js';
import { fitCanvas, draw } from './render.js';
import { createInput } from './input.js';
import { createProfile, AMMO_COST, RANK_XP, WEAPON_UNLOCK, RESEARCH_COST } from './profile.js';
import { buildPool, WEATHER, RIFT_RANK, RIFT_RADIUS_M } from './world.js';
import { blockers } from './sanctuary.js';
import { createPatrol, stepPatrol, drawPatrol, patrolClock, biomeUnderfoot, ELEMENT_COLOUR } from './patrol.js';

const DATA_FILES = ['elements', 'sizes', 'weapons', 'ammo', 'monsters'];
const CARRY = { lethal: 24, capture: 12 };
const FIXED_DT = 1 / 60;

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString();
const title = (s) => String(s).replace(/_/g, ' ');

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

  const profile = createProfile({
    speciesById,
    elementDefs: data.elements.elements,
    bonusCap: data.elements.sanctuary_bonus_cap_per_element ?? 0.15,
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
  const patrol = createPatrol(profile, [...pool, ...riftPool], apexById);
  let view = 'patrol';
  let fight = null;
  let fightSpawn = null;
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
  const VIEWS = ['patrol', 'fight', 'codex', 'sanctuary', 'loadout'];
  function show(next) {
    view = next;
    for (const v of VIEWS) $(`view-${v}`).hidden = v !== next;
    for (const t of document.querySelectorAll('.tab')) t.dataset.active = String(t.dataset.view === next);
    if (next === 'codex') renderCodex();
    if (next === 'sanctuary') renderSanctuary();
    if (next === 'loadout') renderLoadout();
    if (next === 'patrol') mapView = fitCanvas(mapCanvas);
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
  $('engage-go').addEventListener('click', () => { if (patrol.nearest) startFight(patrol.nearest); });

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

    const near = patrol.nearest;
    $('engage').hidden = !near;
    if (near) {
      const sp = speciesById[near.speciesId];
      const e = profile.entry(sp.id);
      const pack = near.packSize ?? 1;
      $('engage-name').textContent = pack > 1 ? `${sp.name} ×${pack}` : sp.name;
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

    fight = createFight(loadouts, {
      carried, bonuses: profile.bonuses,
      packSize: spawn.packSize ?? 1,
      partySize: 1,                       // solo is the only party this build can field
    });
    const loadout = fight.loadout;
    fightSpawn = spawn;
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
        weaponId: active?.weaponId ?? null,
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

    if (f.outcome && shownOutcome !== f.outcome) {
      shownOutcome = f.outcome;
      finishFight();
      showOutcome(f);
    }
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
    $('overlay').hidden = false;
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
      if (e.firstMethod) lines.push(`<p class="entry__first">First taken with ${e.firstMethod}</p>`);
      if (e.bestHp) lines.push(`<p class="entry__first">Best capture at ${(e.bestHp * 100).toFixed(0)}% HP</p>`);
      if (sp.is_branch_form) lines.push('<p class="entry__first">Branch form — evolution only, never spawns wild</p>');

      return `
        <article class="entry" data-state="${e.state}">
          <div class="entry__dot" style="--c:${colour}"></div>
          <div class="entry__body">
            <h3>${seen ? sp.name : '???'} <span class="entry__no">№ ${String(sp.dex).padStart(3, '0')}</span></h3>
            <p class="entry__meta">${seen ? `${sp.elements.join('/')} · ${sp.size} · stage ${sp.stage} · ${title(sp.rarity)}` : 'Not yet sighted'}</p>
            <p class="entry__state">${STATE_LABEL[e.state]}${e.catalogued ? ` · ${e.catalogued} catalogued` : ''}${e.culled ? ` · ${e.culled} culled` : ''}${known ? ` · Research ${e.research}/3` : ''}</p>
            ${lines.join('')}
          </div>
          ${profile.canResearch(sp.id)
            ? `<button class="ghost entry__research" data-species="${sp.id}" type="button">Research ${'I'.repeat(next)} · ${RESEARCH_COST[next]} RP</button>` : ''}
        </article>`;
    }).join('');

    for (const b of document.querySelectorAll('.entry__research')) {
      b.addEventListener('click', () => { profile.research(b.dataset.species); renderCodex(); });
    }
  }

  // ---------------------------------------------------------------- sanctuary
  function renderSanctuary() {
    const s = profile.state;
    const ctx = ctxFor();
    const bonuses = profile.bonuses;

    $('sanctuary-summary').textContent =
      `${s.residents.length} / ${profile.residentCap} residents · ${profile.habitatSlots} habitats · ${s.stats.evolutions} evolutions`;
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
        <article class="resident">
          <div class="entry__dot" style="--c:${colour}"></div>
          <div class="resident__body">
            <h3>${sp.name} <span class="entry__no">${sp.elements.join('/')} · stage ${sp.stage}</span></h3>
            <div class="resident__study">
              <div class="meter__track meter__track--slim"><div class="meter__fill meter__fill--restraint" style="width:${pct}%"></div></div>
              <span>${Math.floor(r.study)}${nextGate ? ` / ${nextGate}` : ''} Study</span>
            </div>
            ${r.method ? `<p class="entry__first">Taken with ${ammoById[r.method]?.name ?? r.method}</p>` : ''}
            ${options || '<p class="entry__first">Fully evolved</p>'}
            <div class="resident__actions">
              <select data-assign="${r.uid}">
                <option value="">unassigned</option>
                ${Array.from({ length: profile.habitatSlots }, (_, i) =>
                  `<option value="${i}" ${r.habitat === i ? 'selected' : ''}>Habitat ${i + 1}${s.habitats[i]?.element ? ` (${s.habitats[i].element})` : ''}</option>`).join('')}
              </select>
              ${sp.elements.map((el) => `<button class="ghost" data-feed="${r.uid}" data-el="${el}" type="button" ${profile.canFeed(r, el) ? '' : 'disabled'}>Feed ${el}</button>`).join('')}
              <button class="ghost" data-release="${r.uid}" type="button">Release</button>
            </div>
          </div>
        </article>`;
    }).join('') : '<p class="empty">No residents. Catalogue something and it will live here.</p>';

    for (const el of document.querySelectorAll('[data-habitat]')) {
      el.addEventListener('change', () => { profile.setHabitatElement(Number(el.dataset.habitat), el.value || null); renderSanctuary(); });
    }
    for (const el of document.querySelectorAll('[data-assign]')) {
      el.addEventListener('change', () => { profile.assignHabitat(el.dataset.assign, el.value === '' ? null : Number(el.value)); renderSanctuary(); });
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
      if (!frame.warnedStep) { console.error('[riftborn] step error', err); frame.warnedStep = true; }
    }

    studyClock += elapsed;
    if (studyClock > 5) { studyClock = 0; if (profile.tickStudy()) profile.save(); }

    /*
     * Never let one bad frame end the game. An exception escaping this callback
     * means requestAnimationFrame is never re-armed and the whole app silently
     * freezes — which is exactly what a temporal-dead-zone slip in the rift
     * drawing did: the loop died the moment a rift came within range.
     */
    try {
      if (view === 'patrol') {
        drawPatrol(mapCtx, patrol, mapView, speciesById);
        renderPatrolHud();
      } else if (view === 'fight' && fight) {
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
      if (!frame.warned) { console.error('[riftborn] frame error', err); frame.warned = true; }
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
    show, startFight, renderSanctuary, renderContracts,
    loadLoadout, applyMods, modUnlocked, fittedMods,
    teleportTo(spawn) { patrol.x = spawn.x; patrol.y = spawn.y; },
  };

  $('opt-unlock').checked = Boolean(profile.state.devUnlockAll);
  $('opt-study').value = profile.state.devStudyRate;
  $('study-label').textContent = `×${profile.state.devStudyRate}`;
  $('opt-weather').innerHTML = '<option value="">live (simulated)</option>'
    + Object.entries(WEATHER).map(([id, w]) => `<option value="${id}">${w.name}</option>`).join('');
  renderContracts();
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
