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

/*
 * 1. The engine must speak every placement term the data uses.
 *
 * This is the check that would have caught the whole bug. The bestiary has used
 * `midnight`, `event` and `requires_weather: "storm"` since phase 0; the engine
 * understood none of them and said nothing, so two of the three apexes were
 * unplaceable and one species' only condition could never be met.
 */
const vocab = await page.evaluate(() => {
  const r = window.__riftborn;
  const all = r.data.monsters.monsters;
  const usedWindows = new Set();
  const usedWeather = new Set();
  const usedBiomes = new Set();
  for (const m of all) {
    for (const w of m.spawn?.time_windows ?? []) usedWindows.add(w);
    if (m.spawn?.requires_weather) usedWeather.add(m.spawn.requires_weather);
    for (const b of m.spawn?.biomes ?? []) usedBiomes.add(b);
  }
  const known = r.PLACEMENT_VOCABULARY;
  // A biome is "known" if some tile in the world can actually be it, or if it is
  // the pseudo-biome that means "inside a rift".
  const reachable = new Set(['rift_event']);
  for (let tx = 0; tx < 260; tx += 3) {
    for (let ty = 0; ty < 260; ty += 3) reachable.add(r.biomeAt(tx, ty, 1));
  }
  return {
    windows: [...usedWindows].sort(),
    unknownWindows: [...usedWindows].filter((w) => !known.timeWindows.includes(w)),
    weather: [...usedWeather],
    unknownWeather: [...usedWeather].filter((w) => !known.weatherKinds.includes(w) && !r.data.elements),
    // a weather kind is known if it resolves to at least one real weather
    unresolvableWeather: [...usedWeather].filter(
      (kind) => !Object.keys(r.WEATHER).some((w) => r.weatherIs(kind, w))),
    biomes: [...usedBiomes].sort(),
    unreachableBiomes: [...usedBiomes].filter((b) => !reachable.has(b)),
  };
});
ok('the engine understands every placement term the bestiary uses',
   vocab.unknownWindows.length === 0 && vocab.unresolvableWeather.length === 0
   && vocab.unreachableBiomes.length === 0,
   `${vocab.windows.length} time windows (${vocab.windows.join(', ')})`
   + ` · ${vocab.weather.length} weather condition${vocab.weather.length === 1 ? '' : 's'} (${vocab.weather.join(', ')})`
   + ` · ${vocab.biomes.length} biomes, all reachable`
   + (vocab.unknownWindows.length ? ` · UNKNOWN WINDOWS ${vocab.unknownWindows.join(',')}` : '')
   + (vocab.unresolvableWeather.length ? ` · UNRESOLVABLE ${vocab.unresolvableWeather.join(',')}` : '')
   + (vocab.unreachableBiomes.length ? ` · UNREACHABLE ${vocab.unreachableBiomes.join(',')}` : ''));

/*
 * 1b. And every biome the world generates must have something living in it.
 *
 * This is the mirror of phase 2's "every wild species is reachable" check, and it
 * catches the opposite drift. `residential` is the second-largest biome on the map
 * — 16% of tiles, and the one a player is most often actually standing in, because
 * it is where people live — and no species listed it at all. Its 7% tile rate was
 * really 0%. The phase 1 suite had been intermittently failing "spawns generated"
 * on it for weeks, and a comment I wrote myself called it "a residential tile only
 * spawns 7% of the time" rather than never.
 */
const dead = await page.evaluate(() => {
  const r = window.__riftborn;
  const pool = r.patrol.pool;
  const biomes = new Set();
  for (let tx = 0; tx < 400; tx++) for (let ty = 0; ty < 60; ty++) biomes.add(r.biomeAt(tx, ty, 1));
  const counts = [...biomes].sort().map((b) => [b, pool.filter((s) => s.spawn.biomes.includes(b)).length]);
  return { counts, empty: counts.filter(([, n]) => n === 0).map(([b]) => b) };
});
ok('every biome the world generates has something that lives there',
   dead.empty.length === 0,
   dead.counts.map(([b, n]) => `${b} ${n}`).join(' · ')
   + (dead.empty.length ? ` · DEAD GROUND: ${dead.empty.join(', ')}` : ''));

