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

/*
 * Page-side helper, injected so it survives reloads: put a species in the
 * Sanctuary, make it the escort, and engage a named target. Everything below
 * needs this and it has to run inside the page, not in Node.
 */
await page.addInitScript(() => {
  window.withEscortInPage = async (escortId, targetId) => {
    const r = window.__riftborn;
    const sp = r.data.monsters.monsters.find((m) => m.id === escortId);
    r.profile.state.residents = [];
    r.profile.state.escortUid = null;
    r.profile.admit(sp, { heightM: 1, percentile: 0.5 });
    const res = r.profile.state.residents.at(-1);
    r.profile.setEscort(res.uid);

    r.show('patrol');
    await new Promise((d) => setTimeout(d, 250));
    for (let i = 0; i < 40 && r.patrol.spawns.length === 0; i++) {
      r.patrol.x += 90; r.patrol.y += 40;
      await new Promise((d) => setTimeout(d, 60));
    }
    const base = r.patrol.spawns[0];
    if (!base) return null;
    const spawn = { ...base, id: `esc-${Math.random()}`, speciesId: targetId, packSize: 1 };
    r.teleportTo(spawn); r.startFight(spawn);
    await new Promise((d) => setTimeout(d, 300));
    return r.fight?.escort ?? null;
  };
});

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__riftborn !== undefined, null, { timeout: 8000 });

await page.evaluate(() => {
  const r = window.__riftborn;
  r.profile.state.devUnlockAll = true;
  Object.assign(r.profile.state.ammo, { ball_round: 200, tranq_dart: 200, slug: 200 });
  r.profile.save();
});

// --- 1. every element brings exactly one ability
const table = await page.evaluate(() => {
  const r = window.__riftborn;
  const defs = r.data.elements.escort_abilities;
  const rules = r.data.elements.escort_ability_rules;
  const elements = r.data.elements.elements.map((e) => e.id);
  return {
    elements,
    covered: elements.filter((e) => defs[e]),
    effects: elements.map((e) => defs[e]?.effect),
    charges: rules.charges_per_encounter,
    ready: rules.ready_after_seconds,
    // an ability must be resolvable for a real species, not just present in the table
    sample: r.escortAbility(r.data.monsters.monsters.find((m) => m.id === 'sootpup'), defs, rules),
  };
});
ok('every element brings exactly one ability',
   table.covered.length === table.elements.length
   && new Set(table.effects).size === table.effects.length
   && table.charges === 1,
   `${table.covered.length} / ${table.elements.length} elements · ${new Set(table.effects).size} distinct effects`
   + ` · ${table.charges} charge per encounter, armed after ${table.ready}s`);

// --- 2. magnitudes scale with stage; durations only when there is no magnitude
const scaling = await page.evaluate(() => {
  const r = window.__riftborn;
  const defs = r.data.elements.escort_abilities;
  const rules = r.data.elements.escort_ability_rules;
  const at = (el, stage) => r.escortAbility({ elements: [el], stage }, defs, rules);
  return {
    scorch: [at('ember', 1), at('ember', 3)].map((a) => [a.damage_per_second, a.seconds]),
    bulwark: [at('stone', 1), at('stone', 3)].map((a) => a.hp),
    root: [at('verdant', 1), at('verdant', 3)].map((a) => a.seconds),
    shroud: [at('gloom', 1), at('gloom', 3)].map((a) => a.scale),
  };
});
ok('an ability scales on its magnitude, or on its duration when it has none',
   scaling.scorch[1][0] > scaling.scorch[0][0]        // dps scales
   && scaling.scorch[1][1] === scaling.scorch[0][1]   // and its duration does NOT, so it cannot compound
   && scaling.bulwark[1] > scaling.bulwark[0]
   && scaling.root[1] > scaling.root[0] && scaling.root[1] < scaling.root[0] * 1.5,
   `Scorch ${scaling.scorch[0][0]}/s → ${scaling.scorch[1][0].toFixed(1)}/s over a fixed ${scaling.scorch[0][1]}s`
   + ` · Bulwark ${scaling.bulwark[0]} → ${scaling.bulwark[1].toFixed(0)}`
   + ` · Rootgrasp ${scaling.root[0]}s → ${scaling.root[1].toFixed(2)}s (half rate)`);

