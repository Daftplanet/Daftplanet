/*
 * Run every browser suite against a local copy of the prototype.
 *
 *   node game/tests/run.mjs              # all suites
 *   node game/tests/run.mjs mods rifts   # just those
 *
 * It serves docs/ itself on a free port, so there is nothing to start first.
 * Set CHROMIUM if Playwright cannot find a browser on its own.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'docs');
const SUITES = {
  phase1: 'smoke1.mjs', phase2: 'smoke2.mjs', packs: 'packs.mjs', rifts: 'rifts.mjs',
  pwa: 'pwa.mjs', twoweapons: 'twoweapons.mjs', mods: 'mods.mjs', codex: 'codex.mjs', escort: 'escort.mjs', aim: 'aim.mjs', placement: 'placement.mjs', map: 'map.mjs', voxel: 'voxel.mjs',
};
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml',
};

/*
 * A fake tile server.
 *
 * The map path — fetch a tile, decode it, sample its pixels for biome, draw it —
 * cannot be tested against a real provider from a sandbox with no outbound
 * network, and should not be tested against one anyway: a suite that depends on
 * OpenStreetMap being up is a suite that fails for reasons that are not the
 * code's. So serve tiles here, with known ground in them.
 *
 * Each tile is quartered: water top-left, dark green top-right, pale green
 * bottom-left, and noisy grey bottom-right. That gives every classifier branch
 * something to find at a predictable position.
 */
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function fakeTile(size = 256) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0;                                  // filter: none
    for (let x = 0; x < size; x++) {
      const left = x < size / 2, top = y < size / 2;
      let r, g, b;
      if (top && left) { r = 26; g = 62; b = 112; }             // water: blue
      else if (top) { r = 24; g = 68; b = 30; }                 // woodland: dark green
      else if (left) { r = 92; g = 164; b = 96; }               // parkland: pale green
      else {
        // built: mid grey with strong local variation, so it reads as busy
        const n = ((x * 7 + y * 13) % 17) > 8 ? 78 : 26;
        r = n; g = n; b = n + 2;
      }
      raw[o++] = r; raw[o++] = g; raw[o++] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 2;    // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const TILE_PNG = fakeTile();

const server = createServer(async (req, res) => {
  if (req.url.startsWith('/faketiles/')) {
    res.writeHead(200, {
      'content-type': 'image/png',
      'cache-control': 'no-store',
      // Without this the browser taints the canvas and getImageData throws —
      // which is exactly the failure mode a provider without CORS produces, and
      // is covered by its own check in the suite.
      'access-control-allow-origin': '*',
    });
    res.end(TILE_PNG);
    return;
  }
  if (req.url.startsWith('/notile/')) { res.writeHead(404).end('no tile'); return; }
  if (req.url.startsWith('/opaquetile/')) {
    // Same image, no CORS header: displayable, not samplable.
    res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
    res.end(TILE_PNG);
    return;
  }
  let p = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  if (p.endsWith('/')) p += 'index.html';
  try {
    const body = await readFile(join(ROOT, p));
    // The service worker must be served from the scope it claims, with no caching.
    res.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/riftborn/`;

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SUITES);
let failed = 0;
for (const name of wanted) {
  const file = SUITES[name];
  if (!file) { console.error(`unknown suite "${name}" — try ${Object.keys(SUITES).join(', ')}`); failed++; continue; }
  console.log(`\n=== ${name} ===`);
  const code = await new Promise((done) => {
    const child = spawn(process.execPath, [new URL(file, import.meta.url).pathname],
                        { stdio: 'inherit', env: { ...process.env, RIFTBORN_URL: base } });
    child.on('exit', done);
  });
  if (code !== 0) failed++;
}
server.close();
console.log(failed ? `\n${failed} suite(s) failed` : '\nall suites passed');
process.exit(failed ? 1 : 0);
