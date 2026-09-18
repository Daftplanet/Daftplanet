/*
 * RIFTBORN — field reports.
 *
 * 07-codex-wiki.md: "a shareable card generated from a capture: species, method,
 * approximate area, HP remaining. This is the organic marketing surface."
 *
 * It renders to an offscreen canvas and hands back a PNG blob, so it works
 * offline and nothing leaves the device unless the player shares it themselves.
 *
 * The location rule from 09-risks-and-roadmap.md is enforced here rather than
 * trusted to the caller: a card may name a **biome** and nothing else. No
 * coordinates, no tile, no distance, no map. The card cannot be made to leak a
 * position because it is never given one.
 */

const W = 1080;
const H = 1350;

const INK = '#e8eaed';
const DIM = '#9aa3ad';
const FAINT = '#6b737c';
const PANEL = '#15181c';
const LINE = '#2b3037';

const ELEMENT_TINT = {
  ember: '#c2622f', tide: '#4a90b8', verdant: '#5f9e5a', stone: '#8a8378',
  gale: '#8fb8c9', volt: '#d9c04a', gloom: '#7a6b96', lumen: '#e0d090', rift: '#b05ad0',
};

const MONO = 'ui-monospace, Menlo, Consolas, monospace';
const title = (s) => String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Wrap text to a width, clamped to `maxLines` with an ellipsis. The clamp is not
 * optional: a long family blurb ran straight out of the bottom of its panel, and
 * the card has no scrollbar to save it.
 */
function wrap(ctx, text, x, y, maxWidth, lineHeight, maxLines = 3) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = word; }
    else line = test;
  }
  if (line) lines.push(line);

  const shown = lines.slice(0, maxLines);
  if (lines.length > maxLines && shown.length) {
    let last = shown[shown.length - 1];
    while (last && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1).trimEnd();
    shown[shown.length - 1] = `${last}…`;
  }
  shown.forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight));
  return shown.length * lineHeight;
}

function chip(ctx, x, y, text, colour) {
  ctx.font = `600 26px ${MONO}`;
  const w = ctx.measureText(text).width + 34;
  ctx.strokeStyle = colour;
  ctx.fillStyle = `${colour}22`;
  ctx.lineWidth = 2;
  roundRect(ctx, x, y, w, 46, 23);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = colour;
  ctx.textAlign = 'center';
  ctx.fillText(text, x + w / 2, y + 31);
  ctx.textAlign = 'left';
  return w + 12;
}

/**
 * A stand-in portrait. The bible wants "a 3D model rendered from your specimen";
 * what this build has is the silhouette the arena draws, scaled to the specimen's
 * measured height so a 98th-percentile animal genuinely looks like one.
 */
