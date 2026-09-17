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
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__riftborn !== undefined, null, { timeout: 8000 });

// --- 1. a species' typical height is derived from its own data, not authored
const heights = await page.evaluate(() => {
  const r = window.__riftborn;
  const sp = (id) => r.data.monsters.monsters.find((m) => m.id === id);
  const sz = (s) => r.data.sizes.sizes.find((z) => z.id === s.size);
  return ['glimmerfly', 'sootpup', 'cinderfang', 'karrahk'].map((id) => {
    const s = sp(id);
    const z = sz(s);
    return { id, size: s.size, band: z.height_m, mean: Number(r.speciesHeight(s, z).toFixed(2)) };
  });
});
ok('a species sits inside its own size band',
   heights.every((h) => h.mean > h.band[0] && h.mean < h.band[1]),
   heights.map((h) => `${h.id} ${h.mean}m of ${h.band.join('-')}`).join(' · '));

// --- 2. the roll is a distribution, and the percentile matches it
const dist = await page.evaluate(() => {
  const r = window.__riftborn;
  const s = r.data.monsters.monsters.find((m) => m.id === 'cinderfang');
  const z = r.data.sizes.sizes.find((x) => x.id === s.size);
  let a = 12345;
  const rng = () => { a = (a * 16807) % 2147483647; return a / 2147483647; };
  const rolls = Array.from({ length: 4000 }, () => r.rollSpecimen(s, z, rng));
  const hs = rolls.map((x) => x.heightM).sort((p, q) => p - q);
  const mean = r.speciesHeight(s, z);
  // A roll's own percentile should agree with where it actually landed in the sample.
  const mid = rolls[0];
  const rank = hs.filter((h) => h < mid.heightM).length / hs.length;
  return {
    p05: hs[200], p50: hs[2000], p95: hs[3800], mean,
    spread: (hs[3800] - hs[200]) / mean,
    agree: Math.abs(rank - mid.percentile),
    band: z.height_m,
    inBand: hs[0] >= z.height_m[0] && hs[hs.length - 1] <= z.height_m[1],
  };
});
ok('heights spread around the mean and never leave the class band',
   dist.inBand && Math.abs(dist.p50 - dist.mean) < 0.03 && dist.spread > 0.2 && dist.agree < 0.03,
   `p05 ${dist.p05.toFixed(2)} · p50 ${dist.p50.toFixed(2)} · p95 ${dist.p95.toFixed(2)}`
   + ` (mean ${dist.mean.toFixed(2)}, band ${dist.band.join('-')}) · percentile agrees to ${(dist.agree * 100).toFixed(1)}pt`);

// --- 3. the specimen roll must not disturb the fight's own RNG
const streams = await page.evaluate(() => {
  const r = window.__riftborn;
  const lo = r.loadLoadout(r.data, {
    speciesId: 'cinderfang', weaponId: 'marker_pistol', lethalId: 'ball_round', captureId: 'tranq_dart',
  });
  const mk = (seed) => {
    let a = seed;
    return () => { a = (a * 16807) % 2147483647; return a / 2147483647; };
  };
  // Same fight rng, different specimen rng: every draw the fight makes must match.
  const runs = [1, 2].map((s) => {
    const f = r.createFight(lo, { rng: mk(999), specimenRng: mk(s * 7717) });
    return { draws: Array.from({ length: 20 }, () => f.rng()), h: f.monster.heightM };
  });
  return {
    sameDraws: runs[0].draws.join() === runs[1].draws.join(),
    differentHeights: Math.abs(runs[0].h - runs[1].h) > 0.001,
  };
});
ok('the specimen stream is separate from the fight stream',
   streams.sameDraws && streams.differentHeights,
   'same fight rng → identical draws; different specimen rng → different animal');

/** Drop into a fight against a named species. */
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
  const spawn = { ...base, id: `cx-${Math.random()}`, speciesId: id, packSize: 1 };
  r.teleportTo(spawn); r.startFight(spawn);
  await new Promise((res) => setTimeout(res, 350));
  return r.fight ? { name: r.fight.loadout.species.name, h: r.fight.monster.heightM, p: r.fight.monster.percentile } : null;
}, speciesId);