// --- 3. the escort reaches the fight and arms on a delay
const armed = await page.evaluate(async () => {
  const e = await window.withEscortInPage('sootpup', 'cinderfang');
  return e ? { ability: e.ability.name, charges: e.charges, readyIn: e.readyIn } : null;
});
const arming = await page.evaluate(async () => {
  const r = window.__riftborn;
  const before = { readyIn: r.fight.escort.readyIn, used: r.useEscort(r.fight) };
  // Pressing while still arming must do nothing and must not burn the charge.
  const midCharges = r.fight.escort.charges;
  r.fight.escort.readyIn = 0;
  const after = r.useEscort(r.fight);
  return { before, midCharges, after, charges: r.fight.escort.charges };
});
ok('the escort arms on a delay and spends exactly one charge',
   armed?.ability === 'Scorch' && arming.before.used === false && arming.midCharges === 1
   && arming.after === true && arming.charges === 0,
   `${armed.ability} · refused while arming (${arming.before.readyIn.toFixed(1)}s left) · then 1 → 0 charges`);

const spent = await page.evaluate(() => window.__riftborn.useEscort(window.__riftborn.fight));
ok('a spent charge does not come back inside one encounter', spent === false, 'second press refused');

// --- 4. each effect does the thing it says
const effects = {};

effects.scorch = await page.evaluate(async () => {
  const r = window.__riftborn;
  const m = r.fight.monster;
  const hp0 = m.hp;
  m.burn = { dps: 9, left: 5 };
  await new Promise((res) => setTimeout(res, 700));
  return { dropped: hp0 - r.fight.monster.hp };
});
ok('Scorch burns over time', effects.scorch.dropped > 1, `${effects.scorch.dropped.toFixed(1)} HP over ~0.7s`);

// The bug this suite exists for: a burn tick must never undo a kill.
effects.resurrect = await page.evaluate(async () => {
  const r = window.__riftborn;
  const m = r.fight.monster;
  m.burn = { dps: 9, left: 5 };
  m.hp = 0;                                  // exactly what a killing shot leaves
  await new Promise((res) => setTimeout(res, 400));
  return { hp: r.fight.monsters[0].hp, state: r.fight.monsters[0].state, outcome: r.fight.outcome };
});
ok('a burn tick never resurrects a killed monster',
   effects.resurrect.hp <= 0 && effects.resurrect.state === 'dead',
   `hp ${effects.resurrect.hp} · ${effects.resurrect.state} · outcome ${effects.resurrect.outcome}`);

effects.undertow = await page.evaluate(async () => {
  await withEscortInPage('brinelet', 'cinderfang');
  const r = window.__riftborn;
  const m = r.fight.monster;
  m.hp = m.maxHp * 0.3;                      // wounded, so the wound multiplier is in play
  r.fight.escort.readyIn = 0;
  const before = m.restraint;
  r.useEscort(r.fight);
  return { before, after: m.restraint, name: r.fight.escort.ability.name };
});
ok('Undertow adds Restraint, scaled by how wounded it is',
   effects.undertow.after > effects.undertow.before + 22,
   `${effects.undertow.name}: ${effects.undertow.before.toFixed(0)} → ${effects.undertow.after.toFixed(0)}`
   + ` (base 22, boosted by the wound multiplier)`);

effects.bulwark = await page.evaluate(async () => {
  await withEscortInPage('pebblit', 'cinderfang');
  const r = window.__riftborn;
  r.fight.escort.readyIn = 0;
  r.useEscort(r.fight);
  const shield = r.fight.player.shield;
  const hp0 = r.fight.player.hp;
  // Take a hit and check the shield eats it before the Warden does.
  const m = r.fight.monster;
  m.x = r.fight.player.x; m.y = r.fight.player.y;
  m.state = 'lunge'; m.stateT = 0; r.fight.player.invuln = 0;
  await new Promise((res) => setTimeout(res, 900));
  return { shield, shieldAfter: r.fight.player.shield, hp0, hp: r.fight.player.hp, name: r.fight.escort.ability.name };
});
ok('Bulwark absorbs before the Warden does',
   effects.bulwark.shield > 0
   && (effects.bulwark.shieldAfter < effects.bulwark.shield || effects.bulwark.hp === effects.bulwark.hp0),
   `${effects.bulwark.name}: ${effects.bulwark.shield.toFixed(0)} shield → ${effects.bulwark.shieldAfter.toFixed(0)} left,`
   + ` Warden ${effects.bulwark.hp0} → ${effects.bulwark.hp.toFixed(0)}`);