// --- 2. midnight is a slice of night, not a synonym for it
const windows = await page.evaluate(() => {
  const r = window.__riftborn;
  const at = (h) => new Date(2026, 8, 17, h, 30);
  return {
    midnight: [22, 23, 0, 1, 2].map((h) => [h, r.inTimeWindow('midnight', at(h))]),
    night: [22, 23, 0, 1, 2].map((h) => [h, r.inTimeWindow('night', at(h))]),
    day: r.inTimeWindow('day', at(12)),
    any: r.inTimeWindow('any', at(3)),
    event: r.inTimeWindow('event', at(3)),
    nonsense: r.inTimeWindow('elevenses', at(11)),
  };
});
ok('midnight is a narrow window inside night, and nonsense matches nothing',
   windows.midnight.filter(([, v]) => v).map(([h]) => h).join() === '23,0'
   && windows.night.every(([, v]) => v)
   && windows.day && windows.any && windows.event && windows.nonsense === false,
   `midnight = ${windows.midnight.filter(([, v]) => v).map(([h]) => `${h}:00`).join(', ')}`
   + ` · night covers all of 22–02 · an unknown window is never satisfied`);

// --- 3. "storm" resolves to a weather the world actually produces
const weather = await page.evaluate(() => {
  const r = window.__riftborn;
  const kinds = Object.keys(r.WEATHER);
  return {
    kinds,
    stormMatches: kinds.filter((w) => r.weatherIs('storm', w)),
    clearIsNotStorm: r.weatherIs('storm', 'clear'),
    noRequirement: r.weatherIs(null, 'fog'),
  };
});
ok('the bestiary\'s "storm" resolves to real weather',
   weather.stormMatches.length > 0 && weather.clearIsNotStorm === false && weather.noRequirement === true,
   `storm → ${weather.stormMatches.join(', ')} of ${weather.kinds.length} weathers`
   + ` · clear is not a storm · no requirement always passes`);

// --- 4. every apex gets placed only where its own entry says it belongs
const placed = await page.evaluate(() => {
  const r = window.__riftborn;
  const apexById = r.patrol.apexById;
  const ids = Object.keys(apexById);
  const seen = {};
  const violations = [];
  for (let day = 20300; day < 20340; day++) {
    for (let cx = 0; cx < 30; cx++) {
      for (let cy = 0; cy < 8; cy++) {
        const rift = r.riftForCell(cx, cy, day, 1, apexById);
        seen[rift.apexId] = (seen[rift.apexId] ?? 0) + 1;
        const sp = apexById[rift.apexId];
        const fits = r.placementFits(sp, {
          biome: rift.biome, weather: rift.weather, date: new Date(rift.apexFromMs), inRift: true,
        });
        if (!fits && violations.length < 4) {
          violations.push(`${rift.apexId} @ ${rift.biome}/${rift.weather}/${new Date(rift.apexFromMs).getHours()}h`);
        }
      }
    }
  }
  const total = Object.values(seen).reduce((a, b) => a + b, 0);
  return { seen, total, violations, ids };
});
ok('no rift ever carries an apex its own entry forbids',
   placed.violations.length === 0,
   `${placed.total} rifts · ` + Object.entries(placed.seen)
     .map(([k, v]) => `${k} ${((v / placed.total) * 100).toFixed(1)}%`).join(' · ')
   + (placed.violations.length ? ` · VIOLATIONS ${placed.violations.join('; ')}` : ''));

