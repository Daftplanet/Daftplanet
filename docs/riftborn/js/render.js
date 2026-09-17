/*
 * RIFTBORN phase 0 — renderer.
 *
 * Deliberately a grey box. Flat shapes, a grid, and readable numbers: this build
 * exists to answer "is the kill-or-capture decision tense", and art would only
 * get in the way of that question.
 */

import { ARENA, weakPointPositions, activeStatuses } from './game.js';

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
  const scale = Math.min(parent.clientWidth / ARENA.w, parent.clientHeight / ARENA.h);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(ARENA.w * dpr);
  canvas.height = Math.round(ARENA.h * dpr);
  canvas.style.width = `${Math.round(ARENA.w * scale)}px`;
  canvas.style.height = `${Math.round(ARENA.h * scale)}px`;
  return { scale, dpr };
}

export function draw(ctx, f, view) {
  const { dpr } = view;
  ctx.save();
  ctx.scale(dpr, dpr);

  const sx = (Math.random() - 0.5) * f.shake;
  const sy = (Math.random() - 0.5) * f.shake;
  ctx.translate(sx, sy);

  drawFloor(ctx);
  drawTelegraph(ctx, f);
  drawMonster(ctx, f, view);
  drawPlayer(ctx, f);
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
function drawTelegraph(ctx, f) {
  const m = f.monster;
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

function drawMonster(ctx, f, view) {
  const m = f.monster;
  if (m.state === 'escaped' || m.state === 'tagged') return;

  const statuses = activeStatuses(m);
  let body = C.monster;
  if (statuses.includes('enraged')) body = C.monsterEnraged;
  else if (statuses.includes('sedated')) body = C.monsterSedated;
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
    for (const wp of Object.values(weakPointPositions(m))) {
      const pulse = 0.65 + 0.35 * Math.sin(f.t * 7);
      ctx.fillStyle = C.weak;
      ctx.globalAlpha = pulse;
      ctx.beginPath(); ctx.arc(wp.x, wp.y, wp.radius, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  if (!dead) drawMonsterBars(ctx, f);
  if (subdued) drawSubduePrompt(ctx, f);
}

function drawMonsterBars(ctx, f) {
  const m = f.monster;
  const w = 86, h = 5;
  const x = m.x - w / 2, y = m.y - m.radius - 26;

  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(x - 1, y - 1, w + 2, h * 2 + 5);

  ctx.fillStyle = '#000';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = C.hp;
  ctx.fillRect(x, y, w * Math.max(0, m.hp / m.maxHp), h);

  const rFrac = Math.min(1, m.restraint / f.loadout.required);
  ctx.fillStyle = '#000';
  ctx.fillRect(x, y + h + 3, w, h);
  ctx.fillStyle = C.restraint;
  ctx.fillRect(x, y + h + 3, w * rFrac, h);
}

function drawSubduePrompt(ctx, f) {
  const m = f.monster;
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

function drawPlayer(ctx, f) {
  const p = f.player;
  ctx.save();

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
