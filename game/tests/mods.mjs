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

// --- 0. a save written before mods existed picks up an empty mod rail
await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => {
  localStorage.setItem('riftborn.profile.v2', JSON.stringify({
    version: 2, seed: 77, xp: 40000, essence: 900, researchPoints: 40,
    materials: { ember: 9, stone: 9, verdant: 9, gale: 9, volt: 9, lumen: 9, gloom: 9, tide: 9, rift: 0 },
    ammo: { ball_round: 60, tranq_dart: 30 },
    // no `mods` key anywhere: exactly the shape the previous build wrote
    loadout: { slots: [{ weaponId: 'marker_pistol', lethalId: 'ball_round', captureId: 'tranq_dart' }, null] },
    codex: {}, residents: [], habitats: [], contracts: { day: null, list: [] }, biomesVisited: {},
    metresWalked: 0, xpFromWalkingKm: 0, lastTick: Date.now(), resolved: {},
    stats: { encounters: 0, culls: 0, captures: 0, escapes: 0, cleanCaptures: 0, evolutions: 0 },
  }));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__riftborn !== undefined, null, { timeout: 8000 });
const migrated = await page.evaluate(() => {
  const s = window.__riftborn.profile.state;
  return { mods: s.loadout.slots[0].mods, xp: s.xp, weapon: s.loadout.slots[0].weaponId };
});
ok('a pre-mods save migrates', migrated.mods && Object.keys(migrated.mods).length === 0 && migrated.xp === 40000,
   `${migrated.weapon} · mods {} · ${migrated.xp} XP kept`);

// --- 1. the gated sights are locked until the Codex earns them
const gates = await page.evaluate(() => {
  const r = window.__riftborn;
  const before = r.profile.codexProgress;
  const ids = r.data.monsters.monsters.slice(0, 6).map((m) => m.id);
  for (const id of ids) {
    r.profile.state.codex[id] = { state: 'researched', catalogued: 1, culled: 0, research: 1, seen: 1 };
  }
  const afterI = r.profile.codexProgress;
  for (const id of ids.slice(0, 3)) r.profile.state.codex[id].research = 2;
  const afterII = r.profile.codexProgress;
  r.profile.save();
  return { before, afterI, afterII };
});
ok('the gated sights read Codex research', gates.before.researchI === 0 && gates.afterI.researchI === 6 && gates.afterII.researchII === 3,
   `research I 0 → ${gates.afterI.researchI}/5 · research II ${gates.afterII.researchII}/3`);

// --- 2. the bench shows the rail, locks what is not earned, and fits what is
await page.click('[data-view="loadout"]');
await page.waitForSelector('.modcard');
const rail = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.modcard')];
  return {
    count: cards.length,
    heads: [...document.querySelectorAll('.modrail__head')].map((h) => h.textContent),
    locked: cards.filter((c) => c.disabled).map((c) => c.dataset.mod),
  };
});
ok('the bench renders one rail per category', rail.count === 12 && rail.heads.join('/') === 'barrel/core/sight',
   `${rail.count} mods across ${rail.heads.join(', ')}`);

// --- 3. clicking fits it, clicking again takes it off
const toggled = await page.evaluate(async () => {
  const pick = (id) => document.querySelector(`.modcard[data-mod="${id}"]`);
  pick('suppressor').click();
  await new Promise((r) => setTimeout(r, 60));
  const on = window.__riftborn.profile.slotAt(0).mods.barrel;
  document.querySelector('.modcard[data-mod="suppressor"]').click();
  await new Promise((r) => setTimeout(r, 60));
  const off = window.__riftborn.profile.slotAt(0).mods.barrel;
  // and one per category at a time: fitting a second barrel replaces the first
  document.querySelector('.modcard[data-mod="suppressor"]').click();
  await new Promise((r) => setTimeout(r, 60));
  document.querySelector('.modcard[data-mod="flechette"]').click();
  await new Promise((r) => setTimeout(r, 60));
  return { on, off, replaced: window.__riftborn.profile.slotAt(0).mods.barrel };
});
ok('a mod fits, clears, and never doubles up in a category',
   toggled.on === 'suppressor' && toggled.off === undefined && toggled.replaced === 'flechette',
   `fit ${toggled.on} → cleared → replaced by ${toggled.replaced}`);

