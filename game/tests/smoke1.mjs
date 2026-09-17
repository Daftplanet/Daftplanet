import { chromium } from 'playwright';

// executablePath is only needed where the browser is not on Playwright's own path.
const LAUNCH = process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {};

const URL = process.env.RIFTBORN_URL ?? 'http://127.0.0.1:8765/riftborn/';
const browser = await chromium.launch(LAUNCH);
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));

const ok = (label, cond, extra = '') => console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  — ' + extra : ''}`);

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__riftborn !== undefined, null, { timeout: 8000 });

/*
 * This suite is the real-time arena's, and the engage button now routes to the
 * turn-based battle by default. Say which combat is under test rather than
 * relying on whichever one happens to be the default.
 */
await page.evaluate(() => {
  window.__riftborn.profile.state.combatMode = 'arena';
  window.__riftborn.profile.save();
});

// --- 1. patrol boots with spawns
await page.waitForTimeout(400);
let st = await page.evaluate(() => ({
  view: window.__riftborn.view,
  spawns: window.__riftborn.patrol.spawns.length,
  clock: document.getElementById('clock').textContent,
  biome: document.getElementById('biome').textContent,
}));
ok('patrol view boots', st.view === 'patrol');
ok('spawns generated', st.spawns > 0, `${st.spawns} in range · ${st.clock} · ${st.biome}`);

// --- 2. walking moves the Warden and accrues distance
const before = await page.evaluate(() => ({ x: window.__riftborn.patrol.x, m: window.__riftborn.profile.state.metresWalked }));
await page.keyboard.down('KeyD'); await page.waitForTimeout(700); await page.keyboard.up('KeyD');
const after = await page.evaluate(() => ({ x: window.__riftborn.patrol.x, m: window.__riftborn.profile.state.metresWalked }));
ok('walking moves + logs distance', after.x > before.x && after.m > before.m, `${(after.m - before.m).toFixed(0)}m walked`);

// --- 3. time of day changes the spawn mix
const mix = async (hourOffset) => page.evaluate((h) => {
  const r = window.__riftborn;
  r.patrol.hourOffset = h;
  const counts = {};
  // sample a wide area rather than just what is on screen
  const { spawnsInTile, biomeAt, timeWindow, timeBucket } = window.__riftbornWorld;
  const d = new Date(Date.now() + h * 3600e3);
  const win = timeWindow(d), bucket = timeBucket(d);
  for (let ty = 0; ty < 60; ty++) for (let tx = 0; tx < 60; tx++) {
    const b = biomeAt(tx, ty, r.profile.state.seed);
    for (const s of spawnsInTile(tx, ty, bucket, r.patrol.pool, b, win, r.profile.state.seed)) {
      const el = r.speciesById[s.speciesId].elements[0];
      counts[el] = (counts[el] || 0) + 1;
    }
  }
  return counts;
}, hourOffset);

await page.evaluate(async () => { window.__riftbornWorld = await import('./js/world.js'); });
const noon = await mix(12 - new Date().getHours());
const night = await mix(23 - new Date().getHours());
/*
 * Measure Gloom, not Ember. Night only boosts Ember x1.2, and that share is diluted
 * by the Slag family, which spawns at any hour — so Ember is a weak signal for
 * "does the clock matter". Gloom swings x0.1 by day to x2.5 by night.
 */
const share = (t, el) => (t[el] || 0) / Object.values(t).reduce((a, b) => a + b, 1);
const gloomDay = share(noon, 'gloom');
const gloomNight = share(night, 'gloom');
ok('time of day shifts spawns', gloomNight > Math.max(gloomDay * 3, 0.02),
   `gloom ${(gloomDay * 100).toFixed(1)}% at noon → ${(gloomNight * 100).toFixed(1)}% at night`
   + ` · ember ${(share(noon, 'ember') * 100).toFixed(0)}% → ${(share(night, 'ember') * 100).toFixed(0)}%`);
await page.evaluate(() => { window.__riftborn.patrol.hourOffset = 0; });

