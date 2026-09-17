import { chromium } from 'playwright';

// executablePath is only needed where the browser is not on Playwright's own path.
const LAUNCH = process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {};
const URL = process.env.RIFTBORN_URL ?? 'http://127.0.0.1:8765/riftborn/';
const browser = await chromium.launch(LAUNCH);
const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
/*
 * A failing check must FAIL THE RUN. Until this counted, every suite exited on
 * console errors alone: a red FAIL line printed, the runner read exit code 0,
 * and the run announced "all suites passed" underneath it. A check that cannot
 * fail the build is a comment with extra steps.
 */
let fails = 0;
const ok = (l, c, x = '') => { if (!c) fails++; console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x ? '  — ' + x : ''}`); };

/** Start a battle against a named species with a chosen team. */
await page.addInitScript(() => {
  window.battleWith = async (teamIds, wildId, opts = {}) => {
    const r = window.__riftborn;
    r.profile.state.devUnlockAll = true;
    r.profile.state.residents = [];
    r.profile.state.escortUid = null;
    Object.assign(r.profile.state.ammo, { tranq_dart: 30, heavy_sedative_dart: 20 });
    for (const id of teamIds) {
      const sp = r.data.monsters.monsters.find((m) => m.id === id);
      r.profile.admit(sp, { heightM: 1, percentile: 0.5 });
      r.profile.state.residents.at(-1).study = opts.study ?? 900;
    }
    r.profile.save();

    r.show('patrol');
    await new Promise((d) => setTimeout(d, 250));
    for (let i = 0; i < 40 && r.patrol.spawns.length === 0; i++) {
      r.patrol.x += 90; r.patrol.y += 40;
      await new Promise((d) => setTimeout(d, 60));
    }
    const base = r.patrol.spawns[0];
    if (!base) return null;
    r.teleportTo(base);
    r.startBattle({ ...base, id: `b-${Math.random()}`, speciesId: wildId, packSize: opts.packSize ?? 1 });
    await new Promise((d) => setTimeout(d, 350));
    return r.battle;
  };

  /*
   * Play a battle to its end with a fixed policy, straight through the engine.
   * Deliberately NOT by clicking: the menu is rebuilt every turn and an earlier
   * suite of mine spent a while chasing a stale button rather than a real bug.
   */
  window.playOut = (policy = 'fight') => {
    const r = window.__riftborn;
    const b = r.battle;
    for (let i = 0; i < 200 && !b.outcome; i++) {
      const o = r.battleOptions();
      if (policy === 'catch' && b.wild.hp / b.wild.maxHp < 0.5) {
        const ammo = r.data.ammo.capture.find((a) => r.profile.ammoCount(a.id) > 0);
        if (ammo) { r.takeTurn({ kind: 'catch', ammoId: ammo.id }); continue; }
      }
      // Whichever move hits hardest, which is what a competent player converges on.
      let best = 0, bestI = 0;
      o.moves.forEach((m, j) => {
        const d = r.computeMoveDamage(r.activeMon(b) ?? b.wild, b.wild, m, r.data, () => 0.5).damage;
        if (d > best) { best = d; bestI = j; }
      });
      r.takeTurn({ kind: 'move', index: bestI });
    }
    return b;
  };
});

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__riftborn !== undefined, null, { timeout: 8000 });

// --- 1. every species can field a move set
const moves = await page.evaluate(() => {
  const r = window.__riftborn;
  const rows = r.data.monsters.monsters.map((sp) => ({
    id: sp.id,
    n: r.movesFor(sp, r.data).length,
    typed: r.movesFor(sp, r.data).filter((m) => m.element).length,
  }));
  return {
    total: rows.length,
    min: Math.min(...rows.map((x) => x.n)),
    untypedOnly: rows.filter((x) => x.typed === 0).map((x) => x.id),
    // Every species now has at least four moves, so "more than the base kit"
    // is what marks a dual-element one: two typed pairs plus a status each.
    dual: rows.filter((x) => x.n > 4).length,
  };
});
ok('every species knows a move set drawn from its elements',
   moves.min >= 3 && moves.untypedOnly.length === 0,
   `${moves.total} species · at least ${moves.min} moves each`
   + ` · ${moves.dual} dual-element species get both pairs`);

// --- 2. the type chart is the loudest term in the damage formula
const chart = await page.evaluate(() => {
  const r = window.__riftborn;
  const sp = (id) => r.data.monsters.monsters.find((m) => m.id === id);
  const at = (atkId, defId, el) => {
    const A = r.makeCombatant(sp(atkId), 12, r.data);
    const D = r.makeCombatant(sp(defId), 12, r.data, { wild: true });
    const mv = A.moves.find((m) => m.element === el);
    return r.computeMoveDamage(A, D, mv, r.data, () => 0.5);
  };
  return {
    good: at('brinelet', 'cinderfang', 'tide'),
    bad: at('cinderfang', 'brinelet', 'ember'),
  };
});
ok('super effective hits harder than not very effective, across a big stat gap',
   chart.good.damage > chart.bad.damage
   && chart.good.note === 'super effective' && chart.bad.note === 'not very effective',
   `a Mote's Tide move into a Strider: ${chart.good.damage} (${chart.good.note})`
   + ` · the Strider's Ember move back: ${chart.bad.damage} (${chart.bad.note})`);

