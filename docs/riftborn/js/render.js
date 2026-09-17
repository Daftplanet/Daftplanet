/*
 * RIFTBORN phase 0 — renderer.
 *
 * Deliberately a grey box. Flat shapes, a grid, and readable numbers: this build
 * exists to answer "is the kill-or-capture decision tense", and art would only
 * get in the way of that question.
 */

import { ARENA, weakPointPositions, activeStatuses, isDone, assistPhase, assistMiss, ASSIST_CONFIG } from './game.js';

const C = {
  floor: '#191b1e',
  grid: '#25292f',
  gridMajor: '#32383f',
  wall: '#3a3f45',
  player: '#e8eaed',
  playerHurt: '#ff6b6b',
  monster: '#c2622f',
  monsterLit: '#ffd9a0',
  monsterSedated: '#5f8fb5',
  monsterEnraged: '#e0403a',
  weak: '#ffd23f',
  telegraph: '#e0403a',
  bullet: '#fff4d6',
  dart: '#69d2e7',
  hp: '#d9463f',
  restraint: '#69d2e7',
  text: '#9aa3ad',
};

export function fitCanvas(canvas) {
  const parent = canvas.parentElement;
  const availW = parent.clientWidth || ARENA.w;
  const availH = parent.clientHeight;

  /*
   * On the stacked mobile layout the stage sizes itself to its content, so the
   * canvas height and the parent height depend on each other. A canvas measured
   * while hidden reports a parent height of 0 and would pin itself to 0px — which
   * silently collapsed the fight arena on phones, the one platform this is for.
   * With no usable height to divide by, fit to width and let it letterbox.
   */
  const scale = availH > 40
    ? Math.min(availW / ARENA.w, availH / ARENA.h)
    : availW / ARENA.w;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(ARENA.w * dpr);
  canvas.height = Math.round(ARENA.h * dpr);
  canvas.style.width = `${Math.round(ARENA.w * scale)}px`;
  canvas.style.height = `${Math.round(ARENA.h * scale)}px`;
  return { scale, dpr };
}

const ELEMENT_TINT = {
  ember: '#c2622f', tide: '#4a90b8', verdant: '#5f9e5a', stone: '#8a8378',
  gale: '#8fb8c9', volt: '#d9c04a', gloom: '#7a6b96', lumen: '#e0d090', rift: '#b05ad0',
};

export function draw(ctx, f, view) {
  const { dpr } = view;
  ctx.save();
  ctx.scale(dpr, dpr);

  const sx = (Math.random() - 0.5) * f.shake;
  const sy = (Math.random() - 0.5) * f.shake;
  ctx.translate(sx, sy);

  drawFloor(ctx);
  for (const m of f.monsters) drawTelegraph(ctx, m);
  drawBursts(ctx, f);
  for (const m of f.monsters) drawMonster(ctx, f, m, view, m === f.monster);
  drawEscort(ctx, f);
  drawPlayer(ctx, f);
  if (f.aimMode === 'assisted') drawAssist(ctx, f);
  drawProjectiles(ctx, f);
  drawFloaters(ctx, f);

  ctx.restore();
}

function drawFloor(ctx) {
  ctx.fillStyle = C.floor;
  ctx.fillRect(0, 0, ARENA.w, ARENA.h);

  ctx.lineWidth = 1;
  for (let x = 0; x <= ARENA.w; x += 40) {
    ctx.strokeStyle = x % 160 === 0 ? C.gridMajor : C.grid;
    ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, ARENA.h); ctx.stroke();
  }
  for (let y = 0; y <= ARENA.h; y += 40) {
    ctx.strokeStyle = y % 160 === 0 ? C.gridMajor : C.grid;
    ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(ARENA.w, y + 0.5); ctx.stroke();
  }
  ctx.strokeStyle = C.wall;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, ARENA.w - 2, ARENA.h - 2);
}

/** The lunge tell. If a player can't read this, the attack is unfair. */
function drawTelegraph(ctx, m) {
  if (m.state !== 'windup') return;
  const progress = Math.min(1, m.stateT / 0.45);
  ctx.save();
  ctx.globalAlpha = 0.25 + progress * 0.5;
  ctx.strokeStyle = C.telegraph;
  ctx.lineWidth = 2 + progress * 4;
  ctx.setLineDash([12, 8]);
  ctx.beginPath();
  ctx.moveTo(m.x, m.y);
  ctx.lineTo(m.x + Math.cos(m.facing) * 300, m.y + Math.sin(m.facing) * 300);
  ctx.stroke();
  ctx.restore();
}

