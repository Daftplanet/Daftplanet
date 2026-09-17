import { chromium } from 'playwright';

// executablePath is only needed where the browser is not on Playwright's own path.
const LAUNCH = process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {};
const URL = process.env.RIFTBORN_URL ?? 'http://127.0.0.1:8765/riftborn/';
const browser = await chromium.launch(LAUNCH);
const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const ok = (l, c, x = '') => console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x ? '  — ' + x : ''}`);

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
    r.startBattle({ ...base, id: `b-${Math.random()}`, speciesId: wildId, packSize: 1 });
    await new Promise((d) => setTimeout(d, 350));
    return r.battle;
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
    dual: rows.filter((x) => x.n > 3).length,
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
  const N = 60;
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

// --- 11. phone layout
await page.setViewportSize({ width: 390, height: 844 });
await page.evaluate(async () => { await window.battleWith(['brinelet'], 'cinderfang'); });
await page.waitForTimeout(400);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok('no horizontal overflow at 390px', overflow === 0, `${overflow}px`);

await page.screenshot({ path: process.argv[2] ?? 'battle.png' });
await browser.close();
console.log(errors.length ? `\nCONSOLE ERRORS:\n${errors.join('\n')}` : '\nno console errors');
process.exit(errors.length ? 1 : 0);