function drawSilhouette(ctx, cx, cy, radius, tint, weakPoints) {
  ctx.save();
  ctx.translate(cx, cy);

  const grad = ctx.createRadialGradient(0, 0, radius * 0.2, 0, 0, radius * 1.8);
  grad.addColorStop(0, `${tint}55`);
  grad.addColorStop(1, `${tint}00`);
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(0, 0, radius * 1.8, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = tint;
  ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#00000066';
  ctx.lineWidth = 4;
  ctx.stroke();

  // Facing wedge, the same cue the arena uses.
  ctx.fillStyle = '#ffffff22';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, radius, -0.5, 0.5);
  ctx.closePath();
  ctx.fill();

  weakPoints.forEach((_, i) => {
    const a = -0.9 + (i / Math.max(1, weakPoints.length - 1 || 1)) * 1.8;
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    ctx.arc(Math.cos(a) * radius * 0.62, Math.sin(a) * radius * 0.62, radius * 0.11, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.restore();
}

/**
 * Build the card.
 *
 * `report` is a plain object — species, outcome, method, heightM, percentile,
 * hpFraction, biome, at — so this module needs no access to profile state and can
 * be unit-driven from a test.
 */
export function drawFieldReport(canvas, report) {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const sp = report.species;
  /*
   * A rift-touched specimen takes Rift's colour on its card, because the card is
   * the thing people show each other and that is the whole reward. The silhouette
   * and the chips both read from this one value.
   */
  const tint = report.riftTouched ? '#b05ad0' : (ELEMENT_TINT[sp.elements[0]] ?? '#c2622f');
  const taken = report.outcome === 'catalogued';

  ctx.fillStyle = '#0e1013';
  ctx.fillRect(0, 0, W, H);

  // A wash of the species' element, so a Gloom card and an Ember card read apart
  // at thumbnail size.
  const wash = ctx.createLinearGradient(0, 0, W, H);
  wash.addColorStop(0, `${tint}26`);
  wash.addColorStop(0.55, '#0e101300');
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = LINE;
  ctx.lineWidth = 3;
  roundRect(ctx, 26, 26, W - 52, H - 52, 28);
  ctx.stroke();

  // ---- header
  ctx.textAlign = 'left';
  ctx.fillStyle = FAINT;
  ctx.font = `700 26px ${MONO}`;
  ctx.fillText('RIFTBORN  ·  FIELD REPORT', 72, 106);

  ctx.fillStyle = taken ? '#69d2e7' : '#d9463f';
  ctx.font = `700 34px ${MONO}`;
  ctx.textAlign = 'right';
  ctx.fillText(taken ? 'CATALOGUED' : 'CULLED', W - 72, 106);
  ctx.textAlign = 'left';

  // ---- portrait
  // Scaled by the specimen's percentile, so the runt and the record-breaker are
  // visibly different animals on their cards.
  const portrait = 128 + 46 * Math.max(0, Math.min(1, report.percentile));
  drawSilhouette(ctx, W / 2, 400, portrait, tint, sp.weak_points ?? []);

  // ---- name
  ctx.textAlign = 'center';
  ctx.fillStyle = INK;
  ctx.font = `700 82px ${MONO}`;
  ctx.fillText(sp.name.toUpperCase(), W / 2, 660);

  ctx.fillStyle = DIM;
  ctx.font = `400 30px ${MONO}`;
  ctx.fillText(`№ ${String(sp.dex).padStart(3, '0')}  ·  ${sp.elements.map(title).join(' / ')}  ·  ${title(sp.size)}`,
               W / 2, 706);
  ctx.textAlign = 'left';

  // ---- chips
  let cx = 72;
  cx += chip(ctx, cx, 748, `${report.heightM.toFixed(2)} m`, tint);
  cx += chip(ctx, cx, 748, `${ordinal(Math.round(report.percentile * 100))} pct`, tint);
  if (report.riftTouched) cx += chip(ctx, cx, 748, 'RIFT-TOUCHED', '#dfa0f0');
  if (taken) chip(ctx, cx, 748, `${Math.round(report.hpFraction * 100)}% HP left`, '#69d2e7');

  // ---- detail panel
  ctx.fillStyle = PANEL;
  roundRect(ctx, 72, 830, W - 144, 400, 20);
  ctx.fill();
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 2;
  ctx.stroke();

  const rows = [
    ['METHOD', report.method ?? '—'],
    // Neighbourhood at most. This is the whole location rule, and it is the only
    // place in the card that touches where the player was.
    ['AREA', report.biome ? `${title(report.biome)} — approximate` : 'undisclosed'],
    ['DATE', new Date(report.at ?? Date.now()).toLocaleDateString(undefined,
              { year: 'numeric', month: 'short', day: 'numeric' })],
  ];
  rows.forEach(([k, v], i) => {
    const y = 892 + i * 70;
    ctx.fillStyle = FAINT;
    ctx.font = `600 24px ${MONO}`;
    ctx.fillText(k, 112, y);
    ctx.fillStyle = INK;
    ctx.font = `400 30px ${MONO}`;
    ctx.fillText(v, 300, y);
  });

  ctx.fillStyle = DIM;
  ctx.font = `400 26px ${MONO}`;
  wrap(ctx, report.note ?? sp.family_blurb ?? '', 112, 1112, W - 224, 36);

  // ---- footer
  ctx.fillStyle = FAINT;
  ctx.font = `400 24px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.fillText(report.footer ?? 'Location shown to neighbourhood only.', W / 2, 1272);
  ctx.textAlign = 'left';

  return canvas;
}

function ordinal(n) {
  const v = Math.max(1, Math.min(99, Math.round(n)));
  if (v % 100 >= 11 && v % 100 <= 13) return `${v}th`;
  return `${v}${['th', 'st', 'nd', 'rd'][v % 10] ?? 'th'}`;
}

/** Render to a PNG blob. Resolves null if the canvas cannot be encoded. */
export function toPng(canvas) {
  return new Promise((resolve) => {
    try { canvas.toBlob((b) => resolve(b), 'image/png'); } catch { resolve(null); }
  });
}