// --- 3. the catch roll still rewards softening and sedating
const catching = await page.evaluate(async () => {
  const r = window.__riftborn;
  await window.battleWith(['brinelet'], 'cinderfang');
  const b = r.battle;
  const tranq = r.data.ammo.capture.find((a) => a.id === 'tranq_dart');
  const heavy = r.data.ammo.capture.find((a) => a.id === 'heavy_sedative_dart');
  const at = (hpFrac, statuses = {}) => {
    b.wild.hp = b.wild.maxHp * hpFrac;
    b.wild.statuses = { ...statuses };
    return r.catchChance(tranq).chance;
  };
  const full = at(1);
  const hurt = at(0.3);
  const hurtSedated = at(0.3, { sedated: 4 });
  b.wild.hp = b.wild.maxHp * 0.3; b.wild.statuses = {};
  const heavier = r.catchChance(heavy).chance;
  return { full, hurt, hurtSedated, heavier, tranqAt30: at(0.3) };
});
ok('a wounded, sedated target is easier to take — the old Restraint maths, intact',
   catching.hurt > catching.full && catching.hurtSedated > catching.hurt
   && catching.heavier > catching.tranqAt30,
   `healthy ${(catching.full * 100).toFixed(0)}% → wounded ${(catching.hurt * 100).toFixed(0)}%`
   + ` → wounded and sedated ${(catching.hurtSedated * 100).toFixed(0)}%`
   + ` · a heavy dart beats a tranq (${(catching.heavier * 100).toFixed(0)}% vs ${(catching.tranqAt30 * 100).toFixed(0)}%)`);

// --- 4. a failed capture still lands its sedative
const shake = await page.evaluate(async () => {
  const r = window.__riftborn;
  await window.battleWith(['brinelet'], 'cinderfang');
  const b = r.battle;
  b.rng = () => 0.999;                       // never catches
  b.wild.hp = b.wild.maxHp;
  const before = { ...b.wild.statuses };
  const lines = r.takeTurn({ kind: 'catch', ammoId: 'tranq_dart' });
  return { before, after: { ...b.wild.statuses }, spent: b.spent.tranq_dart, lines: lines.map((l) => l.text) };
});
ok('a dart that does not take still takes hold',
   Object.keys(shake.before).length === 0 && shake.after.sedated > 0 && shake.spent === 1,
   `shook free, but sedated for ${shake.after.sedated} turns · the round is spent either way`);

// --- 5. speed and priority decide who moves first
const order = await page.evaluate(async () => {
  const r = window.__riftborn;
  await window.battleWith(['brinelet'], 'cinderfang');
  const b = r.battle;
  b.rng = () => 0.5;
  const mine = r.activeMon(b);
  // A quick move should land before a faster opponent's ordinary one.
  mine.speed = 1; b.wild.speed = 99;
  const quick = mine.moves.findIndex((m) => (m.priority ?? 0) > 2);
  b.wild.hp = b.wild.maxHp;
  const lines = r.takeTurn({ kind: 'move', index: quick >= 0 ? quick : 0 });
  const first = lines.find((l) => /used/.test(l.text))?.text ?? '';
  return { quick: quick >= 0, first, mineName: mine.species.name };
});
ok('a quick move goes before a faster opponent',
   order.quick && order.first.startsWith(order.mineName),
   `${order.mineName} is far slower and still acted first: "${order.first}"`);

// --- 6. faint, swap, and running out of monsters
const bench = await page.evaluate(async () => {
  const r = window.__riftborn;
  await window.battleWith(['brinelet', 'sootpup'], 'cinderfang');
  const b = r.battle;
  const swapped = r.takeTurn({ kind: 'swap', index: 1 });
  const afterSwap = r.activeMon(b).species.name;
  // Knock the whole bench over and check the battle ends rather than hanging.
  for (const c of b.team) { c.hp = 1; }
  let guard = 0;
  while (!b.outcome && guard++ < 30) r.takeTurn({ kind: 'move', index: 0 });
  return { team: b.team.length, afterSwap, swappedSaid: swapped.some((l) => /send out/i.test(l.text)), outcome: b.outcome };
});
ok('you can swap, and a wiped bench ends the battle',
   bench.team === 2 && bench.afterSwap === 'Sootpup' && bench.swappedSaid
   && ['wiped', 'defeated', 'caught', 'escaped'].includes(bench.outcome),
   `swapped to ${bench.afterSwap} · battle resolved as "${bench.outcome}" rather than hanging`);

// --- 7. the opening battle, with no monsters at all, is winnable
const opening = await page.evaluate(async () => {
  const r = window.__riftborn;
  let won = 0, turns = 0;
  /*
   * Thirty, not sixty. Each opening walks the patrol to find a spawn and then
   * fights it out, and once the comparable-damage cap doubled fight length this
   * one check was taking longer than the other twenty-eight put together. Thirty
   * still separates "winnable" from "a formality" at the band this asserts.
   */
  const N = 30;
  for (let i = 0; i < N; i++) {
    await window.battleWith([], 'sootpup');
    const b = r.battle;
    if (!b) return null;
    let g = 0;
    while (!b.outcome && g++ < 60) r.takeTurn({ kind: 'move', index: 0 });
    if (b.outcome === 'defeated' || b.outcome === 'caught') won++;
    turns += b.turn;
  }
  return { won, N, turns: turns / N, wardenOnly: r.battle.wardenOnly };
});
ok('a Warden with no monsters can still win their first fight',
   opening.wardenOnly && opening.won / opening.N > 0.4 && opening.won / opening.N < 0.95,
   `${((opening.won / opening.N) * 100).toFixed(0)}% of ${opening.N} openings won,`
   + ` ${opening.turns.toFixed(1)} turns on average — winnable, not a formality`);

