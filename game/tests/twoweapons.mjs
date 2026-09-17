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

// --- 0. an old single-weapon save migrates instead of being wiped
await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => {
  const old = {
    version: 2, seed: 4242, xp: 9999, essence: 500, researchPoints: 3,
    materials: { ember: 5, stone: 5, verdant: 5, gale: 5, volt: 5, lumen: 5, gloom: 5, tide: 5, rift: 0 },
    ammo: { ball_round: 20, tranq_dart: 5 },
    loadout: { weaponId: 'longtooth', lethalId: 'slug', captureId: 'tranq_dart' },
    codex: { sootpup: { state: 'catalogued', catalogued: 2, culled: 0, research: 1, seen: 3 } },
    residents: [], habitats: [], contracts: { day: null, list: [] }, biomesVisited: {},
    metresWalked: 0, xpFromWalkingKm: 0, lastTick: Date.now(), resolved: {},
    stats: { encounters: 5, culls: 1, captures: 2, escapes: 2, cleanCaptures: 0, evolutions: 0 },
  };
  localStorage.setItem('riftborn.profile.v2', JSON.stringify(old));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__riftborn !== undefined, null, { timeout: 8000 });
const migrated = await page.evaluate(() => {
  const s = window.__riftborn.profile.state;
  return { slots: s.loadout.slots, xp: s.xp, codex: s.codex.sootpup?.catalogued };
});
ok('an old single-weapon save migrates',
   Array.isArray(migrated.slots) && migrated.slots[0]?.weaponId === 'longtooth'
   && migrated.slots[1] === null && migrated.xp === 9999 && migrated.codex === 2,
   `slot 1 = ${migrated.slots[0]?.weaponId}/${migrated.slots[0]?.lethalId}, slot 2 empty, ${migrated.xp} XP kept`);

// --- 1. two slots configure and persist
const configured = await page.evaluate(async () => {
  const r = window.__riftborn;
  r.profile.state.devUnlockAll = true;
  Object.assign(r.profile.state.ammo, { piercing_round: 60, anchor_tether: 40, broadhead: 60, rune_arrow: 60 });
  r.profile.setSlot(0, { weaponId: 'tether_harpoon', lethalId: 'piercing_round', captureId: 'anchor_tether' });
  r.profile.setSlot(1, { weaponId: 'sting_crossbow', lethalId: 'broadhead', captureId: 'rune_arrow' });
  return r.profile.slots.map((s) => s.weaponId);
});
ok('two weapon slots configure', configured.length === 2, configured.join(' + '));

await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__riftborn !== undefined, null, { timeout: 8000 });
const persisted = await page.evaluate(() => window.__riftborn.profile.slots.map((s) => s.weaponId));
ok('the loadout persists across reload', persisted.join('+') === 'tether_harpoon+sting_crossbow', persisted.join(' + '));

/** Drop into a fight against a named species. */
const engage = (speciesId) => page.evaluate(async (id) => {
  const r = window.__riftborn;
  await new Promise((res) => setTimeout(res, 300));
  for (let i = 0; i < 40 && r.patrol.spawns.length === 0; i++) {
    r.patrol.x += 90; r.patrol.y += 40;
    await new Promise((res) => setTimeout(res, 60));
  }
  const base = r.patrol.spawns[0];
  if (!base) return null;
  const spawn = { ...base, id: `tw-${Math.random()}`, speciesId: id, packSize: 1 };
  r.teleportTo(spawn); r.startFight(spawn);
  await new Promise((res) => setTimeout(res, 300));
  const f = r.fight;
  return f ? { slots: f.loadouts.map((l) => l.weapon.name), active: f.activeSlot, name: f.loadout.species.name } : null;
}, speciesId);

// --- 2. both weapons reach the fight, each with its own magazine
const inFight = await engage('nyxhollow');
ok('both weapons reach the fight', inFight?.slots.length === 2, inFight ? inFight.slots.join(' + ') : 'no fight');

const mags = await page.evaluate(() => {
  const f = window.__riftborn.fight;
  return f.weapons.map((w, i) => `${f.loadouts[i].weapon.name}: ${w.mag.lethal}L/${w.mag.capture}C`);
});
ok('each weapon has its own magazine', mags.length === 2 && mags[0] !== mags[1], mags.join('  |  '));

