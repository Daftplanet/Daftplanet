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
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'docs');
const SUITES = {
  phase1: 'smoke1.mjs', phase2: 'smoke2.mjs', packs: 'packs.mjs', rifts: 'rifts.mjs',
  pwa: 'pwa.mjs', twoweapons: 'twoweapons.mjs', mods: 'mods.mjs',
};
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml',
};

const server = createServer(async (req, res) => {
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