// --- 8. a catch writes the monster into the Codex and the Sanctuary
const caught = await page.evaluate(async () => {
  const r = window.__riftborn;
  await window.battleWith(['brinelet'], 'sporelet');
  const b = r.battle;
  b.rng = () => 0.0001;                       // always catches
  const residentsBefore = r.profile.state.residents.length;
  const darts = r.profile.ammoCount('tranq_dart');
  r.takeTurn({ kind: 'catch', ammoId: 'tranq_dart' });
  const outcome = b.outcome;
  /*
   * Resolve through the API rather than the button. Taking a turn directly does
   * not re-render the menu, so clicking the first .bchoice pressed "Fight" and
   * opened the move list — the battle was never banked and the check failed on
   * an empty Codex entry that looked like a real bug.
   */
  r.finishBattle();
  await new Promise((d) => setTimeout(d, 300));
  const e = r.profile.entry('sporelet');
  return {
    outcome,
    state: e.state,
    catalogued: e.catalogued,
    largest: e.largest?.heightM ?? 0,
    residents: r.profile.state.residents.length - residentsBefore,
    dartsSpent: darts - r.profile.ammoCount('tranq_dart'),
    view: r.view,
  };
});
ok('a caught monster is catalogued, measured, admitted, and paid for',
   caught.outcome === 'caught' && caught.state === 'catalogued' && caught.catalogued >= 1
   && caught.largest > 0 && caught.residents === 1 && caught.dartsSpent === 1
   && caught.view === 'patrol',
   `catalogued at ${caught.largest.toFixed(2)} m · +${caught.residents} resident`
   + ` · ${caught.dartsSpent} dart spent · back on patrol`);

// --- 9. the menu never offers a dead option
const menu = await page.evaluate(async () => {
  const r = window.__riftborn;
  await window.battleWith(['brinelet'], 'cinderfang');
  const read = () => [...document.querySelectorAll('.bchoice')]
    .map((b) => ({ label: b.querySelector('b').textContent, disabled: b.disabled }));
  const root = read();
  // No second monster, so Swap must be dead.
  const swap = root.find((x) => x.label === 'Swap');
  // Empty the bag; Bag should go dead too.
  r.profile.state.ammo.tranq_dart = 0;
  r.profile.state.ammo.heavy_sedative_dart = 0;
  r.profile.save();
  document.querySelectorAll('.bchoice')[1].click();
  await new Promise((d) => setTimeout(d, 200));
  const bag = read();
  return { root: root.map((x) => x.label), swapDisabled: swap?.disabled, bag: bag.map((x) => `${x.label}${x.disabled ? '(off)' : ''}`) };
});
ok('a single monster cannot swap, and an empty bag says so',
   menu.root.join('/') === 'Fight/Bag/Swap/Run' && menu.swapDisabled === true
   && menu.bag.some((x) => /No capture rounds/.test(x)),
   `${menu.root.join(' · ')} — Swap greyed · bag reads "${menu.bag[0]}"`);

// --- 10. the arena is still reachable
const arena = await page.evaluate(async () => {
  const r = window.__riftborn;
  r.profile.state.combatMode = 'arena';
  r.profile.state.ammo.ball_round = 40;
  r.profile.save();
  r.show('patrol');
  await new Promise((d) => setTimeout(d, 300));
  for (let i = 0; i < 40 && r.patrol.spawns.length === 0; i++) {
    r.patrol.x += 90; r.patrol.y += 40;
    await new Promise((d) => setTimeout(d, 60));
  }
  const s = r.patrol.spawns[0];
  r.teleportTo(s);
  document.getElementById('engage-go').click();
  await new Promise((d) => setTimeout(d, 400));
  const wentToArena = r.view === 'fight';
  r.profile.state.combatMode = 'turn';
  r.profile.save();
  return { wentToArena, hasFight: Boolean(r.fight) };
});
ok('the real-time arena is still there for anyone who wants it',
   arena.wentToArena && arena.hasFight,
   'the world panel switches combat mode, and the old shooter runs unchanged');