// --- 4. engage the nearest spawn
await page.waitForTimeout(300);
const engaged = await page.evaluate(async () => {
  const r = window.__riftborn;
  // Walk on if this starting tile happens to be empty. Residential is the
  // thinnest table by design at a 7% tile rate, so an empty patch is the world
  // working — though for a long time it was the world being broken: residential
  // had no species at all and this line was quietly describing a content bug.
  for (let i = 0; i < 40 && r.patrol.spawns.length === 0; i++) {
    r.patrol.x += 90; r.patrol.y += 40;
    await new Promise((res) => setTimeout(res, 60));
  }
  const easiest = [...r.patrol.spawns]
    .sort((a, b) => r.speciesById[a.speciesId].stats.hp - r.speciesById[b.speciesId].stats.hp)[0];
  if (!easiest) return null;
  r.teleportTo(easiest);
  return { name: r.speciesById[easiest.speciesId].name, id: easiest.id };
});
ok('a spawn is reachable', Boolean(engaged), engaged?.name);
await page.waitForTimeout(250);
ok('engage prompt appears', await page.locator('#engage').isVisible());
await page.click('#engage-go');
await page.waitForTimeout(250);
ok('fight view opens', (await page.evaluate(() => window.__riftborn.view)) === 'fight',
   await page.textContent('#monster-name'));
await page.waitForTimeout(400);
await page.screenshot({ path: (process.argv[2] ?? 'p1.png').replace('.png', '-fight.png') });

// --- 5. fight to a conclusion with a scripted player that actually aims
/*
 * Pack-aware: commit to one target until it is resolved, then move on. Reading the
 * focused monster instead made the strategy thrash its chamber every time focus
 * shifted to a fresh full-health pack member.
 */
let targetUid = null;
const readTarget = () => page.evaluate((uid) => {
  const f = window.__riftborn.fight;
  if (!f || f.outcome) return null;
  const done = (x) => ['dead', 'tagged', 'escaped'].includes(x.state);
  const t = f.monsters.find((x) => x.uid === uid && !done(x)) ?? f.monsters.find((x) => !done(x));
  if (!t) return null;

  /*
   * Lead the target. A Mote crosses nearly two body-widths in the time between
   * this read and the trigger pull, so aiming where it is means never hitting the
   * fast ones — 24 shots for 1 hit against a Glimmerfly. A human leads; so does this.
   */
  const now = performance.now();
  // Keyed to this fight: a cache surviving into the next encounter reports the jump
  // between two unrelated positions as velocity, and the aim goes off the map.
  if (window.__leadFight !== f) { window.__leadFight = f; window.__lead = {}; }
  const prev = window.__lead[t.uid];
  let vx = 0, vy = 0;
  if (prev) {
    const dt = Math.max(0.016, (now - prev.t) / 1000);
    vx = (t.x - prev.x) / dt;
    vy = (t.y - prev.y) / dt;
    const sp = Math.hypot(vx, vy);
    if (sp > 500) { vx = (vx / sp) * 500; vy = (vy / sp) * 500; }   // nothing moves faster
  }
  window.__lead[t.uid] = { x: t.x, y: t.y, t: now };

  const speed = f.weapon.chamber === 'lethal' ? 950 : 760;
  const range = Math.hypot(t.x - f.player.x, t.y - f.player.y);
  const horizon = range / speed + 0.16;            // flight time plus the click delay
  return {
    uid: t.uid,
    x: t.x + vx * horizon, y: t.y + vy * horizon,
    hp: t.hp / t.maxHp, state: t.state,
    chamber: f.weapon.chamber, mag: f.weapon.mag[f.weapon.chamber],
    reserve: f.weapon.reserve[f.weapon.chamber],
    have: {
      lethal: f.weapon.mag.lethal + f.weapon.reserve.lethal,
      capture: f.weapon.mag.capture + f.weapon.reserve.capture,
    },
    anySubdued: f.monsters.some((x) => x.state === 'subdued'),
  };
}, targetUid);