// --- 4. the fitted numbers are the numbers the fight uses
const stats = await page.evaluate(async () => {
  const r = window.__riftborn;
  r.profile.setSlot(0, { weaponId: 'marker_pistol', lethalId: 'ball_round', captureId: 'tranq_dart',
                         mods: { barrel: 'suppressor', core: 'potency_coil', sight: 'scope' } });
  const base = r.data.weapons.weapons.find((w) => w.id === 'marker_pistol');
  const fitted = r.loadLoadout(r.data, {
    speciesId: 'sootpup', weaponId: 'marker_pistol', lethalId: 'ball_round', captureId: 'tranq_dart',
    mods: { barrel: 'suppressor', core: 'potency_coil', sight: 'scope' },
  });
  return {
    dmg: [base.damage, Number(fitted.weapon.damage.toFixed(2))],
    res: [base.restraint, Number(fitted.weapon.restraint.toFixed(2))],
    range: [base.range_m, Number(fitted.weapon.range_m.toFixed(2))],
    noise: [base.noise, fitted.weapon.noise],
    // mods must never change what the weapon can chamber
    lethal: fitted.ammo.lethal.id, capture: fitted.ammo.capture.id,
  };
});
ok('mod effects compound onto the base weapon',
   Math.abs(stats.dmg[1] - 18 * 0.9 * 0.9) < 0.01 && Math.abs(stats.res[1] - 14 * 1.25) < 0.01
   && Math.abs(stats.range[1] - 18 * 1.15) < 0.01 && stats.noise[1] === 'low'
   && stats.lethal === 'ball_round' && stats.capture === 'tranq_dart',
   `dmg ${stats.dmg[0]}→${stats.dmg[1]} · res ${stats.res[0]}→${stats.res[1]} · range ${stats.range[0]}→${stats.range[1]}m · noise ${stats.noise.join('→')}`);

/** Drop into a fight against a named species with the current loadout. */
const engage = (speciesId) => page.evaluate(async (id) => {
  const r = window.__riftborn;
  r.show('patrol');
  await new Promise((res) => setTimeout(res, 300));
  for (let i = 0; i < 40 && r.patrol.spawns.length === 0; i++) {
    r.patrol.x += 90; r.patrol.y += 40;
    await new Promise((res) => setTimeout(res, 60));
  }
  const base = r.patrol.spawns[0];
  if (!base) return null;
  const spawn = { ...base, id: `mod-${Math.random()}`, speciesId: id, packSize: 1 };
  r.teleportTo(spawn); r.startFight(spawn);
  await new Promise((res) => setTimeout(res, 350));
  return r.fight ? { name: r.fight.loadout.species.name, flags: r.fight.loadout.modFlags } : null;
}, speciesId);

// --- 5. a suppressor buys distance, not silence — silence stays the bow's alone
const noise = await page.evaluate(() => {
  const r = window.__riftborn;
  const L = (weaponId, lethalId, captureId, mods) =>
    r.loadLoadout(r.data, { speciesId: 'sootpup', weaponId, lethalId, captureId, mods }).weapon.noise;
  return {
    pistol: [L('marker_pistol', 'ball_round', 'tranq_dart', {}),
             L('marker_pistol', 'ball_round', 'tranq_dart', { barrel: 'suppressor' })],
    // the crossbow already sits one rung from silent: the floor is what stops it
    crossbow: [L('sting_crossbow', 'broadhead', 'rune_arrow', {}),
               L('sting_crossbow', 'broadhead', 'rune_arrow', { barrel: 'suppressor' })],
    bow: [L('sylvan_bow', 'broadhead', 'rune_arrow', {}),
          L('sylvan_bow', 'broadhead', 'rune_arrow', { barrel: 'suppressor' })],
  };
});
ok('a suppressor steps towards silence but can never buy it',
   noise.pistol.join('→') === 'medium→low' && noise.crossbow.join('→') === 'low→low'
   && noise.bow.join('→') === 'silent→silent',
   `pistol ${noise.pistol.join('→')} · crossbow ${noise.crossbow.join('→')} · only the Sylvan Bow is ${noise.bow[0]}`);

