import { chromium } from 'playwright';

// executablePath is only needed where the browser is not on Playwright's own path.
const LAUNCH = process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {};

const URL = process.env.RIFTBORN_URL ?? 'http://127.0.0.1:8765/riftborn/';
const browser = await chromium.launch(LAUNCH);
const context = await browser.newContext({ viewport: { width: 420, height: 880 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const ok = (l, c, x = '') => console.log(`${c ? 'PASS' : 'FAIL'}  ${l}${x ? '  — ' + x : ''}`);

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__riftborn !== undefined, null, { timeout: 8000 });

// --- manifest is linked, fetchable and sane
const manifest = await page.evaluate(async () => {
  const link = document.querySelector('link[rel="manifest"]');
  if (!link) return null;
  const res = await fetch(link.href);
  return res.ok ? await res.json() : null;
});
ok('manifest is linked and parses', Boolean(manifest), manifest && `${manifest.name} · ${manifest.display}`);
ok('manifest has required install fields',
   manifest && manifest.name && manifest.start_url && manifest.display === 'standalone'
   && manifest.icons.some((i) => i.sizes === '512x512')
   && manifest.icons.some((i) => i.purpose === 'maskable'),
   manifest && `${manifest.icons.length} icons incl. maskable`);

// --- every icon actually resolves
const icons = await page.evaluate(async () => {
  const link = document.querySelector('link[rel="manifest"]');
  const m = await (await fetch(link.href)).json();
  const base = new URL('./', link.href);
  const out = [];
  for (const i of m.icons) {
    const res = await fetch(new URL(i.src, base));
    out.push({ src: i.src, status: res.status });
  }
  const apple = document.querySelector('link[rel="apple-touch-icon"]');
  if (apple) out.push({ src: 'apple-touch-icon', status: (await fetch(apple.href)).status });
  return out;
});
ok('every icon resolves', icons.every((i) => i.status === 200),
   icons.map((i) => `${i.src}:${i.status}`).join(' '));

// --- service worker registers and takes control
const sw = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.ready;
  return { scope: reg.scope, active: Boolean(reg.active), state: reg.active?.state };
});
ok('service worker activates', sw.active && sw.state === 'activated', sw.scope);

await page.waitForTimeout(1200);   // let the precache finish
const cached = await page.evaluate(async () => {
  const keys = await caches.keys();
  const cache = await caches.open(keys.find((k) => k.startsWith('riftborn-')));
  const entries = await cache.keys();
  return { cacheName: keys.find((k) => k.startsWith('riftborn-')), count: entries.length };
});
ok('app shell is precached', cached.count >= 20, `${cached.count} entries in ${cached.cacheName}`);

// --- the real test: play it with no connection at all
await context.setOffline(true);
const offline = await context.newPage();
const offErrors = [];
offline.on('pageerror', (e) => offErrors.push(e.message));
await offline.goto(URL, { waitUntil: 'domcontentloaded' });
const booted = await offline.waitForFunction(() => window.__riftborn !== undefined, null, { timeout: 10000 })
  .then(() => true).catch(() => false);
/* Give the patrol loop a moment to populate, and walk on if this particular
   starting tile happens to be empty — a residential tile only spawns 7% of the
   time, so "no spawns right here" is the world working, not the app failing. */
const state = booted ? await offline.evaluate(async () => {
  const r = window.__riftborn;
  for (let i = 0; i < 40 && r.patrol.spawns.length === 0; i++) {
    r.patrol.x += 90; r.patrol.y += 40;
    await new Promise((res) => setTimeout(res, 60));
  }
  return {
    spawns: r.patrol.spawns.length,
    species: Object.keys(r.speciesById).length,
    view: r.view,
  };
}) : null;
ok('boots and plays with no connection', booted && state.species === 43,
   booted ? `${state.species} species loaded · ${state.spawns} spawns on the map` : offErrors.join('; '));

// --- a fight works offline too
if (booted) {
  const fought = await offline.evaluate(async () => {
    const r = window.__riftborn;
    const s = r.patrol.spawns[0];
    if (!s) return 'no spawn';
    r.teleportTo(s); r.startFight(s);
    await new Promise((res) => setTimeout(res, 300));
    return r.view === 'fight' ? r.fight.loadout.species.name : 'did not start';
  });
  ok('a fight starts offline', fought !== 'no spawn' && fought !== 'did not start', fought);
}
await offline.screenshot({ path: process.argv[2] ?? 'pwa.png' });
await context.setOffline(false);

await browser.close();
console.log(errors.length ? `\nCONSOLE ERRORS:\n${errors.join('\n')}` : '\nno console errors');
process.exit(errors.length ? 1 : 0);
