/*
 * RIFTBORN phase 1 — app shell.
 *
 * Routes between the patrol map, a fight, the Codex and the loadout bench, and
 * carries the consequences between them: what you spend, what you learn, what the
 * Codex records.
 */

import { loadLoadout } from './rules.js';
import { createFight, step, readouts, activeStatuses } from './game.js';
import { fitCanvas, draw } from './render.js';
import { createInput } from './input.js';
import { createProfile, AMMO_COST, RANK_XP, WEAPON_UNLOCK } from './profile.js';
import { buildPool, ENGAGE_M } from './world.js';
import { createPatrol, stepPatrol, drawPatrol, patrolClock, biomeUnderfoot, VIEW, ELEMENT_COLOUR } from './patrol.js';

const DATA_FILES = ['elements', 'sizes', 'weapons', 'ammo', 'monsters'];
const FAMILIES = ['cinder', 'crag', 'volt'];
const PHASE1_WEAPONS = ['marker_pistol', 'longtooth', 'sylvan_bow'];
const PHASE1_AMMO = ['ball_round', 'piercing_round', 'incendiary', 'cryo_round', 'broadhead', 'tranq_dart', 'rune_arrow'];

/* A pouch, not your whole stock. Keeps per-fight pressure while the economy runs
 * across a session. */
const CARRY = { lethal: 24, capture: 12 };
const FIXED_DT = 1 / 60;

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString();

const VERDICTS = {
  culled: ['CULLED', 'Materials banked, fast and certain. Nothing for the Codex.'],
  catalogued: ['CATALOGUED', 'Tagged and recorded. The entry is yours.'],
  escaped: ['ESCAPED', 'It got out. All that ammunition spent and the entry is still blank.'],
  driven_off: ['DRIVEN OFF', 'Out of rounds or out of health. The spawn is gone either way.'],
};

const STATE_LABEL = {
  unknown: 'Unknown', sighted: 'Sighted', encountered: 'Encountered',
  data_lost: 'Data Lost', catalogued: 'Catalogued', researched: 'Researched',
};