let loops = 0, brokeOn = null;
for (let i = 0; i < 140 && !(await page.locator('#overlay').isVisible()); i++) {
  loops = i + 1;
  const m = await readTarget();
  if (!m) { brokeOn = 'no live target'; break; }
  targetUid = m.uid;

  if (m.anySubdued) { await page.keyboard.press('KeyE'); continue; }

  const box = await page.locator('#stage').boundingBox();
  await page.mouse.move(box.x + (m.x / 960) * box.width, box.y + (m.y / 640) * box.height);

  /*
   * Soften with lethal, then swap to darts once this target is well wounded — but
   * only ever want a chamber that still has rounds. Without that guard the bot
   * swapped away from a dry chamber and the strategy swapped straight back,
   * oscillating forever with 12 unused darts in the pouch.
   */
  let want = m.hp > 0.35 ? 'lethal' : 'capture';
  if (m.have[want] === 0) want = want === 'lethal' ? 'capture' : 'lethal';
  if (m.have[want] === 0) { brokeOn = 'out of rounds'; break; }

  if (m.chamber !== want) { await page.keyboard.press('Space'); await page.waitForTimeout(650); continue; }
  if (m.mag === 0) { await page.keyboard.press('KeyR'); await page.waitForTimeout(1500); continue; }
  await page.mouse.down(); await page.waitForTimeout(130); await page.mouse.up();
}
// The encounter ends a frame or two after the last round lands, so give it a beat
// before calling it unresolved.
for (let i = 0; i < 20 && !(await page.locator('#overlay').isVisible()); i++) {
  await page.waitForTimeout(150);
}
let resolved = await page.locator('#overlay').isVisible();
const diag = resolved ? null : await page.evaluate(() => {
  const f = window.__riftborn.fight;
  if (!f) return { note: 'no fight object' };
  const m = f.monsters[0];
  return {
    pack: f.monsters.map((x) => `${x.state} ${Math.round(x.hp)}/${x.maxHp}`),
    outcome: f.outcome,
    restraint: `${Math.round(m.restraint)}/${Math.round(m.required)}`,
    shots: f.stats.shots, hits: f.stats.hits,
    ammo: `L ${f.weapon.mag.lethal}+${f.weapon.reserve.lethal} / C ${f.weapon.mag.capture}+${f.weapon.reserve.capture}`,
    chamber: f.weapon.chamber, playerHp: Math.round(f.player.hp),
  };
});
ok('fight reaches an outcome', resolved,
   resolved ? `${await page.textContent('#verdict')} · ${await page.textContent('#rewards')}`
            : `unresolved after ${loops} loops, stopped on "${brokeOn ?? 'loop limit'}" — ${JSON.stringify(diag)}`);

// --- 6. rewards actually landed
const gained = await page.evaluate(() => {
  const s = window.__riftborn.profile.state;
  return { xp: s.xp, ess: s.essence, encounters: s.stats.encounters, codex: Object.keys(s.codex).length };
});
ok('profile recorded the encounter', gained.encounters > 0 && gained.codex > 0,
   `${gained.xp} XP · ${gained.codex} codex entries touched (a failed encounter pays nothing by design)`);

if (resolved) { await page.click('#again'); } else { await page.keyboard.press('Escape'); }
await page.waitForTimeout(250);
ok('returns to patrol', (await page.evaluate(() => window.__riftborn.view)) === 'patrol');

// --- 6b. withdrawing leaves the spawn standing
const wd = await page.evaluate(async () => {
  const r = window.__riftborn;
  const s = r.patrol.spawns[0];
  if (!s) return null;
  r.teleportTo(s); r.startFight(s);
  await new Promise((res) => setTimeout(res, 200));
  const inFight = r.view === 'fight';
  document.getElementById('withdraw').click();
  await new Promise((res) => setTimeout(res, 200));
  return { inFight, back: r.view === 'patrol', stillThere: !r.profile.isResolved(s.id) };
});
ok('withdraw from an unaware monster keeps the spawn', wd && wd.inFight && wd.back && wd.stillThere, JSON.stringify(wd));

// --- 6c. withdrawing after it has seen you costs the spawn
const wd2 = await page.evaluate(async () => {
  const r = window.__riftborn;
  const s = r.patrol.spawns.find((sp) => !r.profile.isResolved(sp.id));
  if (!s) return null;
  r.teleportTo(s); r.startFight(s);
  await new Promise((res) => setTimeout(res, 200));
  r.fight.monster.aware = true;                 // it has noticed you
  document.getElementById('withdraw').click();
  await new Promise((res) => setTimeout(res, 200));
  return { back: r.view === 'patrol', consumed: r.profile.isResolved(s.id) };
});
ok('withdraw after being seen costs the spawn', wd2 && wd2.back && wd2.consumed, JSON.stringify(wd2));

