/*
 * RIFTBORN — the Google Maps basemap.
 *
 * The hand-drawn city in city.js is a stylised guess at a place. This draws the
 * actual place: real streets, real building footprints, real parks, tilted, with
 * the monsters standing in it.
 *
 * It is optional and it degrades. No key, no network, a vector context that will
 * not start — each of those falls back to the canvas renderer the game shipped
 * with, because a game you play on a walk cannot stop working when a third party
 * does. Nothing in the game's rules reads from here: this layer draws a picture
 * and reports where the camera is, and that is the whole contract.
 *
 * Three decisions worth stating, because each one is load-bearing:
 *
 *   - The monsters are Google's own markers rather than sprites we position
 *     ourselves. Under a tilted, rotating camera, working out where a world
 *     position lands on screen is exactly the sort of arithmetic that is wrong
 *     by a few pixels forever. Handing the map a latitude and longitude makes
 *     the camera Google's problem, which is the correct place for it.
 *   - The engagement and detection radii are ground circles for the same reason.
 *     A circle drawn on our canvas would sit on the screen; these lie on the
 *     street and lean with it.
 *   - The key never enters the repository. It is read at runtime from a URL
 *     parameter or from this browser's storage. A client-side Maps key is
 *     visible to anyone using the page no matter what — that is inherent, and
 *     the answer is an HTTP-referrer restriction on the key — but a key committed
 *     to a public repository is found by scrapers within minutes, which is a
 *     different and much worse problem.
 */

import { worldToLonLat } from './geo.js';

// The Maps library exports something called Map, so keep a handle on the real
// one before anything shadows it.
const NativeMap = globalThis.Map;

const STORE_KEY = 'riftborn.gmaps.key';
const STORE_MAP_ID = 'riftborn.gmaps.mapid';

/**
 * Where the key comes from, in order: this page's URL, then this browser.
 *
 * A key in the URL is saved so a bookmark keeps working, and stripped from the
 * address bar so it does not end up pasted into a chat or a screenshot.
 */
export function configuredKey() {
  let key = null;
  let mapId = null;
  try {
    const q = new URLSearchParams(location.search);
    key = q.get('gmaps_key');
    mapId = q.get('gmaps_map_id');
    if (key) {
      localStorage.setItem(STORE_KEY, key);
      if (mapId) localStorage.setItem(STORE_MAP_ID, mapId);
      q.delete('gmaps_key');
      q.delete('gmaps_map_id');
      const rest = q.toString();
      history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
    }
    key = key ?? localStorage.getItem(STORE_KEY);
    mapId = mapId ?? localStorage.getItem(STORE_MAP_ID);
  } catch { /* private mode, blocked storage — no key, canvas renderer */ }
  return { key: key || null, mapId: mapId || null };
}

export function forgetKey() {
  try { localStorage.removeItem(STORE_KEY); localStorage.removeItem(STORE_MAP_ID); } catch { /* ignore */ }
}

let loading = null;

