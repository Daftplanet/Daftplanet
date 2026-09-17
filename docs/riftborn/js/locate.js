/*
 * RIFTBORN — where the Warden actually is.
 *
 * Two ways to have a position, and the game does not care which:
 *
 *   - LIVE: the device's GPS, watched continuously, so walking down the street
 *     walks on the map. This is the whole point of the genre.
 *   - MANUAL: drag the avatar. The fallback when permission is refused or there
 *     is no fix, and also the only way anyone can play this at a desk.
 *
 * Privacy, which 09-risks-and-roadmap.md commits to and this has to keep:
 * the coordinate never leaves the device. It is not sent anywhere, not stored in
 * the profile, and not written into a field report. The one unavoidable leak is
 * that asking a tile server for map tiles tells that server roughly where you are
 * — which is true of every map on the web, is why the tile request is the only
 * outbound call, and is worth saying out loud in the UI rather than hiding.
 *
 * Accuracy is surfaced rather than smoothed away. A 40-metre fix in a city centre
 * is normal and pretending otherwise makes spawns appear to jump.
 */

import { lonLatToWorld } from './geo.js';

export const LOCATE = {
  /** Below this, a fix is good enough to walk with. Above it, we show the doubt. */
  goodAccuracyM: 35,
  /** A jump further than this in one update is treated as a re-fix, not movement. */
  teleportM: 120,
  /** Faster than this and we stop counting distance — the speed lockout from `09`. */
  lockoutMps: 11,        // ~40 km/h
};

export function createLocator(opts = {}) {
  const onUpdate = opts.onUpdate ?? (() => {});
  const state = {
    mode: 'manual',            // 'manual' | 'live'
    status: 'idle',            // idle | requesting | tracking | denied | unavailable | error
    accuracyM: null,
    lastFixAt: null,
    speedMps: 0,
    lockedOut: false,
    message: '',
    lon: null,
    lat: null,
  };
  let watchId = null;
  let previous = null;

  const supported = typeof navigator !== 'undefined' && 'geolocation' in navigator;

  function handle(position) {
    const { longitude, latitude, accuracy, speed } = position.coords;
    const world = lonLatToWorld(longitude, latitude);
    const now = position.timestamp ?? Date.now();

    let jumped = false;
    if (previous) {
      const dt = Math.max(0.001, (now - previous.t) / 1000);
      const d = Math.hypot(world.x - previous.x, world.y - previous.y);
      state.speedMps = speed != null && Number.isFinite(speed) ? speed : d / dt;
      // A GPS re-fix can move you 100 m without you taking a step. Treat that as a
      // correction rather than as travel, or the walking rewards pay out for noise.
      jumped = d > LOCATE.teleportM;
    }
    previous = { x: world.x, y: world.y, t: now };

    state.status = 'tracking';
    state.accuracyM = accuracy ?? null;
    state.lastFixAt = now;
    state.lon = longitude;
    state.lat = latitude;
    state.lockedOut = state.speedMps > LOCATE.lockoutMps;
    state.message = state.lockedOut
      ? 'Moving too fast to patrol safely — spawns are paused.'
      : accuracy > LOCATE.goodAccuracyM
        ? `Weak fix — accurate to about ${Math.round(accuracy)} m.`
        : '';

    onUpdate({ x: world.x, y: world.y, jumped, accuracyM: accuracy ?? null, lockedOut: state.lockedOut });
  }

  function fail(err) {
    state.status = err?.code === 1 ? 'denied' : err?.code === 2 ? 'unavailable' : 'error';
    state.mode = 'manual';
    state.message = {
      denied: 'Location refused — drag the marker to move instead.',
      unavailable: 'No position available — drag the marker to move instead.',
      error: 'Location timed out — drag the marker to move instead.',
    }[state.status] ?? '';
    onUpdate(null);
  }

  return {
    get state() { return state; },
    get supported() { return supported; },

    /** Ask for permission and start watching. Resolves once we know the answer. */
    async start() {
      if (!supported) {
        state.status = 'unavailable';
        state.message = 'This device has no location service — drag the marker to move.';
        return false;
      }
      if (watchId !== null) return true;
      state.status = 'requesting';
      state.message = 'Waiting for a position…';
      return new Promise((resolve) => {
        let settled = false;
        watchId = navigator.geolocation.watchPosition(
          (pos) => {
            state.mode = 'live';
            handle(pos);
            if (!settled) { settled = true; resolve(true); }
          },
          (err) => {
            fail(err);
            if (!settled) { settled = true; resolve(false); }
            // A refusal is permanent for the session; stop asking.
            if (err?.code === 1) this.stop();
          },
          { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
        );
      });
    },

    stop() {
      if (watchId !== null && supported) navigator.geolocation.clearWatch(watchId);
      watchId = null;
      previous = null;
      state.mode = 'manual';
      if (state.status === 'tracking') state.status = 'idle';
    },

    /** Manual mode has no fix and no accuracy; say so rather than implying one. */
    setManual() {
      this.stop();
      state.accuracyM = null;
      state.speedMps = 0;
      state.lockedOut = false;
      state.message = '';
    },
  };
}