// --- 5. and the conditional two do still turn up, in the right conditions
const conditions = await page.evaluate(() => {
  const r = window.__riftborn;
  const apexById = r.patrol.apexById;
  const out = { karrahk: [], nyxhollow: [] };
  for (let day = 20300; day < 20400; day++) {
    for (let cx = 0; cx < 40; cx++) {
      for (let cy = 0; cy < 10; cy++) {
        const rift = r.riftForCell(cx, cy, day, 1, apexById);
        if (out[rift.apexId]) {
          out[rift.apexId].push({ biome: rift.biome, weather: rift.weather, hour: new Date(rift.apexFromMs).getHours() });
        }
      }
    }
  }
  return {
    karrahk: { n: out.karrahk.length, biomes: [...new Set(out.karrahk.map((x) => x.biome))], weathers: [...new Set(out.karrahk.map((x) => x.weather))] },
    nyxhollow: { n: out.nyxhollow.length, biomes: [...new Set(out.nyxhollow.map((x) => x.biome))], hours: [...new Set(out.nyxhollow.map((x) => x.hour))].sort((a, b) => a - b) },
  };
});
ok('Karrahk only ever appears on water in a storm',
   conditions.karrahk.n > 0 && conditions.karrahk.biomes.join() === 'waterside'
   && conditions.karrahk.weathers.join() === 'thunderstorm',
   `${conditions.karrahk.n} scheduled · biomes ${conditions.karrahk.biomes.join(',')}`
   + ` · weather ${conditions.karrahk.weathers.join(',')}`);
ok('Nyxhollow only ever appears at midnight, in the two biomes it names',
   conditions.nyxhollow.n > 0
   && conditions.nyxhollow.hours.every((h) => h === 23 || h === 0)
   && conditions.nyxhollow.biomes.every((b) => ['urban_core', 'woodland'].includes(b)),
   `${conditions.nyxhollow.n} scheduled · hours ${conditions.nyxhollow.hours.map((h) => `${h}:00`).join(', ')}`
   + ` · biomes ${conditions.nyxhollow.biomes.join(',')}`);

/*
 * 6. The schedule has to be able to REACH midnight.
 *
 * Before this change rifts opened 08:00–21:00, so the latest possible apex window
 * was 22:35 and Nyxhollow's only window was unreachable by construction — the
 * rules would have been honoured and the species still never seen.
 */
const reach = await page.evaluate(() => {
  const r = window.__riftborn;
  const hours = new Set();
  for (let day = 20300; day < 20310; day++) {
    for (let cx = 0; cx < 60; cx++) {
      for (let cy = 0; cy < 20; cy++) {
        hours.add(new Date(r.riftForCell(cx, cy, day, 1).apexFromMs).getHours());
      }
    }
  }
  return [...hours].sort((a, b) => a - b);
});
ok('the schedule can put an apex window at midnight at all',
   reach.includes(23) || reach.includes(0),
   `apex windows land at ${reach[0]}:00–${reach[reach.length - 1]}:00`);

// --- 7. the forecast finds what the local rift list cannot
const forecast = await page.evaluate(() => {
  const r = window.__riftborn;
  const seed = r.profile.state.seed;
  const at = new Date(2026, 8, 17, 9, 0);
  const wide = r.apexForecast(60000, 60000, at, 1, r.patrol.apexById);
  const narrow = r.apexForecast(60000, 60000, at, 1, r.patrol.apexById, { cells: 1, days: 4 });
  return {
    wide: wide.map((x) => x.apexId),
    narrow: narrow.map((x) => x.apexId),
    sorted: wide.every((x, i) => i === 0 || wide[i - 1].apexFromMs <= x.apexFromMs),
    hasDistance: wide.every((x) => x.distance >= 0 && x.biome && x.weather),
    seed,
  };
});
ok('the forecast scans wide enough to find what a local scan misses',
   forecast.wide.length >= forecast.narrow.length && forecast.sorted && forecast.hasDistance,
   `±3 cells finds ${forecast.wide.join(', ') || 'nothing'}`
   + ` · ±1 finds ${forecast.narrow.join(', ') || 'nothing'} · sorted by when, each with a place and conditions`);