// --- 11. a pack comes up one at a time, and every member is recorded
const pack = await page.evaluate(async () => {
  const r = window.__riftborn;
  await window.battleWith(['cinderfang', 'brinelet', 'sporelet'], 'sparkmite', { packSize: 3 });
  const b = r.battle;
  const started = { wilds: b.wilds.length, facing: b.wild.speciesId, remaining: r.remaining(b) };
  const seen = [];
  for (let i = 0; i < 400 && !b.outcome; i++) {
    seen.push(b.wild);
    window.playOut('fight');
    if (b.outcome) break;
  }
  const distinct = new Set(b.wilds.map((w) => w.heightM)).size;
  const before = r.profile.entry('sparkmite');
  const beforeN = (before.culled ?? 0) + (before.catalogued ?? 0);
  const beforeEnc = r.profile.state.stats.encounters;
  r.finishBattle();
  const after = r.profile.entry('sparkmite');
  const outcomes = b.results.map((x) => x.outcome);
  return {
    ...started,
    results: b.results.length,
    outcomes,
    distinct,
    /*
     * An escape is recorded but is neither a cull nor a catalogue, which the
     * first version of this check forgot — it demanded three kept specimens
     * from a pack where one got away, and failed on correct behaviour. Count
     * encounters for "every member was resolved", and kept specimens against
     * the members that did not get away.
     */
    encounters: r.profile.state.stats.encounters - beforeEnc,
    kept: (after.culled ?? 0) + (after.catalogued ?? 0) - beforeN,
    wantKept: outcomes.filter((o) => o !== 'escaped').length,
  };
});
ok('a pack of three is three monsters, fought one at a time and recorded one at a time',
   pack.wilds === 3 && pack.results === 3 && pack.distinct === 3
   && pack.encounters === 3 && pack.kept === pack.wantKept,
   `${pack.wilds} queued · ${pack.results} reached an ending (${pack.outcomes.join(', ')})`
   + ` · ${pack.encounters} encounters logged · ${pack.kept} specimens kept of ${pack.wantKept}`
   + ` that did not get away · ${pack.distinct} distinct measured heights`);

// --- 12. the replacement does not get a free hit on the turn it arrives
/*
 * Read the LOG, not our health. The first version of this check compared HP
 * across the changeover turn and failed on correct behaviour: when the wild
 * moves first it hits us and THEN dies, so damage on a KO turn is perfectly
 * legitimate and the check could not tell it from a free hit.
 *
 * "Another X steps up" is the last thing that happens when a member is
 * replaced, so anything logged after it in the same turn is the free hit.
 */
const freeHit = await page.evaluate(async () => {
  const r = window.__riftborn;
  await window.battleWith(['pyrecrown'], 'sparkmite', { packSize: 3, study: 3000 });
  const b = r.battle;
  const changeovers = [];
  for (let i = 0; i < 80 && !b.outcome; i++) {
    const idx = b.index;
    let best = 0, bestI = 0;
    r.battleOptions().moves.forEach((m, j) => {
      const d = r.computeMoveDamage(r.activeMon(b), b.wild, m, r.data, () => 0.5).damage;
      if (d > best) { best = d; bestI = j; }
    });
    const lines = r.takeTurn({ kind: 'move', index: bestI }).map((l) => l.text);
    if (b.index > idx) {
      const at = lines.findIndex((t) => t.startsWith('Another '));
      changeovers.push({ turn: i + 1, after: lines.slice(at + 1), last: lines.at(-1) });
    }
  }
  return { changeovers, n: changeovers.length };
});
ok('the monster that steps up does not also attack on the turn it arrives',
   freeHit.n >= 1 && freeHit.changeovers.every((c) => c.after.length === 0),
   `${freeHit.n} changeover(s), nothing logged after any of them`
   + ` — e.g. turn ${freeHit.changeovers[0]?.turn} ends "${freeHit.changeovers[0]?.last}"`
   + ' · a pack of three would otherwise collect free hits from the shape of the loop');

// --- 13. a fight is the same length whether it is a Mote or a Titan
const lengths = await page.evaluate(() => {
  const r = window.__riftborn;
  const rows = r.data.monsters.monsters.map((sp) => {
    const lvl = 4 + ((sp.stage ?? 1) - 1) * 6;
    const a = r.makeCombatant(sp, lvl, r.data, { resident: { study: 0 } });
    const d = r.makeCombatant(sp, lvl, r.data, { wild: true });
    const best = Math.max(...a.moves.map((m) => r.computeMoveDamage(a, d, m, r.data, () => 0.5).damage));
    return { id: sp.id, stage: sp.stage ?? 1, turns: Math.ceil(d.maxHp / best) };
  });
  const med = (n) => {
    const v = rows.filter((x) => x.stage === n).map((x) => x.turns).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  };
  const worst = rows.sort((a, b) => b.turns - a.turns)[0];
  return { s1: med(1), s2: med(2), s3: med(3), worst };
});
ok('an apex fight is a fight, not an endurance test',
   lengths.worst.turns <= 15 && Math.abs(lengths.s3 - lengths.s1) <= 3,
   `mirror match: ${lengths.s1} turns at stage 1 · ${lengths.s2} at stage 2 · ${lengths.s3} at stage 3`
   + ` · worst in the book is ${lengths.worst.id} at ${lengths.worst.turns}`
   + ' — an absolute damage base made this 6 / 14 / 41, and Karrahk 118');