// --- 4. a capture writes the specimen into the Codex
await page.evaluate(() => {
  const r = window.__riftborn;
  r.profile.state.devUnlockAll = true;
  r.profile.state.ammo.tranq_dart = 60;
  r.profile.save();
});
const caught = await engage('sootpup');
const recorded = await page.evaluate(async () => {
  const r = window.__riftborn;
  const m = r.fight.monster;
  m.hp = m.maxHp;                             // a clean capture, so bestHp is meaningful
  for (let i = 0; i < 60 && m.state !== 'subdued'; i++) {
    m.restraint = m.required + 1;
    await new Promise((res) => setTimeout(res, 50));
  }
  document.getElementById('btn-tag').click();
  await new Promise((res) => setTimeout(res, 400));
  const e = r.profile.entry('sootpup');
  const res = r.profile.state.residents.at(-1);
  return {
    largest: e.largest, specimens: e.specimens, firstAt: !!e.firstAt, area: e.lastArea,
    resident: res ? { h: res.heightM, p: res.percentile, biome: res.biome } : null,
  };
});
ok('a capture records the specimen on both the entry and the resident',
   recorded.largest?.heightM > 0 && recorded.specimens.count === 1
   && Math.abs(recorded.resident.h - recorded.largest.heightM) < 1e-9 && !!recorded.area,
   `${recorded.largest.heightM.toFixed(2)} m · ${(recorded.largest.percentile * 100).toFixed(0)}th pct`
   + ` · area "${recorded.area}" (biome only)`);

// --- 5. "largest" keeps the largest, and the running count keeps counting
const largest = await page.evaluate(() => {
  const r = window.__riftborn;
  const before = r.profile.entry('sootpup').largest.heightM;
  const e = { ...r.profile.entry('sootpup') };
  r.profile.recordSpecimen(e, { heightM: before - 0.2, percentile: 0.1 }, 'culled');
  const afterSmall = e.largest.heightM;
  r.profile.recordSpecimen(e, { heightM: before + 0.2, percentile: 0.99 }, 'catalogued');
  r.profile.state.codex.sootpup = e;
  r.profile.save();
  return { before, afterSmall, after: e.largest.heightM, count: e.specimens.count };
});
ok('a smaller specimen never replaces the record',
   Math.abs(largest.afterSmall - largest.before) < 1e-9
   && largest.after > largest.before && largest.count === 3,
   `${largest.before.toFixed(2)} → smaller ignored → ${largest.after.toFixed(2)} m over ${largest.count} seen`);

// --- 6. the Codex shows Your Records, and offers a card
// Leave the fight first: the tab strip deliberately ignores clicks mid-encounter,
// so clicking Codex from the outcome overlay does nothing at all.
await page.click('#again');
await page.waitForTimeout(200);
await page.click('[data-view="codex"]');
await page.waitForSelector('.records');
const panel = await page.evaluate(() => {
  const el = [...document.querySelectorAll('.entry')].find((a) => /Sootpup/.test(a.textContent));
  const rec = el?.querySelector('.records');
  return {
    text: rec ? rec.textContent.replace(/\s+/g, ' ').trim() : null,
    hasCard: !!rec?.querySelector('.records__card'),
  };
});
ok('the Codex entry carries a Your Records panel',
   /Largest/.test(panel.text) && /percentile/.test(panel.text)
   && /Species typical/.test(panel.text) && panel.hasCard,
   panel.text.slice(0, 120));

// --- 7. a field report renders, names a biome, and names nothing finer
const card = await page.evaluate(async () => {
  document.querySelector('.records__card').click();
  await new Promise((r) => setTimeout(r, 300));
  const c = document.getElementById('report-canvas');
  const ctx = c.getContext('2d');
  // Not blank: count distinct pixels across the card.
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const seen = new Set();
  for (let i = 0; i < d.length; i += 4 * 977) seen.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
  const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
  return { w: c.width, h: c.height, colours: seen.size, bytes: blob?.size ?? 0, open: !document.getElementById('report').hidden };
});
ok('the field report renders to a shareable PNG',
   card.open && card.w === 1080 && card.h === 1350 && card.colours > 8 && card.bytes > 8000,
   `${card.w}×${card.h} · ${card.colours} distinct colours sampled · ${(card.bytes / 1024).toFixed(0)} KB PNG`);

