/*
 * RIFTBORN — 3D pixel monsters.
 *
 * Forty-three species, no artist. So each monster is *built* from its own Codex
 * entry: family decides the silhouette, size class decides the proportions,
 * elements decide the palette, weak points become glowing voxels that sit where
 * the fight says they are, and the stage adds mass and detail. Two Cinderfangs
 * look alike; a Cinderfang and a Pyrecrown do not.
 *
 * It renders as voxels — cubes on a lattice, drawn back to front in isometric —
 * which is what "3D pixel" means and what makes a rotatable model possible from
 * a few dozen lines of geometry rather than a mesh pipeline.
 *
 * No DOM at the model layer, so the shapes can be tested headlessly; only the
 * renderer touches a canvas.
 */

// ---------------------------------------------------------------- palette

export const ELEMENT_RAMP = {
  ember:   ['#5a2410', '#8f3a17', '#c2622f', '#e8924a'],
  tide:    ['#153346', '#2a5f80', '#4a90b8', '#7fc3e0'],
  verdant: ['#1d3a1c', '#3a6b33', '#5f9e5a', '#8fce85'],
  stone:   ['#3a3730', '#5f5a50', '#8a8378', '#b5ada0'],
  gale:    ['#33505c', '#5a8496', '#8fb8c9', '#c0e2ef'],
  volt:    ['#544416', '#8f7726', '#d9c04a', '#f5e68a'],
  gloom:   ['#241f33', '#453a5e', '#7a6b96', '#a897c4'],
  lumen:   ['#544c20', '#8f8340', '#e0d090', '#fff4c4'],
  rift:    ['#3a1145', '#6c2a80', '#b05ad0', '#dfa0f0'],
};

const WEAK_COLOUR = '#ffd23f';

/** Blend two element ramps for a dual-element species, band by band. */
function rampFor(elements) {
  const ramps = elements.map((e) => ELEMENT_RAMP[e]).filter(Boolean);
  if (!ramps.length) return ELEMENT_RAMP.stone;
  if (ramps.length === 1) return ramps[0];
  return ramps[0].map((c, i) => mix(c, ramps[1][i], 0.42));
}

function mix(a, b, t) {
  const pa = hex(a), pb = hex(b);
  const to = (n) => n.toString(16).padStart(2, '0');
  return `#${to(Math.round(pa[0] + (pb[0] - pa[0]) * t))}`
       + `${to(Math.round(pa[1] + (pb[1] - pa[1]) * t))}`
       + `${to(Math.round(pa[2] + (pb[2] - pa[2]) * t))}`;
}

function hex(c) {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}

/** Shade a colour for a cube face. Top is lit, left is mid, right is dark. */
export function shade(colour, face) {
  const k = face === 'top' ? 1.18 : face === 'left' ? 0.88 : 0.66;
  const [r, g, b] = hex(colour);
  const c = (n) => Math.max(0, Math.min(255, Math.round(n * k)));
  return `rgb(${c(r)},${c(g)},${c(b)})`;
}

// ---------------------------------------------------------------- shapes

/*
 * Twelve families, six silhouettes. Each builder returns voxels in a right-handed
 * lattice where +y is up, and everything is normalised afterwards, so a builder
 * only has to get the proportions right and never the scale.
 */
const BODY_PLAN = {
  cinder: 'quadruped', crag: 'lump', thorn: 'lump', myco: 'lump',
  brine: 'serpent', rime: 'quadruped', volt: 'insect', gale: 'flier',
  lumen: 'flier', gloom: 'wraith', slag: 'lump', tide: 'serpent',
};

/*
 * The apexes have no family of their own — `apex` is a bucket, not a lineage — so
 * they fell through to the default blob, which is a poor showing for the three
 * monsters the whole endgame is built around. Their element decides instead:
 * Karrahk is Tide and coils, Nyxhollow is Gloom and looms, Aeonrend is Rift.
 */
const ELEMENT_PLAN = {
  tide: 'serpent', brine: 'serpent', gloom: 'wraith', rift: 'wraith',
  gale: 'flier', lumen: 'flier', volt: 'insect', ember: 'quadruped',
  verdant: 'lump', stone: 'lump',
};

function planFor(species) {
  const byFamily = BODY_PLAN[species.family];
  if (byFamily) return byFamily;
  for (const el of species.elements ?? []) {
    if (ELEMENT_PLAN[el]) return ELEMENT_PLAN[el];
  }
  return 'lump';
}

