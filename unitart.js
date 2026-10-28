// unitart.js: Artie's unit art (rts-loops/art/units/HANDOFF.md) and building art v1 (rts-loops/art/buildings/HANDOFF-buildings.md)
// for the Canvas 2D renderer. One loader / recolour / baked-fallback machinery shared by every atlas set.
// Pure helpers (manifest parsing, facing/heading selection, turret mount math, fallback selection) are DOM-free and
// require()-able in node for tests; the loader/recolour/draw part only runs in the browser.
// Any load failure or missing frame -> the caller keeps drawing that unit with its procedural sprite (one console warning max).
(function (root) {
  'use strict';
  const ROOT = 'assets/';                          // relative to index.html (works on GitHub Pages / raw.githack)
  const BASE = ROOT + 'units/';
  const FACTIONS = ['survivors', 'horde'];
  // atlas sets: id -> manifest path (relative to ROOT) + parser. Unit sets keep their v2 ids ('survivors'/'horde').
  const SETS = {
    survivors: { dir: 'units/', json: 'survivors-atlas.json', kind: 'units' },
    horde: { dir: 'units/', json: 'horde-atlas.json', kind: 'units' },
    'bld:survivors': { dir: 'buildings/', json: 'survivors-buildings-atlas.json', kind: 'buildings' },
    'bld:horde': { dir: 'buildings/', json: 'horde-buildings-atlas.json', kind: 'buildings' },
    // Loop 4 units (art/units/HANDOFF.md §9): separate atlases, same manifest format as survivors/horde
    'survivors-l4': { dir: 'units/', json: 'survivors-l4-atlas.json', kind: 'units' },
    'horde-l4': { dir: 'units/', json: 'horde-l4-atlas.json', kind: 'units' },
    // Loop 4 unit fx (HANDOFF §9): team-less, no trim mask, no recolour
    'fx:l4': { dir: 'units/', json: 'loop4-fx-atlas.json', kind: 'fx' },
  };
  // game building type (BDEF) -> building id per faction (HANDOFF-buildings §3). Frames are looked up by code_type.
  const BLD_MAP = {
    hq: { survivors: 'hq', horde: 'hive' },
    power: { survivors: 'power_plant', horde: 'power_plant' },
    refinery: { survivors: 'scrap_yard', horde: 'grinder_pit', pad: true },
    depot: { survivors: 'depot', horde: 'depot' },
    barracks: { survivors: 'barracks', horde: 'spawning_pit' },
    factory: { survivors: 'factory', horde: 'factory' },
    turret: { survivors: 'turret', horde: 'bone_spire', top: true },
    silo: { survivors: 'nuke_silo', horde: 'hell_silo' },
    // Loop 4 tech buildings (HANDOFF-buildings §10): one faction each; the other side has no frames -> selectBuilding null
    armory: { survivors: 'armory', horde: null },
    church: { survivors: 'church', horde: null },
    altar: { survivors: null, horde: 'dark_altar' },
  };
  const SIDE_FACTION = { 0: 'survivors', 1: 'horde' };
  const DAMAGED_BELOW = 0.5;      // HANDOFF-buildings §5 "Suggested use: hp < 50%" (same line as game.js smoke)
  const IDLE_TOP_HEADING = 90;    // turret / bone spire head before it has ever aimed: face south (towards the camera)
  const LAUNCH_OPEN_S = 1.5;      // silo stays 'open' for the first 1.5 s of a launch (HANDOFF §5 "or during launch")
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
    // Loop 4 units (art/units/HANDOFF.md §9)
    flamer: { faction: 'survivors-l4', unit: 'flamer', kind: 'creature' },
    rocket: { faction: 'survivors-l4', unit: 'rocket_soldier', kind: 'creature' },
    medic: { faction: 'survivors-l4', unit: 'medic', kind: 'creature' },
    archangel: { faction: 'survivors-l4', unit: 'archangel', kind: 'creature' },
    templar: { faction: 'survivors-l4', unit: 'templar', kind: 'creature' },
    demon: { faction: 'horde-l4', unit: 'demon_lord', kind: 'creature' },
  };
  // HANDOFF §6 ramps. Survivors default blue, Horde default violet, red = alternate for either side.
  const RAMPS = {
    blue: { light: '#7FAEFF', base: '#3A7BFF', dark: '#1F4BB0' },
    violet: { light: '#DABCFF', base: '#BE90FF', dark: '#9060E8' },   // art v4 unit pass (manifest team_ramps wins when present)
    red: { light: '#FF7E66', base: '#E8432F', dark: '#8E2418' },
  };
  const DEFAULT_TEAM = { 0: 'blue', 1: 'violet' };
  // cargo stage = f(pip count), so sprite and 5-pip bar can never disagree (Dezi option C, Oct 27, 2026):
  // Salvage.pipsOf() + balance table cargoHalfPips / cargoFullPips (salvage.js TABLE)
  function salvage() {
    if (root.Salvage && root.Salvage.pipsOf) return root.Salvage;
    if (typeof require === 'function') { try { return require('./salvage.js'); } catch (e) { /* not available */ } }
    return null;
  }

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
  // cargo stage from the pip count: pips < cargoHalfPips -> empty, < cargoFullPips -> half, else full. Non-cargo units: 'idle'.
  // Returns null if Salvage / the table values are unavailable (cargo unit then draws procedurally).
  function stateFor(map, u, S) {
    if (!map.cargo) return 'idle';
    S = S || salvage(); const D = S && S.D;
    if (!D || !S.pipsOf || D.cargoHalfPips === undefined || D.cargoFullPips === undefined) return null;
    const p = S.pipsOf(u.load || 0, (u.d && u.d.cap) || D.haulerCapacity);
    return p >= D.cargoFullPips ? 'full' : p >= D.cargoHalfPips ? 'half' : 'empty';
  }
  // which frame(s) to draw for a unit, or null -> procedural fallback
  // returns { frame, mirror, heading?, turret? } ; W = E mirrored (mirror_of_E)
  // stage 'half' uses a 'half' frame when the manifest has one, otherwise the 'empty' frame (data-driven)
  function selectFrame(man, type, u, idx, S) {
    const map = UNIT_MAP[type]; if (!man || !map) return null;
    const stage = stateFor(map, u, S); if (!stage) return null;
    const r = pickFrame(man, map, u, idx || man.index, stage);
    if (r || stage !== 'half') return r && Object.assign(r, { stage });
    const e = pickFrame(man, map, u, idx || man.index, 'empty');
    return e && Object.assign(e, { stage });
  }
  function pickFrame(man, map, u, index, state) {
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

  // ---------- buildings (pure) ----------
  const xkey = (code, part, n) => code + '|' + part + '|' + n;
  const bkey = (code, part, state, heading) => code + '|' + part + '|' + state + (part === 'top' ? '|' + snap16(heading || 0).toFixed(1) : '');
  const okRect = f => f && Array.isArray(f.rect) && f.rect.length === 4 && Array.isArray(f.anchor);
  function okBld(f) {
    if (!okRect(f) || !f.code_type || !f.part || !f.state) return false;
    if (f.part === 'base') return Array.isArray(f.footprint) && Array.isArray(f.footprint_origin);
    if (f.part === 'top') return typeof f.facing === 'number';
    return f.part === 'pad';
  }
  // never merge the two faction manifests by name (ids are shared): one parsed manifest per faction
  function parseBuildingManifest(json) {
    if (!json || !json.neutral || !Array.isArray(json.neutral.frames)) throw new Error('building art manifest: no neutral.frames');
    const index = new Map(), baked = new Map();
    for (const f of json.neutral.frames) if (okBld(f)) index.set(bkey(f.code_type, f.part, f.state, f.facing), f);
    for (const f of Array.isArray(json.frames) ? json.frames : []) {
      if (!f || !f.team || !okBld(f)) continue;
      if (!baked.has(f.team)) baked.set(f.team, new Map());
      baked.get(f.team).set(bkey(f.code_type, f.part, f.state, f.facing), f);
    }
    if (!index.size) throw new Error('building art manifest: no usable frames');
    // loop 4 (HANDOFF-buildings §10): research overlays {id}-research_{0..3} and HQ/Hive weapon fx, by code type + part + frame number
    const extra = new Map(), bakedExtra = new Map(), okX = f => okRect(f) && f.code_type && (f.part === 'overlay' || f.part === 'fx') && typeof f.frame === 'number';
    for (const f of json.neutral.frames) if (okX(f)) extra.set(xkey(f.code_type, f.part, f.frame), f);
    for (const f of Array.isArray(json.frames) ? json.frames : []) {
      if (!f || !f.team || !okX(f)) continue;
      if (!bakedExtra.has(f.team)) bakedExtra.set(f.team, new Map());
      bakedExtra.get(f.team).set(xkey(f.code_type, f.part, f.frame), f);
    }
    return { kind: 'buildings', index, baked, extra, bakedExtra, bakedImage: json.image, image: json.neutral.image, trim: json.neutral.trim_image, size: json.neutral.size, ramps: json.team_ramps || {}, defaultTeam: json.default_team, tile: json.tile || 32 };
  }
  const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
  // is a nuke from this silo in its first LAUNCH_OPEN_S seconds? (game.js launchNuke: sx = s.x, sy = s.y - 20)
  function launching(b, missiles) {
    for (const m of missiles || []) if (m.side === b.side && m.sx === b.x && m.sy === b.y - 20 && m.t < LAUNCH_OPEN_S) return true;
    return false;
  }
  // base state of a finished building (HANDOFF-buildings §5, §9):
  //   silo: open (charged, or launching) + hp < 50% -> damaged_open; open -> open; hp < 50% -> damaged; else closed
  //   others: hp < 50% -> damaged; else idle
  function buildingState(b, o) {
    o = o || {};
    const silo = b.type === 'silo', dmg = !!(b.maxhp && b.hp < b.maxhp * DAMAGED_BELOW);
    if (silo && ((o.nukeCharge && b.charge >= o.nukeCharge) || o.launching)) return dmg ? 'damaged_open' : 'open';
    return dmg ? 'damaged' : silo ? 'closed' : 'idle';
  }
  // missing state frame -> next frame to try (damaged_open -> open -> closed; damaged -> intact)
  const STATE_FALLBACK = { damaged_open: 'open', open: 'closed' };
  function topHeading(b) { return (!b.target && !b.tang) ? IDLE_TOP_HEADING : snap16(radToDeg(b.tang)); }
  // remote Scrap Yard / Grinder Pit setup (HANDOFF-buildings §12): base deploy_0..3, one per quarter of setup progress, + a looped dust fx
  const DEPLOY_FRAMES = 4, DEPLOY_FX_FPS = 8;
  // frames for one building, or null -> procedural. o: { p: build progress 0..1 (undefined = built), nukeCharge, launching, ghost,
  //   setup: remote setup (o.p = setup progress) -> the deploy_k frame instead of the scaffold reveal when the manifest has one }
  function selectBuilding(man, b, o, idx) {
    o = o || {}; const index = idx || (man && man.index), t = b.type;
    if (!index || !BLD_MAP[t]) return null;
    const p = o.ghost ? 0 : o.p == null ? 1 : clamp01(o.p), building = p < 1;
    const intact = t === 'silo' ? 'closed' : 'idle', state = building ? intact : buildingState(b, o);
    let base = null;
    for (let st = state; st && !base; st = st === intact ? null : STATE_FALLBACK[st] || intact) base = index.get(bkey(t, 'base', st));
    if (!base) return null;
    const construct = building ? index.get(bkey(t, 'base', 'construct')) || null : null;
    if (o.ghost && !construct) return null;
    let top = null, heading;
    if (base.top) { heading = topHeading(b); top = index.get(bkey(t, 'top', 'idle', heading)); if (!top || !base.turret_mount) return null; }
    let pad = null;
    if (base.dock_pad) { pad = index.get(bkey(t, 'pad', 'idle')); if (!pad) return null; }
    if (o.setup && !o.ghost) {
      const dep = index.get(bkey(t, 'base', 'deploy_' + Math.min(DEPLOY_FRAMES - 1, Math.floor(p * DEPLOY_FRAMES))));
      if (dep) return { base: dep, construct: null, top: null, pad, heading, p, state: 'deploy' };   // no frame -> the scaffold reveal (old placeholder)
    }
    return { base, construct, top, pad, heading, p, state: o.ghost ? 'ghost' : building ? 'construct' : state };
  }
  // deploy dust fx frame at time t (s): ~8 fps loop over the type's fx frames; null when there are none
  function selectDeployFx(man, b, t, xmap) {
    const fr = topFxFrames(man, b.type, xmap); return fr.length ? fr[Math.floor(Math.max(0, t || 0) * DEPLOY_FX_FPS) % fr.length] : null;
  }
  // loop 4 research/training overlay frame at time t (s), ~4 fps loop over frames 0-3; null when the building type has none
  const OVERLAY_FPS = 4;
  function selectOverlay(man, b, t, xmap) {
    const m = xmap || (man && man.extra); if (!m || !BLD_MAP[b.type]) return null;
    return m.get(xkey(b.type, 'overlay', Math.floor(Math.max(0, t || 0) * OVERLAY_FPS) % 4)) || null;
  }
  // rubble frame left after a tech building dies (HANDOFF-buildings §10 'destroyed'); null for types without one
  function selectDestroyed(man, b, idx) { const index = idx || (man && man.index); return index && BLD_MAP[b.type] ? index.get(bkey(b.type, 'base', 'destroyed')) || null : null; }
  // HQ / Hive weapon fx frame k (hq_muzzle_flash 0-2 / hive_fire_puff 0-3); count = frames available
  function topFxFrames(man, type, xmap) { const m = xmap || (man && man.extra), out = []; if (!m) return out; for (let k = 0; m.has(xkey(type, 'fx', k)); k++) out.push(m.get(xkey(type, 'fx', k))); return out; }
  // fx atlas (team-less): frames by fx name, ordered by frame number
  function parseFxManifest(json) {
    if (!json || !Array.isArray(json.frames)) throw new Error('fx manifest: no frames');
    const fx = new Map();
    for (const f of json.frames) if (okRect(f) && f.fx && typeof f.frame === 'number') { if (!fx.has(f.fx)) fx.set(f.fx, []); fx.get(f.fx)[f.frame] = f; }
    if (!fx.size) throw new Error('fx manifest: no usable frames');
    return { kind: 'fx', fx, image: json.image, size: json.size };
  }
  // Dezi rule (HANDOFF §9.1): burn decal 2x for units 2 or more tiles in size (art height), 1x for everything else
  const burnScale = artH => (artH >= 64 ? 2 : 1);
  // health bar y for a ground unit: above the sprite top for art taller than ~2 tiles (Demon Lord: u.y - 85), else the classic u.y - r - 7
  const hpBarY = (u, frame) => (frame && frame.rect[3] > 64 ? u.y - frame.anchor[1] - 6 : u.y - u.r - 7);
  // geometry (HANDOFF-buildings §4), all integer positions
  const T32 = 32;
  function bodyPos(f, tx, ty) { return [Math.round(tx * T32 - f.footprint_origin[0]), Math.round(ty * T32 - f.footprint_origin[1])]; }
  function anchorPos(f, tx, ty) { const [ox, oy] = bodyPos(f, tx, ty); return [ox + f.anchor[0], oy + f.anchor[1]]; }   // = footprint bottom-centre
  function topPos(base, top, ox, oy) { return [Math.round(ox + base.turret_mount[0] - top.anchor[0]), Math.round(oy + base.turret_mount[1] - top.anchor[1])]; }
  function padPos(pad, ptx, pty) { return [Math.round(ptx * T32 + 16 - pad.anchor[0]), Math.round(pty * T32 + 16 - pad.anchor[1])]; }
  function padTileOf(base, tx, ty) { const t = base.dock_pad.tile; return [tx + t[0], ty + t[1]]; }
  function shadowGeom(f, tx, ty) {
    const s = f.shadow; if (!s) return null;
    return { shape: s.shape, cx: tx * T32 + f.footprint[0] * 16 + s.dx, cy: ty * T32 + f.footprint[1] * 16 + s.dy, w: s.w, h: s.h, alpha: s.alpha != null ? s.alpha : 0.3 };
  }
  const revealRows = (rh, p) => Math.round(rh * clamp01(p));
  const sortKey = b => (b.ty + b.h) * T32;     // y-sort by footprint bottom

  // ---------- browser: load, recolour, draw (shared by every atlas set) ----------
  const A = { ready: {}, man: {}, img: {}, trim: {}, cache: {}, baked: {}, bakedImg: {}, tint: {}, forceBaked: false, failed: {}, warned: false, team: Object.assign({}, DEFAULT_TEAM), root: ROOT,
    stats: { drawn: 0, fallback: 0, bDrawn: 0, bFallback: 0 } };
  const url = (set, file) => A.root + SETS[set].dir + file;
  function warnOnce(msg) { if (A.warned) return; A.warned = true; if (typeof console !== 'undefined') console.warn('[unit art] ' + msg + ' - using procedural sprites'); }
  function loadImg(src) { return new Promise((res, rej) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = () => rej(new Error('failed to load ' + src)); im.src = src; }); }
  function loadSet(set) {
    const S = SETS[set], parse = S.kind === 'buildings' ? parseBuildingManifest : S.kind === 'fx' ? parseFxManifest : parseManifest, j0 = url(set, S.json);
    if (S.kind === 'fx') return fetch(j0).then(r => { if (!r.ok) throw new Error(S.json + ' HTTP ' + r.status); return r.json(); })
      .then(j => { const m = parse(j); return loadImg(url(set, m.image)).then(im => { A.man[set] = m; A.img[set] = im; A.ready[set] = true; }); })
      .catch(e => { A.failed[set] = true; warnOnce(e.message); });
    return fetch(j0).catch(e => { throw new Error('failed to load ' + j0 + ' (' + e.message + ')'); }).then(r => { if (!r.ok) throw new Error(S.json + ' HTTP ' + r.status); return r.json(); })
      .then(j => { const m = parse(j); return Promise.all([loadImg(url(set, m.image)), loadImg(url(set, m.trim))]).then(([im, tr]) => { A.man[set] = m; A.img[set] = im; A.trim[set] = tr; A.ready[set] = true; }); })
      .catch(e => { A.failed[set] = true; warnOnce(e.message); });
  }
  function load(opts) {
    opts = opts || {};
    if (opts.base) A.root = opts.base;
    if (opts.team) Object.assign(A.team, opts.team);
    if (opts.baked) A.forceBaked = true;
    return Promise.all(Object.keys(SETS).filter(k => !opts.sets || opts.sets.includes(k)).map(loadSet));
  }
  // one offscreen canvas per set x team, built once (never per draw call)
  // recolour impossible -> load the baked colour atlas (drawImage of a cross-origin image is fine; only readback taints)
  function useBaked(set, why) {
    if (A.baked[set]) return; A.baked[set] = 'loading';
    if (why) warnOnce('recolour unavailable (' + why + '), using baked team atlas');
    loadImg(url(set, A.man[set].bakedImage)).then(im => { A.bakedImg[set] = im; A.baked[set] = 'ready'; }, e => { A.baked[set] = 'failed'; A.failed[set] = true; warnOnce(e.message); });
  }
  function atlasFor(set, team) {
    const k = set + ':' + team; if (A.cache[k] !== undefined) return A.cache[k];
    if (A.forceBaked) { useBaked(set); return null; }
    let c = null;
    try {
      const img = A.img[set], trim = A.trim[set], ramp = A.man[set].ramps[team] || RAMPS[team];   // manifest team_ramps first, code table for teams not baked (e.g. blue Horde)
      if (!ramp) throw new Error('no ramp for team ' + team);
      const w = img.width, h = img.height;
      c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      const m = document.createElement('canvas'); m.width = w; m.height = h;
      const mg = m.getContext('2d'); mg.drawImage(trim, 0, 0);
      const px = g.getImageData(0, 0, w, h);                 // throws SecurityError if the canvas is tainted (cross-origin)
      recolourPixels(px.data, mg.getImageData(0, 0, w, h).data, ramp);
      g.putImageData(px, 0, 0);
    } catch (e) { c = null; useBaked(set, e.name === 'SecurityError' ? 'canvas tainted by cross-origin image' : e.message); }
    return (A.cache[k] = c);
  }
  // atlas image + frame index for (set, team), or null (not ready / failed / baked still loading)
  function atlasIndex(set, team) {
    if (!A.ready[set] || A.failed[set]) return null;
    const man = A.man[set];
    const atlas = A.baked[set] ? null : atlasFor(set, team);
    if (atlas) return { atlas, idx: man.index, xmap: man.extra, man };
    if (A.baked[set] === 'ready') { const idx = man.baked.get(team) || man.baked.get(man.defaultTeam); return idx ? { atlas: A.bakedImg[set], idx, xmap: man.bakedExtra && (man.bakedExtra.get(team) || man.bakedExtra.get(man.defaultTeam)), man } : null; }
    return null;
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
    const fac = map.faction, team = A.team[u.side] || DEFAULT_TEAM[u.side];
    const at = atlasIndex(fac, team); if (!at) { A.stats.fallback++; return false; }
    const sel = selectFrame(at.man, u.type, u, at.idx);
    if (!sel) { warnOnce('no frame for ' + u.type); A.stats.fallback++; return false; }
    const atlas = at.atlas, lift = (opts && opts.lift) || 0, bob = (opts && opts.bob) || 0;
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

  // ---------- buildings (browser) ----------
  // plan = everything needed to draw b this frame, or null -> procedural drawBld. o as selectBuilding (+ padTile [x,y] from the game)
  function planBuilding(b, o) {
    if (!BLD_MAP[b.type] || (b.side !== 0 && b.side !== 1)) return null;
    const set = 'bld:' + SIDE_FACTION[b.side], team = A.team[b.side] || DEFAULT_TEAM[b.side];
    const at = atlasIndex(set, team); if (!at) { A.stats.bFallback++; return null; }
    const sel = selectBuilding(at.man, b, o, at.idx);
    if (!sel) { warnOnce('no building frame for ' + b.type); A.stats.bFallback++; return null; }
    const [ox, oy] = bodyPos(sel.base, b.tx, b.ty);
    return { b, set, team, atlas: at.atlas, xmap: at.xmap, idx: at.idx, man: at.man, sel, ox, oy, padTile: (o && o.padTile) || (sel.pad ? padTileOf(sel.base, b.tx, b.ty) : null) };
  }
  function blitAt(c, atlas, f, x, y) { const [sx, sy, w, h] = f.rect; c.drawImage(atlas, sx, sy, w, h, x, y, w, h); }
  // ground layer (before every body): footprint shadow (rect Survivors / ellipse Horde, 30% black, +3,+3) and the dock pad decal
  function drawBuildingGround(c, P) {
    const { b, sel } = P, g = shadowGeom(sel.base, b.tx, b.ty), prev = c.imageSmoothingEnabled; c.imageSmoothingEnabled = false;
    const a = g ? g.alpha * (sel.state === 'ghost' ? 0 : sel.p) : 0;      // no shadow for the scaffold; 0.3*p during the reveal
    if (a > 0) {
      c.save(); c.fillStyle = 'rgba(0,0,0,' + a + ')';
      if (g.shape === 'ellipse') { c.beginPath(); c.ellipse(g.cx, g.cy, g.w / 2, g.h / 2, 0, 0, Math.PI * 2); c.fill(); }
      else c.fillRect(Math.round(g.cx - g.w / 2), Math.round(g.cy - g.h / 2), g.w, g.h);
      c.restore();
    }
    if (sel.pad && P.padTile) { const [x, y] = padPos(sel.pad, P.padTile[0], P.padTile[1]); blitAt(c, P.atlas, sel.pad, x, y); }
    c.imageSmoothingEnabled = prev; A.stats.bDrawn++;
  }
  // red-tinted copy of one frame (invalid placement ghost), cached
  function tinted(P, f) {
    const k = P.set + ':' + P.team + ':' + f.rect.join(','); if (A.tint[k]) return A.tint[k];
    const [sx, sy, w, h] = f.rect, cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d'); g.drawImage(P.atlas, sx, sy, w, h, 0, 0, w, h);
    g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(255,50,40,0.75)'; g.fillRect(0, 0, w, h);
    return (A.tint[k] = cv);
  }
  // body: scaffold + bottom-up reveal while building, else the state frame; hit flash = additive redraw
  function drawBuildingBody(c, P, o) {
    const { sel, atlas, ox, oy } = P, prev = c.imageSmoothingEnabled; c.imageSmoothingEnabled = false;
    if (sel.state === 'ghost') {
      if (o && o.invalid) c.drawImage(tinted(P, sel.construct), ox, oy); else blitAt(c, atlas, sel.construct, ox, oy);
    } else if (sel.state === 'deploy') {                                       // §12: the deploy frame is a full body (no reveal)
      blitAt(c, atlas, sel.base, ox, oy);
      if (o && o.hit) { c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha *= 0.35; blitAt(c, atlas, sel.base, ox, oy); c.restore(); }
    } else if (sel.p < 1) {
      if (sel.construct) blitAt(c, atlas, sel.construct, ox, oy);
      const [rx, ry, rw, rh] = sel.base.rect, k = revealRows(rh, sel.p);
      if (k > 0) c.drawImage(atlas, rx, ry + rh - k, rw, k, ox, oy + rh - k, rw, k);
    } else {
      blitAt(c, atlas, sel.base, ox, oy);
      if (o && o.hit) { c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha *= 0.35; blitAt(c, atlas, sel.base, ox, oy); c.restore(); }
    }
    c.imageSmoothingEnabled = prev;
  }
  // turret / bone spire head (drawn after neighbouring bases); never clipped
  function drawBuildingTop(c, P, o) {
    const { sel, atlas, ox, oy } = P; if (!sel.top || sel.p < 1) return;
    const prev = c.imageSmoothingEnabled; c.imageSmoothingEnabled = false;
    const [x, y] = topPos(sel.base, sel.top, ox, oy); blitAt(c, atlas, sel.top, x, y);
    if (o && o.hit) { c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha *= 0.35; blitAt(c, atlas, sel.top, x, y); c.restore(); }
    c.imageSmoothingEnabled = prev;
  }
  // loop 4 overlay over the idle/damaged body (never during the build reveal): each overlay frame is placed by its own footprint_origin
  function drawBuildingOverlay(c, P, t) {
    const { b, sel, atlas } = P; if (sel.p < 1 || sel.state === 'ghost') return false;
    const f = selectOverlay(P.man, b, t, P.xmap); if (!f) return false;
    const [x, y] = bodyPos(f, b.tx, b.ty), prev = c.imageSmoothingEnabled; c.imageSmoothingEnabled = false;
    blitAt(c, atlas, f, x, y); c.imageSmoothingEnabled = prev; return true;
  }
  // HQ / Hive shot fx: frame k of top_fx, anchor at the top frame's muzzle, rotated to the top heading
  function drawBuildingTopFx(c, P, u) {
    const { sel, atlas, ox, oy } = P; if (!sel.top || !sel.top.muzzle || sel.p < 1) return false;
    const fr = topFxFrames(P.man, P.b.type, P.xmap); if (!fr.length) return false;
    const f = fr[Math.min(fr.length - 1, Math.floor(clamp01(u) * fr.length))], [tx, ty] = topPos(sel.base, sel.top, ox, oy);
    const [sx, sy, w, h] = f.rect, prev = c.imageSmoothingEnabled; c.imageSmoothingEnabled = false;
    c.save(); c.translate(tx + sel.top.muzzle[0], ty + sel.top.muzzle[1]); c.rotate(sel.heading * Math.PI / 180); c.globalCompositeOperation = 'lighter';
    c.drawImage(atlas, sx, sy, w, h, -f.anchor[0], -f.anchor[1], w, h); c.restore(); c.imageSmoothingEnabled = prev; return true;
  }
  // §12 remote setup dust over the deploy frame (placed by footprint_origin like a base frame); fades out over the last quarter
  function drawBuildingDeployFx(c, P, t) {
    const { b, sel, atlas } = P; if (sel.state !== 'deploy') return false;
    const f = selectDeployFx(P.man, b, t, P.xmap); if (!f) return false;
    const [x, y] = bodyPos(f, b.tx, b.ty), prev = c.imageSmoothingEnabled; c.imageSmoothingEnabled = false;
    c.save(); if (sel.p > 0.75) c.globalAlpha *= Math.max(0, (1 - sel.p) * 4); blitAt(c, atlas, f, x, y); c.restore(); c.imageSmoothingEnabled = prev; return true;
  }
  // rubble of a dead tech building (d = { type, side, tx, ty }); false -> caller draws the procedural ruin
  function drawBuildingDestroyed(c, d) {
    if (!BLD_MAP[d.type] || (d.side !== 0 && d.side !== 1)) return false;
    const at = atlasIndex('bld:' + SIDE_FACTION[d.side], A.team[d.side] || DEFAULT_TEAM[d.side]); if (!at) return false;
    const f = selectDestroyed(at.man, d, at.idx); if (!f) return false;
    const [x, y] = bodyPos(f, d.tx, d.ty), prev = c.imageSmoothingEnabled; c.imageSmoothingEnabled = false;
    blitAt(c, at.atlas, f, x, y); c.imageSmoothingEnabled = prev; return true;
  }
  // fx atlas frame (team-less), or null while loading / failed
  function fxFrame(name, k) {
    const set = 'fx:l4'; if (!A.ready[set] || A.failed[set]) return null;
    const fr = A.man[set].fx.get(name); if (!fr || !fr.length) return null;
    return { atlas: A.img[set], f: fr[((k % fr.length) + fr.length) % fr.length], n: fr.length };
  }
  // draw fx frame with its anchor at (x, y), rotated by rot (rad), scaled by s
  function drawFx(c, name, k, x, y, rot, s, o) {
    const F = fxFrame(name, k); if (!F) return false;
    const { atlas, f } = F, [sx, sy, w, h] = f.rect, prev = c.imageSmoothingEnabled; c.imageSmoothingEnabled = false;
    c.save(); c.translate(x, y); if (rot) c.rotate(rot); if (s && s !== 1) c.scale(s, s); if (o && o.alpha != null) c.globalAlpha *= o.alpha; if (o && o.add) c.globalCompositeOperation = 'lighter';
    c.drawImage(atlas, sx, sy, w, h, -f.anchor[0], -f.anchor[1], w, h); c.restore(); c.imageSmoothingEnabled = prev; return true;
  }
  // unit art frame for u (no draw), e.g. for the health bar height
  function unitFrame(u) {
    const map = UNIT_MAP[u.type]; if (!map || (u.side !== 0 && u.side !== 1)) return null;
    const at = atlasIndex(map.faction, A.team[u.side] || DEFAULT_TEAM[u.side]); if (!at) return null;
    const sel = selectFrame(at.man, u.type, u, at.idx); return sel ? sel.frame : null;
  }
  const UnitArt = { ROOT, BASE, SETS, UNIT_MAP, BLD_MAP, RAMPS, DEFAULT_TEAM, DAMAGED_BELOW, IDLE_TOP_HEADING, LAUNCH_OPEN_S, salvage, snap16, facing4, fkey, parseManifest, selectFrame, stateFor, topLeft, turretPos, recolourPixels, hexToRgb,
    bkey, parseBuildingManifest, buildingState, launching, topHeading, selectBuilding, bodyPos, anchorPos, topPos, padPos, padTileOf, shadowGeom, revealRows, sortKey,
    xkey, OVERLAY_FPS, selectOverlay, DEPLOY_FRAMES, DEPLOY_FX_FPS, selectDeployFx, selectDestroyed, topFxFrames, parseFxManifest, burnScale, hpBarY,
    load, draw, atlasFor, atlasIndex, url, planBuilding, drawBuildingGround, drawBuildingBody, drawBuildingTop, drawBuildingOverlay, drawBuildingTopFx, drawBuildingDeployFx, drawBuildingDestroyed, fxFrame, drawFx, unitFrame, state: A };
  if (typeof module !== 'undefined' && module.exports) module.exports = UnitArt;
  root.UnitArt = UnitArt;
})(typeof window !== 'undefined' ? window : globalThis);
