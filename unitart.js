// unitart.js: Artie's unit art v2 (rts-loops/art/units/HANDOFF.md) for the Canvas 2D renderer.
// Pure helpers (manifest parsing, facing/heading selection, turret mount math, fallback selection) are DOM-free and
// require()-able in node for tests; the loader/recolour/draw part only runs in the browser.
// Any load failure or missing frame -> the caller keeps drawing that unit with its procedural sprite (one console warning max).
(function (root) {
  'use strict';
  const BASE = 'assets/units/';                     // relative to index.html (works on GitHub Pages / raw.githack)
  const FACTIONS = ['survivors', 'horde'];
  // game unit type -> atlas unit (HANDOFF §7). Types not listed stay procedural.
  const UNIT_MAP = {
    survivor: { faction: 'survivors', unit: 'rifleman', kind: 'creature' },
    seraph: { faction: 'survivors', unit: 'angel', kind: 'creature' },
    ark: { faction: 'survivors', unit: 'tank_hull', kind: 'vehicle', turret: 'tank_turret' },
    gleaner: { faction: 'survivors', unit: 'scrap_truck', kind: 'vehicle', cargo: true },
    zombie: { faction: 'horde', unit: 'zombie', kind: 'creature' },
    imp: { faction: 'horde', unit: 'imp', kind: 'creature' },
    brute: { faction: 'horde', unit: 'hellbrute', kind: 'creature' },
    reaper: { faction: 'horde', unit: 'scrap_eater', kind: 'creature', cargo: true },
  };
  // HANDOFF §6 ramps. Survivors default blue, Horde default violet, red = alternate for either side.
  const RAMPS = {
    blue: { light: '#7FAEFF', base: '#3A7BFF', dark: '#1F4BB0' },
    violet: { light: '#C49BFF', base: '#9A5CFF', dark: '#5A2FA0' },
    red: { light: '#FF7E66', base: '#E8432F', dark: '#8E2418' },
  };
  const DEFAULT_TEAM = { 0: 'blue', 1: 'violet' };
  const FULL_AT = 0.5;                              // cargo state: 'full' at >= 50% of capacity (gameplay choice; no in-between frames)

  // ---------- pure helpers ----------
  const snap16 = deg => (Math.round((((deg % 360) + 360) % 360) / 22.5) % 16) * 22.5;
  const radToDeg = r => r * 180 / Math.PI;
  // nearest of E/S/N/W from an angle in radians (screen space: +y is south)
  function facing4(rad) {
    const c = Math.cos(rad || 0), s = Math.sin(rad || 0);
    return Math.abs(c) >= Math.abs(s) - 1e-9 ? (c >= 0 ? 'E' : 'W') : (s > 0 ? 'S' : 'N');
  }
  const fkey = (unit, state, facing) => unit + '|' + state + '|' + (typeof facing === 'number' ? snap16(facing).toFixed(1) : facing);
  // index the manifest's neutral frames (team-less; recoloured per team at load)
  function parseManifest(json) {
    if (!json || !json.neutral || !Array.isArray(json.neutral.frames)) throw new Error('unit art manifest: no neutral.frames');
    const index = new Map();
    for (const f of json.neutral.frames) {
      if (!f || !f.unit || !f.state || f.facing === undefined || !Array.isArray(f.rect) || f.rect.length !== 4 || !Array.isArray(f.anchor)) continue;
      index.set(fkey(f.unit, f.state, f.facing), f);
    }
    // baked colour frames (team-specific) - used only if the runtime recolour is impossible (tainted canvas)
    const baked = new Map();
    for (const f of Array.isArray(json.frames) ? json.frames : []) {
      if (!f || !f.team || !f.unit || !f.state || f.facing === undefined || !Array.isArray(f.rect) || f.rect.length !== 4 || !Array.isArray(f.anchor)) continue;
      if (!baked.has(f.team)) baked.set(f.team, new Map());
      baked.get(f.team).set(fkey(f.unit, f.state, f.facing), f);
    }
    return { index, baked, bakedImage: json.image, image: json.neutral.image, trim: json.neutral.trim_image, size: json.neutral.size, ramps: json.team_ramps || {}, defaultTeam: json.default_team };
  }
  function stateFor(map, u) {
    if (!map.cargo) return 'idle';
    const cap = (u.d && u.d.cap) || 500;
    return (u.load || 0) >= cap * FULL_AT ? 'full' : 'empty';
  }
  // which frame(s) to draw for a unit, or null -> procedural fallback
  // returns { frame, mirror, heading?, turret? } ; W = E mirrored (mirror_of_E)
  function selectFrame(man, type, u, idx) {
    const map = UNIT_MAP[type]; if (!man || !map) return null;
    const index = idx || man.index;
    const state = stateFor(map, u);
    if (map.kind === 'vehicle') {
      const heading = snap16(radToDeg(u.ang || 0)), frame = index.get(fkey(map.unit, state, heading));
      if (!frame) return null;
      let turret = null;
      if (map.turret) {
        const aim = snap16(radToDeg(u.tang !== undefined ? u.tang : u.ang || 0));
        turret = index.get(fkey(map.turret, 'idle', aim));
        if (!turret || !frame.turret_mount) return null;  // never draw a tank without its turret
      }
      return { frame, mirror: false, heading, turret, state };
    }
    const f4 = facing4(u.ang);
    if (f4 === 'W') {
      const e = index.get(fkey(map.unit, state, 'E'));
      if (e) return { frame: e, mirror: true, state };
      const w = index.get(fkey(map.unit, state, 'W'));
      return w ? { frame: w, mirror: false, state } : null;
    }
    const frame = index.get(fkey(map.unit, state, f4));
    return frame ? { frame, mirror: false, state } : null;
  }
  // top-left (integer) for a frame whose anchor goes on (px, py). Mirrored: anchorW.x = w - anchorE.x
  function topLeft(f, px, py, mirror) {
    const ax = mirror ? f.rect[2] - f.anchor[0] : f.anchor[0];
    return [Math.round(px - ax), Math.round(py - f.anchor[1])];
  }
  // HANDOFF §4: turret anchor goes at the hull's turret_mount (relative to the hull rect's rounded top-left)
  function turretPos(hull, px, py) {
    const [hx, hy] = topLeft(hull, px, py, false);
    return [hx + hull.turret_mount[0], hy + hull.turret_mount[1]];
  }
  function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  // HANDOFF §6 A: exact ramp rebuild on RGBA pixel data (mask 255 light, 170 base, 85 dark; alpha 0 = not trim)
  function recolourPixels(px, mk, ramp) {
    const L = hexToRgb(ramp.light), B = hexToRgb(ramp.base), D = hexToRgb(ramp.dark);
    for (let i = 0; i < mk.length; i += 4) {
      if (mk[i + 3] === 0) continue;
      const col = mk[i] > 212 ? L : mk[i] > 127 ? B : D;
      px[i] = col[0]; px[i + 1] = col[1]; px[i + 2] = col[2];
    }
    return px;
  }

  // ---------- browser: load, recolour, draw ----------
  const A = { ready: {}, man: {}, img: {}, trim: {}, cache: {}, baked: {}, bakedImg: {}, forceBaked: false, failed: {}, warned: false, team: Object.assign({}, DEFAULT_TEAM), base: BASE, stats: { drawn: 0, fallback: 0 } };
  function warnOnce(msg) { if (A.warned) return; A.warned = true; if (typeof console !== 'undefined') console.warn('[unit art] ' + msg + ' - using procedural sprites'); }
  function loadImg(src) { return new Promise((res, rej) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = () => rej(new Error('failed to load ' + src)); im.src = src; }); }
  function load(opts) {
    opts = opts || {};
    if (opts.base) A.base = opts.base;
    if (opts.team) Object.assign(A.team, opts.team);
    if (opts.baked) A.forceBaked = true;
    return Promise.all(FACTIONS.map(fac => fetch(A.base + fac + '-atlas.json').catch(e => { throw new Error('failed to load ' + A.base + fac + '-atlas.json (' + e.message + ')'); }).then(r => { if (!r.ok) throw new Error(fac + '-atlas.json HTTP ' + r.status); return r.json(); })
      .then(j => { const m = parseManifest(j); return Promise.all([loadImg(A.base + m.image), loadImg(A.base + m.trim)]).then(([im, tr]) => { A.man[fac] = m; A.img[fac] = im; A.trim[fac] = tr; A.ready[fac] = true; }); })
      .catch(e => { A.failed[fac] = true; warnOnce(e.message); })));
  }
  // one offscreen canvas per faction x team, built once (never per draw call)
  // recolour impossible -> load the baked colour atlas (drawImage of a cross-origin image is fine; only readback taints)
  function useBaked(fac, why) {
    if (A.baked[fac]) return; A.baked[fac] = 'loading';
    if (why) warnOnce('recolour unavailable (' + why + '), using baked team atlas');
    loadImg(A.base + A.man[fac].bakedImage).then(im => { A.bakedImg[fac] = im; A.baked[fac] = 'ready'; }, e => { A.baked[fac] = 'failed'; A.failed[fac] = true; warnOnce(e.message); });
  }
  function atlasFor(fac, team) {
    const k = fac + ':' + team; if (A.cache[k] !== undefined) return A.cache[k];
    if (A.forceBaked) { useBaked(fac); return null; }
    let c = null;
    try {
      const img = A.img[fac], trim = A.trim[fac], ramp = RAMPS[team] || A.man[fac].ramps[team];
      if (!ramp) throw new Error('no ramp for team ' + team);
      const w = img.width, h = img.height;
      c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      const m = document.createElement('canvas'); m.width = w; m.height = h;
      const mg = m.getContext('2d'); mg.drawImage(trim, 0, 0);
      const px = g.getImageData(0, 0, w, h);                 // throws SecurityError if the canvas is tainted (cross-origin)
      recolourPixels(px.data, mg.getImageData(0, 0, w, h).data, ramp);
      g.putImageData(px, 0, 0);
    } catch (e) { c = null; useBaked(fac, e.name === 'SecurityError' ? 'canvas tainted by cross-origin image' : e.message); }
    return (A.cache[k] = c);
  }
  function shadow(c, cx, cy, s, rot) {
    c.save(); c.fillStyle = 'rgba(0,0,0,' + (s.alpha != null ? s.alpha : 0.3) + ')';
    c.beginPath(); c.ellipse(cx, cy, s.rx, s.ry, rot || 0, 0, Math.PI * 2); c.fill(); c.restore();
  }
  function blit(c, atlas, f, px, py, mirror) {
    const [sx, sy, w, h] = f.rect, [x, y] = topLeft(f, px, py, mirror);
    if (!mirror) { c.drawImage(atlas, sx, sy, w, h, x, y, w, h); return; }
    c.save(); c.translate(x + w, y); c.scale(-1, 1); c.drawImage(atlas, sx, sy, w, h, 0, 0, w, h); c.restore();
  }
  // draws u at (u.x, u.y) [+ lift for air]; returns false -> caller draws the procedural sprite
  function draw(c, u, opts) {
    const map = UNIT_MAP[u.type]; if (!map || (u.side !== 0 && u.side !== 1)) return false;
    const fac = map.faction; if (!A.ready[fac] || A.failed[fac]) { A.stats.fallback++; return false; }
    const man = A.man[fac], team = A.team[u.side] || DEFAULT_TEAM[u.side];
    let atlas = A.baked[fac] ? null : atlasFor(fac, team), idx;
    if (!atlas && A.baked[fac] === 'ready') { atlas = A.bakedImg[fac]; idx = man.baked.get(team) || man.baked.get(man.defaultTeam); }
    if (!atlas || (A.baked[fac] && !idx)) { A.stats.fallback++; return false; }
    const sel = selectFrame(man, u.type, u, idx);
    if (!sel) { warnOnce('no frame for ' + u.type); A.stats.fallback++; return false; }
    const lift = (opts && opts.lift) || 0, bob = (opts && opts.bob) || 0;
    const px = u.x, py = u.y, f = sel.frame, s = f.shadow;
    const prev = c.imageSmoothingEnabled; c.imageSmoothingEnabled = false;
    if (sel.heading !== undefined) {
      if (s) shadow(c, px + s.dx, py + s.dy, s, s.rotate_with_heading === false ? 0 : sel.heading * Math.PI / 180);
      blit(c, atlas, f, px, py, false);
      if (sel.turret) { const [mx, my] = turretPos(f, px, py); blit(c, atlas, sel.turret, mx, my, false); }
    } else {
      if (s) shadow(c, px + s.dx, py + s.dy, s, 0);           // shadow offset never mirrors and stays on the ground
      blit(c, atlas, f, px, py - lift + bob, sel.mirror);
    }
    c.imageSmoothingEnabled = prev; A.stats.drawn++;
    return true;
  }
  const UnitArt = { BASE, UNIT_MAP, RAMPS, DEFAULT_TEAM, FULL_AT, snap16, facing4, fkey, parseManifest, selectFrame, stateFor, topLeft, turretPos, recolourPixels, hexToRgb, load, draw, atlasFor, state: A };
  if (typeof module !== 'undefined' && module.exports) module.exports = UnitArt;
  root.UnitArt = UnitArt;
})(typeof window !== 'undefined' ? window : globalThis);