// --- 14. winning teaches the monsters that fought, and only those
const study = await page.evaluate(async () => {
  const r = window.__riftborn;
  await window.battleWith(['cinderfang', 'brinelet', 'sporelet'], 'sootpup', { study: 100 });
  const b = r.battle;
  const before = r.profile.state.residents.map((x) => x.study);
  window.playOut('fight');
  const outcome = b.outcome;
  const wildLevel = b.wild.level;
  const mineLevel = r.activeMon(b).level;
  r.finishBattle();
  const after = r.profile.state.residents.map((x) => x.study);
  return {
    outcome, wildLevel, mineLevel,
    gained: after.map((x, i) => x - before[i]),
    expected: r.studyFromBattle(wildLevel, mineLevel, outcome),
  };
});
ok('the monster that fought learns something; the two on the bench do not',
   study.gained[0] > 0 && study.gained[1] === 0 && study.gained[2] === 0
   && study.gained[0] === study.expected,
   `won as "${study.outcome}" · Lv.${study.mineLevel} against Lv.${study.wildLevel}`
   + ` → +${study.gained[0]} Study for the one on the field, +${study.gained[1]}/+${study.gained[2]} for the bench`);

// --- 15. swapping a monster in shares the lesson, at the cost of a turn
const shared = await page.evaluate(async () => {
  const r = window.__riftborn;
  await window.battleWith(['cinderfang', 'brinelet'], 'sootpup', { study: 100 });
  const b = r.battle;
  const before = r.profile.state.residents.map((x) => x.study);
  r.takeTurn({ kind: 'swap', index: 1 });      // costs the turn, buys the share
  window.playOut('fight');
  r.finishBattle();
  const after = r.profile.state.residents.map((x) => x.study);
  return { gained: after.map((x, i) => x - before[i]), outcome: b.outcome, turns: b.turn };
});
ok('a monster you swap in has been in the fight, and is taught for it',
   shared.gained[0] > 0 && shared.gained[1] > 0,
   `both learned (+${shared.gained[0]} and +${shared.gained[1]}) over ${shared.turns} turns`
   + ' — the swap costs a turn, which is the price of the share');

// --- 16. grinding something trivial stops paying
const grind = await page.evaluate(() => {
  const r = window.__riftborn;
  const sp = r.data.monsters.monsters.find((m) => m.id === 'sootpup');
  const wl = r.wildLevel(sp, 3);
  const rows = [0, 400, 1600, 3600].map((s) => ({
    study: s, level: r.levelOf({ study: s }, sp), got: r.studyFromBattle(wl, r.levelOf({ study: s }, sp), 'defeated'),
  }));
  return { wl, rows };
});
ok('a raised monster stops learning from what it has outgrown',
   grind.rows[0].got > grind.rows[3].got * 3 && grind.rows[3].got > 0,
   `the same Lv.${grind.wl} wild teaches `
   + grind.rows.map((x) => `Lv.${x.level}: ${x.got}`).join(' · ')
   + ' — worth about a fifth once you have outgrown it, never zero');

// --- 17. an apex is a sequence of different problems, and every phase happens
const apex = await page.evaluate(async () => {
  const r = window.__riftborn;
  await window.battleWith(['bramblewarden', 'pyrecrown', 'solafaun'], 'karrahk', { study: 3000 });
  const b = r.battle;
  const seen = [];
  const armour = [];
  for (let i = 0; i < 120 && !b.outcome; i++) {
    const w = b.wild;
    if (!seen.includes(w.phase)) { seen.push(w.phase); armour.push(Number(w.armour.toFixed(2))); }
    const mine = r.activeMon(b);
    if (mine.fainted) {
      const j = b.team.findIndex((c) => !c.fainted);
      if (j < 0) break;
      r.takeTurn({ kind: 'swap', index: j });
      continue;
    }
    let best = 0, bestI = 0;
    r.battleOptions().moves.forEach((m, k) => {
      const d = r.computeMoveDamage(mine, w, m, r.data, () => 0.5).damage;
      if (d > best) { best = d; bestI = k; }
    });
    r.takeTurn({ kind: 'move', index: bestI });
  }
  return {
    phases: b.wild.phases,
    seen,
    armour,
    labels: r.data.elements.apex_phases.karrahk.map((x) => x.label),
    turns: b.turn,
    outcome: b.outcome,
    breaks: b.log.filter((l) => l.kind === 'phase').length,
  };
});
ok('a three-phase apex passes through all three, and sheds armour as it goes',
   apex.phases === 3 && apex.seen.join() === '1,2,3'
   && apex.armour[0] > apex.armour[1] && apex.armour[1] > apex.armour[2]
   && apex.turns >= 5 && apex.turns <= 30,
   `${apex.labels.join(' → ')} · armour ${apex.armour.join(' → ')}`
   + ` · resolved as "${apex.outcome}" in ${apex.turns} turns`);

// --- 18. a burst cannot skip a phase
const skip = await page.evaluate(async () => {
  const r = window.__riftborn;
  await window.battleWith(['bramblewarden'], 'karrahk', { study: 3000 });
  const b = r.battle;
  /*
   * Drop it into the LAST health band and hit it once. 30% is band 3 of 3 and
   * still survives a hit — the first version of this check used 5%, where the
   * hit simply kills it, so no phase ever broke and the check failed on its own
   * setup rather than on the rule.
   */
  b.wild.hp = b.wild.maxHp * 0.30;
  const bandBefore = r.phaseAt(b.wild.hp, b.wild.maxHp, b.wild.phases);
  const before = b.wild.phase;
  r.takeTurn({ kind: 'move', index: 0 });
  return {
    before, bandBefore,
    after: b.wild.phase,
    alive: b.wild.hp > 0,
    band: r.phaseAt(b.wild.hp, b.wild.maxHp, b.wild.phases),
  };
});
ok('a hit that crosses two bands still only advances one phase',
   skip.alive && skip.before === 1 && skip.bandBefore === 3 && skip.after === 2,
   `health sat in band ${skip.bandBefore} and the apex advanced 1 → ${skip.after}`
   + ' — without this the whole of phase 2 never happens');