const rnd = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const box = (out, x0, y0, z0, w, h, d, band) => {
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      for (let z = 0; z < d; z++) out.push({ x: x0 + x, y: y0 + y, z: z0 + z, band });
    }
  }
};

const PLANS = {
  quadruped(v, r, bulk) {
    const w = 3 + bulk, h = 2 + Math.round(bulk / 2), d = 6 + bulk;
    box(v, 0, 2, 0, w, h, d, 2);                                   // body
    box(v, 0, 2 + h, d - 3, w, 2, 3, 3);                           // head
    for (const [lx, lz] of [[0, 0], [w - 1, 0], [0, d - 2], [w - 1, d - 2]]) {
      box(v, lx, 0, lz, 1, 2, 2, 1);                               // legs
    }
    box(v, Math.floor(w / 2), 3 + h, -2, 1, 1, 3, 1);              // tail
  },
  lump(v, r, bulk) {
    const w = 4 + bulk, h = 3 + bulk, d = 4 + bulk;
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        for (let z = 0; z < d; z++) {
          // Carve a rough ellipsoid, then knock chips off it so no two look cast
          // from the same mould.
          const nx = (x - (w - 1) / 2) / (w / 2);
          const ny = (y - (h - 1) / 2) / (h / 2);
          const nz = (z - (d - 1) / 2) / (d / 2);
          if (nx * nx + ny * ny + nz * nz > 1.05) continue;
          if (r() < 0.10) continue;
          v.push({ x, y: y + 1, z, band: y > h * 0.6 ? 3 : 2 });
        }
      }
    }
    for (let i = 0; i < 2 + bulk; i++) {                            // spines
      v.push({ x: Math.floor(r() * w), y: h + 1, z: Math.floor(r() * d), band: 3 });
    }
  },
  serpent(v, r, bulk) {
    const len = 9 + bulk * 2;
    const thick = 1 + Math.round(bulk / 2);
    for (let i = 0; i < len; i++) {
      const y = 1 + Math.round(Math.sin(i * 0.7) * 1.4 + 1.4);
      const x = Math.round(Math.cos(i * 0.5) * 1.2);
      box(v, x, y, i, 1 + thick, 1 + thick, 1, i > len - 3 ? 3 : 2);
    }
    box(v, 0, 3, len, 2 + thick, 2 + thick, 2, 3);                  // head
  },
  insect(v, r, bulk) {
    const w = 3 + bulk, d = 4 + bulk;
    box(v, 0, 2, 0, w, 2, d, 2);                                    // thorax
    box(v, 0, 2, d, w, 2, 2, 3);                                    // head
    for (let i = 0; i < 3; i++) {                                   // legs, both sides
      box(v, -1, 1, 1 + i * 2, 1, 1, 1, 1);
      box(v, w, 1, 1 + i * 2, 1, 1, 1, 1);
    }
    box(v, 0, 4, 1, w, 1, d - 2, 1);                                // carapace
  },
  flier(v, r, bulk) {
    const w = 2 + Math.round(bulk / 2), d = 3 + bulk;
    box(v, 0, 3, 0, w, 2, d, 2);                                    // body
    box(v, 0, 3, d, w, 2, 2, 3);                                    // head
    for (let i = 0; i < 3 + bulk; i++) {                            // wings
      box(v, -1 - i, 4 + Math.round(i / 2), 1, 1, 1, d - 2, i % 2 ? 1 : 3);
      box(v, w + i, 4 + Math.round(i / 2), 1, 1, 1, d - 2, i % 2 ? 1 : 3);
    }
  },
  wraith(v, r, bulk) {
    const w = 3 + bulk, h = 5 + bulk;
    for (let y = 0; y < h; y++) {
      // Wide at the shoulders, dissolving into tatters at the hem.
      const spread = Math.max(1, Math.round(w * (0.4 + (y / h) * 0.6)));
      for (let x = 0; x < spread; x++) {
        for (let z = 0; z < spread; z++) {
          if (y < h * 0.35 && r() < 0.55) continue;
          v.push({ x, y: y + 1, z, band: y > h * 0.7 ? 3 : 2 });
        }
      }
    }
  },
};

const BULK = { mote: 0, whelp: 1, strider: 2, brute: 3, colossus: 4, titan: 5 };

/*
 * Where a weak point sits on the model. The names come straight from the bestiary
 * — throat, hind_joint, core, shroud_knot — and each maps to a region of the
 * bounding box, so the glowing voxels are in the same place as the thing the fight
 * makes you shoot at.
 */
