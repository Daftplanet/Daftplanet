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

  /* ---------------------------------------------------------- stage two
   *
   * An evolution has to read as the same animal grown up, or the Codex looks
   * like a list of strangers. Each of these keeps one thing from its stage 1 and
   * changes the rest: Magmaw keeps Slagmite's cracked crust, Rimeclaw keeps
   * Frostnib's ice spikes but wears them down its back, Nightmaw is Shadelet's
   * ragged edge with something opened in the middle of it.
   *
   * The other half of an evolution is that it must be obvious at a glance which
   * one is the grown one. Stage 1s are round and top-heavy; stage 2s get a
   * length, a stance, and a working end — a maw, a claw, a coil.
   */

  /* Magmaw — Slag, stage 2. The crust, stretched, and now with something open
   * in the front of it. The seams run the length of the body so the heat reads
   * as being inside rather than painted on. */
  magmaw(ctx, p) {
    for (const lx of [32, 56, 76]) {
      form(ctx, curve(ctx, [[lx - 6, 64], [lx + 6, 64], [lx + 7, 84], [lx - 7, 84]]), p,
           { fill: mix(p.accent, p.line, 0.25), shade: 0.3, line: 2.2 });
    }
    const body = curve(ctx, [[20, 54], [36, 36], [66, 34], [88, 48], [84, 68], [50, 74], [24, 68]]);
    form(ctx, body, p, { fill: p.accent, shade: 0.5, lit: p.accentDark });
    ctx.save();
    body(); ctx.clip();
    ctx.lineCap = 'round';
    for (const seam of [[[28, 52], [50, 46], [74, 50]], [[34, 66], [58, 62], [80, 62]]]) {
      for (const [w, col] of [[7, p.line], [3.2, p.light]]) {
        ctx.beginPath(); ctx.moveTo(seam[0][0], seam[0][1]);
        for (let i = 1; i < seam.length; i++) ctx.lineTo(seam[i][0], seam[i][1]);
        ctx.strokeStyle = col; ctx.lineWidth = w; ctx.stroke();
      }
    }
    ctx.restore();
    // the maw, which is the weak point and the whole silhouette
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(22, 48); ctx.lineTo(6, 40); ctx.lineTo(8, 62); ctx.lineTo(24, 62);
    ctx.closePath();
    ctx.fillStyle = p.light; ctx.fill();
    ctx.strokeStyle = p.line; ctx.lineWidth = 2.4; ctx.stroke();
    ctx.restore();
    weakSpot(ctx, 15, 51, 4, p);
    eye(ctx, 34, 46, 5, { look: -0.5, angry: true });
  },

  /* Tidecoil — Brine, stage 2. The bell has become a hood over a coiled body,
   * and the four drifting tendrils have become one working siphon. */
  tidecoil(ctx, p) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(52, 56);
    ctx.bezierCurveTo(78, 60, 84, 84, 58, 86);
    ctx.bezierCurveTo(36, 88, 30, 72, 44, 70);
    ctx.strokeStyle = p.line; ctx.lineWidth = 15; ctx.lineCap = 'round'; ctx.stroke();
    ctx.strokeStyle = p.base; ctx.lineWidth = 10.5; ctx.stroke();
    ctx.restore();
    const hood = curve(ctx, [[22, 46], [26, 24], [50, 12], [76, 24], [80, 46], [50, 58]]);
    form(ctx, hood, p, { shade: 0.45, lit: p.light });
    // The siphon, growing OUT of the hood rather than hovering beside it: it
    // starts inside the hood's own outline and tapers away from it.
    form(ctx, curve(ctx, [[30, 44], [8, 40], [4, 54], [28, 56]]), p,
         { fill: p.light, shade: 0.3, line: 2.2 });
    weakSpot(ctx, 12, 47, 3.6, p);
    // an eye cluster rather than a pair: three, uneven
    eye(ctx, 38, 36, 5.4, { look: -0.3 });
    eye(ctx, 54, 34, 4.6, { look: -0.3 });
    eye(ctx, 64, 42, 3.8, { look: -0.3 });
  },

  /* Rimeclaw — Rime, stage 2. Frostnib's tufts, moved: a ridge of ice down the
   * back, and the sac traded for a pair of foreclaws it actually uses. */
  rimeclaw(ctx, p) {
    for (const lx of [64, 78]) {
      form(ctx, curve(ctx, [[lx - 6, 64], [lx + 6, 64], [lx + 6, 84], [lx - 6, 84]]), p,
           { fill: p.dark, shade: 0.3, line: 2.2 });
    }
    form(ctx, curve(ctx, [[26, 56], [44, 42], [72, 44], [86, 58], [70, 72], [36, 70]]), p,
         { shade: 0.5, lit: p.light });
    // the ridge — the tufts a Frostnib wore on its head
    ctx.save();
    ctx.fillStyle = p.accent; ctx.strokeStyle = p.line; ctx.lineWidth = 2;
    for (const [tx, h] of [[44, 14], [56, 19], [68, 13]]) {
      ctx.beginPath();
      ctx.moveTo(tx - 6, 44); ctx.lineTo(tx, 44 - h); ctx.lineTo(tx + 6, 44);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
    form(ctx, curve(ctx, [[14, 40], [30, 28], [42, 38], [34, 52], [18, 52]]), p,
         { shade: 0.45, lit: p.light });
    // foreclaws
    ctx.save();
    ctx.fillStyle = mix(p.accent, '#ffffff', 0.4); ctx.strokeStyle = p.line; ctx.lineWidth = 2;
    for (const cx of [26, 38]) {
      ctx.beginPath();
      ctx.moveTo(cx - 4, 62); ctx.lineTo(cx + 2, 86); ctx.lineTo(cx + 7, 62);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
    weakSpot(ctx, 30, 50, 3.4, p);
    eye(ctx, 26, 38, 5.2, { look: -0.5, angry: true });
  },

  /* Thornhide — Thorn, stage 2. Sporelet's cap has become a back, and the
   * spore freckles have hardened into thorns. It walks now. */
  thornhide(ctx, p) {
    for (const lx of [32, 50, 70]) {
      form(ctx, curve(ctx, [[lx - 6, 64], [lx + 6, 64], [lx + 6, 86], [lx - 6, 86]]), p,
           { fill: p.dark, shade: 0.3, line: 2.2 });
    }
    const back = curve(ctx, [[18, 58], [28, 38], [56, 32], [82, 44], [84, 64], [50, 72], [22, 70]]);
    form(ctx, back, p, { shade: 0.5, lit: p.light });
    ctx.save();
    ctx.fillStyle = mix(p.light, p.line, 0.2); ctx.strokeStyle = p.line; ctx.lineWidth = 1.8;
    for (const [tx, ty, h] of [[34, 40, 13], [48, 34, 17], [62, 34, 15], [75, 42, 11]]) {
      ctx.beginPath();
      ctx.moveTo(tx - 5, ty); ctx.lineTo(tx + 1, ty - h); ctx.lineTo(tx + 5, ty);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
    form(ctx, oval(ctx, 18, 60, 14, 12), p, { shade: 0.4, lit: p.light });
    weakSpot(ctx, 48, 72, 3.6, p);      // root bundle, underneath
    eye(ctx, 13, 58, 4.8, { look: -0.4 });
    eye(ctx, 25, 58, 4.2, { look: -0.4 });
  },

  /* Blightcap — Myco, stage 2. Mycelid's droop, grown heavy: the cap is a
   * hanging canopy and the gills underneath are the thing you aim at. */
  blightcap(ctx, p) {
    form(ctx, curve(ctx, [[38, 52], [62, 52], [68, 88], [34, 88]]), p,
         { fill: p.light, shade: 0.42 });
    ctx.save();
    ctx.strokeStyle = p.accent; ctx.lineWidth = 3; ctx.lineCap = 'round';
    for (let i = 0; i < 11; i++) {
      const gx = 18 + i * 6.4;
      ctx.beginPath(); ctx.moveTo(gx, 42); ctx.lineTo(gx + (gx - 50) * 0.1, 58); ctx.stroke();
    }
    ctx.restore();
    weakSpot(ctx, 50, 54, 4.4, p);
    const cap = curve(ctx, [[14, 46], [16, 24], [50, 8], [84, 24], [86, 46], [66, 38], [50, 42], [34, 38]]);
    form(ctx, cap, p, { shade: 0.5, lit: p.light });
    ctx.save();
    cap(); ctx.clip();
    ctx.fillStyle = p.accent;
    for (const [sx, sy, sr] of [[32, 26, 7], [58, 20, 8.5], [72, 32, 6]]) {
      ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    eye(ctx, 43, 68, 5, { look: 0.1, angry: true });
    eye(ctx, 59, 68, 5, { look: 0.1, angry: true });
  },

  /* Cragback — Crag, stage 2. Pebblit with legs and a shell, and one plate on
   * the shoulder that has already been broken once. */
  cragback(ctx, p) {
    for (const lx of [30, 48, 68]) {
      form(ctx, curve(ctx, [[lx - 7, 66], [lx + 7, 66], [lx + 7, 86], [lx - 7, 86]]), p,
           { fill: p.dark, shade: 0.3, line: 2.2 });
    }
    const shell = curve(ctx, [[16, 62], [24, 36], [52, 26], [80, 38], [88, 62], [50, 74], [20, 72]]);
    form(ctx, shell, p, { shade: 0.5, lit: p.light });
    ctx.save();
    shell(); ctx.clip();
    ctx.strokeStyle = mix(p.base, p.line, 0.5); ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(30, 36); ctx.lineTo(46, 52); ctx.lineTo(88, 50);
    ctx.moveTo(46, 52); ctx.lineTo(44, 74);
    ctx.stroke();
    // the cracked plate, in the accent so the weak point has a shape
    ctx.fillStyle = p.accent;
    ctx.beginPath(); ctx.moveTo(56, 30); ctx.lineTo(80, 42); ctx.lineTo(60, 50); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = p.line; ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.moveTo(62, 32); ctx.lineTo(68, 48); ctx.stroke();
    ctx.restore();
    weakSpot(ctx, 68, 40, 4, p);
    form(ctx, oval(ctx, 18, 62, 13, 11), p, { shade: 0.4, lit: p.light });
    eye(ctx, 13, 60, 4.6, { look: -0.4 });
    eye(ctx, 24, 60, 4, { look: -0.4 });
  },

  /* Zephyrax — Gale, stage 2. The puff has found a direction: a keel, swept
   * wings, and everything trailing backwards from the leading edge. */
  zephyrax(ctx, p) {
    // Wings swept back from the shoulder, long and narrow, drawn before the
    // body so the body sits in front of them.
    for (const [tipY, rot] of [[18, -0.75], [74, 0.7]]) {
      form(ctx, curve(ctx, [[44, 46], [70, tipY], [92, tipY + (tipY < 50 ? 10 : -10)], [62, 52]]), p,
           { fill: mix(p.light, '#ffffff', 0.25), shade: 0.22, line: 2.2 });
    }
    form(ctx, curve(ctx, [[10, 46], [30, 38], [58, 40], [76, 48], [56, 58], [28, 56]]), p,
         { shade: 0.45, lit: p.light });
    // the keel, underneath, which is the weak point and the reason it reads fast
    form(ctx, curve(ctx, [[30, 54], [56, 54], [48, 72], [36, 68]]), p,
         { fill: p.accent, shade: 0.3, line: 2.2 });
    weakSpot(ctx, 43, 60, 3.6, p);
    ctx.save();
    ctx.strokeStyle = p.accent; ctx.lineWidth = 3; ctx.lineCap = 'round';
    for (const ty of [42, 50, 58]) {
      ctx.beginPath(); ctx.moveTo(76, ty); ctx.quadraticCurveTo(86, ty - 4, 94, ty + 2); ctx.stroke();
    }
    ctx.restore();
    eye(ctx, 20, 45, 5.4, { look: -0.5 });
  },

  /* Voltfang — Volt, stage 2. Sparkmite's core, now carried inside something
   * with a jaw. The coil around the jaw is where the charge is kept. */
  voltfang(ctx, p) {
    for (const lx of [36, 58, 74]) {
      form(ctx, curve(ctx, [[lx - 5, 64], [lx + 5, 64], [lx + 6, 84], [lx - 6, 84]]), p,
           { fill: p.dark, shade: 0.3, line: 2.2 });
    }
    form(ctx, curve(ctx, [[28, 56], [46, 42], [74, 44], [86, 58], [70, 70], [38, 70]]), p,
         { shade: 0.5, lit: p.light });
    // the core showing through the flank
    ctx.save();
    const glow = ctx.createRadialGradient(58, 56, 1, 58, 56, 14);
    glow.addColorStop(0, 'rgba(255,246,190,0.9)');
    glow.addColorStop(1, 'rgba(255,246,190,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(58, 56, 14, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    weakSpot(ctx, 58, 56, 4.6, p);
    // A neck, so the head belongs to the body instead of hovering near it.
    form(ctx, curve(ctx, [[26, 48], [42, 44], [44, 62], [28, 64]]), p,
         { shade: 0.4, line: 2.2 });
    form(ctx, curve(ctx, [[8, 44], [22, 30], [40, 36], [42, 56], [22, 62], [10, 58]]), p,
         { shade: 0.45, lit: p.light });
    // The coil is a band around the jaw, not a pair of rings on the face.
    ctx.save();
    ctx.strokeStyle = p.accent; ctx.lineWidth = 3.4; ctx.lineCap = 'round';
    for (const off of [0, 5]) {
      ctx.beginPath();
      ctx.moveTo(12 + off, 56); ctx.quadraticCurveTo(22 + off, 48, 34 + off, 52);
      ctx.stroke();
    }
    ctx.restore();
    ctx.save();
    ctx.fillStyle = '#f7f2df'; ctx.strokeStyle = p.line; ctx.lineWidth = 1.6;
    for (const fx of [13, 21]) {
      ctx.beginPath(); ctx.moveTo(fx, 58); ctx.lineTo(fx + 3, 68); ctx.lineTo(fx + 6, 58);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
    eye(ctx, 22, 40, 5, { look: -0.5, angry: true });
  },

  /* Nightmaw — Gloom, stage 2. Shadelet's ragged edge with something opened in
   * the middle of it. The maw is drawn as a hole rather than as teeth, which is
   * worse, and the interior is what the bestiary says you aim at. */
  nightmaw(ctx, p) {
    const blob = curve(ctx, [
      [20, 56], [24, 30], [50, 16], [78, 30], [82, 58],
      [72, 74], [64, 62], [50, 82], [36, 62], [28, 76],
    ]);
    form(ctx, blob, p, { shade: 0.5, lit: p.light });
    ctx.save();
    blob(); ctx.clip();
    ctx.fillStyle = mix(p.base, p.line, 0.6);
    ctx.beginPath(); ctx.ellipse(64, 62, 28, 24, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // the maw
    ctx.save();
    ctx.beginPath(); ctx.ellipse(50, 58, 18, 13, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#100c17'; ctx.fill();
    ctx.strokeStyle = p.line; ctx.lineWidth = 2.4; ctx.stroke();
    ctx.clip();
    ctx.fillStyle = p.accent;
    for (let i = 0; i < 5; i++) {
      const tx = 34 + i * 8;
      ctx.beginPath(); ctx.moveTo(tx, 46); ctx.lineTo(tx + 4, 56); ctx.lineTo(tx + 8, 46); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(tx, 70); ctx.lineTo(tx + 4, 60); ctx.lineTo(tx + 8, 70); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    weakSpot(ctx, 50, 58, 4, p);
    eye(ctx, 36, 36, 6, { look: 0.2, angry: true, glow: '#e9defb' });
    eye(ctx, 64, 36, 6, { look: -0.2, angry: true, glow: '#e9defb' });
  },

  /* Solafaun — Lumen, stage 2. Light with legs. The antlers carry it rather
   * than the body, and the flank mark is the weak point the bestiary names. */
  solafaun(ctx, p) {
    for (const lx of [34, 46, 64, 76]) {
      form(ctx, curve(ctx, [[lx - 4, 60], [lx + 4, 60], [lx + 4, 86], [lx - 4, 86]]), p,
           { fill: p.dark, shade: 0.3, line: 2 });
    }
    form(ctx, curve(ctx, [[28, 52], [46, 40], [72, 42], [84, 54], [68, 66], [36, 64]]), p,
         { shade: 0.45, lit: p.light });
    ctx.save();
    ctx.fillStyle = p.accent; ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.ellipse(56, 54, 9, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    weakSpot(ctx, 56, 54, 3.6, p);
    form(ctx, oval(ctx, 22, 40, 14, 12), p, { shade: 0.4, lit: p.light });
    // antlers, branching, the tallest thing on it
    ctx.save();
    ctx.strokeStyle = mix(p.light, '#ffffff', 0.35); ctx.lineWidth = 3.2; ctx.lineCap = 'round';
    for (const [bx, dir] of [[16, -1], [28, 1]]) {
      ctx.beginPath();
      ctx.moveTo(bx, 30); ctx.lineTo(bx + dir * 5, 14);
      ctx.moveTo(bx + dir * 2, 23); ctx.lineTo(bx + dir * 11, 18);
      ctx.moveTo(bx + dir * 4, 17); ctx.lineTo(bx + dir * 10, 8);
      ctx.stroke();
    }
    ctx.restore();
    eye(ctx, 16, 40, 4.8, { look: -0.4 });
  },

  /* Voidmaw — Rift, stage 2. Riftspawn's shard, opened. The ring is the animal
   * and the hole in it is the part that does the work. */
  voidmaw(ctx, p) {
    ctx.save();
    ctx.strokeStyle = p.light; ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.globalAlpha = 0.7;
    for (const [ax, ay, bx, by] of [[14, 24, 4, 12], [86, 26, 96, 14], [16, 76, 6, 88], [84, 78, 94, 90]]) {
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }
    ctx.restore();
    const ring = () => {
      ctx.beginPath();
      ctx.moveTo(50, 8); ctx.lineTo(84, 30); ctx.lineTo(88, 66);
      ctx.lineTo(50, 92); ctx.lineTo(12, 66); ctx.lineTo(16, 30);
      ctx.closePath();
    };
    form(ctx, ring, p, { shade: 0.5, lit: p.light });
    // the hole, with the inner ring around it
    ctx.save();
    ctx.beginPath(); ctx.ellipse(50, 50, 20, 22, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#140a1c'; ctx.fill();
    ctx.strokeStyle = mix(p.light, '#ffffff', 0.4); ctx.lineWidth = 3.4; ctx.stroke();
    ctx.restore();
    weakSpot(ctx, 50, 32, 4, p);
    eye(ctx, 34, 30, 4.6, { look: 0.3, angry: true, glow: '#f0d8fa' });
    eye(ctx, 67, 32, 4.6, { look: -0.3, angry: true, glow: '#f0d8fa' });
  },

  /* -------------------------------------------------------- stage three
   *
   * A stage 3 is not a bigger stage 2 — everything is drawn in the same box, so
   * "bigger" is invisible. What reads as final-form is mass sitting low, a
   * silhouette that breaks the outline of the box, and one feature that has
   * grown past being useful into being a problem: a crown of vents, three vent
   * stacks, a ring of eyes.
   *
   * The branch forms are the interesting constraint. Ashenreaver and Pyrecrown
   * are both what a Cinderfang can become, so they have to be visibly siblings
   * AND visibly a choice — same frame, opposite build.
   */

  /* Pyrecrown — Cinder, stage 3. The heavy branch: a maned thing whose crown has
   * become a row of vents it cannot close. */
  pyrecrown(ctx, p) {
    for (const lx of [30, 50, 70]) {
      form(ctx, curve(ctx, [[lx - 8, 62], [lx + 8, 62], [lx + 9, 88], [lx - 9, 88]]), p,
           { fill: p.dark, shade: 0.3, line: 2.4 });
    }
    form(ctx, curve(ctx, [[16, 58], [30, 36], [66, 32], [88, 50], [80, 74], [44, 80], [20, 72]]), p,
         { shade: 0.5, lit: p.light });
    // the mane, behind the head
    form(ctx, curve(ctx, [[10, 44], [22, 18], [48, 14], [58, 34], [46, 56], [18, 58]]), p,
         { fill: p.dark, shade: 0.35, line: 2.4 });
    form(ctx, oval(ctx, 30, 40, 19, 17), p, { shade: 0.45, lit: p.light });
    // the crown: vents, glowing, uneven
    ctx.save();
    for (const [vx, vy, h] of [[16, 22, 13], [28, 15, 18], [42, 17, 15], [54, 24, 11]]) {
      ctx.beginPath();
      ctx.moveTo(vx - 5, vy); ctx.lineTo(vx, vy - h); ctx.lineTo(vx + 5, vy);
      ctx.closePath();
      ctx.fillStyle = p.light; ctx.fill();
      ctx.strokeStyle = p.line; ctx.lineWidth = 2.2; ctx.stroke();
    }
    ctx.restore();
    weakSpot(ctx, 34, 20, 4, p);
    weakSpot(ctx, 52, 58, 4, p);
    eye(ctx, 24, 40, 5.4, { look: -0.5, angry: true });
  },

  /* Ashenreaver — Cinder, stage 3, the other way. Pyrecrown's opposite: burnt
   * out rather than burning, lean, with a ridge of spines and two eyes doing all
   * the heat. */
  ashenreaver(ctx, p) {
    for (const lx of [32, 52, 72]) {
      form(ctx, curve(ctx, [[lx - 5, 62], [lx + 5, 62], [lx + 4, 88], [lx - 6, 88]]), p,
           { fill: mix(p.dark, p.line, 0.4), shade: 0.3, line: 2.2 });
    }
    form(ctx, curve(ctx, [[18, 56], [38, 44], [70, 42], [86, 54], [70, 70], [34, 70]]), p,
         { fill: mix(p.base, p.line, 0.35), shade: 0.45, lit: p.dark });
    // spine ridge
    ctx.save();
    ctx.fillStyle = p.light; ctx.strokeStyle = p.line; ctx.lineWidth = 2;
    for (const [tx, h] of [[34, 12], [46, 17], [58, 15], [70, 10]]) {
      ctx.beginPath();
      ctx.moveTo(tx - 5, 44); ctx.lineTo(tx, 44 - h); ctx.lineTo(tx + 5, 44);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
    weakSpot(ctx, 52, 34, 3.6, p);
    // A narrow neck and a long low skull, in a paler ash than the body, so the
    // head is a separate mass instead of the front end of one.
    form(ctx, curve(ctx, [[22, 50], [36, 46], [38, 62], [24, 64]]), p,
         { fill: mix(p.base, p.line, 0.5), shade: 0.35, line: 2.2 });
    form(ctx, curve(ctx, [[4, 48], [16, 36], [36, 40], [38, 56], [18, 62], [6, 58]]), p,
         { fill: mix(p.base, '#cfc4bb', 0.35), shade: 0.4, lit: p.light });
    ctx.save();
    ctx.strokeStyle = p.line; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(6, 54); ctx.lineTo(26, 56); ctx.stroke();
    ctx.restore();
    eye(ctx, 14, 46, 5.6, { look: -0.5, angry: true, glow: '#ffcf8a' });
    eye(ctx, 29, 48, 4.6, { look: -0.5, angry: true, glow: '#ffcf8a' });
  },

  /* Vulcarne — Slag, colossus. Three vent stacks, each its own weak point, on a
   * mass too heavy to have a neck. */
  vulcarne(ctx, p) {
    for (const lx of [26, 50, 76]) {
      form(ctx, curve(ctx, [[lx - 10, 66], [lx + 10, 66], [lx + 10, 90], [lx - 10, 90]]), p,
           { fill: mix(p.accent, p.line, 0.3), shade: 0.3, line: 2.4 });
    }
    const mass = curve(ctx, [[10, 60], [22, 40], [50, 32], [80, 40], [92, 62], [50, 76], [16, 74]]);
    form(ctx, mass, p, { fill: p.accent, shade: 0.5, lit: p.accentDark });
    ctx.save();
    mass(); ctx.clip();
    ctx.lineCap = 'round';
    for (const seam of [[[18, 56], [46, 50], [76, 56]], [[26, 68], [56, 64], [84, 68]]]) {
      for (const [w, col] of [[8, p.line], [3.6, p.light]]) {
        ctx.beginPath(); ctx.moveTo(seam[0][0], seam[0][1]);
        for (let i = 1; i < seam.length; i++) ctx.lineTo(seam[i][0], seam[i][1]);
        ctx.strokeStyle = col; ctx.lineWidth = w; ctx.stroke();
      }
    }
    ctx.restore();
    // three stacks, different heights, so the count reads without being counted
    for (const [sx, h] of [[26, 22], [50, 30], [74, 18]]) {
      form(ctx, curve(ctx, [[sx - 8, 38], [sx - 6, 38 - h], [sx + 6, 38 - h], [sx + 8, 38]]), p,
           { fill: mix(p.accent, p.line, 0.2), shade: 0.35, line: 2.4 });
      weakSpot(ctx, sx, 40 - h, 4.2, p);
    }
    eye(ctx, 34, 56, 5.2, { look: 0.2, angry: true, glow: '#ffcf8a' });
    eye(ctx, 62, 56, 5.2, { look: -0.2, angry: true, glow: '#ffcf8a' });
  },

  /* Maelstrix — Brine, stage 3. The coil has closed into a spiral with a core in
   * the middle of it, and the mantle is the ring of water it drags along. */
  maelstrix(ctx, p) {
    ctx.save();
    ctx.strokeStyle = p.dark; ctx.lineWidth = 9; ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.ellipse(50, 52, 34 - i * 3, 30 - i * 5, i * 0.5, 0.4, Math.PI * 1.7);
      ctx.stroke();
    }
    ctx.restore();
    const mantle = curve(ctx, [[16, 52], [26, 24], [56, 16], [84, 32], [86, 62], [58, 80], [26, 74]]);
    form(ctx, mantle, p, { shade: 0.5, lit: p.light });
    weakSpot(ctx, 74, 30, 4, p);
    // the core, down the middle
    ctx.save();
    const glow = ctx.createRadialGradient(50, 52, 2, 50, 52, 22);
    glow.addColorStop(0, 'rgba(190,240,255,0.95)');
    glow.addColorStop(1, 'rgba(190,240,255,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(50, 52, 22, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    form(ctx, oval(ctx, 50, 52, 13, 13), p, { fill: p.light, shade: 0.3, line: 2.4 });
    weakSpot(ctx, 50, 52, 5.4, p);
    eye(ctx, 38, 40, 5, { look: 0.3, angry: true });
    eye(ctx, 63, 42, 5, { look: -0.3, angry: true });
  },

  /* Glaciarch — Rime, stage 3. The tall branch: a crest of ice it carries like
   * antlers, and the heart visible through the chest. */
  glaciarch(ctx, p) {
    for (const lx of [36, 58, 74]) {
      form(ctx, curve(ctx, [[lx - 7, 62], [lx + 7, 62], [lx + 7, 88], [lx - 7, 88]]), p,
           { fill: p.dark, shade: 0.3, line: 2.4 });
    }
    form(ctx, curve(ctx, [[22, 56], [40, 40], [72, 42], [88, 56], [70, 74], [32, 72]]), p,
         { shade: 0.5, lit: p.light });
    // heart ice, showing through
    ctx.save();
    const glow = ctx.createRadialGradient(54, 58, 1, 54, 58, 15);
    glow.addColorStop(0, 'rgba(210,245,255,0.95)');
    glow.addColorStop(1, 'rgba(210,245,255,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(54, 58, 15, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    weakSpot(ctx, 54, 58, 4.6, p);
    form(ctx, curve(ctx, [[10, 44], [28, 30], [42, 40], [34, 56], [14, 56]]), p,
         { shade: 0.45, lit: p.light });
    // the crest: tall, forward-swept, taller than the head
    ctx.save();
    ctx.fillStyle = mix(p.accent, '#ffffff', 0.4); ctx.strokeStyle = p.line; ctx.lineWidth = 2.2;
    for (const [tx, ty, h, lean] of [[16, 30, 24, -5], [27, 26, 30, -3], [38, 30, 22, 2]]) {
      ctx.beginPath();
      ctx.moveTo(tx - 6, ty); ctx.lineTo(tx + lean, ty - h); ctx.lineTo(tx + 6, ty);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
    weakSpot(ctx, 27, 6, 3.8, p);
    eye(ctx, 20, 44, 5.2, { look: -0.5, angry: true });
  },

  /* Hoarfell — Rime, stage 3, the other way. Glaciarch's opposite: nothing tall
   * on it at all, everything packed into armoured shoulders. */
  hoarfell(ctx, p) {
    for (const lx of [30, 52, 74]) {
      form(ctx, curve(ctx, [[lx - 10, 64], [lx + 10, 64], [lx + 10, 90], [lx - 10, 90]]), p,
           { fill: p.dark, shade: 0.3, line: 2.4 });
    }
    form(ctx, curve(ctx, [[14, 58], [28, 40], [62, 34], [88, 48], [84, 72], [46, 80], [18, 74]]), p,
         { shade: 0.5, lit: p.light });
    // shoulder plates, overlapping, the whole silhouette
    // Plates that grow off the back: they overlap each other and their lower
    // edges are buried in the body rather than outlined against it.
    ctx.save();
    ctx.fillStyle = mix(p.accent, '#ffffff', 0.3); ctx.strokeStyle = p.line; ctx.lineWidth = 2.4;
    for (const [px_, py, w] of [[34, 42, 15], [54, 37, 17], [73, 44, 14]]) {
      ctx.beginPath();
      ctx.moveTo(px_ - w, py + 14);
      ctx.quadraticCurveTo(px_ - w * 0.5, py - 10, px_ + w * 0.2, py - 8);
      ctx.quadraticCurveTo(px_ + w, py - 2, px_ + w, py + 16);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
    }
    ctx.restore();
    weakSpot(ctx, 54, 34, 4, p);
    form(ctx, oval(ctx, 20, 58, 15, 13), p, { shade: 0.4, lit: p.light });
    weakSpot(ctx, 14, 60, 3.6, p);
    eye(ctx, 15, 54, 5, { look: -0.4, angry: true });
    eye(ctx, 27, 56, 4.4, { look: -0.4, angry: true });
  },

  /* Bramblewarden — Thorn, stage 3. A tree that has decided to stand guard.
   * The crown is a canopy and the heartwood shows through a split in the trunk. */
  bramblewarden(ctx, p) {
    form(ctx, curve(ctx, [[36, 48], [64, 48], [72, 90], [28, 90]]), p,
         { fill: mix(p.base, p.line, 0.25), shade: 0.45, lit: p.dark });
    // roots
    ctx.save();
    ctx.strokeStyle = p.line; ctx.lineWidth = 5; ctx.lineCap = 'round';
    for (const [rx, ry] of [[22, 84], [50, 92], [80, 84]]) {
      ctx.beginPath(); ctx.moveTo(50, 78); ctx.quadraticCurveTo((50 + rx) / 2, 86, rx, ry); ctx.stroke();
    }
    ctx.restore();
    // heartwood
    ctx.save();
    ctx.fillStyle = p.accent;
    ctx.beginPath();
    ctx.moveTo(44, 54); ctx.lineTo(56, 58); ctx.lineTo(52, 78); ctx.lineTo(42, 72);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = p.line; ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();
    weakSpot(ctx, 49, 66, 4, p);
    // the crown, three overlapping masses so it is not one blob
    for (const [cx, cy, rx, ry] of [[28, 34, 22, 17], [66, 32, 24, 18], [48, 22, 26, 19]]) {
      form(ctx, oval(ctx, cx, cy, rx, ry), p, { shade: 0.45, lit: p.light });
    }
    weakSpot(ctx, 48, 10, 3.8, p);
    ctx.save();
    ctx.fillStyle = mix(p.light, p.line, 0.15); ctx.strokeStyle = p.line; ctx.lineWidth = 1.8;
    for (const [tx, ty] of [[22, 22], [40, 12], [62, 14], [78, 24]]) {
      ctx.beginPath();
      ctx.moveTo(tx - 4, ty + 4); ctx.lineTo(tx, ty - 9); ctx.lineTo(tx + 4, ty + 4);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
    eye(ctx, 40, 44, 5.4, { look: 0.2, angry: true, glow: '#d9f0c8' });
    eye(ctx, 60, 44, 5.4, { look: -0.2, angry: true, glow: '#d9f0c8' });
  },

  /* Rotmatron — Myco, stage 3. Blightcap gone to seed: a bloated sac under a
   * canopy of gills. Wide and low, which is what makes it unpleasant. */
  rotmatron(ctx, p) {
    form(ctx, oval(ctx, 50, 66, 30, 22), p, { fill: p.light, shade: 0.5, lit: p.base });
    weakSpot(ctx, 50, 74, 4.4, p);
    ctx.save();
    ctx.strokeStyle = p.accent; ctx.lineWidth = 3.4; ctx.lineCap = 'round';
    for (let i = 0; i < 13; i++) {
      const gx = 14 + i * 6;
      ctx.beginPath(); ctx.moveTo(gx, 38); ctx.lineTo(gx + (gx - 50) * 0.12, 56); ctx.stroke();
    }
    ctx.restore();
    weakSpot(ctx, 24, 48, 4, p);
    const cap = curve(ctx, [[8, 42], [10, 20], [50, 4], [90, 20], [92, 42], [68, 34], [50, 38], [32, 34]]);
    form(ctx, cap, p, { shade: 0.5, lit: p.light });
    ctx.save();
    cap(); ctx.clip();
    ctx.fillStyle = p.accent;
    for (const [sx, sy, sr] of [[26, 22, 8], [54, 14, 10], [76, 26, 7], [40, 30, 6]]) {
      ctx.beginPath(); ctx.arc(sx, sy, sr, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    eye(ctx, 40, 64, 5.4, { look: 0.1, angry: true });
    eye(ctx, 61, 64, 5.4, { look: -0.1, angry: true });
  },

  /* Sporeherald — Myco, stage 3, the other way. Rotmatron's opposite: tall,
   * thin, crowned, and it vents upward instead of spreading. */
  sporeherald(ctx, p) {
    form(ctx, curve(ctx, [[42, 40], [58, 40], [64, 90], [36, 90]]), p,
         { fill: p.light, shade: 0.45, lit: p.base });
    // vents along the stalk, puffing
    ctx.save();
    ctx.fillStyle = p.accent; ctx.globalAlpha = 0.8;
    for (const [vx, vy, vr] of [[34, 52, 6], [68, 62, 7], [32, 72, 5]]) {
      ctx.beginPath(); ctx.arc(vx, vy, vr, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    weakSpot(ctx, 68, 62, 3.8, p);
    form(ctx, curve(ctx, [[28, 38], [30, 20], [50, 10], [70, 20], [72, 38], [50, 44]]), p,
         { shade: 0.5, lit: p.light });
    // the crown: thin spires, taller than the cap
    ctx.save();
    ctx.strokeStyle = p.accent; ctx.lineWidth = 3.2; ctx.lineCap = 'round';
    for (const [cx, h] of [[36, 14], [50, 20], [64, 15]]) {
      ctx.beginPath(); ctx.moveTo(cx, 18); ctx.lineTo(cx + (cx - 50) * 0.15, 18 - h); ctx.stroke();
    }
    ctx.restore();
    weakSpot(ctx, 50, 0 + 4, 3.6, p);
    eye(ctx, 43, 30, 4.8, { look: 0.1, angry: true });
    eye(ctx, 58, 30, 4.8, { look: -0.1, angry: true });
  },

  /* Obelisc — Crag, colossus. A standing stone that got up. Nothing about it is
   * animal: it is a monolith with a keystone holding it together. */
  obelisc(ctx, p) {
    for (const lx of [34, 66] ) {
      form(ctx, curve(ctx, [[lx - 9, 70], [lx + 9, 70], [lx + 8, 92], [lx - 8, 92]]), p,
           { fill: p.dark, shade: 0.3, line: 2.4 });
      weakSpot(ctx, lx, 72, 3.4, p);
    }
    const slab = () => {
      ctx.beginPath();
      ctx.moveTo(36, 6); ctx.lineTo(66, 10); ctx.lineTo(74, 72);
      ctx.lineTo(50, 78); ctx.lineTo(26, 70);
      ctx.closePath();
    };
    form(ctx, slab, p, { shade: 0.5, lit: p.light });
    ctx.save();
    slab(); ctx.clip();
    ctx.strokeStyle = mix(p.base, p.line, 0.5); ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(30, 34); ctx.lineTo(74, 30);
    ctx.moveTo(28, 56); ctx.lineTo(74, 52);
    ctx.stroke();
    // the keystone
    ctx.fillStyle = p.accent;
    ctx.beginPath();
    ctx.moveTo(40, 34); ctx.lineTo(62, 32); ctx.lineTo(60, 52); ctx.lineTo(42, 54);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = p.line; ctx.lineWidth = 2.2; ctx.stroke();
    ctx.restore();
    weakSpot(ctx, 51, 43, 4.4, p);
    eye(ctx, 43, 20, 4.8, { look: 0.2, angry: true, glow: '#efe6d4' });
    eye(ctx, 59, 21, 4.8, { look: -0.2, angry: true, glow: '#efe6d4' });
  },

  /* Tempestrix — Gale, stage 3. Zephyrax become weather: a storm with one eye
   * at the middle of it, which is the joke and also the weak point. */
  tempestrix(ctx, p) {
    // The storm reads at the edges only. Drawn any thicker it becomes the
    // subject, and the creature inside it disappears.
    ctx.save();
    ctx.strokeStyle = p.accent; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.globalAlpha = 0.75;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      ctx.beginPath();
      ctx.ellipse(50, 50, 46, 42, a, a + 0.3, a + 1.1);
      ctx.stroke();
    }
    ctx.restore();
    for (const [tipY] of [[16], [80]]) {
      form(ctx, curve(ctx, [[54, 48], [80, tipY], [96, tipY + (tipY < 50 ? 16 : -16)], [70, 54]]), p,
           { fill: mix(p.light, '#ffffff', 0.2), shade: 0.25, line: 2.4 });
    }
    form(ctx, curve(ctx, [[10, 48], [30, 28], [64, 30], [82, 48], [62, 72], [26, 70]]), p,
         { shade: 0.5, lit: p.light });
    weakSpot(ctx, 70, 58, 4, p);       // storm core
    ctx.save();
    const glow = ctx.createRadialGradient(40, 48, 2, 40, 48, 22);
    glow.addColorStop(0, 'rgba(235,250,255,0.95)');
    glow.addColorStop(1, 'rgba(235,250,255,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(40, 48, 22, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // One enormous eye, which is what a storm with an eye should actually be.
    eye(ctx, 40, 48, 14, { look: -0.2, angry: true });
    weakSpot(ctx, 40, 30, 3.6, p);
  },

  /* Thunderhelm — Volt, stage 3. Everything has gone into the head: an armoured
   * helm with a seam down it and the core showing through the gap. */
  thunderhelm(ctx, p) {
    for (const lx of [34, 56, 76]) {
      form(ctx, curve(ctx, [[lx - 8, 66], [lx + 8, 66], [lx + 8, 90], [lx - 8, 90]]), p,
           { fill: p.dark, shade: 0.3, line: 2.4 });
    }
    form(ctx, curve(ctx, [[26, 60], [44, 46], [76, 48], [90, 62], [72, 76], [36, 74]]), p,
         { shade: 0.5, lit: p.light });
    const helm = curve(ctx, [[8, 44], [20, 22], [46, 20], [56, 40], [46, 60], [16, 60]]);
    form(ctx, helm, p, { fill: mix(p.accent, p.line, 0.35), shade: 0.4, lit: p.light });
    // the seam, glowing, straight down the middle of the helm
    ctx.save();
    helm(); ctx.clip();
    ctx.strokeStyle = p.light; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(30, 18); ctx.lineTo(28, 62); ctx.stroke();
    ctx.restore();
    weakSpot(ctx, 29, 30, 4, p);
    ctx.save();
    const glow = ctx.createRadialGradient(62, 60, 1, 62, 60, 16);
    glow.addColorStop(0, 'rgba(255,246,190,0.9)');
    glow.addColorStop(1, 'rgba(255,246,190,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(62, 60, 16, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    weakSpot(ctx, 62, 60, 5, p);
    eye(ctx, 20, 44, 5, { look: -0.5, angry: true, glow: '#fff3c4' });
    eye(ctx, 38, 44, 4.4, { look: -0.5, angry: true, glow: '#fff3c4' });
  },

  /* Railmane — Volt, stage 3, the other way. Thunderhelm's opposite: nothing
   * armoured, all speed, and the charge carried in a mane of nodes. */
  railmane(ctx, p) {
    for (const [lx, h] of [[30, 90], [44, 86], [64, 90], [78, 86]]) {
      form(ctx, curve(ctx, [[lx - 4, 60], [lx + 5, 60], [lx + 3, h], [lx - 6, h]]), p,
           { fill: p.dark, shade: 0.3, line: 2.2 });
    }
    form(ctx, curve(ctx, [[20, 54], [42, 42], [74, 44], [88, 54], [70, 66], [34, 66]]), p,
         { shade: 0.5, lit: p.light });
    // the mane: nodes on a spine, each one a little lamp
    ctx.save();
    for (const [nx, ny] of [[30, 38], [42, 32], [56, 30], [70, 34], [82, 42]]) {
      const glow = ctx.createRadialGradient(nx, ny, 1, nx, ny, 10);
      glow.addColorStop(0, 'rgba(255,246,190,0.9)');
      glow.addColorStop(1, 'rgba(255,246,190,0)');
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(nx, ny, 10, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(nx, ny, 4.4, 0, Math.PI * 2);
      ctx.fillStyle = p.accent; ctx.fill();
      ctx.strokeStyle = p.line; ctx.lineWidth = 2; ctx.stroke();
    }
    ctx.restore();
    weakSpot(ctx, 56, 30, 3.8, p);
    form(ctx, curve(ctx, [[8, 46], [24, 36], [36, 46], [26, 58], [10, 58]]), p,
         { shade: 0.45, lit: p.light });
    eye(ctx, 17, 46, 5, { look: -0.5, angry: true });
  },

  /* Umbrakhan — Gloom, colossus. Nightmaw with nothing left to open: a mass of
   * dark carrying two rings of eyes, and no face among them. */
  umbrakhan(ctx, p) {
    const mass = curve(ctx, [
      [12, 58], [18, 28], [50, 10], [82, 28], [88, 58],
      [78, 80], [66, 64], [50, 88], [34, 64], [22, 82],
    ]);
    form(ctx, mass, p, { shade: 0.5, lit: p.light });
    ctx.save();
    mass(); ctx.clip();
    ctx.fillStyle = mix(p.base, p.line, 0.6);
    ctx.beginPath(); ctx.ellipse(66, 62, 34, 28, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // two rings of eyes, different radii, none of them a face
    for (const [r, n, ry, er] of [[22, 6, 44, 4.4], [34, 8, 50, 3.2]]) {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + (r === 22 ? 0.3 : 0);
        eye(ctx, 50 + Math.cos(a) * r, ry + Math.sin(a) * r * 0.7, er,
            { look: 0.2, glow: '#e9defb' });
      }
    }
    weakSpot(ctx, 50, 22, 4, p);
    weakSpot(ctx, 50, 78, 4, p);
  },

  /* Aurelian — Lumen, stage 3. Solafaun grown into something that gives light
   * rather than carries it: a halo above and the chest lit from inside. */
  aurelian(ctx, p) {
    ctx.save();
    const halo = ctx.createRadialGradient(50, 20, 6, 50, 20, 30);
    halo.addColorStop(0, 'rgba(255,244,196,0.75)');
    halo.addColorStop(1, 'rgba(255,244,196,0)');
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(50, 20, 30, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = mix(p.light, '#ffffff', 0.5); ctx.lineWidth = 3.4;
    ctx.beginPath(); ctx.ellipse(50, 20, 22, 8, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    weakSpot(ctx, 50, 12, 4, p);
    for (const lx of [34, 48, 66, 78]) {
      form(ctx, curve(ctx, [[lx - 5, 64], [lx + 5, 64], [lx + 5, 90], [lx - 5, 90]]), p,
           { fill: p.dark, shade: 0.3, line: 2.2 });
    }
    form(ctx, curve(ctx, [[22, 56], [42, 42], [74, 44], [88, 58], [70, 72], [32, 70]]), p,
         { shade: 0.45, lit: p.light });
    ctx.save();
    const chest = ctx.createRadialGradient(44, 58, 1, 44, 58, 16);
    chest.addColorStop(0, 'rgba(255,250,225,0.95)');
    chest.addColorStop(1, 'rgba(255,250,225,0)');
    ctx.fillStyle = chest; ctx.beginPath(); ctx.arc(44, 58, 16, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    weakSpot(ctx, 44, 58, 5, p);
    form(ctx, oval(ctx, 20, 44, 14, 12), p, { shade: 0.4, lit: p.light });
    eye(ctx, 15, 44, 4.8, { look: -0.4 });
  },

  /* Aeonrend — Rift, titan. Not a creature at all: a tear, with the far side
   * showing through it. Everything else in the cast is drawn as a solid thing;
   * this one is drawn as an absence, which is the point of it. */
  aeonrend(ctx, p) {
    ctx.save();
    ctx.strokeStyle = p.light; ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.globalAlpha = 0.7;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2;
      ctx.beginPath();
      ctx.moveTo(50 + Math.cos(a) * 30, 50 + Math.sin(a) * 34);
      ctx.lineTo(50 + Math.cos(a) * 48, 50 + Math.sin(a) * 52);
      ctx.stroke();
    }
    ctx.restore();
    const tear = () => {
      ctx.beginPath();
      ctx.moveTo(50, 4);
      ctx.bezierCurveTo(70, 26, 66, 40, 78, 50);
      ctx.bezierCurveTo(66, 60, 70, 74, 50, 96);
      ctx.bezierCurveTo(30, 74, 34, 60, 22, 50);
      ctx.bezierCurveTo(34, 40, 30, 26, 50, 4);
      ctx.closePath();
    };
    form(ctx, tear, p, { shade: 0.5, lit: p.light });
    ctx.save();
    tear(); ctx.clip();
    // the far side: bands of somewhere else
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = i % 2 ? mix(p.line, '#000000', 0.4) : mix(p.light, '#ffffff', 0.25);
      ctx.globalAlpha = 0.55;
      ctx.fillRect(20, 8 + i * 15, 60, 8);
    }
    ctx.restore();
    weakSpot(ctx, 50, 50, 5.4, p);
    eye(ctx, 42, 34, 5, { look: 0.3, angry: true, glow: '#f0d8fa' });
    eye(ctx, 59, 62, 5, { look: -0.3, angry: true, glow: '#f0d8fa' });
  },

  /* ------------------------------------------------------------- apexes
   *
   * These are raid bosses: the bestiary wants four to eight Wardens for each of
   * them. They have to say so before anybody reads a stat, and the way to say it
   * is to break the rules the rest of the cast follows. The other forty sit
   * inside the box with air around them; these fill it corner to corner and run
   * off the edges. Karrahk has no legs because it does not walk anywhere.
   * Nyxhollow has no body at all, only the shroud and the thing inside it.
   */

  /* Karrahk, the Sunken Spire — Tide/Stone, titan. A drowned tower that turned
   * out to be an animal, still wearing the sea it came up through. */
  karrahk(ctx, p) {
    // the water it drags with it, behind everything
    ctx.save();
    ctx.strokeStyle = p.base; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.globalAlpha = 0.5;
    for (const y of [72, 82, 92]) {
      ctx.beginPath();
      ctx.moveTo(-4, y);
      ctx.bezierCurveTo(26, y - 8, 74, y + 8, 104, y - 4);
      ctx.stroke();
    }
    ctx.restore();
    const spire = () => {
      ctx.beginPath();
      ctx.moveTo(50, -6); ctx.lineTo(74, 22); ctx.lineTo(70, 48);
      ctx.lineTo(88, 62); ctx.lineTo(80, 92); ctx.lineTo(50, 82);
      ctx.lineTo(20, 92); ctx.lineTo(12, 62); ctx.lineTo(30, 48);
      ctx.lineTo(26, 22);
      ctx.closePath();
    };
    form(ctx, spire, p, { fill: p.accent, shade: 0.55, lit: p.accentDark, line: 3 });
    // stonework, drowned
    ctx.save();
    spire(); ctx.clip();
    ctx.strokeStyle = mix(p.accent, p.line, 0.55); ctx.lineWidth = 2.4;
    for (const y of [24, 40, 58, 74]) {
      ctx.beginPath(); ctx.moveTo(10, y); ctx.lineTo(90, y - 3); ctx.stroke();
    }
    ctx.fillStyle = p.base;
    ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.ellipse(50, 84, 44, 16, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // the core, sealed behind the plating until the last phase
    ctx.save();
    const glow = ctx.createRadialGradient(50, 50, 2, 50, 50, 24);
    glow.addColorStop(0, 'rgba(150,235,255,0.95)');
    glow.addColorStop(1, 'rgba(150,235,255,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(50, 50, 24, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    form(ctx, oval(ctx, 50, 50, 12, 14), p, { fill: p.light, shade: 0.3, line: 2.6 });
    weakSpot(ctx, 50, 50, 5.6, p);
    eye(ctx, 36, 28, 5.6, { look: 0.3, angry: true, glow: '#cfeeff' });
    eye(ctx, 64, 28, 5.6, { look: -0.3, angry: true, glow: '#cfeeff' });
  },

  /* Nyxhollow — Gloom, colossus. It hides its own health bar unless you bring a
   * Lumen carrier, so the drawing does the same thing: a shroud with one eye
   * open in it, and no way to tell how big the thing underneath is. */
  nyxhollow(ctx, p) {
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = mix(p.line, '#000000', 0.3);
    ctx.beginPath(); ctx.ellipse(50, 56, 48, 44, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    const shroud = curve(ctx, [
      [6, 56], [14, 22], [50, 2], [86, 22], [94, 56],
      [82, 88], [68, 66], [50, 94], [32, 66], [18, 88],
    ]);
    form(ctx, shroud, p, { fill: mix(p.base, p.line, 0.4), shade: 0.45, lit: p.base, line: 3 });
    ctx.save();
    shroud(); ctx.clip();
    ctx.fillStyle = mix(p.line, '#000000', 0.25);
    ctx.beginPath(); ctx.ellipse(66, 66, 40, 34, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // the hollow eye: the only thing on it that is not shroud
    ctx.save();
    const glow = ctx.createRadialGradient(50, 44, 3, 50, 44, 30);
    glow.addColorStop(0, 'rgba(220,200,255,0.9)');
    glow.addColorStop(1, 'rgba(220,200,255,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(50, 44, 30, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.beginPath(); ctx.ellipse(50, 44, 21, 15, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#0d0a12'; ctx.fill();
    ctx.strokeStyle = p.line; ctx.lineWidth = 3; ctx.stroke();
    ctx.restore();
    eye(ctx, 50, 44, 11, { look: 0.1, glow: '#e9defb' });
    weakSpot(ctx, 50, 44, 4.4, p);
    // wisps, off the top, long enough to leave the box
    ctx.save();
    ctx.strokeStyle = p.accent; ctx.lineWidth = 3.2; ctx.lineCap = 'round';
    for (const [wx, wy] of [[26, 14], [50, 2], [74, 14]]) {
      ctx.beginPath();
      ctx.moveTo(wx, wy); ctx.quadraticCurveTo(wx + 6, wy - 14, wx - 4, wy - 26);
      ctx.stroke();
    }
    ctx.restore();
  },

  /* Aeonrend, apex — Rift, titan. The same tear as the stage 3, opened all the
   * way: wider, with more of the far side visible and the seams of four phases
   * across it. It switches the type chart off, so nothing you bring is right. */
  aeonrend_apex(ctx, p) {
    ctx.save();
    ctx.strokeStyle = p.light; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.globalAlpha = 0.75;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + 0.15;
      ctx.beginPath();
      ctx.moveTo(50 + Math.cos(a) * 34, 50 + Math.sin(a) * 40);
      ctx.lineTo(50 + Math.cos(a) * 56, 50 + Math.sin(a) * 62);
      ctx.stroke();
    }
    ctx.restore();
    const tear = () => {
      ctx.beginPath();
      ctx.moveTo(50, -8);
      ctx.bezierCurveTo(78, 22, 72, 40, 92, 50);
      ctx.bezierCurveTo(72, 60, 78, 78, 50, 108);
      ctx.bezierCurveTo(22, 78, 28, 60, 8, 50);
      ctx.bezierCurveTo(28, 40, 22, 22, 50, -8);
      ctx.closePath();
    };
    form(ctx, tear, p, { shade: 0.55, lit: p.light, line: 3 });
    ctx.save();
    tear(); ctx.clip();
    for (let i = 0; i < 9; i++) {
      ctx.fillStyle = i % 2 ? mix(p.line, '#000000', 0.45) : mix(p.light, '#ffffff', 0.3);
      ctx.globalAlpha = 0.6;
      ctx.fillRect(4, -4 + i * 12, 92, 6);
    }
    ctx.globalAlpha = 1;
    // the four phase seams, which is what the fight is actually about
    ctx.strokeStyle = mix(p.light, '#ffffff', 0.55); ctx.lineWidth = 3;
    for (const y of [14, 36, 62, 84]) {
      ctx.beginPath(); ctx.moveTo(10, y); ctx.lineTo(90, y - 4); ctx.stroke();
    }
    ctx.restore();
    weakSpot(ctx, 50, 50, 6, p);
    eye(ctx, 36, 28, 5.6, { look: 0.3, angry: true, glow: '#f0d8fa' });
    eye(ctx, 64, 30, 5.6, { look: -0.3, angry: true, glow: '#f0d8fa' });
    eye(ctx, 44, 72, 4.6, { look: 0.2, angry: true, glow: '#f0d8fa' });
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