// --- 6d. the prototype weapon unlock affordance
const unlocked = await page.evaluate(() => {
  const r = window.__riftborn;
  const before = r.profile.unlockedWeapons.length;
  r.profile.state.devUnlockAll = true;
  const after = r.profile.unlockedWeapons.length;
  r.profile.state.devUnlockAll = false;
  return { before, after };
});
ok('unlock-all opens every weapon', unlocked.before === 1 && unlocked.after === 8, JSON.stringify(unlocked));

// --- 7. codex
await page.click('.tab[data-view="codex"]');
await page.waitForTimeout(200);
const codex = await page.evaluate(() => ({
  entries: document.querySelectorAll('.entry').length,
  progress: document.getElementById('codex-progress').textContent,
  states: [...document.querySelectorAll('.entry')].map((e) => e.dataset.state),
}));
ok('codex lists the bestiary', codex.entries === 40, `${codex.entries} entries · ${codex.progress}`);
ok('codex reflects encounters', codex.states.some((s) => s !== 'unknown'),
   [...new Set(codex.states)].join(', '));
await page.screenshot({ path: (process.argv[2] ?? 'p1.png').replace('.png', '-codex.png') });

// --- 8. loadout + crafting
await page.click('.tab[data-view="loadout"]');
await page.waitForTimeout(200);
const beforeCraft = await page.evaluate(() => window.__riftborn.profile.state.ammo.ball_round);
const craftBtn = page.locator('.round__craft:not([disabled])').first();
if (await craftBtn.count()) await craftBtn.click();
await page.waitForTimeout(200);
const afterCraft = await page.evaluate(() => window.__riftborn.profile.state.ammo);
ok('crafting adds rounds', Object.values(afterCraft).some((v) => v > 0), `ball ${beforeCraft} → ${afterCraft.ball_round}`);
const cards = await page.locator('.wcard').count();
const locked = await page.locator('.wcard:disabled').count();
ok('weapon cards render with rank gates', cards === 8 && locked === 7,
   `${cards} weapons, ${locked} locked at rank 1`);
await page.screenshot({ path: (process.argv[2] ?? 'p1.png').replace('.png', '-loadout.png') });

// --- 9. persistence
const snap = () => page.evaluate(() => {
  const s = window.__riftborn.profile.state;
  // Sighting new spawns legitimately adds codex keys after a reload, so compare the
  // durable record: what was actually catalogued or culled.
  const record = Object.entries(s.codex)
    .filter(([, e]) => e.catalogued || e.culled)
    .map(([k, e]) => `${k}:${e.state}:${e.catalogued}/${e.culled}`).sort();
  return JSON.stringify({ xp: s.xp, ess: s.essence, alloy: s.alloy, ammo: s.ammo,
                          record, enc: s.stats.encounters, rp: s.researchPoints, seed: s.seed });
});
const before2 = await snap();
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__riftborn !== undefined, null, { timeout: 8000 });
const after2 = await snap();
const parsed = JSON.parse(after2);
ok('profile persists across reload', after2 === before2,
   `${parsed.record.join(', ') || 'no record'} · ${parsed.enc} encounters · ${parsed.xp} XP · ${parsed.rp} RP`);

await page.screenshot({ path: process.argv[2] ?? 'p1.png' });

// --- 10. mobile
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await mobile.goto(URL, { waitUntil: 'networkidle' });
await mobile.waitForFunction(() => window.__riftborn !== undefined, null, { timeout: 8000 });
await mobile.waitForTimeout(300);
const of = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok('no horizontal overflow at 390px', of === 0, `${of}px`);
await mobile.screenshot({ path: (process.argv[2] ?? 'p1.png').replace('.png', '-mobile.png') });

await browser.close();
console.log(errors.length ? `\nCONSOLE ERRORS:\n${errors.join('\n')}` : '\nno console errors');
process.exit(errors.length ? 1 : 0);
