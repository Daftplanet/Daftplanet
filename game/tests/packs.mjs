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

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__riftborn !== undefined, null, { timeout: 8000 });
await page.evaluate(() => { window.__riftborn.profile.reset(); });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__riftborn !== undefined, null, { timeout: 8000 });
await page.waitForTimeout(400);

/* Fire for real: arena coords -> screen coords -> actual mouse events. The previous
   version of this test set up state and never pulled the trigger. The canvas is
   measured lazily because it has no box while the fight view is hidden. */
const fireAt = async (ax, ay, ms = 400) => {
  const box = await page.locator('#stage').boundingBox();
  await page.mouse.move(box.x + (ax / 960) * box.width, box.y + (ay / 640) * box.height);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
  await page.waitForTimeout(120);
};

/** Start a fight with a forced pack size and a chosen loadout. */
const setup = async (weaponId, lethalId, captureId, packSize, ammo = {}) => page.evaluate(async (cfg) => {
  const r = window.__riftborn;
  r.profile.state.devUnlockAll = true;
  Object.assign(r.profile.state.ammo, cfg.ammo);
  r.profile.setSlot(0, { weaponId: cfg.weaponId, lethalId: cfg.lethalId, captureId: cfg.captureId });
  r.profile.setSlot(1, null);
  r.profile.save();
  for (let i = 0; i < 40 && r.patrol.spawns.length === 0; i++) {
    r.patrol.x += 90; r.patrol.y += 40;
    r.refreshSpawns();
  }
  const base = r.patrol.spawns.find((s) => !r.profile.isResolved(s.id)) ?? r.patrol.spawns[0];
  if (!base) return null;
  const spawn = { ...base, id: `test-${Math.random()}`, packSize: cfg.packSize };
  r.teleportTo(spawn);
  r.startFight(spawn);
  await new Promise((res) => setTimeout(res, 250));
  return r.view === 'fight' ? { name: r.fight.loadout.species.name, n: r.fight.monsters.length } : null;
}, { weaponId, lethalId, captureId, packSize, ammo });

/** Park the pack in a tight cluster in front of the Warden. */
const cluster = (spacing = 42, y = 250, px = 480, py = 470) => page.evaluate((cfg) => {
  const f = window.__riftborn.fight;
  const mid = (f.monsters.length - 1) / 2;
  f.monsters.forEach((m, i) => {
    m.x = cfg.px + (i - mid) * cfg.spacing;
    m.y = cfg.y;
    m.aware = true; m.state = 'stalk'; m.attackCooldown = 99;
    m.speed = 0;                    // hold still: this is a weapon test, not an AI test
  });
  f.player.x = cfg.px; f.player.y = cfg.py;
  return f.monsters.map((m) => ({ x: Math.round(m.x), y: Math.round(m.y) }));
}, { spacing, y, px, py });

// --- 1. a pack reaches the fight as separate monsters
const packed = await setup('marker_pistol', 'ball_round', 'tranq_dart', 3, { ball_round: 60, tranq_dart: 30 });
const positions = await page.evaluate(() =>
  new Set(window.__riftborn.fight.monsters.map((m) => `${Math.round(m.x)},${Math.round(m.y)}`)).size);
ok('a pack spawns as separate monsters', packed?.n === 3 && positions === 3,
   `${packed?.name} ×${packed?.n}, all at distinct positions`);

// --- 2. only one member may attack at a time (needs an aggressive profile)
const token = await page.evaluate(async () => {
  const f = window.__riftborn.fight;
  f.ai = { alert: 400, preferred: 60, attacks: true, cooldown: 0.2, reach: 400 };
  f.monsters.forEach((m) => { m.aware = true; m.state = 'stalk'; m.attackCooldown = 0; m.x = f.player.x + 50; m.y = f.player.y; });
  let peak = 0, sawAttack = false;
  for (let i = 0; i < 260; i++) {
    await new Promise((res) => setTimeout(res, 8));
    const n = f.monsters.filter((m) => ['windup', 'lunge'].includes(m.state)).length;
    if (n > 0) sawAttack = true;
    peak = Math.max(peak, n);
  }
  return { peak, sawAttack };
});
ok('only one pack member attacks at a time', token.sawAttack && token.peak === 1,
   `attacks observed: ${token.sawAttack} · peak simultaneous: ${token.peak}`);

// --- 3. an area snare catches the whole cluster from one shot
await setup('lattice_launcher', 'incendiary', 'snare_grenade', 3, { incendiary: 40, snare_grenade: 40 });
await cluster(42, 250, 480, 470);
await page.evaluate(() => { window.__riftborn.fight.weapon.chamber = 'capture'; });
await fireAt(480, 250, 500);
const splash = await page.evaluate(() => {
  const f = window.__riftborn.fight;
  return { gained: f.monsters.filter((m) => m.restraint > 0).length,
           ensnared: f.monsters.filter((m) => m.statuses.ensnared).length,
           total: f.monsters.length, shots: f.stats.shots };
});
ok('one area snare catches the cluster', splash.gained >= 2 && splash.ensnared >= 2,
   `${splash.gained}/${splash.total} gained Restraint · ${splash.ensnared} ensnared from ${splash.shots} shot(s)`);