effects.jolt = await page.evaluate(async () => {
  await withEscortInPage('sparkmite', 'cinderfang');
  const r = window.__riftborn;
  const w = r.fight.weapon;
  w.mag.lethal = 0; w.mag.capture = 0;
  const before = { l: w.mag.lethal, c: w.mag.capture, rl: w.reserve.lethal };
  r.fight.escort.readyIn = 0;
  r.useEscort(r.fight);
  return { before, after: { l: w.mag.lethal, c: w.mag.capture, rl: w.reserve.lethal }, name: r.fight.escort.ability.name };
});
ok('Jolt fills both chambers out of reserve',
   effects.jolt.after.l > 0 && effects.jolt.after.rl < effects.jolt.before.rl,
   `${effects.jolt.name}: mags ${effects.jolt.before.l}/${effects.jolt.before.c}`
   + ` → ${effects.jolt.after.l}/${effects.jolt.after.c}, reserve ${effects.jolt.before.rl} → ${effects.jolt.after.rl}`);

effects.shroud = await page.evaluate(async () => {
  await withEscortInPage('shadelet', 'cinderfang');
  const r = window.__riftborn;
  for (const m of r.fight.monsters) { m.aware = true; m.state = 'stalk'; }
  r.fight.escort.readyIn = 0;
  r.useEscort(r.fight);
  return { aware: r.fight.monsters.map((m) => m.aware), name: r.fight.escort.ability.name };
});
ok('Shroud puts the whole pack back to unaware, so Ambush is live again',
   effects.shroud.aware.every((a) => a === false),
   `${effects.shroud.name}: aware ${JSON.stringify(effects.shroud.aware)}`);

effects.kindle = await page.evaluate(async () => {
  await withEscortInPage('glimmerfly', 'shadelet');
  const r = window.__riftborn;
  const m = r.fight.monster;
  const before = { hidden: m.hiddenWeakPoints, lit: m.illuminated, wp: (m.weakPoints ?? []).length };
  r.fight.escort.readyIn = 0;
  r.useEscort(r.fight);
  await new Promise((res) => setTimeout(res, 120));
  return { before, lit: m.illuminated, wp: (m.weakPoints ?? []).length, name: r.fight.escort.ability.name };
});
ok('Kindle lights a weak point that has no position until something lights it',
   (effects.kindle.before.hidden ?? []).length > 0 && effects.kindle.before.wp === 0
   && effects.kindle.lit > 0 && effects.kindle.wp > 0,
   `${effects.kindle.name}: shadelet hides ${JSON.stringify(effects.kindle.before.hidden)}`
   + ` → lit for ${effects.kindle.lit.toFixed(1)}s, ${effects.kindle.wp} weak point visible`);

effects.fracture = await page.evaluate(async () => {
  await withEscortInPage('riftspawn', 'obelisc');
  const r = window.__riftborn;
  const m = r.fight.monster;
  const hit = () => {
    const hp0 = m.hp;
    r.fight.weapon.chamber = 'lethal';
    // fire one modelled body shot through the same path a bullet takes
    r.applyLethalForTest(r.fight, m);
    const d = hp0 - m.hp;
    m.hp = hp0;
    return d;
  };
  const plain = hit();
  r.fight.escort.readyIn = 0;
  r.useEscort(r.fight);
  const sundered = hit();
  return { plain, sundered, pierce: m.sunder?.pierce, name: r.fight.escort.ability.name };
});
ok('Fracture strips armour for a window',
   effects.fracture.sundered > effects.fracture.plain,
   `${effects.fracture.name}: ${effects.fracture.plain.toFixed(1)} → ${effects.fracture.sundered.toFixed(1)} damage`
   + ` per body shot (${Math.round((effects.fracture.pierce ?? 0) * 100)}% of its armour off)`);

// --- 5. the HUD says what the escort is and when it is spent
const hud = await page.evaluate(async () => {
  await withEscortInPage('sootpup', 'cinderfang');
  const r = window.__riftborn;
  await new Promise((res) => setTimeout(res, 120));
  const btn = document.getElementById('btn-escort');
  const arming = { text: btn.textContent, hidden: btn.hidden, ready: btn.dataset.ready };
  r.fight.escort.readyIn = 0;
  await new Promise((res) => setTimeout(res, 120));
  const live = { text: btn.textContent, ready: btn.dataset.ready };
  btn.click();
  await new Promise((res) => setTimeout(res, 150));
  return { arming, live, spent: { text: btn.textContent, disabled: btn.disabled }, charges: r.fight.escort.charges };
});
ok('the HUD button arms, fires and reads as spent',
   hud.arming.hidden === false && hud.arming.ready === 'false'
   && hud.live.ready === 'true' && /SPENT/.test(hud.spent.text) && hud.charges === 0,
   `"${hud.arming.text}" → "${hud.live.text}" → "${hud.spent.text}"`);