// --- 19. the phase decides whether it can be taken at all
const gate = await page.evaluate(async () => {
  const r = window.__riftborn;
  await window.battleWith(['bramblewarden'], 'karrahk', { study: 3000 });
  const b = r.battle;
  const dart = r.data.ammo.capture.find((a) => a.id === 'heavy_sedative_dart')
    ?? r.data.ammo.capture[0];
  const at = (phase, frac, sedate) => {
    b.wild.phase = phase;
    b.wild.hp = b.wild.maxHp * frac;
    b.wild.statuses = sedate ? { sedated: 3 } : {};
    b.wild.catchScale = undefined;
    return r.catchChance(dart);
  };
  const early = at(1, 0.05, true);
  const mid = at(2, 0.05, true);
  const lateHealthy = at(3, 0.45, false);
  const lateReady = at(3, 0.05, true);
  return {
    early: early.chance, sealed: early.sealed === true,
    mid: mid.chance,
    lateHealthy: lateHealthy.chance, lateReady: lateReady.chance,
  };
});
ok('Karrahk cannot be taken until the core is exposed, and softening still matters',
   gate.sealed && gate.early === 0 && gate.mid === 0
   && gate.lateReady > gate.lateHealthy && gate.lateReady > 0.03,
   `phase 1 and 2 are sealed at 0% · phase 3 reads `
   + `${(gate.lateHealthy * 100).toFixed(1)}% healthy and ${(gate.lateReady * 100).toFixed(1)}% wounded and sedated`);

// --- 20. Aeonrend answers the type chart with 1.0 both ways
const flat = await page.evaluate(async () => {
  const r = window.__riftborn;
  await window.battleWith(['bramblewarden'], 'aeonrend_apex', { study: 3000 });
  const b = r.battle;
  const mine = r.activeMon(b);
  const hits = mine.moves.map((m) => ({
    name: m.name,
    element: m.element,
    ...r.computeMoveDamage(mine, b.wild, m, r.data, () => 0.5),
  }));
  const spread = Math.max(...hits.map((h) => h.damage)) / Math.min(...hits.map((h) => h.damage));
  return { hits, spread, noted: hits.filter((h) => h.note).length, eff: hits.map((h) => h.effectiveness) };
});
ok('no loadout counters Aeonrend — the chart reads 1.0 in both directions',
   flat.eff.every((e) => e === 1) && flat.noted === 0,
   `every move comes back neutral (${flat.eff.join(', ')}), so nothing is super effective or resisted`);

// --- 21. Nyxhollow takes your information away, and Lumen takes it back
const shroud = await page.evaluate(async () => {
  const r = window.__riftborn;
  await window.battleWith(['bramblewarden'], 'nyxhollow', { study: 3000 });
  const withoutLumen = { concealed: r.concealed(r.battle), text: document.getElementById('wild-hp-text').textContent };
  await window.battleWith(['solafaun'], 'nyxhollow', { study: 3000 });   // solafaun is Lumen
  const withLumen = { concealed: r.concealed(r.battle), text: document.getElementById('wild-hp-text').textContent };
  // and the shroud lifts on its own in the last phase
  r.battle.wild.phase = 2;
  r.battle.wild.conceal = r.data.elements.apex_phases.nyxhollow[1].conceal === true;
  const lastPhase = r.concealed(r.battle);
  return { withoutLumen, withLumen, lastPhase };
});
ok('Nyxhollow blanks its own health bar, and a Lumen carrier lights it back up',
   shroud.withoutLumen.concealed && shroud.withoutLumen.text === '???'
   && !shroud.withLumen.concealed && shroud.withLumen.text !== '???'
   && !shroud.lastPhase,
   `shrouded it reads "${shroud.withoutLumen.text}" · with a Lumen resident "${shroud.withLumen.text}"`
   + ' · and the shroud is gone once the eye opens');

// --- 22. both combat modes read the same definition of a phase
const oneTable = await page.evaluate(() => {
  const r = window.__riftborn;
  const table = r.data.elements.apex_phases;
  const out = [];
  for (const id of ['karrahk', 'nyxhollow', 'aeonrend_apex']) {
    const sp = r.data.monsters.monsters.find((m) => m.id === id);
    const lo = r.loadLoadout(r.data, {
      speciesId: id, weaponId: 'marker_pistol', lethalId: 'ball_round', captureId: 'tranq_dart',
    });
    const f = r.createFight(lo, { partySize: 4 });
    const m = f.monsters[0];
    out.push({
      id,
      arenaPhases: m.phases,
      dataPhases: table[id].length,
      declared: sp.phases ?? null,
      arenaWeak: m.weakPoints,
      dataWeak: table[id][0].weak_points,
    });
  }
  return out;
});
ok('the arena and the turn battle read apex phases out of the same table',
   oneTable.every((x) => x.arenaPhases === x.dataPhases
     && JSON.stringify(x.arenaWeak) === JSON.stringify(x.dataWeak)),
   oneTable.map((x) => `${x.id} ${x.arenaPhases} phases, opens on ${x.arenaWeak.join('/')}`).join(' · ')
   + ' — the table used to be a const inside game.js');