/** Load the Maps JavaScript API once, whoever asks and however often. */
function loadApi(key) {
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    if (window.google?.maps?.importLibrary) return resolve(window.google.maps);
    const cb = `__riftbornMaps${Date.now()}`;
    window[cb] = () => { delete window[cb]; resolve(window.google.maps); };
    // Google calls this when the key is rejected, and it is the ONLY signal for
    // that case — a bad key otherwise looks like a map that never arrives.
    window.gm_authFailure = () => reject(new Error('Google rejected the Maps API key'));
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&libraries=marker&callback=${cb}`;
    s.onerror = () => reject(new Error('could not reach the Maps API'));
    document.head.appendChild(s);
  });
  return loading;
}

/**
 * Stand a Google basemap up behind the game.
 *
 * Resolves to null when there is no key or the map cannot start, and the caller
 * keeps drawing its own city. It never throws for an ordinary failure, because
 * "no map today" is a supported state rather than an error.
 */
export async function createGoogleBasemap({ key, mapId, container, tilt = 60 }) {
  if (!key || !container) return null;
  let maps;
  try {
    maps = await loadApi(key);
  } catch (err) {
    console.warn('[riftborn] Google basemap unavailable:', err.message);
    return null;
  }

  const { Map } = await maps.importLibrary('maps');
  /*
   * Advanced markers need a Map ID, and a Map ID is a thing somebody has to go
   * and create in a console. Without one the library loads and then refuses,
   * once per marker, forever. So fall back to the classic marker: it is
   * deprecated and it works, and a real map with monsters on it beats a real map
   * with an error in the console while somebody finds the right settings page.
   */
  let AdvancedMarkerElement = null;
  if (mapId) {
    try { ({ AdvancedMarkerElement } = await maps.importLibrary('marker')); } catch { /* classic it is */ }
  }

  const opts = {
    center: { lat: 51.5007, lng: -0.1246 },
    zoom: 18,
    tilt,
    heading: 0,
    disableDefaultUI: true,
    keyboardShortcuts: false,
    gestureHandling: 'none',       // the game owns movement; the map follows
    renderingType: maps.RenderingType?.VECTOR,
    ...(mapId ? { mapId } : {}),
  };
  const map = new Map(container, opts);

  /*
   * Did the vector renderer actually start?
   *
   * Neither obvious answer is true. getRenderingType reports VECTOR from the
   * moment it is asked for, whether or not it works, and getTilt echoes back
   * whatever tilt was requested even on a raster map that cannot honour it — I
   * believed the second one and it cheerfully reported a tilted vector map while
   * the console was saying it had fallen back to raster.
   *
   * The renderer announces the fallback in exactly one place, a console warning,
   * so that is what there is to listen to. Wrapping console.warn is not pretty;
   * being wrong about which map is on screen is worse, because everything
   * downstream — whether to draw our own city, what to tell the player — turns
   * on it.
   */
  let fellBack = false;
  const watch = (fn) => (...args) => {
    if (String(args[0] ?? '').includes('Falling back to Raster')) fellBack = true;
    fn(...args);
  };
  console.warn = watch(console.warn.bind(console));
  console.error = watch(console.error.bind(console));
  await new Promise((done) => {
    const t = setTimeout(done, 6000);
    maps.event.addListenerOnce(map, 'idle', () => { clearTimeout(t); setTimeout(done, 400); });
  });
  /*
   * Read live, not once. The first version latched this immediately after the
   * map went idle and then reported a tilted vector map while the console was
   * still to announce the fallback — the renderer can give up at any point, so
   * a single reading taken early is a reading taken before the answer exists.
   */
  const isTilted = () => !fellBack && map.getTilt() > 1;

  const markers = new NativeMap();
  let circles = null;

  /*
   * A classic marker takes an image URL rather than an element, so the DOM node
   * the caller built has to become one. Only the sprite inside it survives —
   * the name label is an element, and this path cannot carry elements.
   */
  function classicIcon(node) {
    const canvas = node.querySelector('canvas');
    if (!canvas) return undefined;
    return {
      url: canvas.toDataURL(),
      scaledSize: new maps.Size(canvas.width, canvas.height),
      anchor: new maps.Point(canvas.width / 2, canvas.height),
    };
  }

  function circle(colour, weight, dash) {
    return new maps.Circle({
      map, center: opts.center, radius: 1,
      strokeColor: colour, strokeOpacity: dash ? 0.5 : 0.75, strokeWeight: weight,
      fillColor: colour, fillOpacity: dash ? 0.03 : 0.06, clickable: false,
    });
  }

  return {
    map,
    /** True when this is really the tilted vector map rather than flat raster. */
    get tilted() { return isTilted(); },
    get renderingType() { return isTilted() ? 'vector' : 'raster'; },
    /** What a player should be told is missing, or null when nothing is. */
    get advice() {
      if (!isTilted() && !mapId) return 'flat map — add a Map ID with vector rendering and tilt for the 3D view';
      if (!isTilted()) return 'flat map — that Map ID needs vector rendering and tilt enabled';
      if (!AdvancedMarkerElement) return 'using classic markers — a Map ID enables the better ones';
      return null;
    },

    /** Point the camera at the Warden. Heading follows the direction of travel. */
    follow(patrol, { heading = null, zoom = null } = {}) {
      const { lon, lat } = worldToLonLat(patrol.x, patrol.y);
      map.moveCamera({
        center: { lat, lng: lon },
        ...(heading == null ? {} : { heading }),
        ...(zoom == null ? {} : { zoom }),
        tilt,
      });
    },

    /** The two rings that say what you can see and what you can reach. */
    rings(patrol, { detectM, engageM }) {
      const { lon, lat } = worldToLonLat(patrol.x, patrol.y);
      const at = { lat, lng: lon };
      if (!circles) {
        circles = { detect: circle('#69d2e7', 1.5, true), engage: circle('#69d2e7', 2, false) };
      }
      circles.detect.setCenter(at); circles.detect.setRadius(detectM);
      circles.engage.setCenter(at); circles.engage.setRadius(engageM);
    },

    /**
     * Put the spawns on the map, reusing a marker per spawn id.
     *
     * Rebuilding every marker each frame is what makes a map like this stutter,
     * so this diffs: existing ones move, new ones are made, gone ones are
     * dropped. `content` is whatever the caller draws — the same sprite the
     * canvas renderer uses.
     */
    spawns(list, contentFor) {
      const seen = new Set();
      for (const s of list) {
        seen.add(s.id);
        const { lon, lat } = worldToLonLat(s.x, s.y);
        const at = { lat, lng: lon };
        let m = markers.get(s.id);
        if (!m) {
          m = AdvancedMarkerElement
            ? new AdvancedMarkerElement({ map, position: at, content: contentFor(s) })
            : new maps.Marker({ map, position: at, icon: classicIcon(contentFor(s)), clickable: false });
          markers.set(s.id, m);
        } else if (AdvancedMarkerElement) {
          m.position = at;
        } else {
          m.setPosition(at);
        }
      }
      for (const [id, m] of markers) {
        if (seen.has(id)) continue;
        m.map = null;
        markers.delete(id);
      }
    },

    /** How many spawn markers are on the map, which is the only way to count
     *  them from outside: a classic marker leaves nothing in the DOM to find. */
    get markerCount() { return markers.size; },

    destroy() {
      for (const [, m] of markers) m.map = null;
      markers.clear();
      if (circles) { circles.detect.setMap(null); circles.engage.setMap(null); circles = null; }
    },
  };
}