const WEAK_REGION = {
  throat:        (b) => ({ x: 0.5, y: 0.78, z: 0.92 }),
  head:          (b) => ({ x: 0.5, y: 0.85, z: 0.90 }),
  eye:           (b) => ({ x: 0.3, y: 0.82, z: 0.95 }),
  hollow_eye:    (b) => ({ x: 0.5, y: 0.80, z: 0.95 }),
  core:          (b) => ({ x: 0.5, y: 0.50, z: 0.50 }),
  heart:         (b) => ({ x: 0.5, y: 0.55, z: 0.40 }),
  hind_joint:    (b) => ({ x: 0.15, y: 0.20, z: 0.15 }),
  joint:         (b) => ({ x: 0.85, y: 0.25, z: 0.30 }),
  spine:         (b) => ({ x: 0.5, y: 0.95, z: 0.45 }),
  shroud_knot:   (b) => ({ x: 0.5, y: 0.70, z: 0.20 }),
  vent:          (b) => ({ x: 0.5, y: 0.35, z: 0.10 }),
  wing_root:     (b) => ({ x: 0.10, y: 0.70, z: 0.50 }),
  tail:          (b) => ({ x: 0.5, y: 0.60, z: 0.05 }),
};

const DEFAULT_REGION = { x: 0.5, y: 0.6, z: 0.7 };

/**
 * Build a species' voxel model. Deterministic from the species id, so the same
 * monster is the same monster on every device and in every session.
 */
// ---------------------------------------------------------------- markings

/*
 * A monster used to be four tones of one hue and nothing else — a correctly
 * shaped blob. What a creature design needs on top of a silhouette is MARKINGS:
 * the belly that is paler than the back, the banding down a serpent, the mask
 * across a face. They are most of what makes one readable at sprite size, and
 * all of what makes two animals of the same build look like different animals.
 *
 * The accent they draw with is the species' SECOND element where it has one, so
 * the marking is not decoration — it is the type chart, legible on the model. A
 * Tide/Stone reads as a tide-coloured animal with stone banding, and knowing
 * that before you open the menu is the whole point of a type being visible.
 */
const MARKING = {
  cinder: 'stripes', volt: 'stripes',
  brine: 'underside', tide: 'underside', rime: 'underside', gale: 'underside',
  crag: 'plates', lumen: 'plates',
  thorn: 'spots', myco: 'spots',
  gloom: 'mask', slag: 'mottle',
};

/*
 * A single-element species has no second element to wear, and the first attempt
 * gave it `mix(ramp[3], white, 0.34)` — a lighter version of an already-light
 * band. Rendered, Pebblit, Obelisc, Umbrakhan and Glimmerfly came out flat:
 * technically marked, visibly plain, because a highlight is not a contrast.
 *
 * Each element gets a fixed partner instead, chosen to sit across from it rather
 * than beside it — gold on grey stone, violet on cream lumen, pale on violet
 * gloom. This carries no type meaning and is not supposed to: for a DUAL element
 * the accent is the second element and means something, and for a single it is
 * just the colour that makes the animal read as an animal.
 */
const CONTRAST = {
  stone: 'volt', ember: 'stone', tide: 'lumen', verdant: 'lumen',
  gale: 'volt', volt: 'gloom', gloom: 'lumen', lumen: 'gloom', rift: 'lumen',
};

/** The colour a marking draws in: the second element, or the first's partner. */
function accentFor(species, ramp) {
  const els = species.elements ?? [];
  if (els.length > 1 && ELEMENT_RAMP[els[1]]) return ELEMENT_RAMP[els[1]][2];
  const partner = ELEMENT_RAMP[CONTRAST[els[0]] ?? 'volt'];
  return partner ? partner[2] : mix(ramp[3], '#ffffff', 0.34);
}

function markingFor(species) {
  if (MARKING[species.family]) return MARKING[species.family];
  // Apexes have no family, so their plan decides — a wraith gets a mask, a
  // serpent a belly, and nothing falls through to "no markings at all".
  const plan = planFor(species);
  return plan === 'serpent' ? 'underside' : plan === 'wraith' ? 'mask'
    : plan === 'insect' ? 'stripes' : plan === 'flier' ? 'underside' : 'plates';
}

/**
 * Repaint some of the body in the accent. Runs before weak points, which
 * overwrite whatever they land on — an eye outranks a stripe.
 */