// --- 8. the board renders, and keeps the conditions behind Research II
await page.evaluate(() => {
  const r = window.__riftborn;
  r.profile.state.devUnlockAll = true;
  r.profile.save();
});
await page.waitForTimeout(600);
const board = await page.evaluate(() => {
  const el = document.getElementById('forecast-board');
  return {
    hidden: el.hidden,
    rows: document.querySelectorAll('.cast').length,
    why: [...document.querySelectorAll('.cast__why')].map((n) => n.dataset.known),
    text: document.getElementById('forecast').textContent.replace(/\s+/g, ' ').trim().slice(0, 140),
  };
});
ok('the forecast board shows what is due and hides why',
   board.hidden === false && board.rows > 0 && board.why.every((k) => k === 'false')
   && /Research II/.test(board.text),
   `${board.rows} row(s) · ${board.text}`);

const afterResearch = await page.evaluate(async () => {
  const r = window.__riftborn;
  const id = document.querySelector('.cast')?.querySelector('b')?.textContent;
  const sp = r.data.monsters.monsters.find((m) => m.name === id);
  r.profile.state.codex[sp.id] = { state: 'researched', catalogued: 1, culled: 0, research: 2, seen: 1 };
  r.profile.save();
  await new Promise((d) => setTimeout(d, 1300));   // the board refreshes on a timer
  const row = document.querySelector('.cast');
  return { name: id, known: row.querySelector('.cast__why').dataset.known, why: row.querySelector('.cast__why').textContent.trim() };
});
ok('Research II turns the conditions on',
   afterResearch.known === 'true' && !/Research II/.test(afterResearch.why),
   `${afterResearch.name} → "${afterResearch.why}"`);

// --- 9. rift events still work end to end
const inside = await page.evaluate(async () => {
  const r = window.__riftborn;
  // Walk to the next rift and jump the clock into its apex window.
  const f = r.apexForecast(r.patrol.x, r.patrol.y, new Date(), r.profile.state.seed, r.patrol.apexById)[0];
  if (!f) return null;
  r.patrol.x = f.x; r.patrol.y = f.y;
  r.patrol.hourOffset = (f.apexFromMs - Date.now()) / 3600000 + 0.05;
  await new Promise((d) => setTimeout(d, 500));
  return {
    inRift: Boolean(r.patrol.rift),
    apexUp: Boolean(r.patrol.rift?.apexUp),
    apexId: r.patrol.rift?.apexId,
    spawns: r.patrol.spawns.length,
    apexSpawn: r.patrol.spawns.some((s) => s.isApex),
    elements: [...new Set(r.patrol.spawns.map((s) => r.speciesById[s.speciesId]?.elements[0]))],
  };
});
ok('a forecast rift is really there when you walk to it',
   inside?.inRift && inside.apexUp && inside.apexSpawn && inside.elements.every((e) => e === 'rift'),
   `${inside?.apexId} up · ${inside?.spawns} spawns, all ${inside?.elements.join('/')}-element`);

// --- 10. a biome looks like somewhere, not like a legend swatch
/*
 * Each biome used to be one flat hex per tile. That is a colour key, not a
 * place — and this is a game whose premise is that the ground under you decides
 * what lives there, so the ground has to say which ground it is before you read
 * anything. Nine biomes, nine palettes, nine silhouettes scattered on them.
 */