// --- 23. every element has something to do that is not damage
const kit = await page.evaluate(() => {
  const r = window.__riftborn;
  const out = {};
  for (const [el, moves] of Object.entries(r.data.elements.element_moves)) {
    out[el] = {
      n: moves.length,
      status: moves.filter((m) => m.applies || m.applies_self).map((m) => m.name),
      pp: moves.map((m) => m.pp),
    };
  }
  const known = Object.keys(r.data.ammo.statuses);
  const reachable = new Set(Object.values(r.data.elements.element_moves)
    .flat().map((m) => m.applies).filter(Boolean));
  return { out, elements: Object.keys(out).length, known, reachable: [...reachable] };
});
ok('every element can do something other than damage, and the statuses are reachable',
   Object.values(kit.out).every((x) => x.n >= 3 && x.status.length >= 1)
   && Object.values(kit.out).every((x) => x.pp.every((v) => v > 0))
   && kit.reachable.length >= 6,
   `${kit.elements} elements, ${kit.reachable.length} of ${kit.known.length} statuses now reachable from the FIGHT menu`
   + ` (they were 0 — only capture rounds could apply one)`);

// --- 24. PP is spent, and Strike is what is left
const pp = await page.evaluate(async () => {
  const r = window.__riftborn;
  await window.battleWith(['cinderfang'], 'brinelet', { study: 900 });
  const b = r.battle;
  const mine = r.activeMon(b);
  // Find the heavy move and use it until it is gone.
  let heavy = 0, best = -1;
  mine.moves.forEach((m, i) => { if (m.power > best) { best = m.power; heavy = i; } });
  const start = r.ppLeft(mine, heavy);
  const seen = [];
  /*
   * Hold the fight open. This is a harness for one mechanic, and the fight
   * kept ending before the mechanic could be reached: a raised Cinderfang
   * against a rank-1 Brinelet is level 25 against level 3, which outclasses the
   * cap and one-shots it, so the loop exited on turn one with PP untouched.
   * Two earlier versions of this check failed for two different versions of
   * that same problem.
   */
  for (let i = 0; i < start + 2; i++) {
    b.outcome = null;
    b.results.length = 0;
    b.wild.fainted = false; b.wild.hp = b.wild.maxHp; b.wild.statuses = {};
    mine.fainted = false; mine.hp = mine.maxHp; mine.statuses = {};
    const before = r.ppLeft(mine, heavy);
    const lines = r.takeTurn({ kind: 'move', index: heavy }).map((l) => l.text);
    seen.push({ before, after: r.ppLeft(mine, heavy), fellBack: lines.some((t) => /falls back/.test(t)) });
  }
  const strikeIndex = mine.moves.findIndex((m) => m.pp == null);
  return {
    start, seen,
    ranOut: seen.some((x) => x.after === 0),
    fellBack: seen.some((x) => x.fellBack),
    strikeUnlimited: strikeIndex >= 0 && r.ppLeft(mine, strikeIndex) === Infinity,
  };
});
ok('the heavy move runs out, and Strike is what you are left with',
   pp.start > 0 && pp.start <= 6 && pp.ranOut && pp.fellBack && pp.strikeUnlimited,
   `${pp.start} PP on the heavy move · spent ${pp.seen.filter((x) => x.after < x.before).length}`
   + ` · ran dry: ${pp.ranOut} · fell back to Strike: ${pp.fellBack}`
   + ` · Strike has no PP at all: ${pp.strikeUnlimited}`);

// --- 25. a status move actually lands a status, and it bites
const status = await page.evaluate(async () => {
  const r = window.__riftborn;
  await window.battleWith(['cinderfang'], 'brinelet', { study: 900 });   // Ember: burning
  const b = r.battle;
  const mine = r.activeMon(b);
  const i = mine.moves.findIndex((m) => m.applies);
  if (i < 0) return { note: 'no status move' };
  const name = mine.moves[i].name, applies = mine.moves[i].applies;
  let landed = false;
  for (let t = 0; t < 6 && !landed && !b.outcome; t++) {
    b.wild.hp = b.wild.maxHp;
    r.takeTurn({ kind: 'move', index: i });
    landed = Boolean(b.wild.statuses[applies]);
  }
  const before = b.wild.hp;
  // a turn where we do nothing damaging: the burn should still bite
  const strike = b.wild.statuses[applies];
  const lines = r.takeTurn({ kind: 'move', index: mine.moves.findIndex((m) => m.pp == null) })
    .map((l) => l.text);
  return {
    name, applies, landed, strike,
    tickLine: lines.find((t) => new RegExp(applies).test(t)) ?? null,
    lostHp: before - b.wild.hp,
  };
});
ok('a status move lands its status, and burning actually burns',
   status.landed && status.lostHp > 0 && status.tickLine,
   `${status.name} left it ${status.applies} for ${status.strike} turns, and it lost ${status.lostHp} HP`
   + ` — "${status.tickLine}"`);