function applyMarkings(species, voxels, size, ramp, r, { riftTouched = false, pull = 0.55 } = {}) {
  const kind = markingFor(species);
  // The accent shifts with the body, or a rift-touched monster keeps ordinary
  // markings on changed skin and the two halves stop looking like one animal.
  const accent = riftTouched
    ? mix(accentFor(species, ramp), ELEMENT_RAMP.rift[2], pull)
    : accentFor(species, ramp);
  const deep = mix(accent, '#000000', 0.35);

  for (const v of voxels) {
    switch (kind) {
      case 'stripes': {
        /*
         * Bands across the long axis, nudged by height so they are not a
         * barcode. A flat `axis % 4 < 2` rendered as corrugated iron: perfectly
         * even, perfectly artificial. Offsetting each layer gives the band a
         * lean, which is what makes it read as an animal's stripe.
         */
        const axis = size.x >= size.z ? v.x : v.z;
        if ((axis + (v.y >> 1)) % 5 < 2 && v.y > size.y * 0.22) v.colour = accent;
        break;
      }
      case 'underside': {
        /*
         * Counted in LAYERS, not as a fraction of the height. A fraction works
         * on a tall animal and swallows a short one: Gustling is three voxels
         * tall, so "the bottom third" rounded up to two of its three layers and
         * repainted 81% of the model — a Gale monster that had stopped looking
         * Gale. Floor it to whole layers and it is 33%.
         */
        if (v.y < Math.max(1, Math.floor(size.y * 0.35))) v.colour = accent;
        break;
      }
      case 'plates': {
        // A ridge along the spine. The first version wanted the top two layers
        // AND the middle fifth, which on a broad lump is almost no voxels at all.
        const mid = Math.abs(v.z - (size.z - 1) / 2) <= Math.max(1, size.z * 0.3);
        if (v.y >= size.y - Math.max(2, Math.round(size.y * 0.3)) && mid) v.colour = accent;
        break;
      }
      case 'spots': {
        // Deterministic per voxel, so a species is spotted the same way forever.
        const h = Math.imul((v.x + 1) * 73856093 ^ (v.y + 1) * 19349663 ^ (v.z + 1) * 83492791, 0x27d4eb2d) >>> 0;
        if (h % 100 < 22) v.colour = h % 2 ? accent : deep;
        break;
      }
      case 'mask': {
        // The front of the upper body, where a face would be. Both thresholds
        // were too tight: on a wraith it landed on a handful of voxels and the
        // monster stayed one flat colour.
        if (v.y > size.y * 0.5 && v.z > size.z * 0.5) v.colour = deep;
        break;
      }
      case 'mottle': {
        if (r() < 0.24) v.colour = mix(v.colour, accent, 0.55);
        break;
      }
      default: break;
    }
  }
}

// ---------------------------------------------------------------- biome coats

/*
 * What settles on an animal that lives somewhere: soot, rust, dust, moss, water.
 *
 * The coats table lives in elements.json; the app hands it in at load. It is a
 * separate channel from the markings ON PURPOSE — markings mean the second
 * element, so putting the biome there would have traded the type legibility that
 * was the whole point of having markings for a different piece of information.
 *
 * A coat lands only on TOP-EXPOSED voxels, meaning the ones with nothing
 * directly above them. That is both how dust actually behaves and why the effect
 * reads at sprite size without swamping the body: the silhouette keeps its
 * element colour, the upward faces carry where it has been.
 */
let COATS = { strength: 0.34, coats: {} };
export function setBiomeCoats(table) {
  if (table && table.coats) COATS = table;
}
export const biomeCoat = (biome) => COATS.coats?.[biome] ?? null;

function applyCoat(voxels, biome) {
  const coat = COATS.coats?.[biome];
  if (!coat) return;
  const solid = new Set(voxels.map((v) => `${v.x},${v.y},${v.z}`));
  const k = COATS.strength ?? 0.34;
  for (const v of voxels) {
    if (v.weak) continue;                                   // an eye is not dusty
    if (solid.has(`${v.x},${v.y + 1},${v.z}`)) continue;     // something above it
    v.colour = mix(v.colour, coat.colour, k);
  }
}