// --- 6. without a Bio-Scanner the Restraint readout is coarse; with one it is exact
await page.evaluate(() => {
  window.__riftborn.profile.setSlot(0, { weaponId: 'marker_pistol', lethalId: 'ball_round', captureId: 'tranq_dart', mods: {} });
});
const stockHud = await engage('sootpup');
const coarse = await page.evaluate(async () => {
  const r = window.__riftborn;
  r.fight.monster.restraint = r.fight.monster.required * 0.6;
  await new Promise((res) => setTimeout(res, 250));
  return {
    value: document.getElementById('restraint-value').textContent,
    width: document.getElementById('restraint-fill').style.width,
    notched: document.getElementById('restraint-bar').dataset.coarse,
    chips: document.getElementById('statuses').textContent,
  };
});
ok('the stock HUD reads Restraint in quarters',
   /[■□]{4}/.test(coarse.value) && coarse.notched === 'true' && coarse.width === '50%'
   && !/bolt risk/.test(coarse.chips),
   `"${coarse.value}" at 60% true → bar pinned to ${coarse.width}, no bolt-risk chip`);

await page.evaluate(() => {
  const r = window.__riftborn;
  r.profile.setSlot(0, { weaponId: 'marker_pistol', lethalId: 'ball_round', captureId: 'tranq_dart',
                         mods: { sight: 'bio_scanner' } });
  r.show('patrol');
});
const scanned = await engage('sootpup');
const exact = await page.evaluate(async () => {
  const r = window.__riftborn;
  r.fight.monster.restraint = r.fight.monster.required * 0.6;
  r.fight.monster.hp = r.fight.monster.maxHp * 0.2;     // under the flee threshold, so a risk exists to read
  await new Promise((res) => setTimeout(res, 250));
  return {
    value: document.getElementById('restraint-value').textContent,
    width: document.getElementById('restraint-fill').style.width,
    notched: document.getElementById('restraint-bar').dataset.coarse,
    chips: document.getElementById('statuses').textContent,
  };
});
ok('a Bio-Scanner turns it into figures and a live bolt risk',
   /\d+ \/ \d+/.test(exact.value) && exact.notched === 'false'
   && Math.abs(parseFloat(exact.width) - 60) < 1.5 && /bolt risk/.test(exact.chips),
   `"${exact.value}" · bar ${exact.width} · ${exact.chips.match(/bolt risk [\d.]+%\/s/)?.[0] ?? 'no chip'}`);

// --- 7. an unearned mod cannot be smuggled into a fight
const smuggled = await page.evaluate(async () => {
  const r = window.__riftborn;
  for (const id of Object.keys(r.profile.state.codex)) r.profile.state.codex[id].research = 0;
  r.profile.setSlot(0, { weaponId: 'marker_pistol', lethalId: 'ball_round', captureId: 'tranq_dart',
                         mods: { sight: 'bio_scanner' } });
  r.profile.save();
  return { progress: r.profile.codexProgress };
});
const afterLock = await engage('sootpup');
ok('an unearned sight is dropped on the way into the fight',
   afterLock && afterLock.flags.showRestraintNumbers === false,
   `research II back to ${smuggled.progress.researchII}/3 → scanner flags off`);

// --- 8. Shadelet's weak point stays dark until something lights it
const shade = await page.evaluate(async () => {
  const r = window.__riftborn;
  r.profile.setSlot(0, { weaponId: 'marker_pistol', lethalId: 'ball_round', captureId: 'tranq_dart',
                         mods: { sight: 'thermal' } });
  r.show('patrol');
  return r.data.monsters.monsters.find((m) => m.id === 'shadelet')?.weak_point_requires ?? null;
});
const lit = await engage('shadelet');
const illum = await page.evaluate(async () => {
  const r = window.__riftborn;
  const m = r.fight.monster;
  const withThermal = m.illuminated;
  return { hidden: m.hiddenWeakPoints, withThermal, flag: r.fight.loadout.modFlags.revealHidden };
});
ok('Thermal holds a gloom-shrouded weak point lit',
   shade === 'illumination' && (illum.hidden ?? []).length > 0 && illum.flag === true && illum.withThermal > 0,
   `shadelet hides ${JSON.stringify(illum.hidden)} · thermal keeps it lit frame to frame`);

await page.evaluate(() => window.__riftborn.show('loadout'));
await page.waitForTimeout(250);
await page.screenshot({ path: process.argv[2] ?? 'mods.png', fullPage: true });
await browser.close();
console.log(errors.length ? `\nCONSOLE ERRORS:\n${errors.join('\n')}` : '\nno console errors');
if (fails) console.log(`${fails} check(s) FAILED`);
process.exit(errors.length || fails ? 1 : 0);