const skins = await page.evaluate(() => {
  const r = window.__riftborn;
  const B = r.BIOMES;
  const ids = Object.keys(B);
  const props = new Set(ids.map((k) => B[k].skin?.prop).filter(Boolean));
  const tones = new Set();
  for (const k of ids) for (const c of B[k].skin?.ground ?? []) tones.add(c);

  // Paint one tile of every biome offscreen and count what actually landed.
  const painted = ids.map((k) => {
    const c = document.createElement('canvas');
    c.width = 68; c.height = 68;
    const g = c.getContext('2d');
    r.drawTileSkin(g, k, 3, 7, 0, 0, 68);
    const px = g.getImageData(0, 0, 68, 68).data;
    const seen = new Set();
    for (let i = 0; i < px.length; i += 4) seen.add(`${px[i]},${px[i + 1]},${px[i + 2]}`);
    return { id: k, colours: seen.size };
  });
  /*
   * The same tile twice must be identical. "A neighbour must differ" is NOT a
   * safe assertion any more: tiles are baked into a small set of variants and
   * picked by hash, so any two given tiles have a one-in-thirty-two chance of
   * landing on the same one. Asserting on one pair would fail about three runs
   * in a hundred, for no reason. The real property is that a run of tiles shows
   * plenty of different arrangements.
   */
  const shot = (tx, ty) => {
    const c = document.createElement('canvas');
    c.width = 68; c.height = 68;
    const g = c.getContext('2d');
    r.drawTileSkin(g, 'woodland', tx, ty, 0, 0, 68);
    return g.getImageData(0, 0, 68, 68).data.join(',');
  };
  const spread = new Set(Array.from({ length: 64 }, (_, i) => shot(i, 9))).size;
  return {
    biomes: ids.length, props: props.size, tones: tones.size,
    flat: painted.filter((x) => x.colours < 3).map((x) => x.id),
    minColours: Math.min(...painted.map((x) => x.colours)),
    stable: shot(4, 9) === shot(4, 9),
    spread,
  };
});
ok('every biome paints a patterned ground that is stable for its tile',
   skins.flat.length === 0 && skins.biomes === 9 && skins.props >= 7
   && skins.minColours >= 3 && skins.stable && skins.spread >= 8,
   `${skins.biomes} biomes · ${skins.props} distinct prop silhouettes · ${skins.tones} ground tones`
   + ` · thinnest tile still paints ${skins.minColours} colours`
   + ` · the same tile redraws identically, and 64 tiles show ${skins.spread} different arrangements`
   + ' — each biome was one flat hex before');

/*
 * The ground has to be cheap as well as pretty.
 *
 * Woodland at four trees a tile measured 2.93ms for a screenful of 150 against
 * 0.14ms for a flat fill — 17% of a 16.7ms frame on a desktop CPU, and a phone
 * is several times slower. Baking the variants took it to 0.60ms. Guard the
 * ratio rather than a millisecond count, because the millisecond count belongs
 * to whatever machine happens to be running this.
 */
const TILE_COUNT = 150;
const cost = await page.evaluate(() => {
  const r = window.__riftborn;
  const c = document.createElement('canvas');
  c.width = 400; c.height = 400;
  const g = c.getContext('2d');
  const TILES = 150, PX = 68;
  // Same work either way: one woodland tile, 150 times. propsOnly skips the
  // ground fill and paints the scatter live, which is the expensive half and
  // the path a real basemap underneath still takes.
  const run = (opts) => {
    for (let i = 0; i < TILES; i++) r.drawTileSkin(g, 'woodland', i, 3, 0, 0, PX, opts);
  };
  const time = (opts) => {
    run(opts); run(opts);                       // warm the cache and the JIT
    const t = performance.now();
    for (let pass = 0; pass < 5; pass++) run(opts);
    return (performance.now() - t) / 5;
  };
  const live = time({ propsOnly: true });
  const baked = time({});
  return { live: +live.toFixed(2), baked: +baked.toFixed(2) };
});
ok('a screenful of patterned ground is a blit, not six hundred arcs',
   cost.baked * 2 < cost.live,
   `${TILE_COUNT} tiles of woodland: ${cost.baked}ms baked against ${cost.live}ms painting the props live`
   + ` — ${(cost.live / Math.max(cost.baked, 0.01)).toFixed(1)}x, and the live path is doing less`
   + ' (no ground fill). Unbaked, this was 17% of a frame on a desktop.');

// --- 11. phone layout
await page.setViewportSize({ width: 390, height: 844 });
await page.evaluate(() => window.__riftborn.show('patrol'));
await page.waitForTimeout(400);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok('no horizontal overflow at 390px', overflow === 0, `${overflow}px`);

await page.screenshot({ path: process.argv[2] ?? 'placement.png' });
await browser.close();
console.log(errors.length ? `\nCONSOLE ERRORS:\n${errors.join('\n')}` : '\nno console errors');
if (fails) console.log(`${fails} check(s) FAILED`);
process.exit(errors.length || fails ? 1 : 0);