export function buildModel(species, { riftTouched = false, pull = 0.55, biome = null } = {}) {
  const plan = PLANS[planFor(species)] ?? PLANS.lump;
  const r = rnd(hashString(species.id));
  const bulk = BULK[species.size] ?? 2;
  /*
   * A rift-touched specimen wears the one palette no ordinary species can: its
   * own colours dragged partway toward Rift. Partway is the point — pulled all
   * the way, every rare monster is the same violet and you can no longer tell
   * what you are looking at, which is the opposite of what a rare skin is for.
   */
  const base = rampFor(species.elements ?? ['stone']);
  const ramp = riftTouched
    ? base.map((c, i) => mix(c, ELEMENT_RAMP.rift[i], pull))
    : base;

  const raw = [];
  plan(raw, r, bulk);
  // A later stage is a bigger, spinier animal, not just a recoloured one.
  if ((species.stage ?? 1) > 1) {
    const extra = (species.stage - 1) * (2 + bulk);
    for (let i = 0; i < extra; i++) {
      const base = raw[Math.floor(r() * raw.length)];
      if (base) raw.push({ x: base.x, y: base.y + 1, z: base.z, band: 3 });
    }
  }
  if (!raw.length) box(raw, 0, 0, 0, 2, 2, 2, 2);

  // Normalise to a lattice starting at the origin.
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const v of raw) {
    min.x = Math.min(min.x, v.x); max.x = Math.max(max.x, v.x);
    min.y = Math.min(min.y, v.y); max.y = Math.max(max.y, v.y);
    min.z = Math.min(min.z, v.z); max.z = Math.max(max.z, v.z);
  }
  const size = { x: max.x - min.x + 1, y: max.y - min.y + 1, z: max.z - min.z + 1 };

  const seen = new Set();
  const voxels = [];
  for (const v of raw) {
    const x = v.x - min.x, y = v.y - min.y, z = v.z - min.z;
    const k = `${x},${y},${z}`;
    if (seen.has(k)) continue;
    seen.add(k);
    voxels.push({ x, y, z, colour: ramp[Math.max(0, Math.min(3, v.band))], weak: false });
  }

  applyMarkings(species, voxels, size, ramp, r, { riftTouched, pull });

  // Weak points last, so they overwrite whatever body voxel was there.
  const byKey = new Map(voxels.map((v) => [`${v.x},${v.y},${v.z}`, v]));
  const weakNames = species.weak_points?.length
    ? species.weak_points
    : (species.weak_point_requires ? ['core'] : []);
  for (const name of weakNames) {
    const region = (WEAK_REGION[name] ?? (() => DEFAULT_REGION))(size);
    const target = {
      x: Math.round(region.x * (size.x - 1)),
      y: Math.round(region.y * (size.y - 1)),
      z: Math.round(region.z * (size.z - 1)),
    };
    // Snap to the nearest solid voxel: a weak point floating in mid-air beside
    // the model reads as a bug, not as an eye.
    let best = null, bestD = Infinity;
    for (const v of voxels) {
      const d = (v.x - target.x) ** 2 + (v.y - target.y) ** 2 + (v.z - target.z) ** 2;
      if (d < bestD) { bestD = d; best = v; }
    }
    if (best) { best.weak = true; best.colour = WEAK_COLOUR; }
    void byKey;
  }

  if (biome) applyCoat(voxels, biome);

  return { id: species.id, size, voxels, ramp, riftTouched, biome: biome ?? null };
}

// ---------------------------------------------------------------- renderer

/**
 * The screen box a model occupies at a given rotation and scale.
 *
 * Needed because the isometric projection grows upward from its anchor: a Titan
 * drawn at the same anchor as a Mote runs off the top of its frame. Measuring
 * first and centring second is the difference between a grid of monsters and a
 * grid of monsters with their heads cut off.
 */
export function projectedBounds(model, turns = 0, scale = 4) {
  const a = turns * Math.PI * 2;
  const cos = Math.cos(a), sin = Math.sin(a);
  const { size } = model;
  const cx = (size.x - 1) / 2, cz = (size.z - 1) / 2;
  const w = scale, h = scale * 0.5;
  const depth = scale * 0.85;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const v of model.voxels) {
    const dx = v.x - cx, dz = v.z - cz;
    const rx = dx * cos - dz * sin;
    const rz = dx * sin + dz * cos;
    const sx = (rx - rz) * w;
    const sy = (rx + rz) * h - v.y * depth;
    minX = Math.min(minX, sx - w); maxX = Math.max(maxX, sx + w);
    minY = Math.min(minY, sy);     maxY = Math.max(maxY, sy + h * 2 + depth);
  }
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

/**
 * Draw a model isometrically, rotated `turns` around its vertical axis.
 *
 * Painter's algorithm: rotate every voxel, sort by depth, draw three faces each.
 * At these voxel counts — a Titan is a few thousand — that is comfortably faster
 * than the frame budget, and it means rotation is free rather than needing a
 * pre-baked sprite per angle.
 */