const leak = await page.evaluate(() => {
  const r = window.__riftborn;
  // Hand the card everything a caller might wrongly pass and check none of it lands.
  const sp = r.data.monsters.monsters.find((m) => m.id === 'sootpup');
  const c = document.createElement('canvas');
  r.drawFieldReport(c, {
    species: sp, outcome: 'catalogued', heightM: 0.7, percentile: 0.5, hpFraction: 1,
    biome: 'residential', at: Date.now(),
    x: 51.5074, y: -0.1278, tile: 'tile-9912', lat: 51.5074, lng: -0.1278,
  });
  return { drew: c.width === 1080, patrol: { x: r.patrol.x, y: r.patrol.y } };
});
ok('the card takes a biome and cannot be handed a position',
   leak.drew,
   'report.js reads species/outcome/method/height/percentile/hp/biome/date — coordinates passed alongside are simply never read');

// --- 8. completion rewards: a finished family pays a habitat, all first stages pay the Bio-Scanner
const rewards = await page.evaluate(() => {
  const r = window.__riftborn;
  const all = r.data.monsters.monsters.filter((m) => m.family !== 'apex');
  const before = { slots: r.profile.habitatSlots, done: r.profile.completedFamilies.length };

  // Merge: replacing the entry outright would wipe the specimen records this
  // suite has just spent five checks building, and the later persistence check
  // would then be measuring the test's own damage.
  const mark = (m) => {
    const e = { ...r.profile.entry(m.id) };
    e.state = 'catalogued';
    e.catalogued = Math.max(1, e.catalogued ?? 0);
    r.profile.state.codex[m.id] = e;
  };
  const cinder = all.filter((m) => m.family === 'cinder');
  for (const m of cinder) mark(m);
  const oneFamily = { slots: r.profile.habitatSlots, done: r.profile.completedFamilies.length };

  const scannerBefore = r.modUnlocked({ id: 'bio_scanner', requires: 'research_2' }, r.profile.codexProgress);
  for (const m of all) if (m.stage === 1) mark(m);
  const scannerAfter = r.modUnlocked({ id: 'bio_scanner', requires: 'research_2' }, r.profile.codexProgress);
  r.profile.save();
  return {
    before, oneFamily, scannerBefore, scannerAfter,
    stageOne: r.profile.stageOneFamilies.length, families: r.profile.familyCount,
  };
});
ok('completing a family pays a habitat slot',
   rewards.oneFamily.done === rewards.before.done + 1
   && rewards.oneFamily.slots === rewards.before.slots + 1,
   `${rewards.before.slots} → ${rewards.oneFamily.slots} habitats for the Cinder line`);
ok('every family at stage 1 hands over the Bio-Scanner permanently',
   rewards.scannerBefore === false && rewards.scannerAfter === true
   && rewards.stageOne === rewards.families,
   `${rewards.stageOne} / ${rewards.families} first stages → scanner opens with zero Research II`);

// --- 9. an evolution carries the percentile, not the height
const evolved = await page.evaluate(() => {
  const r = window.__riftborn;
  const res = r.profile.state.residents.at(-1);
  res.speciesId = 'sootpup';
  res.percentile = 0.95;
  res.heightM = 0.80;
  res.study = 99999;
  const before = { h: res.heightM, p: res.percentile, sp: res.speciesId };
  r.profile.evolve(res.uid, 'cinderfang');
  const sp = r.data.monsters.monsters.find((m) => m.id === 'cinderfang');
  const sz = r.data.sizes.sizes.find((z) => z.id === sp.size);
  return {
    before, after: { h: res.heightM, sp: res.speciesId, lineage: res.evolvedFrom },
    cinderfangMean: r.speciesHeight(sp, sz),
    // the percentile it reads at now, measured against the animal it became
    nowPct: r.heightPercentile(sp, sz, res.heightM),
  };
});
ok('an evolved specimen keeps its percentile, not its old height',
   evolved.after.h > evolved.cinderfangMean && Math.abs(evolved.nowPct - 0.95) < 0.02
   && evolved.after.lineage.includes('sootpup'),
   `${evolved.before.h.toFixed(2)} m Sootpup (95th) → ${evolved.after.h.toFixed(2)} m Cinderfang`
   + ` (${(evolved.nowPct * 100).toFixed(0)}th, species mean ${evolved.cinderfangMean.toFixed(2)})`);

