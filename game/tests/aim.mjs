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

/** Engage a named species in the current aim mode. */
await page.addInitScript(() => {
  window.engageIn = async (mode, speciesId, packSize = 1) => {
    const r = window.__riftborn;
    r.profile.state.aimMode = mode;
    r.profile.save();
    r.show('patrol');
    /*
     * Walk by stepping the world directly rather than nudging a coordinate and
     * sleeping for the next animation frame. The old loop cost up to 2.65s per
     * encounter and these checks set up dozens — it was most of two suites.
     */
    r.refreshSpawns();
    for (let i = 0; i < 40 && r.patrol.spawns.length === 0; i++) {
      r.patrol.x += 90; r.patrol.y += 40;
      r.refreshSpawns();
    }
    const base = r.patrol.spawns[0];
    if (!base) return null;
    const spawn = { ...base, id: `aim-${Math.random()}`, speciesId, packSize };
    r.teleportTo(spawn); r.startFight(spawn);
    await new Promise((d) => requestAnimationFrame(d));
    return r.fight ?? null;
  };
});

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__riftborn !== undefined, null, { timeout: 8000 });
await page.evaluate(() => {
  const r = window.__riftborn;
  r.profile.state.devUnlockAll = true;
  Object.assign(r.profile.state.ammo, { ball_round: 400, tranq_dart: 200, slug: 200 });
  r.profile.save();
});

// --- 1. free aim is the default and is unchanged
const defaults = await page.evaluate(async () => {
  const r = window.__riftborn;
  const f = await window.engageIn('free', 'cinderfang');
  return { mode: f.aimMode, lockPad: document.getElementById('btn-lock').hidden, setting: document.getElementById('opt-aim').value };
});
ok('free aim is the default and shows no lock UI',
   defaults.mode === 'free' && defaults.lockPad === true,
   `aimMode "${defaults.mode}" · target pad hidden`);

// --- 2. the ring is tied to the weapon, not the wall clock
const tempo = await page.evaluate(async () => {
  const r = window.__riftborn;
  const out = {};
  for (const [w, lethal] of [['marker_pistol', 'ball_round'], ['longtooth', 'slug']]) {
    r.profile.setSlot(0, { weaponId: w, lethalId: lethal, captureId: 'tranq_dart', mods: {} });
    const f = await window.engageIn('assisted', 'cinderfang');
    out[w] = { rpm: f.loadout.weapon.rpm, sweep: Number(r.ringSeconds(f).toFixed(3)) };
  }
  r.profile.setSlot(0, { weaponId: 'marker_pistol', lethalId: 'ball_round', captureId: 'tranq_dart', mods: {} });
  return out;
});
ok('every weapon beats at its own tempo',
   Math.abs(tempo.marker_pistol.sweep - 2 * 60 / tempo.marker_pistol.rpm) < 0.01
   && tempo.longtooth.sweep > tempo.marker_pistol.sweep * 2,
   `pistol ${tempo.marker_pistol.rpm} rpm → ${tempo.marker_pistol.sweep}s sweep`
   + ` · Longtooth ${tempo.longtooth.rpm} rpm → ${tempo.longtooth.sweep}s`);

// --- 3. the gold band sits AFTER the weapon comes off cooldown
const band = await page.evaluate(async () => {
  const r = window.__riftborn;
  const f = await window.engageIn('assisted', 'cinderfang');
  const cd = 60 / f.loadout.weapon.rpm;
  const sweep = r.ringSeconds(f);
  // Walk the sweep and record where the band opens and closes.
  let open = null, close = null;
  for (let t = 0; t <= sweep; t += sweep / 400) {
    f.weapon.sinceShot = t;
    const inBand = r.assistMiss(f) === 0;
    if (inBand && open === null) open = t;
    if (!inBand && open !== null && close === null) close = t;
  }
  return { cd, sweep, open, close };
});
ok('the gold band opens only after the weapon is ready',
   band.open > band.cd && band.close > band.open,
   `ready at ${band.cd.toFixed(3)}s, band ${band.open.toFixed(3)}–${band.close.toFixed(3)}s`
   + ` — so holding the trigger always fires early`);

// --- 4. the ring restarts on every shot, and the shot reads it BEFORE the reset
const perShot = await page.evaluate(async (band0) => {
  const r = window.__riftborn;
  const f = await window.engageIn('assisted', 'cinderfang');
  const m = f.monster;
  m.aware = true;
  const fireAt = (sinceShot) => {
    f.weapon.cooldown = 0;
    f.weapon.mag.lethal = 8;
    f.weapon.sinceShot = sinceShot;
    const before = f.stats.goldShots ?? 0;
    r.step(f, 1 / 60, { moveX: 0, moveY: 0, aim: f.player.aim, firing: true, swap: false, reload: false, tag: false });
    return { gold: (f.stats.goldShots ?? 0) > before, after: f.weapon.sinceShot };
  };
  const inBand = fireAt((band0.open + band0.close) / 2);
  const early = fireAt(60 / f.loadout.weapon.rpm);
  return { inBand, early };
}, band);
ok('a shot is judged on the ring it was fired on, not the one it starts',
   perShot.inBand.gold === true && perShot.early.gold === false && perShot.inBand.after < 0.05,
   `in the band → gold, at cooldown-end → not; ring restarts at ${perShot.inBand.after.toFixed(3)}s`);

