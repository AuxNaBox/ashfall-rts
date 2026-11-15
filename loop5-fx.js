// loop5-fx.js: Loop 5 visual layer (Don art overhaul / Artie 2-art-notes.md §4.9 + style guide).
// Contact shadows, dust skirts, tread marks, crater/scorch decals, and building damage-state FX.
// Visuals only: never calls simRand, never writes sim state. A separate particle/decal pool so G.decals
// (and the 400 cap that existing tests observe) is left alone. Procedural fallbacks until Artie's
// loop5-fx-atlas lands; ?art5=off skips new atlas fetches, not this engine layer.
(function (root) {
  'use strict';
  const L5 = root.Loop5;
  if (!L5) throw new Error('loop5-fx.js needs Loop5');
  const D = L5.D;
  const TILE = 32;

  const TREAD_TYPES = { ark: 'tread', gleaner: 'tread', apc: 'tread', artillery: 'tread', catapult: 'tread', purifier: 'tread', sprayer: 'tread', crawler: 'crawler' };
  const AIR_LIFT = { seraph: 11, imp: 5, archangel: 14 };

  function hash32(n) {
    n = n | 0;
    n = Math.imul(n ^ n >>> 16, 0x45d9f3b);
    n = Math.imul(n ^ n >>> 16, 0x45d9f3b);
    return (n ^ n >>> 16) >>> 0;
  }
  function v01(...parts) {
    let h = 2166136261;
    for (const p of parts) h = Math.imul(h ^ (p | 0), 16777619);
    return hash32(h) / 4294967296;
  }

  function dmgStateOf(hp, maxhp) {
    if (!maxhp) return 0;
    const f = hp / maxhp;
    if (f <= D.DMG_STATE_CRITICAL) return 2;
    if (f < D.DMG_STATE_DAMAGED) return 1;
    return 0;
  }

  // spawn points: atlas / per-building metadata first, then a stable procedural layout on the footprint
  function readMetaPoints(b) {
    const d = b && b.d;
    if (!d) return null;
    const raw = d.fxPoints || d.fire_points || d.smoke_points || d.dmgPoints;
    if (Array.isArray(raw) && raw.length) {
      return raw.map((p, i) => {
        if (Array.isArray(p)) return { x: p[0], y: p[1], k: p[2] || (i % 2 ? 'fire' : 'smoke') };
        return { x: p.x, y: p.y, k: p.k || (i % 2 ? 'fire' : 'smoke') };
      });
    }
    return null;
  }
  function readArtPoints(b) {
    try {
      const UA = root.UnitArt;
      if (!UA || typeof UA.dmgPoints !== 'function') return null;
      const pts = UA.dmgPoints(b);
      return pts && pts.length ? pts : null;
    } catch (e) { return null; }
  }
  function proceduralPoints(b) {
    const w = (b.w || 1) * TILE, h = (b.h || 1) * TILE;
    const ox = b.tx != null ? b.tx * TILE : b.x - w / 2;
    const oy = b.ty != null ? b.ty * TILE : b.y - h / 2;
    const n = Math.min(4, 1 + (b.w || 1) * (b.h || 1));
    const insets = [[0.30, 0.35], [0.70, 0.40], [0.45, 0.72], [0.62, 0.28]];
    const pts = [];
    for (let i = 0; i < n; i++) pts.push({ x: ox + w * insets[i][0], y: oy + h * insets[i][1], k: i % 2 ? 'fire' : 'smoke' });
    return pts;
  }
  function spawnPoints(b) { return readMetaPoints(b) || readArtPoints(b) || proceduralPoints(b); }

  function footprintShadow(e) {
    if (e.kind === 'b' || e.tx != null) {
      const w = (e.w || 1) * TILE, h = (e.h || 1) * TILE;
      return { x: e.x, y: e.y + (e.h ? e.h * TILE * 0.15 : 0), rx: Math.max(10, w * 0.42), ry: Math.max(6, h * 0.28) };
    }
    const r = e.r || 8;
    return { x: e.x, y: e.y + 2, rx: r + 3, ry: (r + 3) * 0.55 };
  }

  const pool = { decals: [], dust: [], dmg: [] };
  let treadAt = new WeakMap();
  let dustAt = new WeakMap();
  let placed = new WeakSet();
  let completed = new WeakSet();
  let fxAcc = new WeakMap();
  let lastTick = null;
  let art5 = true;

  // Per-kind caps: evict the oldest live of this kind only, so treads cannot wipe craters.
  function alloc(list, cap, fill) {
    const kind = fill.k;
    let n = 0, oldest = null;
    for (const o of list) {
      if (o.dead) continue;
      if (kind != null && o.k !== kind) continue;
      n++;
      if (!oldest || (o.born != null && oldest.born != null ? o.born < oldest.born : true)) oldest = o;
    }
    if (n >= cap && oldest) { Object.assign(oldest, fill); oldest.dead = false; return oldest; }
    for (const o of list) if (o.dead) { Object.assign(o, fill); o.dead = false; return o; }
    const o = Object.assign({ dead: false }, fill);
    list.push(o);
    return o;
  }
  function fxAtlasReady() {
    const UA = root.UnitArt;
    return !!(UA && UA.state && UA.state.ready && UA.state.ready['fx:l5']);
  }
  function fadeOf(d, now) {
    const life = d.fade || D.DECAL_FADE_SCORCH;
    const a = 1 - (now - d.born) / life;
    return a <= 0 ? 0 : a;
  }

  function addDecal(kind, x, y, opts) {
    opts = opts || {};
    const fade = opts.fade != null ? opts.fade : (kind === 'tread' || kind === 'crawler' ? D.DECAL_FADE_TRACK : kind === 'crater' ? D.DECAL_FADE_CRATER : D.DECAL_FADE_SCORCH);
    const cap = kind === 'tread' || kind === 'crawler' ? D.TREAD_CAP : kind === 'crater' ? D.CRATER_CAP : D.SCORCH_CAP;
    return alloc(pool.decals, cap, {
      k: kind, x, y, r: opts.r || (kind === 'crater' ? (opts.large ? 24 : 10) : 14),
      a: opts.a || 0, born: opts.born != null ? opts.born : 0, fade, large: !!opts.large, variant: opts.variant || 0,
    });
  }

  function addCrater(x, y, opts) {
    opts = opts || {};
    const large = !!opts.large || (opts.r != null && opts.r >= 20);
    const born = opts.born != null ? opts.born : 0;
    const variant = opts.variant != null ? opts.variant : (hash32((x * 13) | 0 ^ (y * 29) | 0) & 1);
    addDecal('crater', x, y, { r: opts.r || (large ? 24 : 10), large, variant, born, fade: D.DECAL_FADE_CRATER, a: opts.a || 0 });
    addDecal('scorch', x, y, { r: (opts.r || (large ? 24 : 10)) * 1.15, born, fade: D.DECAL_FADE_SCORCH });
  }
  function addScorch(x, y, opts) {
    opts = opts || {};
    addDecal('scorch', x, y, { r: opts.r || 14, born: opts.born != null ? opts.born : 0, fade: D.DECAL_FADE_SCORCH, a: opts.a || 0 });
  }

  function onImpact(p, time) {
    if (!p) return;
    const x = p.tx != null ? p.tx : p.x, y = p.ty != null ? p.ty : p.y;
    const t = time || 0;
    if (p.w === 'shell' || p.rocket || p.bolt) addCrater(x, y, { large: !!(p.splash && p.splash >= 1.2) || !!p.big, born: t, r: p.big ? 24 : (p.splash && p.splash >= 1.2 ? 24 : 10) });
    else if (p.w === 'fire') addScorch(x, y, { r: p.big ? 16 : 8, born: t });
  }
  function onKill(t, w, time) {
    if (!t) return;
    const tm = time || 0;
    if (w === 'fire' || w === 'holy') addScorch(t.x, t.y, { r: t.kind === 'b' ? (t.w || 1) * 16 : 10, born: tm });
    else if (t.kind === 'b') addCrater(t.x, t.y, { large: (t.w || 1) >= 2, r: (t.w || 1) * 16, born: tm });
  }
  function onPlaced(b, time) { if (b) puffDust(b.x, b.y + (b.h || 1) * 8, time || 0, 6, 1); }
  function onComplete(b, time) { if (b) puffDust(b.x, b.y + (b.h || 1) * 8, time || 0, 8, 1.2); }

  function puffDust(x, y, time, n, scale) {
    for (let i = 0; i < n; i++) {
      const a = v01(x, y, time * 100, i) * Math.PI * 2;
      const spd = 8 + v01(y, x, i, 3) * 18;
      alloc(pool.dust, D.DUST_CAP, {
        x, y, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd * 0.5 - 6,
        t: 0, dur: 0.45 + v01(i, x) * 0.35, s: (scale || 1) * (0.7 + v01(i, y) * 0.6),
      });
    }
  }

  function emitTreads(u, time) {
    const kind = TREAD_TYPES[u.type];
    if (!kind || !u.moving || u.dead || u.carried) return;
    const last = treadAt.get(u);
    if (last) {
      const d = Math.hypot(u.x - last.x, u.y - last.y);
      if (d < D.TREAD_STEP_PX) return;
    }
    treadAt.set(u, { x: u.x, y: u.y });
    addDecal(kind, u.x, u.y, { a: u.ang || 0, born: time, fade: D.DECAL_FADE_TRACK, r: kind === 'crawler' ? 10 : 10, variant: last && last.v ? 0 : 1 });
    if (last) last.v = !last.v;
  }

  function emitMoveDust(u, time) {
    if (!u.moving || u.dead || u.carried || u.d && u.d.fly) return;
    if (u.d && u.d.cat !== 'vehicle' && !TREAD_TYPES[u.type]) return;
    if (TREAD_TYPES[u.type] === 'crawler') return; // prints instead
    const key = (time * 8 | 0);
    if (dustAt.get(u) === key) return;
    dustAt.set(u, key);
    puffDust(u.x, u.y + 4, time, 1, 0.55);
  }

  function tickDmgFx(b, time, dt) {
    const st = dmgStateOf(b.hp, b.maxhp);
    if (st === 0 || b.dead) return;
    const pts = spawnPoints(b);
    const horde = b.side === 1;
    const rate = st === 2 ? 0.08 : 0.16;
    const acc = (fxAcc.get(b) || 0) + dt;
    if (acc < rate) { fxAcc.set(b, acc); return; }
    fxAcc.set(b, 0);
    for (const p of pts) {
      const kind = horde
        ? (st === 2 ? (p.k === 'fire' ? 'ooze' : 'drip') : (p.k === 'fire' ? 'drip' : 'smoke'))
        : (st === 2 ? (p.k === 'fire' ? 'fire' : 'smoke') : (p.k === 'fire' ? 'fire' : 'smoke'));
      // damaged: small fires + darker smoke; critical: more / hotter
      const dark = st >= 1;
      const s = st === 2 ? 1.25 : 0.85;
      const pi = pts.indexOf(p);
      const start = (pi * 2 + hash32(b.id || 0)) & 255;
      alloc(pool.dmg, D.DMG_FX_CAP, {
        k: kind, dark, x: p.x, y: p.y, t: 0, dur: kind === 'fire' || kind === 'ooze' ? 0.7 : 1.1,
        s, vx: (v01(p.x, time * 20, b.id || 0) - 0.5) * 6, vy: -10 - v01(p.y, time * 20) * 10,
        side: b.side, st, start, pi,
      });
    }
  }

  function sweep(list, dt, move) {
    for (const o of list) {
      if (o.dead) continue;
      o.t += dt;
      if (move) { o.x += (o.vx || 0) * dt; o.y += (o.vy || 0) * dt; }
      if (o.t >= (o.dur || o.fade || 1)) o.dead = true;
    }
  }

  function tick(G, opts) {
    if (!G) return;
    const time = (opts && opts.time != null) ? opts.time : G.time;
    const dt = (opts && opts.dt != null) ? opts.dt : 1 / 30;
    if (lastTick === time && !(opts && opts.force)) return;
    lastTick = time;
    if (G.units) for (const u of G.units) if (!u.dead) { emitTreads(u, time); emitMoveDust(u, time); }
    if (G.blds) for (const b of G.blds) if (!b.dead) {
      if (!placed.has(b)) {
        placed.add(b);
        // only puff for buildings that just appeared (not the starting HQ / pre-placed arena pieces)
        if (b.bornT != null && time - b.bornT >= 0 && time - b.bornT < 0.1) onPlaced(b, time);
      }
      const reveal = 2;
      if (b.bornT != null && b.bornT >= 0 && !completed.has(b) && time - b.bornT >= reveal) { completed.add(b); onComplete(b, time); }
      tickDmgFx(b, time, dt);
    }
    sweep(pool.dust, dt, true);
    sweep(pool.dmg, dt, true);
    const now = time;
    for (const d of pool.decals) if (!d.dead && fadeOf(d, now) <= 0) d.dead = true;
  }

  function drawEllipse(c, x, y, rx, ry, fill) {
    c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fillStyle = fill; c.fill();
  }

  function drawContactShadow(c, e, opts) {
    opts = opts || {};
    const fp = footprintShadow(e);
    const dx = D.SHADOW_DX, dy = D.SHADOW_DY;
    const lift = opts.lift != null ? opts.lift : (e.d && e.d.fly ? (AIR_LIFT[e.type] || 10) : 0);
    // air units: shadow stays on the ground, offset down-right plus a little further with height
    const ox = fp.x + dx + (lift ? lift * 0.15 : 0);
    const oy = fp.y + dy + lift * 0.35;
    const a = (opts.alpha != null ? opts.alpha : D.SHADOW_ALPHA) * (opts.p != null ? opts.p : 1);
    c.save(); c.globalAlpha *= a;
    drawEllipse(c, ox, oy, fp.rx, fp.ry, '#000');
    c.restore();
  }

  function drawDecals(c, time) {
    if (root.UnitArt && root.UnitArt.drawFx) {
      // atlas stamps when the loop5-fx-atlas is loaded; otherwise procedural
    }
    for (const d of pool.decals) {
      if (d.dead) continue;
      const a = fadeOf(d, time); if (a <= 0) continue;
      c.save(); c.globalAlpha *= Math.max(0, Math.min(1, a));
      const drawn = root.UnitArt && typeof root.UnitArt.drawFx === 'function' && (
        d.k === 'crater' ? root.UnitArt.drawFx(c, d.large ? 'siege_crater_lg' : 'siege_crater', d.variant, d.x, d.y, d.a, 1)
        : d.k === 'scorch' ? root.UnitArt.drawFx(c, 'scorch_decal', d.variant, d.x, d.y, d.a, 1)
        : d.k === 'tread' ? root.UnitArt.drawFx(c, 'tread_mark', d.variant, d.x, d.y, d.a, 1)
        : d.k === 'crawler' ? root.UnitArt.drawFx(c, 'crawler_print', d.variant, d.x, d.y, d.a, 1)
        : false
      );
      if (!drawn && !fxAtlasReady()) {
        if (d.k === 'crater') {
          c.fillStyle = 'rgba(18,14,10,0.85)';
          c.beginPath(); c.ellipse(d.x, d.y, d.r, d.r * 0.62, d.a || 0, 0, Math.PI * 2); c.fill();
          c.strokeStyle = 'rgba(70,58,42,0.45)'; c.lineWidth = 2;
          c.beginPath(); c.ellipse(d.x, d.y, d.r * 0.95, d.r * 0.58, d.a || 0, 0, Math.PI * 2); c.stroke();
          c.fillStyle = 'rgba(0,0,0,0.55)';
          c.beginPath(); c.ellipse(d.x, d.y, d.r * 0.5, d.r * 0.28, d.a || 0, 0, Math.PI * 2); c.fill();
        } else if (d.k === 'scorch') {
          const g = c.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.r);
          g.addColorStop(0, 'rgba(16,10,6,0.75)'); g.addColorStop(0.55, 'rgba(40,22,10,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
          c.fillStyle = g; c.beginPath(); c.arc(d.x, d.y, d.r, 0, Math.PI * 2); c.fill();
        } else if (d.k === 'tread' || d.k === 'crawler') {
          c.save(); c.translate(d.x, d.y); c.rotate(d.a || 0);
          c.fillStyle = d.k === 'crawler' ? 'rgba(36,24,16,0.45)' : 'rgba(16,14,10,0.55)';
          if (d.k === 'crawler') { c.beginPath(); c.ellipse(0, -4, 5, 3, 0, 0, 7); c.ellipse(0, 4, 5, 3, 0, 0, 7); c.fill(); }
          else { c.fillRect(-10, -5, 20, 3); c.fillRect(-10, 2, 20, 3); }
          c.restore();
        }
      }
      c.restore();
    }
  }

  function drawDust(c) {
    for (const o of pool.dust) {
      if (o.dead) continue;
      const p = 1 - o.t / o.dur;
      c.save(); c.globalAlpha *= 0.35 * p;
      c.fillStyle = '#c4b89a';
      c.beginPath(); c.ellipse(o.x, o.y, 5 * o.s * (1.2 - 0.4 * p), 3 * o.s * (1.2 - 0.4 * p), 0, 0, 7); c.fill();
      c.restore();
    }
  }

  function drawDmgFx(c) {
    const atlasOn = fxAtlasReady();
    if (!atlasOn) for (const o of pool.dmg) {
      if (o.dead) continue;
      const p = 1 - o.t / o.dur;
      c.save(); c.globalAlpha *= Math.max(0, p);
      if (o.k === 'fire') {
        const r = 3.5 * o.s * (0.8 + 0.4 * p);
        c.fillStyle = o.st === 2 ? '#ff7a18' : '#ff9a30';
        c.beginPath(); c.ellipse(o.x, o.y - o.t * 8, r, r * 1.4, 0, 0, 7); c.fill();
        c.fillStyle = '#ffe080'; c.beginPath(); c.ellipse(o.x, o.y - o.t * 8 - 1, r * 0.45, r * 0.7, 0, 0, 7); c.fill();
      } else if (o.k === 'smoke') {
        const r = 5 * o.s * (1 + o.t);
        c.fillStyle = o.dark || o.st >= 1 ? 'rgba(28,24,20,0.7)' : 'rgba(70,66,60,0.5)';
        c.beginPath(); c.ellipse(o.x + o.t * (o.vx || 0) * 0.2, o.y, r, r * 0.75, 0, 0, 7); c.fill();
      } else if (o.k === 'drip' || o.k === 'ooze') {
        c.fillStyle = o.k === 'ooze' ? 'rgba(90,160,30,0.7)' : 'rgba(140,180,40,0.55)';
        const r = (o.k === 'ooze' ? 4 : 2.5) * o.s;
        c.beginPath(); c.ellipse(o.x, o.y + o.t * 14, r, r * (o.k === 'ooze' ? 1.2 : 1.6), 0, 0, 7); c.fill();
      }
      c.restore();
    }
    // atlas frames if present
    if (root.UnitArt && typeof root.UnitArt.drawFx === 'function') {
      for (const o of pool.dmg) {
        if (o.dead) continue;
        const name = o.k === 'fire' ? 'building_fire' : o.k === 'smoke' ? 'building_smoke' : o.k === 'drip' ? 'horde_drip' : o.k === 'ooze' ? 'horde_ooze' : null;
        if (!name) continue;
        const k = Math.floor(o.t * 8) + (o.start || 0);
        root.UnitArt.drawFx(c, name, k, o.x, o.y, 0, o.s, { alpha: Math.max(0, 1 - o.t / o.dur) });
      }
    }
  }

  function reset() {
    pool.decals.length = 0; pool.dust.length = 0; pool.dmg.length = 0;
    treadAt = new WeakMap(); dustAt = new WeakMap(); fxAcc = new WeakMap();
    placed = new WeakSet(); completed = new WeakSet();
    lastTick = null;
  }

  function counts() {
    const live = a => a.filter(o => !o.dead).length;
    return { decals: live(pool.decals), dust: live(pool.dust), dmg: live(pool.dmg), treads: pool.decals.filter(d => !d.dead && (d.k === 'tread' || d.k === 'crawler')).length, craters: pool.decals.filter(d => !d.dead && d.k === 'crater').length, scorches: pool.decals.filter(d => !d.dead && d.k === 'scorch').length };
  }

  const FX = {
    dmgStateOf, spawnPoints, addDecal, addCrater, addScorch, onImpact, onKill, onPlaced, onComplete, fxAtlasReady,
    tick, drawContactShadow, drawDecals, drawDust, drawDmgFx, footprintShadow, reset, counts,
    pool, TREAD_TYPES, setArt5(v) { art5 = !!v; }, art5Enabled() { return art5; },
    hash32, v01,
  };
  L5.FX = FX;
  L5.onDamageState = L5.onDamageState || function () { /* visual hook; particles are ticked from render */ };
  L5.dmgStateOf = dmgStateOf;
  if (typeof module !== 'undefined' && module.exports) module.exports = FX;
  root.Loop5FX = FX;
})(typeof window !== 'undefined' ? window : globalThis);
