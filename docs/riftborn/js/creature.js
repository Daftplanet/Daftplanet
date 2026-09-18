/*
 * RIFTBORN — the monsters, drawn.
 *
 * voxel.js builds a creature out of its data: body plan from the family, palette
 * from the element, scale from the size class. That is a generator, and a
 * generator's ceiling is low — every Cinder is the same animal in a different
 * colour, because nothing in the data says what a Cinder *looks* like.
 *
 * These are drawn one at a time instead. Each species has its own function with
 * its own curves, and a Sootpup is a different shape from a Brinelet because
 * somebody decided what each one is, not because a parameter differed.
 *
 * That has a cost worth stating plainly: a new species no longer gets art for
 * free. Adding one to monsters.json gives it stats, spawns, evolution and a
 * Codex entry, and then it needs a drawing. Species without one fall back to the
 * voxel model, so the game is never missing a monster — art arrives a batch at a
 * time rather than all at once.
 *
 * The house style, so the batches match:
 *
 *   - A heavy outline in a very dark version of the element, never pure black.
 *     Pure black outlines flatten everything to the same weight and make a
 *     nine-colour cast look like a sticker sheet.
 *   - Flat colour in bands, not gradients. Base, one shadow, one light. A
 *     gradient reads as plastic at sprite size and costs more to draw.
 *   - The light comes from the upper left, everywhere, always. Inconsistent
 *     lighting is the fastest way to make a set look like several sets.
 *   - Big eyes with a highlight. This is the single biggest difference between
 *     "creature" and "shape", and it is nearly free.
 *   - The second element is the marking colour, which is the rule the voxel
 *     models already used — a dual type stays legible from the model.
 */

import { ELEMENT_RAMP } from './voxel.js';

/* The design space every drawing is authored in, then scaled to whatever the
 * caller asked for. Working in a fixed box means a Sootpup and a Vulcarne are
 * drawn at the same numbers and differ by their actual proportions. */
const BOX = 100;

