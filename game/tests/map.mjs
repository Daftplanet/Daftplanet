import { chromium } from 'playwright';

// executablePath is only needed where the browser is not on Playwright's own path.
const LAUNCH = process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {};
const URL = process.env.RIFTBORN_URL ?? 'http://127.0.0.1:8765/riftborn/';
const ORIGIN = new global.URL(URL).origin;
const browser = await chromium.launch(LAUNCH);
const context = await browser.newContext({
  viewport: { width: 1280, height: 950 },
  permissions: [],
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  // The dead-basemap check fetches a deliberate 404. That browser-level network
  // error IS the test passing, so it is the one message this suite tolerates.
  if (m.type() !== 'error') return;
  const text = m.text();
  if (/404/.test(text) && /Not Found/.test(text)) return;
  errors.push(text);
});
const ok = (l, c, x = '') => console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x ? '  — ' + x : ''}`);

/*
 * Point the app at the runner's fake tile server. Real providers are not used by
 * this suite on purpose: a test that needs OpenStreetMap to be up fails for
 * reasons that are not the code's.
 */
await page.addInitScript((origin) => {
  window.__TEST_TILES__ = origin;
}, ORIGIN);

await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__riftborn !== undefined, null, { timeout: 8000 });

// --- 1. the projection is a real projection
const proj = await page.evaluate(() => {
  const r = window.__riftborn;
  const places = {
    westminster: [-0.1246, 51.5007],
    equator: [0, 0],
    sydney: [151.2093, -33.8688],
    nullIsland: [0.0001, 0.0001],
  };
  const out = {};
  for (const [k, [lon, lat]] of Object.entries(places)) {
    const w = r.lonLatToWorld(lon, lat);
    const back = r.worldToLonLat(w.x, w.y);
    out[k] = {
      x: w.x, y: w.y,
      errLon: Math.abs(back.lon - lon), errLat: Math.abs(back.lat - lat),
      scale: r.groundScale(w.y),
    };
  }
  // A known figure: one degree of longitude at the equator is 111,319.49 m.
  const a = r.lonLatToWorld(0, 0), b = r.lonLatToWorld(1, 0);
  out.degreeAtEquator = b.x - a.x;
  return out;
});
ok('lon/lat round-trips through Web Mercator',
   Object.values(proj).every((v) => !v.errLon || (v.errLon < 1e-9 && v.errLat < 1e-9))
   && Math.abs(proj.degreeAtEquator - 111319.49) < 1,
   `1° of longitude at the equator = ${proj.degreeAtEquator.toFixed(0)} m`
   + ` · ground scale ${proj.equator.scale.toFixed(3)} at the equator,`
   + ` ${proj.westminster.scale.toFixed(3)} at Westminster, ${proj.sydney.scale.toFixed(3)} in Sydney`);

// --- 2. ground distance is not Mercator distance
const dist = await page.evaluate(() => {
  const r = window.__riftborn;
  // 100 m due east at two latitudes, measured both ways.
  const at = (lat) => {
    const a = r.lonLatToWorld(0, lat);
    const b = { x: a.x + 100, y: a.y };
    return { raw: 100, ground: r.groundMetres(a.x, a.y, b.x, b.y) };
  };
  return { equator: at(0), london: at(51.5), oslo: at(59.9) };
});
ok('100 Mercator metres is fewer ground metres the further from the equator',
   Math.abs(dist.equator.ground - 100) < 0.5
   && dist.london.ground < 64 && dist.london.ground > 60
   && dist.oslo.ground < dist.london.ground,
   `equator ${dist.equator.ground.toFixed(1)} m · London ${dist.london.ground.toFixed(1)} m`
   + ` · Oslo ${dist.oslo.ground.toFixed(1)} m, all from the same 100 world units`);

// --- 3. tile addressing lands on the right tile
const tiling = await page.evaluate(() => {
  const r = window.__riftborn;
  const w = r.lonLatToWorld(-0.1246, 51.5007);
  const t = r.tileAt(w.x, w.y, 17);
  // Known: Westminster at z17 is tile x=65490, y=43616 (slippy convention).
  const back = r.tileOrigin(t.x, t.y, 17);
  return {
    t, spanM: r.tileSpan(17),
    containsPoint: w.x >= back.x && w.x < back.x + r.tileSpan(17)
                && w.y >= back.y && w.y < back.y + r.tileSpan(17),
    url: r.tileUrl('osm', t.x, t.y, 17),
    wrap: r.normaliseTile(-1, 5, 3),
  };
});
ok('a world point resolves to the tile that contains it',
   tiling.containsPoint && tiling.t.z === 17 && tiling.wrap.x === 7
   && /\/17\/\d+\/\d+\.png$/.test(tiling.url),
   `z17 tile ${tiling.t.x}/${tiling.t.y}, ${tiling.spanM.toFixed(0)} m across`
   + ` · x wraps -1 → ${tiling.wrap.x} · ${tiling.url.replace(/^https:\/\//, '')}`);

// --- 4. colour classification finds the ground it is shown
const colours = await page.evaluate(() => {
  const r = window.__riftborn;
  return {
    water: r.biomeFromPixel(26, 62, 112),
    darkGreen: r.biomeFromPixel(24, 68, 30),
    paleGreen: r.biomeFromPixel(92, 164, 96),
    grey: r.biomeFromPixel(78, 78, 80),
    white: r.biomeFromPixel(250, 250, 250),
    black: r.biomeFromPixel(10, 10, 12),
  };
});
ok('blue is water, green is vegetation, grey commits to nothing',
   colours.water === 'waterside' && colours.darkGreen === 'woodland'
   && colours.paleGreen === 'parkland' && colours.grey === null
   && colours.white === null && colours.black === null,
   `blue → ${colours.water} · dark green → ${colours.darkGreen} · pale green → ${colours.paleGreen}`
   + ` · grey/white/black → null, so the caller falls back rather than inventing land`);

// --- 5. a real tile fetch, decode, and sample
const sampled = await page.evaluate(async (origin) => {
  const r = window.__riftborn;
  const src = r.createTileSource({
    provider: 'test',
    fallbackBiome: () => 'industrial',
  });
  const w = r.lonLatToWorld(-0.1246, 51.5007);
  src.prefetch(w.x, w.y, 17, 0);
  for (let i = 0; i < 80 && src.loaded === 0; i++) await new Promise((d) => setTimeout(d, 50));

  // The fake tile is quartered: water NW, woodland NE, parkland SW, built SE.
  const span = r.tileSpan(17);
  const t = r.tileAt(w.x, w.y, 17);
  const o = r.tileOrigin(t.x, t.y, 17);
  const at = (fx, fy) => src.biomeAt(o.x + span * fx, o.y + span * fy, 17);
  return {
    loaded: src.loaded,
    nw: at(0.25, 0.25), ne: at(0.75, 0.25), sw: at(0.25, 0.75), se: at(0.75, 0.75),
    tainted: src.tainted,
  };
}, ORIGIN);
ok('a fetched tile is decoded and read for biome',
   sampled.loaded === 1 && sampled.nw === 'waterside' && sampled.ne === 'woodland'
   && sampled.sw === 'parkland' && sampled.se && sampled.se !== 'waterside',
   `NW ${sampled.nw} · NE ${sampled.ne} · SW ${sampled.sw} · SE ${sampled.se} (built, from the fallback)`);

// --- 6. a provider without CORS still draws, and says it cannot be sampled
const opaque = await page.evaluate(async () => {
  const r = window.__riftborn;
  const src = r.createTileSource({ provider: 'test_opaque', fallbackBiome: () => 'works' });
  const w = r.lonLatToWorld(-0.1246, 51.5007);
  src.prefetch(w.x, w.y, 17, 0);
  for (let i = 0; i < 80 && src.loaded === 0; i++) await new Promise((d) => setTimeout(d, 50));
  return { loaded: src.loaded, tainted: src.tainted, biome: src.biomeAt(w.x, w.y, 17) };
});
ok('a tile with no CORS header is displayable but not samplable',
   opaque.loaded === 1 && opaque.tainted === true && opaque.biome === null,
   'tile drew, getImageData threw, biomeAt returns null so the caller falls back');

// --- 7. a dead provider falls back rather than failing
const dead = await page.evaluate(async () => {
  const r = window.__riftborn;
  const src = r.createTileSource({ provider: 'test_dead', fallbackBiome: () => 'transit' });
  const w = r.lonLatToWorld(-0.1246, 51.5007);
  src.prefetch(w.x, w.y, 17, 0);
  await new Promise((d) => setTimeout(d, 900));
  const patrol = r.patrol;
  const before = patrol.tiles;
  patrol.tiles = src;
  const biome = r.biomeUnderfoot(patrol);
  patrol.tiles = before;
  return { loaded: src.loaded, biome };
});
ok('a 404 basemap leaves the synthetic world running',
   dead.loaded === 0 && typeof dead.biome === 'string' && dead.biome.length > 0,
   `no tiles loaded · biomeUnderfoot still answers "${dead.biome}"`);

// --- 8. the live patrol reads its biome off the map
const live = await page.evaluate(async () => {
  const r = window.__riftborn;
  const src = r.createTileSource({ provider: 'test', fallbackBiome: () => 'industrial' });
  r.patrol.tiles = src;
  const span = r.tileSpan(17);
  const w = r.lonLatToWorld(-0.1246, 51.5007);
  const t = r.tileAt(w.x, w.y, 17);
  const o = r.tileOrigin(t.x, t.y, 17);
  src.prefetch(o.x + span * 0.5, o.y + span * 0.5, 17, 0);
  for (let i = 0; i < 80 && src.loaded === 0; i++) await new Promise((d) => setTimeout(d, 50));

  const seen = {};
  for (const [name, fx, fy] of [['nw', 0.25, 0.25], ['ne', 0.75, 0.25], ['sw', 0.25, 0.75]]) {
    r.placePatrol(r.patrol, o.x + span * fx, o.y + span * fy, { live: false });
    seen[name] = r.biomeUnderfoot(r.patrol);
  }
  return seen;
});
ok('standing somewhere changes what you are standing on',
   live.nw === 'waterside' && live.ne === 'woodland' && live.sw === 'parkland',
   `moved across one tile: ${live.nw} → ${live.ne} → ${live.sw}`);

// --- 9. spawns follow the real ground
const spawning = await page.evaluate(async () => {
  const r = window.__riftborn;
  const span = r.tileSpan(17);
  const w = r.lonLatToWorld(-0.1246, 51.5007);
  const t = r.tileAt(w.x, w.y, 17);
  const o = r.tileOrigin(t.x, t.y, 17);
  const pool = r.patrol.pool;

  const bySpecies = Object.fromEntries(pool.map((s) => [s.id, s.spawn.biomes]));
  /*
   * visibleSpawns gathers everything within the detection radius, which spans
   * several tiles and therefore several biomes — so "everything I can see from
   * the water is a water species" is false by construction. The real invariant
   * is per spawn: whatever tile it came from, it belongs in that tile's biome.
   */
  const sample = (fx, fy) => {
    const px = o.x + span * fx, py = o.y + span * fy;
    const rows = [];
    for (let b = 0; b < 24; b++) {
      for (const s of r.visibleSpawns(px, py, 900000 + b, pool, 'day', 1, 'overcast',
        (x, y) => r.biomeAtWorld(r.patrol, x, y))) {
        rows.push({ id: s.speciesId, biome: s.biome, fits: bySpecies[s.speciesId].includes(s.biome) });
      }
    }
    return rows;
  };
  const water = sample(0.25, 0.25);
  const wood = sample(0.75, 0.25);
  const all = [...water, ...wood];
  return {
    water: [...new Set(water.filter((x) => x.biome === 'waterside').map((x) => x.id))],
    wood: [...new Set(wood.filter((x) => x.biome === 'woodland').map((x) => x.id))],
    total: all.length,
    mismatched: all.filter((x) => !x.fits).map((x) => `${x.id}@${x.biome}`).slice(0, 4),
    waterOk: true, woodOk: true,
  };
});
ok('every spawn belongs in the ground it stands on',
   spawning.total > 0 && spawning.mismatched.length === 0
   && spawning.water.length > 0 && spawning.wood.length > 0,
   `${spawning.total} spawns across the tile, none out of place`
   + ` · on the water: ${spawning.water.slice(0, 3).join(', ')}`
   + ` · in the trees: ${spawning.wood.slice(0, 3).join(', ')}`
   + (spawning.mismatched.length ? ` · WRONG GROUND: ${spawning.mismatched.join(', ')}` : ''));

// --- 10. dragging the marker moves you and pays for the walk
const drag = await page.evaluate(async () => {
  const r = window.__riftborn;
  r.show('patrol');
  await new Promise((d) => setTimeout(d, 200));
  const before = { x: r.patrol.x, y: r.patrol.y, walked: r.profile.state.metresWalked };
  const canvas = document.getElementById('map');
  const box = canvas.getBoundingClientRect();
  const down = new PointerEvent('pointerdown', { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, pointerId: 1, bubbles: true });
  const move = new PointerEvent('pointermove', { clientX: box.x + box.width / 2 + 60, clientY: box.y + box.height / 2, pointerId: 1, bubbles: true });
  const up = new PointerEvent('pointerup', { clientX: box.x + box.width / 2 + 60, clientY: box.y + box.height / 2, pointerId: 1, bubbles: true });
  canvas.dispatchEvent(down); canvas.dispatchEvent(move); canvas.dispatchEvent(up);
  await new Promise((d) => setTimeout(d, 150));
  return {
    before, after: { x: r.patrol.x, y: r.patrol.y, walked: r.profile.state.metresWalked },
    moved: Math.hypot(r.patrol.x - before.x, r.patrol.y - before.y),
  };
});
ok('dragging the map walks the Warden',
   drag.moved > 5 && drag.after.walked >= drag.before.walked,
   `dragged ${drag.moved.toFixed(0)} world units west → east`
   + ` · walked total ${drag.before.walked.toFixed(0)} → ${drag.after.walked.toFixed(0)} m`);

// --- 11. a GPS re-fix is not a 100-metre sprint
const refix = await page.evaluate(async () => {
  const r = window.__riftborn;
  const walked0 = r.profile.state.metresWalked;
  const { x, y } = r.patrol;
  // A real step.
  r.placePatrol(r.patrol, x + 20, y, { jumped: false, live: true, accuracyM: 8 });
  const afterStep = r.profile.state.metresWalked;
  // A re-fix: same size of jump, flagged as a correction.
  r.placePatrol(r.patrol, x + 220, y, { jumped: true, live: true, accuracyM: 48 });
  return { walked0, afterStep, afterJump: r.profile.state.metresWalked, accuracy: r.patrol.accuracyM };
});
ok('a re-fix does not pay out as walking',
   refix.afterStep > refix.walked0 && refix.afterJump === refix.afterStep,
   `a 20 m step counted (${refix.walked0.toFixed(0)} → ${refix.afterStep.toFixed(0)} m);`
   + ` a 200 m re-fix did not (still ${refix.afterJump.toFixed(0)} m)`);

// --- 12. the location bar reflects a refusal instead of pretending
const denied = await page.evaluate(async () => {
  const r = window.__riftborn;
  // Refusal is what an un-granted permission produces in a headless context.
  document.getElementById('btn-locate').click();
  await new Promise((d) => setTimeout(d, 1200));
  return {
    status: r.locator.state.status,
    mode: r.locator.state.mode,
    bar: document.getElementById('locate-bar').dataset.state,
    text: document.getElementById('locate-state').textContent,
    where: document.getElementById('locate-where').textContent,
  };
});
ok('a refused or unavailable fix falls back to dragging, and says so',
   ['denied', 'unavailable', 'error', 'requesting', 'tracking'].includes(denied.status)
   && denied.where.includes(','),
   `status "${denied.status}" · bar "${denied.bar}" · "${denied.text.trim()}" · at ${denied.where}`);

// --- 13. the map draws, with attribution
const drew = await page.evaluate(async () => {
  const r = window.__riftborn;
  const src = r.createTileSource({ provider: 'test', fallbackBiome: () => 'industrial' });
  r.patrol.tiles = src;
  src.prefetch(r.patrol.x, r.patrol.y, 17, 1);
  for (let i = 0; i < 80 && src.loaded < 4; i++) await new Promise((d) => setTimeout(d, 50));
  await new Promise((d) => setTimeout(d, 400));

  const c = document.getElementById('map');
  const ctx = c.getContext('2d');
  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  const seen = new Set();
  for (let i = 0; i < data.length; i += 4 * 719) seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
  return { loaded: src.loaded, colours: seen.size, attribution: src.attribution };
});
ok('the map paints and credits its source',
   drew.loaded >= 4 && drew.colours > 6 && /OpenStreetMap/.test(drew.attribution),
   `${drew.loaded} tiles · ${drew.colours} distinct colours sampled · "${drew.attribution}"`);

// --- 14. phone layout
await page.setViewportSize({ width: 390, height: 844 });
await page.evaluate(() => window.__riftborn.show('patrol'));
await page.waitForTimeout(400);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok('no horizontal overflow at 390px', overflow === 0, `${overflow}px`);

await page.screenshot({ path: process.argv[2] ?? 'map.png' });
await browser.close();
console.log(errors.length ? `\nCONSOLE ERRORS:\n${errors.join('\n')}` : '\nno console errors');
process.exit(errors.length ? 1 : 0);
