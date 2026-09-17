/*
 * RIFTBORN service worker.
 *
 * Makes the game installable and playable with no connection — which matters for
 * something meant to be played outdoors, where coverage is patchy and it is not the
 * player's fault (09-risks-and-roadmap.md, "Offline tolerance").
 *
 * VERSION is stamped from a hash of the shipped files by game/tools/stamp_sw.py.
 * Getting that wrong is the classic PWA failure — everyone pinned to a stale build
 * with no way to tell — so it is generated rather than remembered.
 */

const VERSION = '973bb40df322';
const CACHE = `riftborn-${VERSION}`;

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/app.js',
  'js/game.js',
  'js/rules.js',
  'js/render.js',
  'js/input.js',
  'js/world.js',
  'js/patrol.js',
  'js/profile.js',
  'js/sanctuary.js',
  'js/report.js',
  'data/elements.json',
  'data/sizes.json',
  'data/weapons.json',
  'data/ammo.json',
  'data/monsters.json',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Cache entries one at a time: a single 404 must not abort the whole install
    // and leave the worker permanently unregistered.
    await Promise.all(SHELL.map(async (path) => {
      try {
        await cache.add(new Request(path, { cache: 'reload' }));
      } catch (err) {
        console.warn('[sw] could not precache', path, err);
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('riftborn-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(new URL('./', self.location).pathname)) return;

  // Navigations go to the network first so a new build lands as soon as there is a
  // connection, and fall back to the cached shell when there is not.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put('index.html', fresh.clone());
        return fresh;
      } catch {
        const cache = await caches.open(CACHE);
        return (await cache.match('index.html')) ?? (await cache.match('./')) ?? Response.error();
      }
    })());
    return;
  }

  // Everything else is cache-first for instant loads, revalidated in the background.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    const network = fetch(req).then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    return hit ?? (await network) ?? Response.error();
  })());
});
