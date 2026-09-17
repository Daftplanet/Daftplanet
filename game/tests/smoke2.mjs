import { chromium } from 'playwright';

// executablePath is only needed where the browser is not on Playwright's own path.
const LAUNCH = process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {};

const URL = process.env.RIFTBORN_URL ?? 'http://127.0.0.1:8765/riftborn/';
const browser = await chromium.launch(LAUNCH);
const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
const ok = (l, c, x = '') => console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x ? '  — ' + x : ''}`);

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__riftborn !== undefined, null, { timeout: 8000 });
await page.evaluate(() => { window.__riftborn.profile.reset(); });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__riftborn !== undefined, null, { timeout: 8000 });
await page.waitForTimeout(400);

// --- 1. full bestiary is live
const scope = await page.evaluate(() => {
  const r = window.__riftborn;
  const fams = new Set(r.patrol.pool.map((s) => s.family));
  return { pool: r.patrol.pool.length, families: fams.size, codexRows: null,
           weapons: r.data.weapons.weapons.length, ammo: r.data.ammo.lethal.length + r.data.ammo.capture.length };
});
// 12 wild families plus `rift`, which only exists inside a rift event.
ok('every family is spawnable somewhere', scope.families === 13,
   `${scope.pool} species across ${scope.families} families (12 wild + rift events)`);
ok('all weapons and ammo present', scope.weapons === 8 && scope.ammo === 14, `${scope.weapons} weapons · ${scope.ammo} rounds`);

// --- 2. weather shifts the spawn mix
const share = async (weather, el) => page.evaluate(async ([w, element]) => {
  const r = window.__riftborn;
  const W = await import('./js/world.js');
  const d = new Date();
  let hit = 0, total = 0;
  for (let ty = 0; ty < 70; ty++) for (let tx = 0; tx < 70; tx++) {
    const b = W.biomeAt(tx, ty, r.profile.state.seed);
    for (const s of W.spawnsInTile(tx, ty, 999, r.patrol.pool, b, 'day', r.profile.state.seed, w)) {
      total++;
      if (r.speciesById[s.speciesId].elements.includes(element)) hit++;
    }
  }
  return total ? hit / total : 0;
}, [weather, el]);
const voltClear = await share('clear', 'volt');
const voltStorm = await share('thunderstorm', 'volt');
ok('weather shifts the spawn mix', voltStorm > voltClear * 1.5,
   `volt ${(voltClear * 100).toFixed(0)}% clear → ${(voltStorm * 100).toFixed(0)}% thunderstorm`);

// --- 3. a capture becomes a Sanctuary resident
const admitted = await page.evaluate(() => {
  const r = window.__riftborn;
  const sp = r.speciesById.sootpup;
  r.profile.recordOutcome(sp, 'catalogued', { clean: false, hpFraction: 0.4, methodAmmo: 'tranq_dart', weaponId: 'marker_pistol' });
  return { residents: r.profile.state.residents.length, species: r.profile.state.residents[0]?.speciesId,
           method: r.profile.state.residents[0]?.method };
});
ok('a capture admits a resident', admitted.residents === 1 && admitted.species === 'sootpup',
   `${admitted.species} · taken with ${admitted.method}`);

// --- 4. study accrues in real time
const studied = await page.evaluate(async () => {
  const r = window.__riftborn;
  r.profile.state.devStudyRate = 20000;          // compress real minutes
  const before = r.profile.state.residents[0].study;
  r.profile.state.lastTick = Date.now() - 3000;  // pretend 3s passed
  r.profile.tickStudy();
  return { before, after: r.profile.state.residents[0].study };
});
ok('study accrues over real time', studied.after > studied.before + 400,
   `${studied.before.toFixed(0)} → ${studied.after.toFixed(0)} Study`);

// --- 5. evolution gates block, then release
const gated = await page.evaluate(() => {
  const r = window.__riftborn;
  r.profile.state.xp = 0;                        // rank 1, below the rank-3 gate
  const res = r.profile.state.residents[0];
  const sp = r.speciesById[res.speciesId];
  return { blocked: window.__riftbornBlockers(res, sp) };
});
ok('evolution is gated by rank', gated.blocked.some((b) => /rank/i.test(b)), gated.blocked.join(' · '));

const evolved = await page.evaluate(() => {
  const r = window.__riftborn;
  r.profile.state.xp = 20000;                    // clear the rank gate
  const res = r.profile.state.residents[0];
  const sp = r.speciesById[res.speciesId];
  const blocked = window.__riftbornBlockers(res, sp);
  const target = sp.evolves_to[0].id;
  const out = blocked.length === 0 ? r.profile.evolve(res.uid, target) : null;
  return { blocked, became: out?.name ?? null,
           codex: r.profile.entry(target).state,
           lineage: r.profile.state.residents[0].evolvedFrom };
});
ok('a resident evolves once gates clear', evolved.became === 'Cinderfang',
   `became ${evolved.became} · codex ${evolved.codex} · lineage ${JSON.stringify(evolved.lineage)}`);

// --- 6. a branch condition actually gates on the world
const branch = await page.evaluate(() => {
  const r = window.__riftborn;
  const res = r.profile.state.residents[0];
  res.study = 99999;
  const sp = r.speciesById[res.speciesId];
  const branchOpt = sp.evolves_to.find((o) => o.condition !== 'none');
  const atNoon = window.__riftbornBlockers(res, sp, 12);
  const atMidnight = window.__riftbornBlockers(res, sp, 1);
  return { branch: branchOpt ? r.speciesById[branchOpt.id].name : null,
           noon: atNoon, midnight: atMidnight };
});
ok('branch condition gates on time of day',
   branch.noon.length > 0 && branch.midnight.length === 0,
   `${branch.branch}: blocked at noon (${branch.noon.join(', ')}), clear at 01:00`);

// --- 7. research tiers
const research = await page.evaluate(() => {
  const r = window.__riftborn;
  r.profile.state.researchPoints = 20;
  const id = 'sootpup';
  const steps = [];
  for (let i = 0; i < 4; i++) steps.push(r.profile.research(id) ? r.profile.entry(id).research : 'refused');
  return steps;
});
ok('research runs I → II → III then stops', JSON.stringify(research) === '[1,2,3,"refused"]', JSON.stringify(research));

// --- 8. contracts progress and claim
const contracts = await page.evaluate(() => {
  const r = window.__riftborn;
  const c = r.profile.state.contracts.list[0];
  c.progress = c.target;
  const xpBefore = r.profile.state.xp;
  const claimed = r.profile.claimContract(c.id);
  return { claimed, gained: r.profile.state.xp - xpBefore, text: c.text, twice: r.profile.claimContract(c.id) };
});
ok('a contract claims once', contracts.claimed && contracts.gained > 0 && contracts.twice === false,
   `"${contracts.text}" → +${contracts.gained} XP`);

// --- 9. crafting is gated on element materials
const craft = await page.evaluate(() => {
  const r = window.__riftborn;
  r.profile.state.essence = 9999;
  r.profile.state.materials.lumen = 0;
  const blocked = r.profile.canCraft('rune_arrow', 1);
  r.profile.state.materials.lumen = 50;
  r.profile.state.materials.gloom = 50;
  const allowed = r.profile.canCraft('rune_arrow', 1);
  const made = r.profile.craft('rune_arrow', 5);
  return { blocked, allowed, made, owned: r.profile.ammoCount('rune_arrow'), lumenLeft: r.profile.state.materials.lumen };
});
ok('crafting is gated on element materials',
   craft.blocked === false && craft.allowed && craft.made && craft.owned === 5,
   `rune arrows locked without Lumen; 5 crafted, lumen ${craft.lumenLeft} left`);

// --- 10. sanctuary bonuses exist and are capped
const bonus = await page.evaluate(() => {
  const r = window.__riftborn;
  for (let i = 0; i < 40; i++) r.profile.admit(r.speciesById.sootpup, {});
  const b = r.profile.bonuses;
  return { keys: Object.keys(b), lethal: b.lethal_damage ?? 0, cap: r.data.elements.sanctuary_bonus_cap_per_element };
});
ok('resident bonuses apply and cap', bonus.lethal > 0 && bonus.lethal <= bonus.cap + 1e-9,
   `lethal_damage +${(bonus.lethal * 100).toFixed(0)}% (cap ${(bonus.cap * 100).toFixed(0)}%)`);

// --- 11. the Sanctuary view renders
await page.click('.tab[data-view="sanctuary"]');
await page.waitForTimeout(250);
const rendered = await page.evaluate(() => ({
  residents: document.querySelectorAll('.resident').length,
  habitats: document.querySelectorAll('.habitat').length,
  summary: document.getElementById('sanctuary-summary').textContent,
}));
ok('sanctuary view renders', rendered.residents > 0 && rendered.habitats > 0, rendered.summary);
await page.screenshot({ path: process.argv[2] ?? 'p2.png' });

await page.click('.tab[data-view="codex"]');
await page.waitForTimeout(250);
const codexRows = await page.locator('.entry').count();
ok('codex lists the whole bestiary', codexRows === 40, `${codexRows} entries`);
await page.screenshot({ path: (process.argv[2] ?? 'p2.png').replace('.png', '-codex.png') });

await page.click('.tab[data-view="loadout"]');
await page.waitForTimeout(250);
await page.screenshot({ path: (process.argv[2] ?? 'p2.png').replace('.png', '-bench.png') });

// --- 12. persistence
const before = await page.evaluate(() => JSON.stringify({
  res: window.__riftborn.profile.state.residents.length,
  xp: window.__riftborn.profile.state.xp,
  ammo: window.__riftborn.profile.state.ammo.rune_arrow,
}));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__riftborn !== undefined, null, { timeout: 8000 });
const after = await page.evaluate(() => JSON.stringify({
  res: window.__riftborn.profile.state.residents.length,
  xp: window.__riftborn.profile.state.xp,
  ammo: window.__riftborn.profile.state.ammo.rune_arrow,
}));
ok('sanctuary and inventory persist', before === after, after);

// --- 13. mobile
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await mobile.goto(URL, { waitUntil: 'networkidle' });
await mobile.waitForFunction(() => window.__riftborn !== undefined, null, { timeout: 8000 });
await mobile.waitForTimeout(300);
const of = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok('no horizontal overflow at 390px', of === 0, `${of}px`);
await mobile.screenshot({ path: (process.argv[2] ?? 'p2.png').replace('.png', '-mobile.png') });

await browser.close();
console.log(errors.length ? `\nCONSOLE ERRORS:\n${errors.join('\n')}` : '\nno console errors');
process.exit(errors.length ? 1 : 0);