// --- 4. the chain weapon arcs between targets
await setup('arcbrand_coil', 'arc_cell', null, 3, { arc_cell: 200 });
await cluster(42, 250, 480, 470);
await fireAt(480, 250, 500);
const chain = await page.evaluate(() => {
  const f = window.__riftborn.fight;
  return { damaged: f.monsters.filter((m) => m.hp < m.maxHp).length, total: f.monsters.length,
           stunned: f.monsters.filter((m) => m.statuses.stunned).length, shots: f.stats.shots };
});
ok('the chain weapon arcs to other targets', chain.damaged >= 2,
   `${chain.damaged}/${chain.total} damaged · ${chain.stunned} stunned`);

// --- 5. a lethal-only weapon is a valid loadout and cannot swap
const noCapture = await page.evaluate(async () => {
  const r = window.__riftborn;
  const f = r.fight;
  const before = f.weapon.chamber;
  document.getElementById('btn-swap').click();
  await new Promise((res) => setTimeout(res, 900));
  return { hasCapture: f.loadout.hasCapture, carried: f.weapon.carried.capture,
           chamberBefore: before, chamberAfter: f.weapon.chamber,
           label: document.getElementById('capture-round').textContent };
});
ok('a lethal-only weapon loads and refuses to swap',
   noCapture.hasCapture === false && noCapture.carried === 0 && noCapture.chamberAfter === 'lethal',
   `capture chamber reads "${noCapture.label}"`);

// --- 6. the scattergun puts pellets into more than one target
await setup('splitbore', 'ball_round', 'net_shell', 3, { ball_round: 200, net_shell: 40 });
await cluster(26, 290, 480, 470);      // 180px out: inside the 9m range, cone wide enough to span them
await fireAt(480, 290, 700);
const pellets = await page.evaluate(() => {
  const f = window.__riftborn.fight;
  return { damaged: f.monsters.filter((m) => m.hp < m.maxHp).length, total: f.monsters.length, shots: f.stats.shots };
});
ok('a pellet cone spreads across the cluster', pellets.damaged >= 2,
   `${pellets.damaged}/${pellets.total} damaged by ${pellets.shots} shell(s)`);

// --- 7. every pack member is recorded separately
const recorded = await page.evaluate(async () => {
  const r = window.__riftborn;
  r.profile.setSlot(0, { weaponId: 'marker_pistol', lethalId: 'ball_round', captureId: 'tranq_dart' });
  r.profile.setSlot(1, null);
  r.profile.save();
  for (let i = 0; i < 40 && r.patrol.spawns.length === 0; i++) {
    r.patrol.x += 90; r.patrol.y += 40;
    r.refreshSpawns();
  }
  const base = r.patrol.spawns.find((s) => !r.profile.isResolved(s.id)) ?? r.patrol.spawns[0];
  if (!base) return null;
  const spawn = { ...base, id: `rec-${Math.random()}`, packSize: 3 };
  r.teleportTo(spawn); r.startFight(spawn);
  await new Promise((res) => setTimeout(res, 250));
  const f = r.fight;
  const sp = f.loadout.species;
  const before = r.profile.entry(sp.id);

  f.monsters[0].hp = 0;                                   // culled
  await new Promise((res) => setTimeout(res, 150));
  f.monsters[1].restraint = f.loadout.required * 3;       // subdued...
  await new Promise((res) => setTimeout(res, 150));
  document.getElementById('btn-tag').click();             // ...then tagged
  await new Promise((res) => setTimeout(res, 200));
  f.monsters[2].hp = 0;                                   // culled
  await new Promise((res) => setTimeout(res, 500));

  const after = r.profile.entry(sp.id);
  return { outcome: f.outcome, results: f.results.map((x) => x.outcome),
           culled: after.culled - before.culled, catalogued: after.catalogued - before.catalogued,
           blurb: document.getElementById('verdict-blurb').textContent };
});
ok('every pack member is recorded separately',
   recorded.results.length === 3 && recorded.culled === 2 && recorded.catalogued === 1,
   `${recorded.outcome}: ${recorded.results.join(', ')} → "${recorded.blurb}"`);

await page.screenshot({ path: process.argv[2] ?? 'packs.png' });
await browser.close();
console.log(errors.length ? `\nCONSOLE ERRORS:\n${errors.join('\n')}` : '\nno console errors');
if (fails) console.log(`${fails} check(s) FAILED`);
process.exit(errors.length || fails ? 1 : 0);