// --- 10. the showcase pins three and refuses a fourth
const showcase = await page.evaluate(() => {
  const r = window.__riftborn;
  const sp = r.data.monsters.monsters.find((m) => m.id === 'sootpup');
  while (r.profile.state.residents.length < 5) r.profile.admit(sp, { heightM: 0.6, percentile: 0.4 });
  r.profile.state.showcase = [];
  const uids = r.profile.state.residents.slice(0, 4).map((x) => x.uid);
  const results = uids.map((u) => r.profile.togglePin(u));
  const afterFour = r.profile.showcase.length;
  r.profile.togglePin(uids[0]);                  // pinning the same one again unpins it
  return { results, afterFour, afterUnpin: r.profile.showcase.length };
});
ok('the showcase holds three and no more',
   showcase.results.join() === 'true,true,true,false'
   && showcase.afterFour === 3 && showcase.afterUnpin === 2,
   `4th pin refused · unpinning drops back to ${showcase.afterUnpin}`);

// --- 11. a resident shows what it is and where it came from
await page.evaluate(() => window.__riftborn.show('sanctuary'));
await page.waitForSelector('.resident');
const sanctuary = await page.evaluate(() => ({
  summary: document.getElementById('sanctuary-summary').textContent,
  lineage: [...document.querySelectorAll('.resident')].some((el) => /Raised from/.test(el.textContent)),
  measured: [...document.querySelectorAll('.resident')].some((el) => /percentile/.test(el.textContent)),
  pins: document.querySelectorAll('[data-pin]').length,
}));
ok('the Sanctuary shows measurement, lineage and the pin',
   sanctuary.lineage && sanctuary.measured && sanctuary.pins > 0
   && /families complete/.test(sanctuary.summary),
   sanctuary.summary);

// --- 12. all of it survives a reload
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__riftborn !== undefined, null, { timeout: 8000 });
const persisted = await page.evaluate(() => {
  const r = window.__riftborn;
  const e = r.profile.entry('sootpup');
  return {
    largest: e.largest?.heightM ?? 0,
    seen: e.specimens?.count ?? 0,
    showcase: r.profile.showcase.length,
    scanner: r.profile.permanentMods,
    slots: r.profile.habitatSlots,
  };
});
ok('records, showcase and completion rewards persist',
   persisted.largest > 0 && persisted.seen >= 3 && persisted.showcase === 2
   && persisted.scanner.includes('bio_scanner'),
   JSON.stringify(persisted));

// --- 13. layout holds on a phone
await page.setViewportSize({ width: 390, height: 844 });
await page.evaluate(() => window.__riftborn.show('codex'));
await page.waitForTimeout(300);
const overflow = await page.evaluate(() => {
  const el = document.querySelector('.records__card');
  if (el) el.click();
  return document.documentElement.scrollWidth - document.documentElement.clientWidth;
});
await page.waitForTimeout(300);
const fits = await page.evaluate(() => {
  const c = document.getElementById('report-canvas');
  const r = c.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height), vw: window.innerWidth, vh: window.innerHeight };
});
ok('the card fits a 390px phone with no horizontal overflow',
   // w > 200 matters: a hidden modal measures 0x0 and would sail through "fits".
   overflow === 0 && fits.w > 200 && fits.w <= fits.vw && fits.h <= fits.vh,
   `${overflow}px overflow · card ${fits.w}×${fits.h} in ${fits.vw}×${fits.vh}`);

await page.screenshot({ path: process.argv[2] ?? 'codex.png' });
await browser.close();
console.log(errors.length ? `\nCONSOLE ERRORS:\n${errors.join('\n')}` : '\nno console errors');
if (fails) console.log(`${fails} check(s) FAILED`);
process.exit(errors.length || fails ? 1 : 0);