function mix(a, b, k) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const f = k < 0 ? 0 : k > 1 ? 1 : k;
  const r = Math.round((pa >> 16) * (1 - f) + (pb >> 16) * f);
  const g = Math.round(((pa >> 8) & 255) * (1 - f) + ((pb >> 8) & 255) * f);
  const bl = Math.round((pa & 255) * (1 - f) + (pb & 255) * f);
  return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, '0')}`;
}

/** Base, shadow, light and line for one element, plus the second element's accent. */
function palette(species, { riftTouched = false, pull = 0.55 } = {}) {
  const [e1, e2] = species.elements;
  let ramp = ELEMENT_RAMP[e1] ?? ELEMENT_RAMP.stone;
  if (riftTouched) ramp = ramp.map((c, i) => mix(c, ELEMENT_RAMP.rift[i], pull));
  const accentRamp = e2 ? (ELEMENT_RAMP[e2] ?? ramp) : null;
  return {
    line: mix(ramp[0], '#000000', 0.45),
    dark: ramp[1],
    base: ramp[2],
    light: ramp[3],
    // A single-element creature still needs a marking colour that is not just a
    // paler version of itself, which is the mistake the voxel markings made.
    accent: accentRamp ? accentRamp[2] : mix(ramp[3], '#ffffff', 0.45),
    accentDark: accentRamp ? accentRamp[1] : mix(ramp[2], '#ffffff', 0.2),
    weak: '#ffd23f',
  };
}

/**
 * Draw a shape the house way: flat fill, one shadow band, then the outline.
 *
 * `path` is called to lay the shape down and may be called more than once —
 * once to fill, once to clip the shadow into, once to stroke — so it must not
 * do anything but describe the outline.
 */
function form(ctx, path, p, { fill = null, shade = 0.55, line = 2.6, lit = null } = {}) {
  const body = fill ?? p.base;
  ctx.save();
  path(); ctx.fillStyle = body; ctx.fill();

  // The shadow is the same shape, pushed down and right, clipped back inside.
  if (shade > 0) {
    ctx.save();
    path(); ctx.clip();
    ctx.translate(BOX * 0.10, BOX * 0.12);
    path();
    ctx.fillStyle = mix(body, p.line, shade * 0.45);
    ctx.fill();
    ctx.restore();
  }
  // And the light catch, up and left, the same way.
  if (lit) {
    ctx.save();
    path(); ctx.clip();
    ctx.translate(-BOX * 0.07, -BOX * 0.09);
    path();
    ctx.fillStyle = mix(body, lit, 0.5);
    ctx.fill();
    ctx.restore();
  }
  if (line > 0) { path(); ctx.strokeStyle = p.line; ctx.lineWidth = line; ctx.lineJoin = 'round'; ctx.stroke(); }
  ctx.restore();
}

/** An ellipse as a path function, which is most of what a creature is made of. */
const oval = (ctx, x, y, rx, ry, rot = 0) => () => {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
};

/** A closed shape through points, smoothed. Corners get rounded by the midpoints. */
const curve = (ctx, pts) => () => {
  ctx.beginPath();
  const n = pts.length;
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let [sx, sy] = mid(pts[n - 1], pts[0]);
  ctx.moveTo(sx, sy);
  for (let i = 0; i < n; i++) {
    const [mx, my] = mid(pts[i], pts[(i + 1) % n]);
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  ctx.closePath();
};

/**
 * An eye, which is the whole difference between a creature and a shape.
 *
 * The highlight is not decoration: a pupil without one reads as dead, and two
 * pupils that both catch the light in the same place read as alive. It costs one
 * arc.
 */
function eye(ctx, x, y, r, { look = 0, angry = false, glow = null } = {}) {
  ctx.save();
  ctx.beginPath(); ctx.ellipse(x, y, r, r * 1.08, 0, 0, Math.PI * 2);
  ctx.fillStyle = glow ?? '#fdfdfd'; ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = r * 0.22; ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(x + look * r * 0.3, y + r * 0.08, r * 0.46, r * 0.62, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#17141a'; ctx.fill();

  ctx.beginPath();
  ctx.arc(x - r * 0.22, y - r * 0.3, r * 0.26, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff'; ctx.fill();

  if (angry) {
    // A brow turns the same eye from startled to hostile, which is how the
    // aggression in the bestiary reaches the picture.
    ctx.beginPath();
    ctx.moveTo(x - r * 1.25, y - r * 1.15);
    ctx.lineTo(x + r * 0.9, y - r * 0.5);
    ctx.lineWidth = r * 0.5; ctx.strokeStyle = '#17141a'; ctx.lineCap = 'round';
    ctx.stroke();
  }
  ctx.restore();
}

/** The gold glint on a weak point, so the thing you aim at is visible on the art. */
function weakSpot(ctx, x, y, r, p) {
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = p.weak; ctx.globalAlpha = 0.9; ctx.fill();
  ctx.globalAlpha = 1;
  ctx.beginPath(); ctx.arc(x - r * 0.25, y - r * 0.28, r * 0.35, 0, Math.PI * 2);
  ctx.fillStyle = '#fff6cf'; ctx.fill();
  ctx.restore();
}

/* ------------------------------------------------------------------ the cast */

const ART = {
  /*
   * Sootpup — Cinder, stage 1. A soot-covered pup: all head, stubby legs, and a
   * tail like a struck match. Stage 1s read young by having a head too big for
   * the body, which is the oldest trick there is and it works.
   */
  sootpup(ctx, p) {
    // tail, behind everything
    form(ctx, curve(ctx, [[78, 62], [92, 48], [96, 30], [88, 34], [84, 50], [72, 58]]), p,
         { fill: p.accent, shade: 0.4, line: 2.2 });
    // hind and fore legs
    for (const lx of [30, 62]) {
      form(ctx, curve(ctx, [[lx - 7, 66], [lx + 7, 66], [lx + 8, 86], [lx - 8, 86]]), p,
           { fill: p.dark, shade: 0.3, line: 2.2 });
    }
    // body
    form(ctx, oval(ctx, 50, 62, 26, 19), p, { shade: 0.5, lit: p.light });
    // head, deliberately oversized
    form(ctx, oval(ctx, 40, 36, 24, 21), p, { shade: 0.45, lit: p.light });
    // ears
    form(ctx, curve(ctx, [[24, 24], [30, 8], [40, 20]]), p, { fill: p.dark, shade: 0.3, line: 2.2 });
    form(ctx, curve(ctx, [[50, 18], [62, 8], [60, 26]]), p, { fill: p.dark, shade: 0.3, line: 2.2 });
    // muzzle — the weak point in the data
    form(ctx, oval(ctx, 30, 44, 12, 9), p, { fill: p.light, shade: 0.35, line: 2.2 });
    weakSpot(ctx, 24, 44, 3.4, p);
    eye(ctx, 36, 32, 6.2, { look: -0.4 });
    eye(ctx, 53, 34, 5.4, { look: -0.3 });
  },

  /*
   * Cinderfang — Cinder, stage 2. The pup grown lean: longer muzzle, a real
   * stance, and the ember banding that says where the heat lives. Evolution has
   * to be visible at a glance, so the silhouette changes rather than the size.
   */
  cinderfang(ctx, p) {
    form(ctx, curve(ctx, [[76, 54], [94, 42], [98, 18], [90, 22], [86, 42], [70, 50]]), p,
         { fill: p.accent, shade: 0.4, line: 2.4 });
    for (const [lx, h] of [[26, 88], [40, 84], [62, 88], [74, 84]]) {
      form(ctx, curve(ctx, [[lx - 5, 58], [lx + 6, 58], [lx + 5, h], [lx - 6, h]]), p,
           { fill: p.dark, shade: 0.3, line: 2.2 });
    }
    form(ctx, curve(ctx, [[24, 56], [44, 42], [70, 44], [80, 56], [66, 70], [36, 70]]), p,
         { shade: 0.5, lit: p.light });
    // banding: the heat under the hide
    ctx.save();
    curve(ctx, [[24, 56], [44, 42], [70, 44], [80, 56], [66, 70], [36, 70]])();
    ctx.clip();
    ctx.fillStyle = p.accent;
    for (const bx of [40, 54, 68]) {
      ctx.beginPath();
      ctx.ellipse(bx, 52, 4.5, 13, 0.25, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    // head and a long muzzle
    form(ctx, curve(ctx, [[14, 36], [30, 22], [46, 28], [44, 46], [26, 50]]), p,
         { shade: 0.45, lit: p.light });
    form(ctx, curve(ctx, [[6, 40], [18, 32], [22, 44], [10, 46]]), p,
         { fill: p.light, shade: 0.35, line: 2.2 });
    form(ctx, curve(ctx, [[30, 22], [36, 6], [44, 22]]), p, { fill: p.dark, shade: 0.3, line: 2.2 });
    weakSpot(ctx, 30, 48, 3.2, p);     // throat
    eye(ctx, 28, 34, 5.4, { look: -0.5, angry: true });
  },

  /*
   * Brinelet — Brine, stage 1. A bell and four tendrils. The whole read is
   * translucency, which flat colour cannot do, so it is faked the way cel
   * animation fakes it: a paler rim inside the outline and a bright bell edge.
   */
  brinelet(ctx, p) {
    for (const [tx, sway, len] of [[28, -7, 30], [39, 5, 36], [50, -4, 40], [61, 6, 35], [72, -6, 28]]) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(tx, 54);
      // Two bends, not one: a single curve reads as a bent rod, and two reads
      // as something drifting.
      ctx.bezierCurveTo(tx + sway, 54 + len * 0.4, tx - sway, 54 + len * 0.7, tx + sway * 1.4, 54 + len);
      ctx.strokeStyle = p.line; ctx.lineWidth = 5.6; ctx.lineCap = 'round'; ctx.stroke();
      ctx.strokeStyle = p.light; ctx.lineWidth = 2.8; ctx.stroke();
      ctx.restore();
    }
    // the bell
    const bell = curve(ctx, [[18, 52], [22, 26], [50, 14], [78, 26], [82, 52], [50, 62]]);
    form(ctx, bell, p, { shade: 0.4, lit: p.light });
    ctx.save();
    bell(); ctx.clip();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = mix(p.light, '#ffffff', 0.55);
    ctx.beginPath(); ctx.ellipse(38, 28, 15, 8, -0.4, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
    weakSpot(ctx, 50, 46, 5, p);       // the bell, in the data
    eye(ctx, 40, 40, 5.6, { look: 0.2 });
    eye(ctx, 61, 40, 5.6, { look: 0.2 });
  },

  /*
   * Sporelet — Myco, stage 1. A cap on a stubby stalk, with spore freckles. The
   * face sits low on the stalk rather than on the cap, which is what stops it
   * reading as a mushroom with eyes drawn on it.
   */
  sporelet(ctx, p) {
    form(ctx, curve(ctx, [[38, 54], [62, 54], [64, 84], [36, 84]]), p,
         { fill: p.light, shade: 0.35 });
    const cap = curve(ctx, [[14, 54], [20, 30], [50, 16], [80, 30], [86, 54], [50, 60]]);
    form(ctx, cap, p, { shade: 0.45, lit: p.light });
    ctx.save();
    cap(); ctx.clip();
    ctx.fillStyle = p.accent;
    for (const [sx, sy, sr] of [[32, 34, 6], [56, 28, 7.5], [70, 42, 5], [44, 46, 4.5]]) {
      ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    eye(ctx, 43, 66, 5, { look: 0.1 });
    eye(ctx, 58, 66, 5, { look: 0.1 });
    // a small mouth, because a stage 1 that looks pleased is a stage 1 people keep
    ctx.save();
    ctx.beginPath(); ctx.arc(50.5, 73, 4.2, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.strokeStyle = p.line; ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.stroke();
    ctx.restore();
    weakSpot(ctx, 50, 22, 3.6, p);
  },

  /*
   * Glimmerfly — Lumen, stage 1. Four wings and a lantern abdomen. Drawn facing
   * us rather than in profile, because a flier in profile is a smear and a flier
   * head-on is a creature.
   */
  glimmerfly(ctx, p) {
    for (const [wx, rot] of [[26, -0.5], [74, 0.5]]) {
      form(ctx, oval(ctx, wx, 34, 22, 12, rot), p,
           { fill: mix(p.light, '#ffffff', 0.35), shade: 0.2, line: 2.2 });
      form(ctx, oval(ctx, wx + (wx < 50 ? 4 : -4), 56, 16, 9, -rot), p,
           { fill: mix(p.light, '#ffffff', 0.2), shade: 0.2, line: 2.2 });
    }
    form(ctx, oval(ctx, 50, 58, 12, 20), p, { shade: 0.45, lit: p.light });
    // the lantern, which is also the weak point
    ctx.save();
    const glow = ctx.createRadialGradient(50, 70, 1, 50, 70, 16);
    glow.addColorStop(0, 'rgba(255,244,196,0.95)');
    glow.addColorStop(1, 'rgba(255,244,196,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(50, 70, 16, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    weakSpot(ctx, 50, 70, 5.5, p);
    form(ctx, oval(ctx, 50, 32, 13, 12), p, { shade: 0.4, lit: p.light });
    ctx.save();
    for (const dx of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(50 + dx * 5, 23);
      ctx.quadraticCurveTo(50 + dx * 15, 13, 50 + dx * 11, 5);
      ctx.strokeStyle = p.line; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.stroke();
      // The tip is outlined in the same line colour, so it belongs to the stalk
      // instead of hovering beside it.
      ctx.beginPath(); ctx.arc(50 + dx * 11, 5, 3.4, 0, Math.PI * 2);
      ctx.fillStyle = p.accent; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = p.line; ctx.stroke();
    }
    ctx.restore();
    eye(ctx, 45, 31, 5, { look: 0 });
    eye(ctx, 56, 31, 5, { look: 0 });
  },

  /*
   * Pebblit — Crag, stage 1. A rock that turned out to be alive. The trick is
   * that the silhouette has to be obviously a rock and obviously not a rock at
   * the same time: flat faceted shapes, then two eyes and stubby feet.
   */
  pebblit(ctx, p) {
    for (const fx of [36, 62]) {
      form(ctx, curve(ctx, [[fx - 8, 74], [fx + 8, 74], [fx + 9, 86], [fx - 9, 86]]), p,
           { fill: p.dark, shade: 0.3, line: 2.2 });
    }
    const rock = curve(ctx, [[16, 62], [24, 34], [46, 20], [72, 26], [86, 48], [80, 74], [46, 80], [22, 74]]);
    form(ctx, rock, p, { shade: 0.5, lit: p.light });
    // facets, so it reads as stone rather than as a potato
    ctx.save();
    rock(); ctx.clip();
    ctx.strokeStyle = mix(p.base, p.line, 0.45); ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(24, 34); ctx.lineTo(44, 48); ctx.lineTo(86, 46);
    ctx.moveTo(44, 48); ctx.lineTo(40, 80);
    ctx.stroke();
    ctx.fillStyle = p.accent;
    ctx.beginPath(); ctx.moveTo(62, 26); ctx.lineTo(80, 40); ctx.lineTo(66, 46); ctx.closePath(); ctx.fill();
    ctx.restore();
    eye(ctx, 38, 58, 6, { look: 0.2 });
    eye(ctx, 60, 58, 6, { look: 0.2 });
    weakSpot(ctx, 50, 30, 3.4, p);
  },

  /*
   * Slagmite — Slag, stage 1. A lump of cooling slag that turned out to be
   * alive. Bottom-heavy and craggy, so it reads as heavy; the heat shows only
   * through the cracks, which is what makes the crust look thick.
   */
  slagmite(ctx, p) {
    const crust = curve(ctx, [[14, 74], [20, 50], [38, 36], [62, 34], [82, 48], [88, 74], [50, 84]]);
    form(ctx, crust, p, { fill: p.accent, shade: 0.5, lit: p.accentDark });
    ctx.save();
    crust(); ctx.clip();
    // The seams, glowing. Drawn as a bright line under a wider dark one so they
    // read as depth rather than as scribble.
    ctx.lineCap = 'round';
    for (const seam of [[[20, 46], [36, 62], [40, 80]], [[58, 38], [66, 58], [86, 66]], [[44, 70], [62, 76]]]) {
      for (const [w, col] of [[6.5, p.line], [3, p.light]]) {
        ctx.beginPath();
        ctx.moveTo(seam[0][0], seam[0][1]);
        for (let i = 1; i < seam.length; i++) ctx.lineTo(seam[i][0], seam[i][1]);
        ctx.strokeStyle = col; ctx.lineWidth = w; ctx.stroke();
      }
    }
    ctx.restore();
    weakSpot(ctx, 64, 58, 4, p);
    eye(ctx, 38, 48, 5.6, { look: 0.2 });
    eye(ctx, 60, 46, 5.2, { look: 0.2 });
  },

  /*
   * Frostnib — Rime, stage 1. A small cold thing with a breath sac at the
   * throat, which is its weak point and also the reason it has a silhouette:
   * without the sac it would be another round pup.
   */
  frostnib(ctx, p) {
    for (const lx of [36, 60]) {
      form(ctx, curve(ctx, [[lx - 6, 70], [lx + 6, 70], [lx + 7, 86], [lx - 7, 86]]), p,
           { fill: p.dark, shade: 0.3, line: 2.2 });
    }
    form(ctx, oval(ctx, 52, 60, 22, 17), p, { shade: 0.5, lit: p.light });
    // the sac, pale and round, hanging under the chin
    form(ctx, oval(ctx, 34, 60, 13, 12), p,
         { fill: mix(p.accent, '#ffffff', 0.45), shade: 0.3, line: 2.2 });
    weakSpot(ctx, 30, 62, 3.6, p);
    form(ctx, oval(ctx, 36, 38, 19, 17), p, { shade: 0.45, lit: p.light });
    // ice tufts instead of ears — three spikes, uneven, so it is not symmetrical
    ctx.save();
    ctx.fillStyle = p.accent; ctx.strokeStyle = p.line; ctx.lineWidth = 2;
    for (const [tx, ty, h] of [[26, 24, 16], [37, 18, 21], [48, 24, 14]]) {
      ctx.beginPath();
      ctx.moveTo(tx - 5, ty); ctx.lineTo(tx, ty - h); ctx.lineTo(tx + 5, ty);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
    eye(ctx, 30, 38, 5.4, { look: -0.4 });
    eye(ctx, 45, 39, 4.8, { look: -0.3 });
  },

  /*
   * Mycelid — Myco, stage 1. Sporelet's sour cousin: a thin stalk with a
   * drooping cap and gloom under the gills. Same family of shape, different
   * posture — Sporelet stands up and this one hangs, which is most of what
   * separates a cheerful fungus from an unpleasant one.
   */
  mycelid(ctx, p) {
    // A stalk thick enough to carry a face, and bent, so it slouches.
    form(ctx, curve(ctx, [[40, 48], [60, 48], [64, 88], [38, 88]]), p,
         { fill: p.light, shade: 0.42 });
    // Gills first, so they show under the cap rim instead of being clipped away
    // inside it — which is where the first version hid them.
    ctx.save();
    ctx.strokeStyle = p.accent; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
    for (let i = 0; i < 9; i++) {
      const gx = 26 + i * 6;
      ctx.beginPath(); ctx.moveTo(gx, 40); ctx.lineTo(gx + (gx - 50) * 0.06, 52); ctx.stroke();
    }
    ctx.restore();
    // A proper dome with a drooping rim, narrower than the old arc.
    const cap = curve(ctx, [[24, 44], [26, 26], [50, 14], [74, 26], [76, 44], [62, 38], [50, 40], [38, 38]]);
    form(ctx, cap, p, { shade: 0.5, lit: p.light });
    ctx.save();
    cap(); ctx.clip();
    ctx.fillStyle = mix(p.base, p.line, 0.4);
    ctx.beginPath(); ctx.ellipse(50, 44, 30, 9, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    weakSpot(ctx, 50, 62, 3.6, p);
    eye(ctx, 44, 64, 4.8, { look: 0.1, angry: true });
    eye(ctx, 58, 64, 4.8, { look: 0.1, angry: true });
  },

  /*
   * Gustling — Gale, stage 1. A puff of moving air. Nothing here has a hard
   * edge except the outline itself, and the trailing wisp is what says it is
   * going somewhere rather than sitting there.
   */
  gustling(ctx, p) {
    ctx.save();
    ctx.strokeStyle = p.accent; ctx.lineWidth = 3.4; ctx.lineCap = 'round';
    for (const [wy, len] of [[44, 26], [58, 20]]) {
      ctx.beginPath();
      ctx.moveTo(84, wy);
      ctx.quadraticCurveTo(84 + len * 0.6, wy - 6, 84 + len, wy - 2);
      ctx.stroke();
    }
    ctx.restore();
    const puff = curve(ctx, [[18, 52], [22, 32], [40, 22], [60, 24], [76, 36], [78, 56], [58, 68], [34, 66]]);
    form(ctx, puff, p, { shade: 0.4, lit: p.light });
    // a comma wing on each side, the shape that says "wind" fastest
    for (const [wx, dir] of [[26, -1], [72, 1]]) {
      form(ctx, curve(ctx, [[wx, 40], [wx + dir * 16, 26], [wx + dir * 10, 44]]), p,
           { fill: mix(p.light, '#ffffff', 0.3), shade: 0.25, line: 2.2 });
    }
    weakSpot(ctx, 30, 42, 3.4, p);
    eye(ctx, 42, 46, 5.6, { look: 0.3 });
    eye(ctx, 60, 46, 5.6, { look: 0.3 });
  },

  /*
   * Sparkmite — Volt, stage 1. A bright core with legs. The corona is drawn as
   * spikes of two lengths: an even ring reads as a sun, and an uneven one reads
   * as something crackling.
   */
  sparkmite(ctx, p) {
    ctx.save();
    ctx.strokeStyle = p.line; ctx.lineWidth = 3.2; ctx.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.4;
      ctx.beginPath();
      ctx.moveTo(50 + Math.cos(a) * 16, 54 + Math.sin(a) * 14);
      ctx.lineTo(50 + Math.cos(a) * 30, 54 + Math.sin(a) * 30);
      ctx.stroke();
    }
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = p.light; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const len = i % 2 ? 34 : 24;
      ctx.beginPath();
      ctx.moveTo(50 + Math.cos(a) * 18, 54 + Math.sin(a) * 17);
      ctx.lineTo(50 + Math.cos(a) * len, 54 + Math.sin(a) * len);
      ctx.stroke();
    }
    ctx.restore();
    form(ctx, oval(ctx, 50, 54, 20, 18), p, { shade: 0.4, lit: p.light });
    ctx.save();
    const glow = ctx.createRadialGradient(50, 54, 1, 50, 54, 15);
    glow.addColorStop(0, 'rgba(255,246,190,0.95)');
    glow.addColorStop(1, 'rgba(255,246,190,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(50, 54, 15, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    weakSpot(ctx, 50, 54, 5.5, p);
    eye(ctx, 42, 50, 5, { look: 0.2 });
    eye(ctx, 59, 50, 5, { look: 0.2 });
  },

  /*
   * Shadelet — Gloom, stage 1. A shadow with an opinion. The bottom edge is
   * ragged rather than closed, so it looks like it is soaking into the ground
   * instead of resting on it, and the eyes are the only bright thing on it.
   */
  shadelet(ctx, p) {
    const blob = curve(ctx, [
      [26, 58], [28, 34], [50, 20], [72, 34], [74, 60],
      [66, 72], [60, 62], [50, 78], [40, 62], [34, 74],
    ]);
    form(ctx, blob, p, { shade: 0.5, lit: p.light });
    // a faint inner shadow, so it is not a flat cut-out
    ctx.save();
    blob(); ctx.clip();
    ctx.fillStyle = mix(p.base, p.line, 0.55);
    ctx.beginPath(); ctx.ellipse(62, 62, 26, 22, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // wisps coming off the top
    ctx.save();
    ctx.strokeStyle = p.accent; ctx.lineWidth = 2.6; ctx.lineCap = 'round';
    for (const [wx, wy] of [[36, 26], [50, 18], [64, 26]]) {
      ctx.beginPath();
      ctx.moveTo(wx, wy);
      ctx.quadraticCurveTo(wx + 4, wy - 10, wx - 2, wy - 16);
      ctx.stroke();
    }
    ctx.restore();
    eye(ctx, 41, 46, 6.4, { look: 0.2, glow: '#e9defb' });
    eye(ctx, 60, 46, 6.4, { look: 0.2, glow: '#e9defb' });
  },

  /*
   * Riftspawn — Rift, stage 1. Not an animal: a piece of somewhere else,
   * held together badly. Everything is straight lines and hard angles, because
   * every other creature here is curves and that is what makes this one wrong.
   */
  riftspawn(ctx, p) {
    ctx.save();
    ctx.strokeStyle = p.light; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
    ctx.globalAlpha = 0.75;
    for (const [ax, ay, bx, by] of [[18, 30, 10, 18], [82, 34, 92, 20], [20, 70, 8, 80], [80, 72, 92, 84]]) {
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }
    ctx.restore();
    const shard = () => {
      ctx.beginPath();
      ctx.moveTo(50, 12); ctx.lineTo(78, 34); ctx.lineTo(72, 72);
      ctx.lineTo(50, 88); ctx.lineTo(28, 72); ctx.lineTo(22, 34);
      ctx.closePath();
    };
    form(ctx, shard, p, { shade: 0.5, lit: p.light });
    // the seam, which is the weak point and the only thing holding it shut
    ctx.save();
    shard(); ctx.clip();
    ctx.strokeStyle = mix(p.light, '#ffffff', 0.5); ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(50, 12); ctx.lineTo(44, 40); ctx.lineTo(56, 58); ctx.lineTo(50, 88);
    ctx.stroke();
    ctx.strokeStyle = mix(p.base, p.line, 0.5); ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(22, 34); ctx.lineTo(44, 40); ctx.moveTo(78, 34); ctx.lineTo(56, 42);
    ctx.stroke();
    ctx.restore();
    weakSpot(ctx, 52, 50, 4.4, p);
    eye(ctx, 40, 44, 5, { look: 0.3, angry: true, glow: '#f0d8fa' });
    eye(ctx, 62, 46, 5, { look: 0.3, angry: true, glow: '#f0d8fa' });
  },
};

/** Whether this species has been drawn yet, or still falls back to the model. */
export const hasArt = (id) => Object.prototype.hasOwnProperty.call(ART, id);

/** How many of the bestiary are drawn — for the Codex, and for knowing where we are. */
export const drawnCount = () => Object.keys(ART).length;

const cache = new Map();

/**
 * A drawn sprite, cached per (species, size, variant).
 *
 * Same contract as the voxel sprites it stands in for: one canvas per distinct
 * request, handed back to every caller that asks again.
 */
export function spriteFor(species, px, { riftTouched = false, biome = null } = {}) {
  const key = `${species.id}:${px}:${riftTouched ? 'r' : ''}:${biome ?? ''}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const c = document.createElement('canvas');
  c.width = px; c.height = px;
  const ctx = c.getContext('2d');
  ctx.save();
  ctx.scale(px / BOX, px / BOX);
  drawCreature(ctx, species, { riftTouched, biome });
  ctx.restore();
  cache.set(key, c);
  return c;
}

export function clearCreatureCache() { cache.clear(); }

/** Draw one creature into the 100×100 design box at the current transform. */
export function drawCreature(ctx, species, opts = {}) {
  const draw = ART[species.id];
  if (!draw) return false;
  const p = palette(species, opts);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  draw(ctx, p);
  return true;
}