// --- 26. being held costs the turn, not just the turn order
const held = await page.evaluate(async () => {
  const r = window.__riftborn;
  await window.battleWith(['thornhide'], 'pebblit', { study: 900 });    // Verdant: ensnared
  const b = r.battle;
  const mine = r.activeMon(b);
  const i = mine.moves.findIndex((m) => m.applies === 'ensnared');
  if (i < 0) return { note: 'no ensnare' };
  /*
   * Enough samples for a 40% effect. The first version measured six turns and
   * asserted "at least one lost", which is a 5% coin-flip (0.6^6) — and it came
   * up on a full run. It also ran out of PP after two ensnares, which is why it
   * only got six turns out of sixty rounds in the first place.
   */
  const strike = mine.moves.findIndex((m) => m.pp == null);
  let lost = 0, turns = 0;
  for (let round = 0; round < 400 && turns < 60 && !b.outcome; round++) {
    b.wild.hp = b.wild.maxHp;
    mine.hp = mine.maxHp;
    mine.pp = {}; mine.moves.forEach((m, k) => { mine.pp[k] = m.pp ?? null; });   // top up
    if (!b.wild.statuses.ensnared) { r.takeTurn({ kind: 'move', index: i }); continue; }
    const lines = r.takeTurn({ kind: 'move', index: strike }).map((l) => l.text);
    turns++;
    // The wild's line specifically: our own monster can be held too (Pebblit
    // anchors), and counting both sides inflated the rate above its design.
    if (lines.some((t) => t.startsWith(`${b.wild.species.name} cannot get free`))) lost++;
  }
  return { lost, turns, rate: turns ? lost / turns : 0 };
});
ok('a held monster loses its turn, rather than just going second',
   held.turns >= 30 && held.lost >= 4 && held.rate > 0.15 && held.rate < 0.7,
   `held for ${held.turns} measured turns, lost ${held.lost} of them (${(held.rate * 100).toFixed(0)}%,`
   + ' against a designed 40%) — speed used to be read in one line of the engine, and decided the order only');

// --- 27. a fair fight is long enough to have a decision in it
const length = await page.evaluate(() => {
  const r = window.__riftborn;
  const pool = r.data.monsters.monsters.filter((m) => !m.apex);
  const pairs = [];
  for (const a of pool) for (const z of pool) {
    if (a.id === z.id || a.stage !== z.stage || a.size !== z.size) continue;
    if (a.elements[0] === z.elements[0]) continue;
    pairs.push([a, z]);
  }
  let turns = 0, quick = 0, n = 0;
  for (const [A, Z] of pairs.slice(0, 40)) {
    const mine = r.makeCombatant(A, 20, r.data, { resident: { study: 900 } });
    const wild = r.makeCombatant(Z, 20, r.data, { wild: true });
    const b = r.createBattle({ data: r.data, team: [mine], wilds: [wild] });
    let g = 0;
    while (!b.outcome && g++ < 200) {
      const m = r.activeMon(b);
      if (!m || m.fainted) break;
      let bi = 0, bd = -1;
      m.moves.forEach((mv, i) => {
        if (!r.canUse(m, i)) return;
        const d = r.computeMoveDamage(m, b.wild, mv, r.data, () => 0.5).damage * (mv.accuracy ?? 1);
        if (d > bd) { bd = d; bi = i; }
      });
      r.takeTurnOn(b, { kind: 'move', index: bi });
    }
    turns += b.turn; if (b.turn <= 2) quick++; n++;
  }
  return { avg: turns / n, quick: quick / n, n };
});
ok('a fight between comparable monsters is not over in two turns',
   length.avg >= 5 && length.quick < 0.05,
   `${length.n} fair matchups average ${length.avg.toFixed(1)} turns, ${(length.quick * 100).toFixed(0)}% end inside two`
   + ' — it was 3.3 turns and 35% before the comparable-damage cap');

// --- 28. a mismatch still ends in one hit
const mismatch = await page.evaluate(() => {
  const r = window.__riftborn;
  const find = (id) => r.data.monsters.monsters.find((m) => m.id === id);
  const titan = r.makeCombatant(find('karrahk'), 30, r.data, { resident: { study: 3000 } });
  const mote = r.makeCombatant(find('glimmerfly'), 8, r.data, { wild: true });
  r.createBattle({ data: r.data, team: [titan], wilds: [mote] });
  const best = Math.max(...titan.moves.map((m) => r.computeMoveDamage(titan, mote, m, r.data, () => 0.5).damage));
  return { best, hp: mote.maxHp, hits: Math.ceil(mote.maxHp / best) };
});
ok('the cap does not save a Mote that walked into a Titan',
   mismatch.hits === 1,
   `Karrahk hits a Glimmerfly for ${mismatch.best} against ${mismatch.hp} health — still one hit,`
   + ' because the cap only applies between monsters that are comparable');

// --- 29. phone layout
await page.setViewportSize({ width: 390, height: 844 });
await page.evaluate(async () => { await window.battleWith(['brinelet'], 'cinderfang'); });
await page.waitForTimeout(400);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok('no horizontal overflow at 390px', overflow === 0, `${overflow}px`);

await page.screenshot({ path: process.argv[2] ?? 'battle.png' });
await browser.close();
console.log(errors.length ? `\nCONSOLE ERRORS:\n${errors.join('\n')}` : '\nno console errors');
if (fails) console.log(`${fails} check(s) FAILED`);
process.exit(errors.length || fails ? 1 : 0);
