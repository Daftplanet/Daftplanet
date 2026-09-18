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

// --- 1. every species in the book gets a model
const all = await page.evaluate(() => {
  const r = window.__riftborn;
  const rows = r.data.monsters.monsters.map((sp) => {
    const m = r.buildModel(sp);
    return {
      id: sp.id, size: sp.size, family: sp.family,
      voxels: m.voxels.length,
      weak: m.voxels.filter((v) => v.weak).length,
      wants: (sp.weak_points ?? []).length || (sp.weak_point_requires ? 1 : 0),
      dims: m.size,
    };
  });
  return {
    n: rows.length,
    empty: rows.filter((x) => x.voxels < 8).map((x) => x.id),
    missingWeak: rows.filter((x) => x.wants > 0 && x.weak === 0).map((x) => x.id),
    min: Math.min(...rows.map((x) => x.voxels)),
    max: Math.max(...rows.map((x) => x.voxels)),
    flat: rows.filter((x) => x.dims.x < 2 || x.dims.y < 2 || x.dims.z < 2).map((x) => x.id),
  };
});
ok('every species builds a solid model with its weak points on it',
   all.empty.length === 0 && all.missingWeak.length === 0 && all.flat.length === 0,
   `${all.n} species · ${all.min}–${all.max} voxels each`
   + (all.empty.length ? ` · EMPTY: ${all.empty.join(',')}` : '')
   + (all.missingWeak.length ? ` · NO WEAK POINT: ${all.missingWeak.join(',')}` : '')
   + (all.flat.length ? ` · FLAT: ${all.flat.join(',')}` : ''));

// --- 2. the model is derived from the entry, not from a random seed each time
const stable = await page.evaluate(() => {
  const r = window.__riftborn;
  const sp = r.data.monsters.monsters.find((m) => m.id === 'cinderfang');
  const a = r.buildModel(sp), b = r.buildModel(sp);
  const key = (m) => m.voxels.map((v) => `${v.x},${v.y},${v.z},${v.colour}`).join('|');
  return { same: key(a) === key(b), n: a.voxels.length };
});
ok('the same monster is always the same monster', stable.same,
   `two builds of Cinderfang agree on all ${stable.n} voxels`);

// --- 3. bigger size classes are bigger models, and later stages are bigger still
const scaling = await page.evaluate(() => {
  const r = window.__riftborn;
  const by = (id) => {
    const sp = r.data.monsters.monsters.find((m) => m.id === id);
    const m = r.buildModel(sp);
    return { n: m.voxels.length, y: m.size.y, size: sp.size, stage: sp.stage };
  };
  return {
    line: ['sootpup', 'cinderfang', 'pyrecrown'].map(by),
    sizes: ['glimmerfly', 'cinderfang', 'karrahk'].map(by),
  };
});
ok('a monster grows as it evolves, and a Titan dwarfs a Mote',
   scaling.line[0].n < scaling.line[1].n && scaling.line[1].n < scaling.line[2].n
   && scaling.sizes[0].n < scaling.sizes[1].n && scaling.sizes[1].n < scaling.sizes[2].n,
   `Sootpup ${scaling.line[0].n} → Cinderfang ${scaling.line[1].n} → Pyrecrown ${scaling.line[2].n} voxels`
   + ` · Mote ${scaling.sizes[0].n} vs Titan ${scaling.sizes[2].n}`);

// --- 4. elements decide the palette
const palette = await page.evaluate(() => {
  const r = window.__riftborn;
  const avg = (id) => {
    const sp = r.data.monsters.monsters.find((m) => m.id === id);
    const m = r.buildModel(sp);
    const body = m.voxels.filter((v) => !v.weak);
    const sum = body.reduce((acc, v) => {
      const h = v.colour;
      return [acc[0] + parseInt(h.slice(1, 3), 16), acc[1] + parseInt(h.slice(3, 5), 16), acc[2] + parseInt(h.slice(5, 7), 16)];
    }, [0, 0, 0]);
    return sum.map((n) => Math.round(n / body.length));
  };
  return { ember: avg('sootpup'), tide: avg('brinelet'), verdant: avg('sporelet'), gloom: avg('shadelet') };
});
ok('an Ember monster is warm and a Tide monster is cold',
   palette.ember[0] > palette.ember[2] && palette.tide[2] > palette.tide[0]
   && palette.verdant[1] > palette.verdant[0] && palette.verdant[1] > palette.verdant[2],
   `ember rgb(${palette.ember}) · tide rgb(${palette.tide})`
   + ` · verdant rgb(${palette.verdant}) · gloom rgb(${palette.gloom})`);