// --- 3. switching weapons costs real time
const swap = await page.evaluate(async () => {
  const f = window.__riftborn.fight;
  const before = f.activeSlot;
  document.getElementById('btn-weapon').click();
  await new Promise((res) => setTimeout(res, 120));
  const mid = { swapping: f.slotSwapT > 0, busy: document.getElementById('busy').textContent, slot: f.activeSlot };
  await new Promise((res) => setTimeout(res, 1000));
  return { before, mid, after: f.activeSlot };
});
ok('switching weapons takes time and then switches',
   swap.mid.swapping && swap.mid.slot === swap.before && swap.after !== swap.before,
   `${swap.mid.busy} → slot ${swap.after + 1}`);

// --- 4. the payoff: anchor with the harpoon, switch, subdue with the crossbow
const apex = await page.evaluate(async () => {
  const r = window.__riftborn;
  const f = r.fight;
  const m = f.monsters[0];

  // Break it to its final phase and wound it, as the fight would.
  m.hp = m.maxHp * 0.12;
  await new Promise((res) => setTimeout(res, 400));

  const harpoonSlot = f.loadouts.findIndex((l) => l.weapon.id === 'tether_harpoon');
  const crossbowSlot = f.loadouts.findIndex((l) => l.weapon.id === 'sting_crossbow');

  const restraintPerShot = (slot, chamber) => {
    const l = f.loadouts[slot];
    const ammo = chamber === 'capture' ? l.ammo.capture : l.ammo.lethal;
    return l.weapon.restraint * (ammo?.restraint_multiplier ?? 1)
      * 2.0                                  // weak point
      * (l.statusDefs.anchored?.restraint_multiplier ?? 1.4)
      * (1 + 2 * Math.pow(1 - m.hp / m.maxHp, l.woundExponent ?? 1))
      / l.sizeDef.size_resistance;
  };

  const harpoonOnly = m.required / restraintPerShot(harpoonSlot, 'capture');
  const crossbowAfterAnchor = m.required / restraintPerShot(crossbowSlot, 'capture');

  const secsFor = (slot, shots) => {
    const w = f.loadouts[slot].weapon;
    return shots * (60 / w.rpm) + Math.ceil(shots / w.magazine) * w.reload_seconds;
  };

  return {
    phase: `${m.phase}/${m.phases}`,
    required: Math.round(m.required),
    harpoonShots: Math.round(harpoonOnly), harpoonMin: +(secsFor(harpoonSlot, harpoonOnly) / 60).toFixed(1),
    crossbowShots: Math.round(crossbowAfterAnchor), crossbowMin: +(secsFor(crossbowSlot, crossbowAfterAnchor) / 60).toFixed(1),
  };
});
ok('two weapons make the apex takeable',
   apex.crossbowShots * 3 < apex.harpoonShots,
   `harpoon alone ${apex.harpoonShots} shots (${apex.harpoonMin} min) → anchor + crossbow ${apex.crossbowShots} shots (${apex.crossbowMin} min)`);

// --- 5. and it actually completes
const taken = await page.evaluate(async () => {
  const r = window.__riftborn;
  const f = r.fight;
  const m = f.monsters[0];
  m.statuses.anchored = 30;
  m.restraint = m.required + 1;
  // Wait for it to actually go down: a phase shield delays the subdue transition,
  // and tagging before it lands is a click into thin air.
  for (let i = 0; i < 60 && m.state !== 'subdued'; i++) {
    m.restraint = m.required + 1;
    await new Promise((res) => setTimeout(res, 50));
  }
  document.getElementById('btn-tag').click();
  await new Promise((res) => setTimeout(res, 400));
  return { outcome: f.outcome, verdict: document.getElementById('verdict').textContent, state: m.state };
});
ok('the apex is catalogued', taken.outcome === 'catalogued', `${taken.verdict} (was ${taken.state})`);

await page.screenshot({ path: process.argv[2] ?? 'tw.png' });
await browser.close();
console.log(errors.length ? `\nCONSOLE ERRORS:\n${errors.join('\n')}` : '\nno console errors');
if (fails) console.log(`${fails} check(s) FAILED`);
process.exit(errors.length || fails ? 1 : 0);
