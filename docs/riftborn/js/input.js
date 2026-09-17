/*
 * RIFTBORN phase 0 — input.
 *
 * Produces the same `intent` shape the balance sim's bot produces, so the fight
 * code never knows or cares whether a human or a script is driving it.
 *
 * Desktop: WASD/arrows move, mouse aims, hold to fire, Space swaps chamber,
 *          R reloads, E tags.
 * Touch:   drag the left half to move, hold the right half to aim and fire,
 *          on-screen buttons for swap / reload / tag.
 */

import { ARENA } from './game.js';

const MOVE_KEYS = {
  KeyW: [0, -1], ArrowUp: [0, -1],
  KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
};

export function createInput(canvas, options = {}) {
  const keys = new Set();
  const pulses = { swap: false, reload: false, tag: false };
  let pointer = null;        // arena-space cursor, or null
  let firing = false;

  // Touch state: one finger steers, another aims.
  let stick = null;          // { id, ox, oy, x, y }
  let aimTouch = null;       // { id, x, y }

  const toArena = (clientX, clientY) => {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((clientX - r.left) / r.width) * ARENA.w,
      y: ((clientY - r.top) / r.height) * ARENA.h,
    };
  };

  // ---- keyboard
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code in MOVE_KEYS || ['Space', 'KeyR', 'KeyE', 'KeyQ'].includes(e.code)) e.preventDefault();
    keys.add(e.code);
    if (e.code === 'Space' || e.code === 'KeyQ') pulses.swap = true;
    if (e.code === 'KeyR') pulses.reload = true;
    if (e.code === 'KeyE') pulses.tag = true;
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => { keys.clear(); firing = false; });

  // ---- mouse
  canvas.addEventListener('mousemove', (e) => { pointer = toArena(e.clientX, e.clientY); });
  canvas.addEventListener('mouseleave', () => { firing = false; });
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    pointer = toArena(e.clientX, e.clientY);
    firing = true;
    pulses.tag = true;              // clicking is also how you tag a subdued monster
  });
  window.addEventListener('mouseup', () => { firing = false; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---- touch
  const onTouch = (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    for (const t of e.changedTouches) {
      // On the map every drag steers; in a fight the screen is split into move and aim.
      const leftHalf = options.allTouchSteers ? true : t.clientX < r.left + r.width / 2;
      if (e.type === 'touchstart') {
        if (leftHalf && !stick) stick = { id: t.identifier, ox: t.clientX, oy: t.clientY, x: t.clientX, y: t.clientY };
        else if (!leftHalf && !aimTouch) {
          aimTouch = { id: t.identifier, ...toArena(t.clientX, t.clientY) };
          firing = true;
          pulses.tag = true;
        }
      } else if (e.type === 'touchmove') {
        if (stick && t.identifier === stick.id) { stick.x = t.clientX; stick.y = t.clientY; }
        if (aimTouch && t.identifier === aimTouch.id) Object.assign(aimTouch, toArena(t.clientX, t.clientY));
      } else {
        if (stick && t.identifier === stick.id) stick = null;
        if (aimTouch && t.identifier === aimTouch.id) { aimTouch = null; firing = false; }
      }
    }
  };
  for (const ev of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
    canvas.addEventListener(ev, onTouch, { passive: false });
  }

  return {
    /** Read and clear one frame of intent. */
    getIntent(f) {
      let mx = 0, my = 0;
      for (const code of keys) {
        const d = MOVE_KEYS[code];
        if (d) { mx += d[0]; my += d[1]; }
      }
      if (stick) {
        const dx = stick.x - stick.ox, dy = stick.y - stick.oy;
        const len = Math.hypot(dx, dy);
        if (len > 10) { mx += dx / len; my += dy / len; }
      }

      const target = aimTouch ?? pointer;
      const aim = target ? Math.atan2(target.y - f.player.y, target.x - f.player.x) : f.player.aim;

      const intent = { moveX: mx, moveY: my, aim, firing, swap: pulses.swap, reload: pulses.reload, tag: pulses.tag };
      pulses.swap = pulses.reload = pulses.tag = false;
      return intent;
    },
    pulse(name) { if (name in pulses) pulses[name] = true; },
    get isTouch() { return stick !== null || aimTouch !== null; },
  };
}