async function loadData() {
  const entries = await Promise.all(DATA_FILES.map(async (name) => {
    const res = await fetch(`data/${name}.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`data/${name}.json → HTTP ${res.status}`);
    return [name, await res.json()];
  }));
  return Object.fromEntries(entries);
}

function boot(data) {
  const profile = createProfile();
  const pool = buildPool(data.monsters.monsters, FAMILIES);
  const family = data.monsters.monsters.filter((m) => FAMILIES.includes(m.family));
  const speciesById = Object.fromEntries(data.monsters.monsters.map((m) => [m.id, m]));
  const ammoById = Object.fromEntries([...data.ammo.lethal, ...data.ammo.capture].map((a) => [a.id, a]));
  const weaponById = Object.fromEntries(data.weapons.weapons.map((w) => [w.id, w]));

  const mapCanvas = $('map');
  const fightCanvas = $('stage');
  const mapCtx = mapCanvas.getContext('2d');
  const fightCtx = fightCanvas.getContext('2d');
  const input = createInput(fightCanvas);
  const mapInput = createInput(mapCanvas, { allTouchSteers: true });

  const patrol = createPatrol(profile, pool);
  let view = 'patrol';
  let fight = null;
  let fightSpawn = null;
  let mapView = fitCanvas(mapCanvas);
  let fightView = fitCanvas(fightCanvas);
  let restraintPeak = 0;
  let shownOutcome = null;

  // ---------------------------------------------------------------- routing

  function show(next) {
    view = next;
    for (const v of ['patrol', 'fight', 'codex', 'loadout']) $(`view-${v}`).hidden = v !== next;
    for (const t of document.querySelectorAll('.tab')) {
      t.dataset.active = String(t.dataset.view === next);
    }
    if (next === 'codex') renderCodex();
    if (next === 'loadout') renderLoadout();
    if (next === 'patrol') { mapView = fitCanvas(mapCanvas); }
    if (next === 'fight') { fightView = fitCanvas(fightCanvas); }
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
    $('alloy').textContent = fmt(s.alloy);
    $('rp').textContent = fmt(s.researchPoints);
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
  $('opt-unlock').addEventListener('change', (e) => {
    profile.state.devUnlockAll = e.target.checked;
    profile.save();
    if (view === 'loadout') renderLoadout();
  });
  $('reset-profile').addEventListener('click', () => {
    if (confirm('Reset this Warden? Codex, rank and inventory are all lost.')) {
      profile.reset();
      location.reload();
    }
  });
  $('engage-go').addEventListener('click', () => { if (patrol.nearest) startFight(patrol.nearest); });

  function renderPatrolHud() {
    const { date, window: win } = patrolClock(patrol);
    $('clock').textContent = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')} ${win}`;
    $('biome').textContent = biomeUnderfoot(patrol).replace('_', ' ');
    $('spawn-count').textContent = `${patrol.spawns.length} in range`;

    const near = patrol.nearest;
    $('engage').hidden = !near;
    if (near) {
      const sp = speciesById[near.speciesId];
      const e = profile.entry(sp.id);
      $('engage-name').textContent = sp.name;
      $('engage-meta').textContent =
        `${sp.elements.join('/')} · ${sp.size} · ${sp.rarity.replace('_', ' ')} · ${STATE_LABEL[e.state]}`;
    }
  }

  // ---------------------------------------------------------------- fight

  function startFight(spawn) {
    const sp = speciesById[spawn.speciesId];
    const L = profile.state.loadout;
    const loadout = loadLoadout(data, {
      speciesId: sp.id, weaponId: L.weaponId, lethalId: L.lethalId, captureId: L.captureId,
    });
    const carried = {
      lethal: Math.min(profile.ammoCount(L.lethalId), CARRY.lethal),
      capture: Math.min(profile.ammoCount(L.captureId), CARRY.capture),
    };
    if (carried.lethal + carried.capture === 0) {
      alert('No rounds for this loadout. Craft some at the Loadout bench.');
      show('loadout');
      return;
    }

    fight = createFight(loadout, { carried });
    fightSpawn = spawn;
    restraintPeak = 0;
    shownOutcome = null;
    $('overlay').hidden = true;
    $('monster-name').textContent = sp.name;
    $('monster-meta').textContent = `${sp.elements.join('/')} · ${loadout.sizeDef.name} · ${sp.aggression}`;
    $('lethal-round').textContent = loadout.ammo.lethal.name;
    $('capture-round').textContent = loadout.ammo.capture.name;
    show('fight');
  }

  /** Rounds fired are gone, whether the fight resolved or you walked away. */
  function spendFired() {
    const L = profile.state.loadout;
    const w = fight.weapon;
    profile.spendAmmo(L.lethalId, w.carried.lethal - (w.mag.lethal + w.reserve.lethal));
    profile.spendAmmo(L.captureId, w.carried.capture - (w.mag.capture + w.reserve.capture));
  }

  /*
   * Withdrawing. An Obelisc is, by design, "a fight you choose, entirely, and can
   * walk away from at any point" — and a rank-1 Warden who meets a Colossus needs
   * that door.
   *
   * The cost is whether it noticed you. Back out before it is aware and the spawn
   * is still standing when you come back; back out after you have woken it and it
   * clears off. That makes scouting a real option and gives the silent Sylvan Bow
   * one more reason to exist.
   */
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

  /** Brief non-blocking note on the patrol strip. */
  let flashTimer = null;
  function flash(text) {
    const el = $('patrol-flash');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { el.hidden = true; }, 4000);
  }

  function finishFight() {
    const sp = fight.loadout.species;
    spendFired();

    const before = { xp: profile.state.xp, ess: profile.state.essence, alloy: profile.state.alloy, rp: profile.state.researchPoints };
    profile.recordOutcome(sp, fight.outcome, {
      clean: fight.stats.cleanCapture,
      hpFraction: fight.stats.hpFractionAtResolve,
      method: `${fight.loadout.weapon.name} · ${fight.loadout.ammo.capture.name}`,
    });
    profile.resolve(fightSpawn.id);

    const after = profile.state;
    const gains = [];
    if (after.xp - before.xp) gains.push(`+${fmt(after.xp - before.xp)} XP`);
    if (after.essence - before.ess) gains.push(`+${fmt(after.essence - before.ess)} essence`);
    if (after.alloy - before.alloy) gains.push(`+${fmt(after.alloy - before.alloy)} alloy`);
    if (after.researchPoints - before.rp) gains.push(`+${fmt(after.researchPoints - before.rp)} RP`);
    $('rewards').textContent = gains.join(' · ') || 'Nothing gained.';
  }

  $('again').addEventListener('click', () => show('patrol'));
  $('withdraw').addEventListener('click', withdraw);
  $('btn-swap').addEventListener('click', () => input.pulse('swap'));
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
    if (fight?.outcome && (e.code === 'Enter' || e.code === 'Space')) {
      e.preventDefault();
      show('patrol');
    } else if (e.code === 'Escape') {
      e.preventDefault();
      withdraw();
    }
  });
  window.addEventListener('resize', () => {
    mapView = fitCanvas(mapCanvas);
    fightView = fitCanvas(fightCanvas);
  });

  function renderFightHud(elapsed) {
    const f = fight;
    const r = readouts(f);
    const m = f.monster;

    $('hp-fill').style.width = `${Math.max(0, m.hp / m.maxHp) * 100}%`;
    $('hp-value').textContent = `${Math.ceil(Math.max(0, m.hp))} / ${m.maxHp}`;

    const rFrac = Math.min(1, m.restraint / r.required);
    restraintPeak = Math.max(rFrac, restraintPeak - elapsed * 0.6);
    $('restraint-fill').style.width = `${rFrac * 100}%`;
    $('restraint-decay').style.width = `${restraintPeak * 100}%`;
    $('restraint-value').textContent = `${m.restraint.toFixed(0)} / ${r.required.toFixed(0)}`;

    const chips = activeStatuses(m).map((id) => {
      const cls = id === 'enraged' ? 'chip--bad'
        : ['sedated', 'ensnared', 'stunned', 'anchored', 'chilled', 'calmed'].includes(id) ? 'chip--good' : 'chip--warn';
      return `<span class="chip ${cls}">${id}</span>`;
    });
    if (m.state === 'flee') chips.push('<span class="chip chip--bad">fleeing</span>');
    if (!m.aware) chips.push('<span class="chip chip--warn">unaware</span>');
    if (f.anchorBlocked) chips.push('<span class="chip chip--bad">needs a Tether Harpoon to subdue</span>');
    $('statuses').innerHTML = chips.join('');

    for (const kind of ['lethal', 'capture']) {
      $(`chamber-${kind}`).dataset.active = String(f.weapon.chamber === kind);
      $(`${kind}-ammo`).textContent = `${f.weapon.mag[kind]} / ${f.weapon.reserve[kind]}`;
    }
    $('warden-fill').style.width = `${(f.player.hp / f.player.maxHp) * 100}%`;

    const w = f.weapon;
    const draw = f.loadout.weapon.charge_seconds ?? 0;
    $('busy').textContent = w.swapT > 0 ? `SWAPPING ${w.swapT.toFixed(1)}s`
      : w.reloadT > 0 ? `RELOADING ${w.reloadT.toFixed(1)}s`
      : draw && w.charge > 0 ? `DRAWING ${Math.round((w.charge / draw) * 100)}%`
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
    const [title, blurb] = VERDICTS[f.outcome];
    const sp = f.loadout.species;
    const e = profile.entry(sp.id);
    $('verdict').textContent = f.stats.cleanCapture ? 'CLEAN CAPTURE' : title;
    $('verdict-blurb').textContent = f.outcome === 'culled' && e.state === 'data_lost'
      ? 'Culled before it was ever catalogued. The entry is marked Data Lost — you can still repair it by catalogueing one later, but the first-capture bonus is gone.'
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
    const done = family.filter((s) => ['catalogued', 'researched'].includes(profile.entry(s.id).state)).length;
    $('codex-progress').textContent = `${done} / ${family.length} catalogued`;

    $('codex-list').innerHTML = family.map((sp) => {
      const e = profile.entry(sp.id);
      const known = ['catalogued', 'researched'].includes(e.state);
      const seen = e.state !== 'unknown';
      const colour = ELEMENT_COLOUR[sp.elements[0]] ?? '#888';
      const wp = e.research >= 1 ? sp.weak_points.map((w) => w.replace(/_/g, ' ')).join(', ') || 'none'
        : '<em>research to reveal</em>';

      return `
        <article class="entry" data-state="${e.state}">
          <div class="entry__dot" style="--c:${colour}"></div>
          <div class="entry__body">
            <h3>${seen ? sp.name : '???'} <span class="entry__no">№ ${String(sp.dex).padStart(3, '0')}</span></h3>
            <p class="entry__meta">${seen ? `${sp.elements.join('/')} · ${sp.size} · stage ${sp.stage} · ${sp.rarity.replace('_', ' ')}` : 'Not yet sighted'}</p>
            <p class="entry__state">${STATE_LABEL[e.state]}${e.catalogued ? ` · ${e.catalogued} catalogued` : ''}${e.culled ? ` · ${e.culled} culled` : ''}</p>
            ${known ? `<p class="entry__wp"><b>Weak points:</b> ${wp}</p>` : ''}
            ${e.firstMethod ? `<p class="entry__first">First taken with ${e.firstMethod}</p>` : ''}
            ${e.bestHp ? `<p class="entry__first">Best capture at ${(e.bestHp * 100).toFixed(0)}% HP</p>` : ''}
            ${sp.is_branch_form ? '<p class="entry__first">Branch form — evolution only, never spawns wild</p>' : ''}
          </div>
          ${profile.canResearch(sp.id) ? `<button class="ghost entry__research" data-species="${sp.id}" type="button">Research I · 1 RP</button>` : ''}
        </article>`;
    }).join('');

    for (const b of document.querySelectorAll('.entry__research')) {
      b.addEventListener('click', () => { profile.research(b.dataset.species); renderCodex(); });
    }
  }

  // ---------------------------------------------------------------- loadout

  function renderLoadout() {
    const L = profile.state.loadout;
    const unlocked = profile.unlockedWeapons.filter((w) => PHASE1_WEAPONS.includes(w));
    const weapon = weaponById[L.weaponId];

    const weaponCards = PHASE1_WEAPONS.map((id) => {
      const w = weaponById[id];
      const open = unlocked.includes(id);
      return `
        <button class="wcard" data-weapon="${id}" data-active="${id === L.weaponId}" ${open ? '' : 'disabled'} type="button">
          <b>${w.name}</b>
          <span>${w.damage} dmg · ${w.restraint} res · ${w.rpm} rpm · ${w.range_m}m · mag ${w.magazine}</span>
          <span class="wcard__note">${open ? w.identity : `Locked — Warden rank ${WEAPON_UNLOCK[id]}`}</span>
        </button>`;
    }).join('');

    const rounds = (kind) => {
      const list = (kind === 'lethal' ? weapon.lethal_ammo : weapon.capture_ammo).filter((a) => PHASE1_AMMO.includes(a));
      if (!list.length) return '<p class="empty">This weapon has no round of that kind.</p>';
      return list.map((id) => {
        const a = ammoById[id];
        const cost = AMMO_COST[id];
        const owned = profile.ammoCount(id);
        const active = (kind === 'lethal' ? L.lethalId : L.captureId) === id;
        return `
          <div class="round" data-active="${active}">
            <button class="round__pick" data-kind="${kind}" data-ammo="${id}" type="button">
              <b>${a.name}</b>
              <span>${kind === 'lethal' ? `×${a.damage_multiplier} dmg` : `×${a.restraint_multiplier} res`}${a.element ? ` · ${a.element}` : ''}${a.applies ? ` · ${a.applies}` : ''}</span>
            </button>
            <span class="round__owned">${owned}</span>
            <button class="ghost round__craft" data-ammo="${id}" data-n="5" type="button" ${profile.canCraft(id, 5) ? '' : 'disabled'}>
              +5 · ${cost.essence * 5}e${cost.alloy ? ` ${cost.alloy * 5}a` : ''}
            </button>
          </div>`;
      }).join('');
    };

    $('loadout-body').innerHTML = `
      <h2>Weapon</h2>
      <div class="wcards">${weaponCards}</div>
      <h2>Chamber A — lethal</h2>
      <div class="rounds">${rounds('lethal')}</div>
      <h2>Chamber B — capture</h2>
      <div class="rounds">${rounds('capture')}</div>
      <p class="dev__note">You carry ${CARRY.lethal} lethal and ${CARRY.capture} capture rounds into a fight; the rest stays here. Culling pays 3× the alloy of a capture — that is what funds the darts.</p>`;

    for (const b of document.querySelectorAll('[data-weapon]')) {
      b.addEventListener('click', () => {
        const w = weaponById[b.dataset.weapon];
        profile.state.loadout = {
          weaponId: w.id,
          lethalId: w.lethal_ammo.find((a) => PHASE1_AMMO.includes(a)) ?? null,
          captureId: w.capture_ammo.find((a) => PHASE1_AMMO.includes(a)) ?? null,
        };
        profile.save();
        renderLoadout();
      });
    }
    for (const b of document.querySelectorAll('.round__pick')) {
      b.addEventListener('click', () => {
        profile.state.loadout[b.dataset.kind === 'lethal' ? 'lethalId' : 'captureId'] = b.dataset.ammo;
        profile.save();
        renderLoadout();
      });
    }
    for (const b of document.querySelectorAll('.round__craft')) {
      b.addEventListener('click', () => { profile.craft(b.dataset.ammo, Number(b.dataset.n)); renderLoadout(); });
    }
  }

  // ---------------------------------------------------------------- loop

  let last = performance.now();
  let accumulator = 0;

  function frame(now) {
    let elapsed = (now - last) / 1000;
    last = now;
    if (elapsed > 0.25) elapsed = 0.25;
    accumulator += elapsed;

    while (accumulator >= FIXED_DT) {
      if (view === 'patrol') stepPatrol(patrol, FIXED_DT, mapInput.getIntent({ player: { x: 0, y: 0, aim: 0 } }));
      else if (view === 'fight' && fight) step(fight, FIXED_DT, input.getIntent(fight));
      accumulator -= FIXED_DT;
    }

    if (view === 'patrol') {
      drawPatrol(mapCtx, patrol, mapView, speciesById);
      renderPatrolHud();
    } else if (view === 'fight' && fight) {
      draw(fightCtx, fight, {
        ...fightView,
        showWeakPoints: profile.weakPointsKnown(fight.loadout.species.id),
      });
      renderFightHud(elapsed);
    }
    requestAnimationFrame(frame);
  }

  /* Debug handle. It is a prototype: being able to poke the world from the console
     (and from the smoke test) is worth more than hiding it. */
  window.__riftborn = {
    profile, patrol, speciesById,
    get view() { return view; },
    get fight() { return fight; },
    show, startFight,
    teleportTo(spawn) { patrol.x = spawn.x; patrol.y = spawn.y; },
  };

  $('opt-unlock').checked = Boolean(profile.state.devUnlockAll);
  show('patrol');
  $('boot').hidden = true;
  requestAnimationFrame(frame);
}

loadData()
  .then(boot)
  .catch((err) => {
    const el = $('boot');
    el.className = 'boot boot--error';
    el.textContent =
      `Could not start.\n\n${err.message}\n\n`
      + 'This page fetches its data files, so it needs serving over http:\n\n'
      + '    python3 -m http.server -d docs 8000\n\n'
      + 'then open http://localhost:8000/riftborn/';
  });