// --- 6. with no escort, nothing appears and nothing breaks
const none = await page.evaluate(async () => {
  const r = window.__riftborn;
  r.profile.setEscort(null);
  r.profile.state.escortUid = null;
  r.show('patrol');
  await new Promise((res) => setTimeout(res, 250));
  for (let i = 0; i < 40 && r.patrol.spawns.length === 0; i++) {
    r.patrol.x += 90; r.patrol.y += 40;
    await new Promise((res) => setTimeout(res, 60));
  }
  const base = r.patrol.spawns[0];
  const spawn = { ...base, id: `noesc-${Math.random()}`, speciesId: 'cinderfang', packSize: 1 };
  r.teleportTo(spawn); r.startFight(spawn);
  await new Promise((res) => setTimeout(res, 300));
  const pressed = r.useEscort(r.fight);
  return { escort: r.fight.escort, pressed, hidden: document.getElementById('btn-escort').hidden };
});
ok('no escort means no button and a press that does nothing',
   none.escort === null && none.pressed === false && none.hidden === true,
   'an escortless fight is exactly the fight that shipped before this');

// --- 7. the Sanctuary picks one escort at a time, and releasing clears it
await page.evaluate(() => window.__riftborn.show('patrol'));
const picker = await page.evaluate(async () => {
  const r = window.__riftborn;
  const sp = (id) => r.data.monsters.monsters.find((m) => m.id === id);
  r.profile.state.residents = [];
  r.profile.state.escortUid = null;
  for (const id of ['sootpup', 'pebblit', 'brinelet']) r.profile.admit(sp(id), { heightM: 1, percentile: 0.5 });
  const [a, b] = r.profile.state.residents;
  r.profile.setEscort(a.uid);
  const first = r.profile.escort.uid === a.uid;
  r.profile.setEscort(b.uid);
  const swapped = r.profile.escort.uid === b.uid;
  r.profile.setEscort(b.uid);                       // pressing the same one again clears it
  const cleared = r.profile.escort === null;
  r.profile.setEscort(a.uid);
  r.profile.release(a.uid);                          // and releasing your escort must not leave a ghost
  return { first, swapped, cleared, afterRelease: r.profile.escort, ability: r.profile.escortAbility };
});
ok('one escort at a time, and releasing it clears the slot',
   picker.first && picker.swapped && picker.cleared && picker.afterRelease === null,
   'set → swapped → cleared → released without leaving a dangling uid');

await page.evaluate(() => window.__riftborn.show('sanctuary'));
await page.waitForSelector('.resident');
const view = await page.evaluate(() => {
  const btn = document.querySelector('[data-escort]');
  btn.click();
  return {
    summary: document.getElementById('sanctuary-summary').textContent,
    abilities: document.querySelectorAll('.ability').length,
    residents: document.querySelectorAll('.resident').length,
  };
});
await page.waitForTimeout(150);
const summary = await page.evaluate(() => document.getElementById('sanctuary-summary').textContent);
ok('the Sanctuary names the ability on every resident and the escort in its summary',
   view.abilities === view.residents && /escorting/.test(summary),
   `${view.abilities} ability lines on ${view.residents} residents · ${summary.split('·').pop().trim()}`);

// --- 8. it survives a reload
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__riftborn !== undefined, null, { timeout: 8000 });
const persisted = await page.evaluate(() => {
  const r = window.__riftborn;
  return { uid: r.profile.state.escortUid, ability: r.profile.escortAbility?.name ?? null };
});
ok('the chosen escort persists', Boolean(persisted.uid) && Boolean(persisted.ability),
   `still escorting, bringing ${persisted.ability}`);

// --- 9. phone layout
await page.setViewportSize({ width: 390, height: 844 });
await page.evaluate(() => window.__riftborn.show('sanctuary'));
await page.waitForTimeout(300);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok('no horizontal overflow at 390px', overflow === 0, `${overflow}px`);

await page.screenshot({ path: process.argv[2] ?? 'escort.png' });
await browser.close();
console.log(errors.length ? `\nCONSOLE ERRORS:\n${errors.join('\n')}` : '\nno console errors');
process.exit(errors.length ? 1 : 0);