// --- 5. the three apexes are not generic blobs
const apexes = await page.evaluate(() => {
  const r = window.__riftborn;
  const shape = (id) => {
    const sp = r.data.monsters.monsters.find((m) => m.id === id);
    const m = r.buildModel(sp);
    return { id, dims: m.size, ratio: Number((m.size.z / m.size.x).toFixed(2)), n: m.voxels.length };
  };
  return ['karrahk', 'nyxhollow', 'aeonrend_apex'].map(shape);
});
ok('the apexes get silhouettes of their own',
   apexes[0].ratio > 2 && apexes.every((a) => a.n > 150)
   && new Set(apexes.map((a) => JSON.stringify(a.dims))).size === apexes.length,
   apexes.map((a) => `${a.id} ${a.dims.x}×${a.dims.y}×${a.dims.z} (${a.n})`).join(' · ')
   + ' — Karrahk coils, the others do not');

// --- 6. rendering centres the model instead of running off the top
const framed = await page.evaluate(() => {
  const r = window.__riftborn;
  const check = (id) => {
    const sp = r.data.monsters.monsters.find((m) => m.id === id);
    const c = document.createElement('canvas');
    c.width = 96; c.height = 96;
    const ctx = c.getContext('2d');
    r.fitModel(ctx, r.modelFor(sp), { turns: 0.125, width: 96, height: 96 });
    const d = ctx.getImageData(0, 0, 96, 96).data;
    let minX = 96, maxX = -1, minY = 96, maxY = -1, painted = 0;
    for (let y = 0; y < 96; y++) {
      for (let x = 0; x < 96; x++) {
        if (d[(y * 96 + x) * 4 + 3] > 8) {
          painted++;
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
      }
    }
    return { id, painted, minX, maxX, minY, maxY, fill: painted / (96 * 96) };
  };
  return ['glimmerfly', 'karrahk', 'pyrecrown'].map(check);
});
ok('a Titan and a Mote both fit their frame with nothing clipped',
   framed.every((f) => f.painted > 300 && f.minX >= 0 && f.minY >= 1 && f.maxX <= 95 && f.maxY <= 95)
   && framed.every((f) => f.fill > 0.06),
   framed.map((f) => `${f.id} fills ${(f.fill * 100).toFixed(0)}% within [${f.minX},${f.minY}]–[${f.maxX},${f.maxY}]`).join(' · '));

// --- 7. rotation actually rotates
const spun = await page.evaluate(() => {
  const r = window.__riftborn;
  const sp = r.data.monsters.monsters.find((m) => m.id === 'cinderfang');
  const m = r.modelFor(sp);
  const shot = (turns) => {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    r.fitModel(c.getContext('2d'), m, { turns, width: 64, height: 64 });
    return c.getContext('2d').getImageData(0, 0, 64, 64).data.join(',');
  };
  const a = shot(0), b = shot(0.25), c = shot(0);
  return { differs: a !== b, repeats: a === c };
});
ok('turning the model changes the picture, and turning back restores it',
   spun.differs && spun.repeats, 'quarter turn differs; same angle is byte-identical');

// --- 8. sprites are cached, not rebuilt per draw
const cache = await page.evaluate(() => {
  const r = window.__riftborn;
  const sp = r.data.monsters.monsters.find((m) => m.id === 'sootpup');
  r.clearVoxelCache();
  const t0 = performance.now();
  const first = r.spriteFor(sp, 48);
  const cold = performance.now() - t0;
  const t1 = performance.now();
  let last = null;
  for (let i = 0; i < 200; i++) last = r.spriteFor(sp, 48);
  const warm = performance.now() - t1;
  return { same: first === last, cold, warm, per: warm / 200 };
});
ok('a sprite is built once and handed back after that',
   cache.same && cache.per < cache.cold,
   `first build ${cache.cold.toFixed(2)} ms · 200 more cost ${cache.warm.toFixed(2)} ms total`
   + ` (${cache.per.toFixed(4)} ms each), and it is the same canvas object`);

// --- 9. the Codex shows models, and they turn
await page.evaluate(() => {
  const r = window.__riftborn;
  for (const m of r.data.monsters.monsters.slice(0, 6)) {
    r.profile.state.codex[m.id] = { state: 'catalogued', catalogued: 1, culled: 0, research: 1, seen: 2 };
  }
  r.profile.save();
  r.show('codex');
});
await page.waitForSelector('.entry__model');
const codex = await page.evaluate(async () => {
  const canvases = [...document.querySelectorAll('.entry__model')];
  const read = (c) => c.getContext('2d').getImageData(0, 0, c.width, c.height).data.join(',');
  const before = read(canvases[0]);
  const painted = canvases.filter((c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 8) return true;
    return false;
  }).length;
  await new Promise((d) => setTimeout(d, 700));
  return { total: canvases.length, painted, turned: read(canvases[0]) !== before };
});
ok('the Codex draws a model per entry and keeps them turning',
   codex.painted === codex.total && codex.total >= 6 && codex.turned,
   `${codex.painted}/${codex.total} entries drew a model, and the picture changed on its own`);

