/*
 * RIFTBORN phase 0 — bootstrap, loop and HUD.
 *
 * Phase 0 scope, straight from the roadmap: one monster (Cinderfang), one weapon
 * (Marker Pistol), both chambers, in a grey box. No map, no AR, no progression.
 * The only question this build answers is whether the kill-or-capture decision
 * is tense.
 */

import { loadLoadout } from './rules.js';
import { createFight, step, readouts, activeStatuses } from './game.js';
import { fitCanvas, draw } from './render.js';
import { createInput } from './input.js';

const DATA_FILES = ['elements', 'sizes', 'weapons', 'ammo', 'monsters'];
const LOADOUT = { speciesId: 'cinderfang', weaponId: 'marker_pistol', lethalId: 'ball_round', captureId: 'tranq_dart' };
const CARRIED = { lethal: 24, capture: 12 };
const FIXED_DT = 1 / 60;

const $ = (id) => document.getElementById(id);

const VERDICTS = {
  culled: ['CULLED', 'Materials banked, fast and certain. Nothing for the Codex — and an uncatalogued species culled is marked Data Lost.'],
  catalogued: ['CATALOGUED', 'Tagged and recorded. It goes to the Sanctuary, gains Study, and eventually becomes something you have not seen.'],
  escaped: ['ESCAPED', 'It got out. All that ammunition spent and the entry is still blank.'],
  driven_off: ['DRIVEN OFF', 'Out of rounds or out of health. The spawn is gone either way.'],
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
  const loadout = loadLoadout(data, LOADOUT);
  const canvas = $('stage');
  const ctx = canvas.getContext('2d');
  const input = createInput(canvas);

  let view = fitCanvas(canvas);
  const opts = { showWeakPoints: true, requireProximityToTag: false };
  let fight = createFight(loadout, { carried: CARRIED, requireProximityToTag: opts.requireProximityToTag });
  let restraintPeak = 0;
  let shownOutcome = null;

  // ---- static labels
  $('monster-name').textContent = loadout.species.name;
  $('monster-meta').textContent =
    `${loadout.species.elements.join('/')} · ${loadout.sizeDef.name} · vs ${loadout.weapon.name}`;
  $('lethal-round').textContent = loadout.ammo.lethal.name;
  $('capture-round').textContent = loadout.ammo.capture.name;

  function restart() {
    fight = createFight(loadout, { carried: CARRIED, requireProximityToTag: opts.requireProximityToTag });
    restraintPeak = 0;
    shownOutcome = null;
    $('overlay').hidden = true;
  }

  // ---- controls
  $('again').addEventListener('click', restart);
  $('btn-swap').addEventListener('click', () => input.pulse('swap'));
  $('btn-reload').addEventListener('click', () => input.pulse('reload'));
  $('btn-tag').addEventListener('click', () => input.pulse('tag'));
  for (const el of [$('chamber-lethal'), $('chamber-capture')]) {
    el.addEventListener('click', () => {
      if (fight.weapon.chamber !== el.dataset.chamber) input.pulse('swap');
    });
  }
  $('dev-toggle').addEventListener('click', (e) => {
    const dev = $('dev');
    dev.hidden = !dev.hidden;
    e.currentTarget.setAttribute('aria-expanded', String(!dev.hidden));
  });
  $('opt-weakpoints').addEventListener('change', (e) => { opts.showWeakPoints = e.target.checked; });
  $('opt-proximity').addEventListener('change', (e) => {
    opts.requireProximityToTag = e.target.checked;
    fight.requireProximityToTag = e.target.checked;
  });
  window.addEventListener('keydown', (e) => {
    if (fight.outcome !== null && (e.code === 'Enter' || e.code === 'Space')) { e.preventDefault(); restart(); }
  });
  window.addEventListener('resize', () => { view = fitCanvas(canvas); });

  // ---- loop
  let last = performance.now();
  let accumulator = 0;

  function frame(now) {
    let elapsed = (now - last) / 1000;
    last = now;
    if (elapsed > 0.25) elapsed = 0.25;          // a backgrounded tab must not fast-forward the fight
    accumulator += elapsed;

    while (accumulator >= FIXED_DT) {
      step(fight, FIXED_DT, input.getIntent(fight));
      accumulator -= FIXED_DT;
    }

    draw(ctx, fight, { ...view, showWeakPoints: opts.showWeakPoints });
    updateHud(fight, elapsed);
    requestAnimationFrame(frame);
  }

  function updateHud(f, elapsed) {
    const r = readouts(f);
    const m = f.monster;

    const hpFrac = Math.max(0, m.hp / m.maxHp);
    $('hp-fill').style.width = `${hpFrac * 100}%`;
    $('hp-value').textContent = `${Math.ceil(Math.max(0, m.hp))} / ${m.maxHp}`;

    const rFrac = Math.min(1, m.restraint / r.required);
    restraintPeak = Math.max(rFrac, restraintPeak - elapsed * 0.6);
    $('restraint-fill').style.width = `${rFrac * 100}%`;
    $('restraint-decay').style.width = `${restraintPeak * 100}%`;
    $('restraint-value').textContent = `${m.restraint.toFixed(0)} / ${r.required.toFixed(0)}`;

    const chips = activeStatuses(m).map((id) => {
      const good = ['sedated', 'ensnared', 'stunned', 'anchored', 'chilled', 'calmed'].includes(id);
      const cls = id === 'enraged' ? 'chip--bad' : good ? 'chip--good' : 'chip--warn';
      return `<span class="chip ${cls}">${id}</span>`;
    });
    if (m.state === 'flee') chips.push('<span class="chip chip--bad">fleeing</span>');
    if (!m.aware) chips.push('<span class="chip chip--warn">unaware</span>');
    $('statuses').innerHTML = chips.join('');

    for (const kind of ['lethal', 'capture']) {
      const el = $(`chamber-${kind}`);
      el.dataset.active = String(f.weapon.chamber === kind);
      $(`${kind}-ammo`).textContent = `${f.weapon.mag[kind]} / ${f.weapon.reserve[kind]}`;
    }

    $('warden-fill').style.width = `${(f.player.hp / f.player.maxHp) * 100}%`;
    const w = f.weapon;
    $('busy').textContent = w.swapT > 0 ? `SWAPPING ${w.swapT.toFixed(1)}s`
      : w.reloadT > 0 ? `RELOADING ${w.reloadT.toFixed(1)}s`
      : w.mag[w.chamber] === 0 ? (w.reserve[w.chamber] > 0 ? 'EMPTY — RELOAD' : 'OUT OF ROUNDS') : '';

    if (!$('dev').hidden) {
      $('dev-readout').innerHTML = [
        ['chamber', f.weapon.chamber],
        ['wound ×', r.wound.toFixed(2)],
        ['status ×', r.statusProduct.toFixed(2)],
        ['per body hit', r.bodyValue.toFixed(1)],
        ['per weak hit', r.weakValue.toFixed(1)],
        ['restraint', `${m.restraint.toFixed(1)} / ${r.required.toFixed(0)}`],
        ['decay /s', r.decay.toFixed(2)],
        ['flee /s', `${(r.fleeChance * 100).toFixed(0)}%`],
        ['monster', m.state],
        ['hits', `${f.stats.hits}/${f.stats.shots}`],
      ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    }

    if (f.outcome && shownOutcome !== f.outcome) {
      shownOutcome = f.outcome;
      showOutcome(f);
    }
  }

  function showOutcome(f) {
    const [title, blurb] = VERDICTS[f.outcome];
    $('verdict').textContent = f.stats.cleanCapture ? 'CLEAN CAPTURE' : title;
    $('verdict-blurb').textContent = f.stats.cleanCapture
      ? 'Subdued above 80% health. That is the flex — and it cost you every material the kill would have dropped.'
      : blurb;

    const acc = f.stats.shots ? (f.stats.hits / f.stats.shots) * 100 : 0;
    const rows = [
      ['Time', `${f.outcomeAt.toFixed(1)}s`],
      ['Shots fired', f.stats.shots],
      ['Hits', `${f.stats.hits} (${acc.toFixed(0)}%)`],
      ['Weak point hits', f.stats.weakHits],
      ['Rounds left', `${f.weapon.mag.lethal + f.weapon.reserve.lethal} ball · ${f.weapon.mag.capture + f.weapon.reserve.capture} dart`],
      ['Times hit', f.stats.playerHits],
      ['Chamber swaps', f.stats.swaps],
    ];
    if (f.stats.failedSubdues) rows.push(['Missed tag windows', f.stats.failedSubdues]);
    if (f.outcome === 'catalogued') rows.push(['HP at subdue', `${(f.stats.hpFractionAtResolve * 100).toFixed(0)}%`]);
    $('results').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    $('overlay').hidden = false;
  }

  $('boot').hidden = true;
  requestAnimationFrame(frame);
}

loadData()
  .then(boot)
  .catch((err) => {
    const boot = $('boot');
    boot.className = 'boot boot--error';
    boot.textContent =
      `Could not start.\n\n${err.message}\n\n`
      + 'This page fetches its data files, so it needs to be served over http rather than\n'
      + 'opened from the filesystem. From the repository root:\n\n'
      + '    python3 -m http.server -d docs 8000\n\n'
      + 'then open http://localhost:8000/riftborn/';
  });