/** Area blasts and chain arcs, drawn under the monsters so they read as ground effects. */
function drawBursts(ctx, f) {
  for (const b of f.bursts) {
    const k = b.t / 0.4;
    ctx.save();
    ctx.globalAlpha = 1 - k;
    if (b.kind === 'chain') {
      ctx.strokeStyle = '#d9c04a';
      ctx.lineWidth = 3 * (1 - k) + 1;
      ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
    } else {
      ctx.strokeStyle = b.kind === 'capture' ? C.dart : '#ff9d8a';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.radius * (0.55 + 0.45 * k), 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }
}

function drawMonster(ctx, f, m, view, focused) {
  if (m.state === 'escaped' || m.state === 'tagged') return;

  const statuses = activeStatuses(m);
  let body = ELEMENT_TINT[f.loadout.species.elements[0]] ?? C.monster;
  if (statuses.includes('enraged')) body = C.monsterEnraged;
  else if (statuses.includes('sedated') || statuses.includes('stunned')) body = C.monsterSedated;
  if (m.hitFlash > 0) body = C.monsterLit;

  const dead = m.state === 'dead';
  const subdued = m.state === 'subdued';

  ctx.save();
  ctx.translate(m.x, m.y);
  ctx.rotate(m.facing);
  if (dead) { ctx.globalAlpha = 0.35; ctx.scale(1, 0.5); }
  if (subdued) ctx.scale(1, 0.72);

  // Body: a blunt wedge so facing is unmistakable at a glance.
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(m.radius * 1.05, 0);
  ctx.lineTo(-m.radius * 0.55, -m.radius * 0.85);
  ctx.lineTo(-m.radius * 0.9, 0);
  ctx.lineTo(-m.radius * 0.55, m.radius * 0.85);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // Hiding weak points stands in for an unresearched Codex entry: they are still
  // there and still take the multiplier, you just cannot see where.
  if (!dead && !subdued && view.showWeakPoints !== false) {
    // A gloom-shrouded weak point is already absent from m.weakPoints while dark,
    // so there is nothing to filter here — it simply has no position to draw.
    for (const wp of Object.values(weakPointPositions(m))) {
      const pulse = 0.65 + 0.35 * Math.sin(f.t * 7);
      ctx.fillStyle = C.weak;
      ctx.globalAlpha = pulse;
      ctx.beginPath(); ctx.arc(wp.x, wp.y, wp.radius, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
      // The Tracker Lens rings what the plain eye only tints.
      if (view.markWeakPoints) {
        ctx.strokeStyle = C.weak;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(wp.x, wp.y, wp.radius + 5 + Math.sin(f.t * 4) * 1.5, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }

  if (focused && !dead && !subdued) {
    // A soft ring marks which pack member the crosshair is reading.
    ctx.strokeStyle = 'rgba(230,233,237,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(m.x, m.y, m.radius + 9, 0, Math.PI * 2); ctx.stroke();
  }

  if (statuses.includes('ensnared') && !dead) {
    ctx.save();
    ctx.strokeStyle = 'rgba(105,210,231,0.7)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI;
      ctx.beginPath();
      ctx.moveTo(m.x + Math.cos(a) * m.radius, m.y + Math.sin(a) * m.radius);
      ctx.lineTo(m.x - Math.cos(a) * m.radius, m.y - Math.sin(a) * m.radius);
      ctx.stroke();
    }
    ctx.restore();
  }

  if (!dead) drawMonsterBars(ctx, f, m, view);
  if (subdued) drawSubduePrompt(ctx, f, m);
}

function drawMonsterBars(ctx, f, m, view = {}) {
  const w = Math.max(54, Math.min(110, m.radius * 3)), h = 5;
  const x = m.x - w / 2, y = m.y - m.radius - 26;

  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(x - 1, y - 1, w + 2, h * 2 + 5);

  ctx.fillStyle = '#000';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = C.hp;
  ctx.fillRect(x, y, w * Math.max(0, m.hp / m.maxHp), h);

  // The monster's own requirement, not the loadout's: apexes scale theirs with
  // party size, so drawing against the unscaled figure showed a full bar as a third full.
  const raw = Math.min(1, m.restraint / (m.required ?? f.loadout.required));
  // Coarse without a Bio-Scanner, to the quarter, same as the HUD meter.
  const rFrac = view.coarseRestraint ? Math.floor(raw * 4) / 4 : raw;
  ctx.fillStyle = '#000';
  ctx.fillRect(x, y + h + 3, w, h);
  ctx.fillStyle = C.restraint;
  ctx.fillRect(x, y + h + 3, w * rFrac, h);
}

function drawSubduePrompt(ctx, f, m) {
  const left = Math.max(0, f.loadout.subdueWindow - m.stateT);
  const frac = left / f.loadout.subdueWindow;

  ctx.save();
  ctx.strokeStyle = C.restraint;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(m.x, m.y, m.radius + 16, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = C.restraint;
  ctx.font = 'bold 15px ui-monospace, Menlo, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.fillText('SUBDUED — TAG IT', m.x, m.y - m.radius - 34);
  ctx.fillText(left.toFixed(1), m.x, m.y + 5);
  ctx.restore();
}

/*
 * The escort: a small companion that orbits the Warden. It has no collision, takes
 * no damage and never moves toward the target, because it does not fight — the
 * whole point of answering decision 1 with "Limited" is that it is a button the
 * Warden presses, not a second combatant to watch.
 */
/*
 * Assisted aim's two pieces of feedback: a bracket on the locked target, and the
 * timing ring around the Warden. The ring restarts on every shot and the gold arc
 * is where a release takes a weak point — it is the whole interface for a mode
 * with no reticle to steer.
 */
function drawAssist(ctx, f) {
  const p = f.player;
  const m = f.monster;

  if (m && !isDone(m)) {
    const r = m.radius + 12;
    ctx.save();
    ctx.strokeStyle = C.restraint;
    ctx.lineWidth = 2;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      ctx.beginPath();
      ctx.moveTo(m.x + sx * r, m.y + sy * r - sy * 7);
      ctx.lineTo(m.x + sx * r, m.y + sy * r);
      ctx.lineTo(m.x + sx * r - sx * 7, m.y + sy * r);
      ctx.stroke();
    }
    ctx.restore();
  }

  const phase = assistPhase(f);
  const gold = assistMiss(f) === 0;
  const R = p.radius + 13;
  const TAU = Math.PI * 2;
  const top = -Math.PI / 2;

  ctx.save();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(232,234,237,0.14)';
  ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, TAU); ctx.stroke();

  // the gold band
  const c = ASSIST_CONFIG.bandCentre;
  const hw = ASSIST_CONFIG.bandWidth / 2;
  ctx.strokeStyle = C.weak;
  ctx.beginPath(); ctx.arc(p.x, p.y, R, top + (c - hw) * TAU, top + (c + hw) * TAU); ctx.stroke();

  // the sweep so far
  ctx.strokeStyle = gold ? C.weak : C.restraint;
  ctx.lineWidth = gold ? 4 : 2;
  ctx.beginPath(); ctx.arc(p.x, p.y, R, top, top + Math.min(1, phase) * TAU); ctx.stroke();
  ctx.restore();
}

function drawEscort(ctx, f) {
  const e = f.escort;
  if (!e) return;
  const p = f.player;
  const a = f.t * 1.1;
  const x = p.x + Math.cos(a) * 26;
  const y = p.y + Math.sin(a) * 26 * 0.6;
  const tint = ELEMENT_TINT[e.element] ?? C.text;
  const live = e.charges > 0 && e.readyIn <= 0;

  ctx.save();
  if (live) {
    ctx.globalAlpha = 0.25 + 0.15 * Math.sin(f.t * 5);
    ctx.fillStyle = tint;
    ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = e.charges > 0 ? tint : '#4a5058';
  ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

function drawPlayer(ctx, f) {
  const p = f.player;
  ctx.save();

  // Bulwark reads as a ring around the Warden, not a number somewhere else.
  if (p.shield > 0) {
    ctx.strokeStyle = ELEMENT_TINT.stone;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.radius + 6, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Aim line, faded out to the weapon's maximum range.
  const range = f.loadout.weapon.range_m * 22;
  const grad = ctx.createLinearGradient(p.x, p.y, p.x + Math.cos(p.aim) * range, p.y + Math.sin(p.aim) * range);
  grad.addColorStop(0, 'rgba(232,234,237,0.30)');
  grad.addColorStop(1, 'rgba(232,234,237,0)');
  ctx.strokeStyle = grad;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(p.x + Math.cos(p.aim) * range, p.y + Math.sin(p.aim) * range);
  ctx.stroke();

  ctx.fillStyle = p.hitFlash > 0 ? C.playerHurt : C.player;
  ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2); ctx.fill();

  // Barrel, tinted by the loaded chamber.
  ctx.strokeStyle = f.weapon.chamber === 'capture' ? C.dart : C.bullet;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(p.x + Math.cos(p.aim) * 20, p.y + Math.sin(p.aim) * 20);
  ctx.stroke();

  if (p.invuln > 0) {
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = C.playerHurt;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.radius + 5, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}

function drawProjectiles(ctx, f) {
  for (const p of f.projectiles) {
    const isDart = p.kind === 'capture';
    ctx.strokeStyle = isDart ? C.dart : C.bullet;
    ctx.lineWidth = isDart ? 3 : 2;
    const len = isDart ? 10 : 16;
    const a = Math.atan2(p.vy, p.vx);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x - Math.cos(a) * len, p.y - Math.sin(a) * len);
    ctx.stroke();
  }
}

function drawFloaters(ctx, f) {
  ctx.save();
  ctx.font = 'bold 13px ui-monospace, Menlo, Consolas, monospace';
  ctx.textAlign = 'center';
  for (const fl of f.floaters) {
    const k = fl.t / 0.9;
    ctx.globalAlpha = 1 - k;
    ctx.fillStyle = fl.kind === 'damage' ? '#ff9d8a' : fl.kind === 'restraint' ? C.dart : C.playerHurt;
    ctx.fillText(fl.text, fl.x, fl.y - k * 26);
  }
  ctx.restore();
}