// --- 10. an unsighted species shows nothing
const unseen = await page.evaluate(() => {
  const models = document.querySelectorAll('.entry__model').length;
  const dots = document.querySelectorAll('.entry__dot').length;
  return { models, dots };
});
ok('a species you have never seen is still a blank slot',
   unseen.dots > 0 && unseen.models > 0,
   `${unseen.models} models for what you have seen · ${unseen.dots} blanks for what you have not`);

// --- 11. every monster carries markings, and they say what the second element is
/*
 * A model used to be four tones of one hue — correctly shaped and completely
 * flat. Markings are most of what makes a creature readable at sprite size, and
 * here they carry information: the accent is the SECOND element where there is
 * one, so a dual-type is legible from the model before you open a menu.
 */
const marks = await page.evaluate(() => {
  const r = window.__riftborn;
  const rows = r.data.monsters.monsters.map((sp) => {
    const m = r.buildModel(sp);
    const offRamp = m.voxels.filter((v) => !m.ramp.includes(v.colour) && !v.weak).length;
    return { id: sp.id, els: sp.elements ?? [], tones: new Set(m.voxels.map((v) => v.colour)).size,
      marked: offRamp / m.voxels.length };
  });
  /*
   * A dual-element species should WEAR its second element — but not necessarily
   * in that element's exact hex. A mask paints a darkened accent and a mottle
   * blends toward it, both of which read as the second element and neither of
   * which equals it. The first version of this check demanded the literal
   * colour and failed 3 of 12 on markings that were working correctly.
   *
   * So test the property instead: somewhere on the model there is a colour
   * nearer to element two's ramp than to element one's.
   */
  const hex = (c) => {
    if (c.startsWith('rgb')) { const n = c.match(/\d+/g).map(Number); return n; }
    return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  };
  const near = (c, ramp) => Math.min(...ramp.map((q) => {
    const a = hex(c), b = hex(q);
    return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  }));
  const dual = rows.filter((x) => x.els.length > 1);
  const secondShows = dual.filter((x) => {
    const sp = r.data.monsters.monsters.find((m) => m.id === x.id);
    const m = r.buildModel(sp);
    const one = r.ELEMENT_RAMP[sp.elements[0]], two = r.ELEMENT_RAMP[sp.elements[1]];
    if (!one || !two) return true;
    return m.voxels.some((v) => !v.weak && near(v.colour, two) < near(v.colour, one));
  }).length;
  return {
    total: rows.length,
    flat: rows.filter((x) => x.marked === 0).map((x) => x.id),
    swamped: rows.filter((x) => x.marked > 0.7).map((x) => x.id),
    minTones: Math.min(...rows.map((x) => x.tones)),
    median: rows.map((x) => x.marked).sort((a, b) => a - b)[Math.floor(rows.length / 2)],
    dual: dual.length, secondShows,
  };
});
ok('every monster carries markings, and a dual-element one wears its second element',
   marks.flat.length === 0 && marks.swamped.length === 0 && marks.minTones >= 3
   && marks.median > 0.05 && marks.median < 0.6 && marks.secondShows === marks.dual,
   `${marks.total} species · none flat, none swamped · median ${(marks.median * 100).toFixed(0)}% marked`
   + ` · ${marks.secondShows}/${marks.dual} dual-element species show their second element`
   + ' — models used to be four tones of one hue');

// --- 12. phone layout
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok('no horizontal overflow at 390px', overflow === 0, `${overflow}px`);

await page.screenshot({ path: process.argv[2] ?? 'voxel.png' });
await browser.close();
console.log(errors.length ? `\nCONSOLE ERRORS:\n${errors.join('\n')}` : '\nno console errors');
if (fails) console.log(`${fails} check(s) FAILED`);
process.exit(errors.length || fails ? 1 : 0);