export function drawModel(ctx, model, { x = 0, y = 0, scale = 4, turns = 0, alpha = 1, flash = 0 } = {}) {
  const a = turns * Math.PI * 2;
  const cos = Math.cos(a), sin = Math.sin(a);
  const { size } = model;
  const cx = (size.x - 1) / 2, cz = (size.z - 1) / 2;

  const placed = model.voxels.map((v) => {
    const dx = v.x - cx, dz = v.z - cz;
    const rx = dx * cos - dz * sin;
    const rz = dx * sin + dz * cos;
    return { rx, rz, y: v.y, colour: v.colour, weak: v.weak, depth: rx + rz + v.y * 0.001 };
  });
  placed.sort((p, q) => p.depth - q.depth);

  const w = scale, h = scale * 0.5;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);

  for (const p of placed) {
    // Isometric: x and z both contribute to screen x and y; height only to y.
    const sx = (p.rx - p.rz) * w;
    const sy = (p.rx + p.rz) * h - p.y * scale * 0.85;
    let colour = p.colour;
    if (flash > 0 && !p.weak) colour = mix(colour, '#ffffff', Math.min(1, flash));

    // top
    ctx.fillStyle = shade(colour, 'top');
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + w, sy + h);
    ctx.lineTo(sx, sy + h * 2);
    ctx.lineTo(sx - w, sy + h);
    ctx.closePath(); ctx.fill();

    // left
    ctx.fillStyle = shade(colour, 'left');
    ctx.beginPath();
    ctx.moveTo(sx - w, sy + h);
    ctx.lineTo(sx, sy + h * 2);
    ctx.lineTo(sx, sy + h * 2 + scale * 0.85);
    ctx.lineTo(sx - w, sy + h + scale * 0.85);
    ctx.closePath(); ctx.fill();

    // right
    ctx.fillStyle = shade(colour, 'right');
    ctx.beginPath();
    ctx.moveTo(sx + w, sy + h);
    ctx.lineTo(sx, sy + h * 2);
    ctx.lineTo(sx, sy + h * 2 + scale * 0.85);
    ctx.lineTo(sx + w, sy + h + scale * 0.85);
    ctx.closePath(); ctx.fill();
  }

  ctx.restore();
}

/*
 * Sprite cache.
 *
 * The map draws dozens of markers a frame and the Codex draws forty entries; both
 * want a picture, not a scene. One render per (species, angle, size) is kept and
 * reused, which is the difference between a marker costing a few hundred polygons
 * and costing none.
 */
const sprites = new Map();
const models = new Map();

export function modelFor(species, opts = {}) {
  // Keyed on the variant: a rift-touched Cinderfang and an ordinary one are two
  // models, and caching them under one id would show whichever was built first.
  const key = `${species.id}${opts.riftTouched ? '!rift' : ''}${opts.biome ? `@${opts.biome}` : ''}`;
  if (!models.has(key)) models.set(key, buildModel(species, opts));
  return models.get(key);
}

export function spriteFor(species, px = 48, turns = 0.125, opts = {}) {
  const key = `${species.id}${opts.riftTouched ? '!rift' : ''}${opts.biome ? `@${opts.biome}` : ''}:${px}:${turns.toFixed(3)}`;
  if (sprites.has(key)) return sprites.get(key);

  const model = modelFor(species, opts);
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  fitModel(canvas.getContext('2d'), model, { turns, width: px, height: px, pad: 0.92 });

  sprites.set(key, canvas);
  return canvas;
}

/**
 * Draw a model scaled and centred to fill a box. Every caller wants this rather
 * than drawModel's raw anchor, because every caller has a frame to fill.
 */
export function fitModel(ctx, model, { turns = 0.125, width, height, pad = 0.9, x = 0, y = 0, alpha = 1, flash = 0 } = {}) {
  // Measure at scale 1, then scale the whole box: the projection is linear in
  // scale, so one measurement answers for every size.
  const unit = projectedBounds(model, turns, 1);
  const scale = Math.min((width * pad) / unit.width, (height * pad) / unit.height);
  const b = projectedBounds(model, turns, scale);
  drawModel(ctx, model, {
    x: x + width / 2 - (b.minX + b.maxX) / 2,
    y: y + height / 2 - (b.minY + b.maxY) / 2,
    scale, turns, alpha, flash,
  });
  return scale;
}

/** Only for tests and for a hot reload; the cache is otherwise permanent. */
export function clearVoxelCache() {
  sprites.clear();
  models.clear();
}
