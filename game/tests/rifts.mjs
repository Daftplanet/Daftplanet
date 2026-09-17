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
await page.waitForTimeout(500);

// --- 1. locked at rank 1
const locked = await page.evaluate(() => ({
  text: document.getElementById('rift-status').textContent,
  state: document.getElementById('rift-status').dataset.state,
  rift: window.__riftborn.patrol.rift,
}));
ok('rift events are rank-gated', locked.state === 'locked' && locked.rift === null, `"${locked.text}"`);

/** Jump to a rift and set the clock so it is open (or in its apex window). */
const enterRift = (apexWindow) => page.evaluate(async (wantApex) => {
  const r = window.__riftborn;
  r.profile.state.devUnlockAll = true;
  r.profile.save();
  const W = await import('./js/world.js');
  /*
   * Pick the rift whose apex window is soonest and still ahead, not merely the
   * nearest one. `riftsNear` sorts by distance and carries both today's and
   * tomorrow's rift for every cell, so `[0]` was as likely to be one that had
   * already finished — the suite then jumped the clock to a window in the past
   * and reported "opens in 480m".
   */
  const target = W.apexForecast(
    r.patrol.x, r.patrol.y, new Date(), r.profile.state.seed, r.patrol.apexById,
  )[0] ?? W.riftsNear(r.patrol.x, r.patrol.y, new Date(), r.profile.state.seed)[0];
  r.patrol.x = target.x; r.patrol.y = target.y;
  const aim = wantApex ? target.apexFromMs + 5 * 60000 : target.startMs + 10 * 60000;
  r.patrol.hourOffset = (aim - Date.now()) / 3600000;
  await new Promise((res) => setTimeout(res, 400));
  return {
    inside: Boolean(r.patrol.rift),
    apexUp: r.patrol.rift?.apexUp ?? false,
    apexId: target.apexId,
    status: document.getElementById('rift-status').textContent,
    species: [...new Set(r.patrol.spawns.map((s) => r.speciesById[s.speciesId].name))],
    hasApexSpawn: r.patrol.spawns.some((s) => s.isApex),
  };
}, apexWindow);

// --- 2. inside an open rift, the spawn table is Rift-only
const inside = await enterRift(false);
ok('standing in an open rift', inside.inside, `"${inside.status}"`);
ok('rift spawns are Rift-element only',
   inside.species.length > 0 && inside.species.every((n) => ['Riftspawn', 'Voidmaw'].includes(n)),
   inside.species.join(', ') || 'none');

// --- 3. the apex turns up for the finale
const finale = await enterRift(true);
ok('the apex appears in the closing minutes', finale.apexUp && finale.hasApexSpawn,
   `${finale.apexId} · "${finale.status}"`);

// --- 4. engaging the apex gives a phased fight
const fight = await page.evaluate(async () => {
  const r = window.__riftborn;
  const apex = r.patrol.spawns.find((s) => s.isApex);
  if (!apex) return null;
  r.teleportTo(apex);
  r.startFight(apex);
  await new Promise((res) => setTimeout(res, 300));
  const f = r.fight;
  if (!f) return { failed: true };
  const m = f.monsters[0];
  return {
    name: f.loadout.species.name, phases: m.phases, phase: m.phase,
    hp: m.hp, baseHp: f.loadout.species.stats.hp, attack: Math.round(m.attack),
    baseAttack: f.loadout.species.stats.attack, radius: m.radius,
    weak: [...m.weakPoints], chips: document.getElementById('statuses').textContent,
  };
});
ok('the apex engages as a phased fight', fight && !fight.failed && fight.phases >= 2,
   fight ? `${fight.name} · phase ${fight.phase}/${fight.phases} · ${fight.hp} HP (of ${fight.baseHp}) · atk ${fight.attack} (of ${fight.baseAttack})` : 'no apex spawn');

// --- 5. phases advance in the live fight, rotating the weak point
const phases = await page.evaluate(async () => {
  const f = window.__riftborn.fight;
  const m = f.monsters[0];
  const seen = [];
  for (let i = 0; i < 400; i++) {
    f.player.x = 40; f.player.y = 600;              // stay out of reach
    if (m.phaseShield <= 0 && m.hp > m.maxHp * 0.05) m.hp -= m.maxHp / 60;
    const key = `${m.phase}:${m.weakPoints.join('+')}`;
    if (!seen.includes(key)) seen.push(key);
    await new Promise((res) => setTimeout(res, 16));
  }
  return { seen, finalPhase: m.phase, total: m.phases };
});
ok('phases advance and rotate the weak point',
   phases.seen.length === phases.total,
   phases.seen.join('  →  '));

// --- 6. capture is refused until the last phase, and then needs an anchor
const gate = await page.evaluate(async () => {
  const f = window.__riftborn.fight;
  const m = f.monsters[0];
  m.restraint = f.loadout.required + 1;
  await new Promise((res) => setTimeout(res, 200));
  const anchorMsg = document.getElementById('statuses').textContent;
  m.statuses.anchored = 10;
  m.restraint = f.loadout.required + 1;
  await new Promise((res) => setTimeout(res, 300));
  const subdued = m.state === 'subdued';
  document.getElementById('btn-tag').click();
  await new Promise((res) => setTimeout(res, 400));
  return { anchorMsg, subdued, outcome: f.outcome, verdict: document.getElementById('verdict').textContent };
});
ok('an apex needs a Tether Harpoon to take alive',
   /Tether Harpoon/.test(gate.anchorMsg) && gate.subdued && gate.outcome === 'catalogued',
   `blocked on "needs a Tether Harpoon", then ${gate.verdict}`);

await page.screenshot({ path: process.argv[2] ?? 'rifts.png' });
await browser.close();
console.log(errors.length ? `\nCONSOLE ERRORS:\n${errors.join('\n')}` : '\nno console errors');
if (fails) console.log(`${fails} check(s) FAILED`);
process.exit(errors.length || fails ? 1 : 0);