// --- 5. an on-beat shot goes at a weak point, an off-beat one does not
const aiming = await page.evaluate(async () => {
  const r = window.__riftborn;
  const f = await window.engageIn('assisted', 'cinderfang');
  const m = f.monster;
  m.aware = true;
  m.x = f.player.x; m.y = f.player.y - 260;    // straight ahead, still
  // Teleporting it also has to move its motion history, or the next frame reads
  // the jump as speed and the assist leads the shot off the map.
  m.lastX = m.x; m.lastY = m.y; m.vxEst = 0; m.vyEst = 0;

  const shoot = (sinceShot) => {
    f.projectiles.length = 0;
    f.weapon.cooldown = 0; f.weapon.mag.lethal = 8; f.weapon.sinceShot = sinceShot;
    r.step(f, 1 / 60, { moveX: 0, moveY: 0, aim: 0, firing: true, swap: false, reload: false, tag: false });
    const p = f.projectiles[0];
    return p ? Math.atan2(p.vy, p.vx) : null;
  };
  const toBody = Math.atan2(m.y - f.player.y, m.x - f.player.x);
  // Angles wrap: a raw subtraction reported an 11-degree spray as 167 degrees.
  const off = (a) => Math.abs(((a - toBody + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  const onBeat = shoot(0.48);
  const offBeat = shoot(60 / f.loadout.weapon.rpm);
  return {
    toBody, onBeat, offBeat,
    onBeatOff: off(onBeat), offBeatOff: off(offBeat),
    weakPoints: Object.keys(r.weakPointPositions(m)).length,
    where: { mx: m.x, my: m.y, px: f.player.x, py: f.player.y, state: m.state },
    projectiles: f.projectiles.length,
  };
});
ok('an on-beat shot is sent at a weak point and an off-beat one sprays',
   aiming.weakPoints > 0 && aiming.onBeatOff > 0.0001 && aiming.offBeatOff > 0
   && aiming.offBeatOff < 0.25,      // spray, not a wild shot
   `weak point ${(aiming.onBeatOff * 180 / Math.PI).toFixed(1)}° off body centre`
   + ` · off-beat spray ${(aiming.offBeatOff * 180 / Math.PI).toFixed(1)}°`
   );

// --- 6. the lock holds instead of following a crosshair
const lock = await page.evaluate(async () => {
  const r = window.__riftborn;
  const f = await window.engageIn('assisted', 'cinderfang', 3);
  const first = f.focusIndex;
  // Swing the aim right across the pack: in free aim this would move focus.
  for (let i = 0; i < 40; i++) {
    r.step(f, 1 / 60, { moveX: 0, moveY: 0, aim: (i / 40) * Math.PI * 2, firing: false, swap: false, reload: false, tag: false });
  }
  const held = f.focusIndex;
  const cycled = r.cycleLock(f);
  // and it moves on by itself when its target is resolved
  f.monsters[f.focusIndex].state = 'dead';
  r.step(f, 1 / 60, { moveX: 0, moveY: 0, aim: 0, firing: false, swap: false, reload: false, tag: false });
  return { pack: f.monsters.length, first, held, cycled, after: f.focusIndex };
});
ok('the lock holds through an aim sweep, cycles on demand, and moves on when its target dies',
   lock.pack === 3 && lock.held === lock.first && lock.cycled !== lock.first && lock.after !== lock.cycled,
   `pack of ${lock.pack} · held ${lock.first} through a full sweep · T → ${lock.cycled} · target died → ${lock.after}`);

const freeFocus = await page.evaluate(async () => {
  const r = window.__riftborn;
  const f = await window.engageIn('free', 'cinderfang', 3);
  const seen = new Set();
  for (let i = 0; i < 60; i++) {
    r.step(f, 1 / 60, { moveX: 0, moveY: 0, aim: (i / 60) * Math.PI * 2, firing: false, swap: false, reload: false, tag: false });
    seen.add(f.focusIndex);
  }
  return seen.size;
});
ok('free aim still follows the crosshair', freeFocus > 1,
   `${freeFocus} different pack members focused across one aim sweep`);

// --- 7. the lock pad appears only where there is something to cycle
const pads = await page.evaluate(async () => {
  const out = {};
  await window.engageIn('assisted', 'cinderfang', 1);
  await new Promise((d) => setTimeout(d, 150));
  out.solo = document.getElementById('btn-lock').hidden;
  await window.engageIn('assisted', 'cinderfang', 3);
  await new Promise((d) => setTimeout(d, 150));
  out.pack = document.getElementById('btn-lock').hidden;
  document.getElementById('btn-lock').click();
  await new Promise((d) => setTimeout(d, 150));
  out.focus = window.__riftborn.fight.focusIndex;
  return out;
});
ok('the target pad shows for a pack and not for a lone monster',
   pads.solo === true && pads.pack === false && pads.focus === 1,
   `solo hidden · pack shown · tapping it moved the lock to ${pads.focus}`);

// --- 8. the setting persists and reaches the fight
await page.evaluate(() => {
  const el = document.getElementById('opt-aim');
  el.value = 'assisted';
  el.dispatchEvent(new Event('change'));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__riftborn !== undefined, null, { timeout: 8000 });
const persisted = await page.evaluate(async () => {
  const r = window.__riftborn;
  const f = await window.engageIn(r.profile.state.aimMode, 'cinderfang');
  return { setting: document.getElementById('opt-aim').value, stored: r.profile.state.aimMode, fight: f.aimMode };
});
ok('the aim mode persists and is what the fight runs',
   persisted.setting === 'assisted' && persisted.stored === 'assisted' && persisted.fight === 'assisted',
   `setting, save and fight all read "${persisted.fight}"`);

// --- 9. assisted aim is playable by someone who never reads the ring
/*
 * Aggregated over many fights on purpose, and the number matters.
 *
 * A single run of this comparison is noise: whether a fixed-aim free player
 * lands anything at all depends entirely on whether the monster happens to
 * wander across the line they are pointing at, and one lucky spawn made free
 * aim look competent.
 *
 * Six fights was not enough either, which took a while to notice because the
 * suite could not fail the build. A never-aiming assisted player finishes
 * roughly a third of its fights, so six fights expects TWO culls — and zero
 * came up about half the time, failing an assertion that wanted at least one.
 * Measured at 24 fights the count is 7 to 11 against free aim's flat zero,
 * which is a signal rather than a coin toss.
 */
const playable = await page.evaluate(async (FIGHTS) => {
  const r = window.__riftborn;
  const run = async (mode) => {
    const f = await window.engageIn(mode, 'cinderfang');
    f.monster.aware = true;
    // A thumb that never aims and never times: hold the trigger, pointing at a
    // fixed bearing that is not the target.
    const fixed = f.player.aim + Math.PI / 2;
    let guard = 0;
    while (f.outcome === null && guard++ < 60 * 45) {
      const w = f.weapon;
      r.step(f, 1 / 60, {
        moveX: 0, moveY: 0, aim: fixed, firing: true,
        swap: false, reload: w.mag[w.chamber] === 0 && w.reserve[w.chamber] > 0, tag: false,
      });
    }
    return { hits: f.stats.hits, shots: f.stats.shots, culled: f.outcome === 'culled' ? 1 : 0 };
  };
  const total = async (mode) => {
    const acc = { hits: 0, shots: 0, culled: 0 };
    for (let i = 0; i < FIGHTS; i++) {
      const one = await run(mode);
      acc.hits += one.hits; acc.shots += one.shots; acc.culled += one.culled;
    }
    return acc;
  };
  return { free: await total('free'), assisted: await total('assisted') };
}, Number(process.env.AIM_FIGHTS ?? 24));
const rate = (a) => (a.shots ? (a.hits / a.shots) * 100 : 0);
const FIGHTS = Number(process.env.AIM_FIGHTS ?? 24);
ok('a player who never aims can still resolve a fight assisted, and cannot free',
   playable.assisted.hits >= Math.max(20, playable.free.hits * 10)
   && playable.assisted.culled >= 3 && playable.free.culled === 0,
   `trigger held at a fixed bearing, ${FIGHTS} fights each: free ${playable.free.hits}/${playable.free.shots}`
   + ` (${rate(playable.free).toFixed(0)}%, ${playable.free.culled} culled)`
   + ` · assisted ${playable.assisted.hits}/${playable.assisted.shots}`
   + ` (${rate(playable.assisted).toFixed(0)}%, ${playable.assisted.culled} culled)`);

// --- 10. phone layout
await page.setViewportSize({ width: 390, height: 844 });
await page.evaluate(async () => { await window.engageIn('assisted', 'cinderfang', 3); });
await page.waitForTimeout(400);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok('no horizontal overflow at 390px with every pad showing', overflow === 0, `${overflow}px`);

await page.screenshot({ path: process.argv[2] ?? 'aim.png' });
await browser.close();
console.log(errors.length ? `\nCONSOLE ERRORS:\n${errors.join('\n')}` : '\nno console errors');
if (fails) console.log(`${fails} check(s) FAILED`);
process.exit(errors.length || fails ? 1 : 0);
