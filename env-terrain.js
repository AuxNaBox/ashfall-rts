// Ashfall env pass 1: reference runtime for the env atlases (r2, approved by Director; handed to Engineer).
// Plain Canvas 2D, no dependencies. Works in the browser (window.EnvTerrain) and in node-canvas (module.exports).
// This file is what art/render-env.js uses to draw the review sheets, so the sheets show exactly this code path.
//
//   const env = EnvTerrain.create({ tiles: [json, img], props: [json, img], fx: [json, img], makeCanvas: (w,h) => canvas });
//   env.bakeTerrain(ctx, map)          // ONCE at map load, into terrCanvas (same as game.js renderTerrain)
//   env.drawPropShadow / drawProp      // y-sorted with units, every frame (static, ~1 drawImage each)
//   env.drawFlames(ctx, fires, t)      // burning props, after the y-sort pass
//   env.drawLights(ctx, lights, t, view)   // 'lighter' radial sprites, after units, before fog; capped
//   env.drawFog(ctx, fog, view)        // dual-grid fog edges, replaces the per-tile fog loop
(function (root) {
  'use strict';
  const TILE = 32;
  // integer hash -> [0,1). Stateless, so the same tile always picks the same variant (no per-tile storage).
  function h32(a, b, s) { let x = Math.imul((a * 73856093) ^ (b * 19349663) ^ (s * 83492791), 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return x >>> 0; }

  function create(o) {
    const [TJ, TI] = o.tiles, [PJ, PI] = o.props, [FJ, FI] = o.fx;
    const F = {}; for (const f of TJ.frames) F[f.name] = f;
    const P = {}; for (const f of PJ.frames) P[f.name] = f;
    const X = {}; for (const f of FJ.frames) X[f.name] = f;
    const layers = TJ.layers.slice().sort((a, b) => a.order - b.order);
    const K = TJ.wang.colours;
    const salt = name => [...name].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) & 0xffff;

    // ---------------------------------------------------------------- terrain bake (load time only)
    // map: { w, h, layer: Uint8Array(w*h) with the layer ORDER per tile (0 ash, 1 scorched, 2 salvage, 3 asphalt, 4 sludge),
    //        decals: [{name, x, y}] (px, centre), groundProps: [{name, tx, ty}] (craters: drawn into the bake) }
    function wangTile(c, terrain, tx, ty, dx, dy) {
      const s = salt(terrain), C = (x, y) => h32(x, y, s) % K;
      const tl = C(tx, ty), tr = C(tx + 1, ty), br = C(tx + 1, ty + 1), bl = C(tx, ty + 1);
      const r = F[`${terrain}-c${tl}${tr}${br}${bl}`].rect;
      c.drawImage(TI, r[0], r[1], TILE, TILE, dx, dy, TILE, TILE);
    }
    function bakeTerrain(ctx, map) {
      const W = map.w * TILE, H = map.h * TILE, L = map.layer, at = (x, y) => L[Math.min(map.h - 1, Math.max(0, y)) * map.w + Math.min(map.w - 1, Math.max(0, x))];
      const t0 = Date.now();
      // 1) base layer everywhere
      for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) wangTile(ctx, layers[0].terrain, tx, ty, tx * TILE, ty * TILE);
      // 2) each upper layer: texture into a scratch canvas, dual-grid mask into another, destination-in, composite.
      //    (For an 80x80 map these are 2560^2 scratch canvases, ~26 MB each, freed after the bake. Bake in 640 px
      //     chunks if memory matters; the result is identical.)
      const A = o.makeCanvas(W, H), M = o.makeCanvas(W, H), a = A.getContext('2d'), m = M.getContext('2d');
      for (const ly of layers.slice(1)) {
        let any = false; for (let i = 0; i < L.length; i++) if (L[i] >= ly.order) { any = true; break; }
        if (!any) continue;
        a.globalCompositeOperation = 'source-over'; a.clearRect(0, 0, W, H); m.clearRect(0, 0, W, H);
        for (let ty = 0; ty < map.h; ty++) for (let tx = 0; tx < map.w; tx++) {
          let near = false; for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (at(tx + dx, ty + dy) >= ly.order) { near = true; break; }
          if (near) wangTile(a, ly.terrain, tx, ty, tx * TILE, ty * TILE);
        }
        // dual grid: cell (vx,vy) is centred on the tile corner (vx*32, vy*32); its 4 corners are the 4 tiles around it
        m.fillStyle = '#000';
        for (let vy = 0; vy <= map.h; vy++) for (let vx = 0; vx <= map.w; vx++) {
          const bits = (at(vx - 1, vy - 1) >= ly.order ? 1 : 0) | (at(vx, vy - 1) >= ly.order ? 2 : 0) | (at(vx, vy) >= ly.order ? 4 : 0) | (at(vx - 1, vy) >= ly.order ? 8 : 0);
          if (!bits) continue;
          const X0 = vx * TILE - 16, Y0 = vy * TILE - 16;
          if (bits === 15) { m.fillRect(X0, Y0, TILE, TILE); continue; }
          const v = h32(vx, vy, 99) % TJ.masks.variants, r = F[`mask-${String(bits).padStart(2, '0')}-v${v}`].rect;
          m.drawImage(TI, r[0], r[1], TILE, TILE, X0, Y0, TILE, TILE);
        }
        if (ly.edge === 'lip') { ctx.globalAlpha = 0.35; ctx.drawImage(M, 1, 1); ctx.drawImage(M, 0, 1); ctx.globalAlpha = 1; }   // raised edge: 1 px drop shadow down/right
        a.globalCompositeOperation = 'destination-in'; a.drawImage(M, 0, 0); a.globalCompositeOperation = 'source-over';
        if (ly.edge === 'sunken') {   // sunken pool: dark band inside the top-left bank
          const S = o.makeCanvas(W, H), s = S.getContext('2d'); s.drawImage(M, 0, 0); s.globalCompositeOperation = 'destination-out'; s.drawImage(M, 2, 2);
          a.globalAlpha = 0.45; a.drawImage(S, 0, 0); a.globalAlpha = 1;
        }
        ctx.drawImage(A, 0, 0);
      }
      // 3) flat stuff: decals + ground-layer props (craters). Baked, so they cost nothing per frame.
      for (const d of map.decals || []) { const f = P[d.name]; if (f) ctx.drawImage(PI, f.rect[0], f.rect[1], f.rect[2], f.rect[3], Math.round(d.x - f.anchor[0]), Math.round(d.y - f.anchor[1]), f.rect[2], f.rect[3]); }
      for (const g of map.groundProps || []) { if (g.shadow) drawPropShadow(ctx, g); drawProp(ctx, g); }
      return Date.now() - t0;
    }

    // ---------------------------------------------------------------- props (y-sorted with units)
    function propOrigin(p) { const f = P[p.name]; return [p.tx * TILE - f.footprint_origin[0], p.ty * TILE - f.footprint_origin[1]]; }
    function drawPropShadow(ctx, p) {
      const f = P[p.name]; if (!f || !f.shadow) return; const s = f.shadow;
      const cx = (p.tx + f.footprint[0] / 2) * TILE + s.dx, cy = (p.ty + f.footprint[1] / 2) * TILE + s.dy;
      ctx.fillStyle = `rgba(0,0,0,${s.alpha})`;
      if (s.shape === 'rect') ctx.fillRect(Math.round(cx - s.w / 2), Math.round(cy - s.h / 2), s.w, s.h);
      else { ctx.beginPath(); ctx.ellipse(cx, cy + f.footprint[1] * TILE * 0.2, s.w / 2, s.h / 2, 0, 0, 7); ctx.fill(); }
    }
    function drawProp(ctx, p) {
      const f = P[p.name]; if (!f) return; const [x, y] = propOrigin(p);
      ctx.drawImage(PI, f.rect[0], f.rect[1], f.rect[2], f.rect[3], Math.round(x), Math.round(y), f.rect[2], f.rect[3]);
    }
    function sortKey(p) { const f = P[p.name]; return (p.ty + f.footprint[1]) * TILE; }   // same rule as buildings (footprint bottom)
    function firePoint(p) { const f = P[p.name], [x, y] = propOrigin(p); return f.fire_point ? [x + f.fire_point[0], y + f.fire_point[1]] : [x + f.rect[2] / 2, y + f.rect[3] / 2]; }

    // ---------------------------------------------------------------- flames + lights
    function drawFlame(ctx, size, x, y, t, phase = 0) {
      const fr = X[`${size}-f${Math.floor(t * 10 + phase * 4) & 3}`]; if (!fr) return;
      ctx.drawImage(FI, fr.rect[0], fr.rect[1], fr.rect[2], fr.rect[3], Math.round(x - fr.anchor[0]), Math.round(y - fr.anchor[1]), fr.rect[2], fr.rect[3]);
    }
    // cheap smooth noise for flicker: sum of 2 sines, phase per light
    const flick = (t, hz, ph) => 0.6 * Math.sin(t * hz * 6.283 + ph * 17.1) + 0.4 * Math.sin(t * hz * 2.31 * 6.283 + ph * 5.3);
    const PRIO = { light_nuke_open: 5, light_hell_open: 5, light_wreck: 4, light_archangel: 4, light_halo: 3, light_holy: 3, light_fire_l: 2, light_fire_m: 2, light_fire_s: 1 };
    // lights: [{name, x, y, phase?, scale?}] in world px. view: {x0,y0,x1,y1} world rect. Returns the number drawn.
    function drawLights(ctx, lights, t, view, cap = 24) {
      const vis = [];
      for (const l of lights) { const f = X[l.name]; if (!f) continue; const r = f.radius * (l.scale || 1);
        if (view && (l.x + r < view.x0 || l.x - r > view.x1 || l.y + r < view.y0 || l.y - r > view.y1)) continue; vis.push(l); }
      if (vis.length > cap) { vis.sort((a, b) => (PRIO[b.name] || 0) - (PRIO[a.name] || 0)); vis.length = cap; }
      const op = ctx.globalCompositeOperation, ga = ctx.globalAlpha;
      ctx.globalCompositeOperation = 'lighter';
      for (const l of vis) {
        const f = X[l.name], fl = f.flicker || {}, n = flick(t, fl.hz || 1, l.phase || 0);
        const a = Math.max(0, Math.min(1, 1 + n * (fl.alpha_jitter || 0))) * (l.alpha === undefined ? 1 : l.alpha);
        const s = (l.scale || 1) * (1 + n * (fl.scale_jitter || 0)), w = f.rect[2] * s, h = f.rect[3] * s;
        ctx.globalAlpha = a;
        ctx.drawImage(FI, f.rect[0], f.rect[1], f.rect[2], f.rect[3], l.x - w / 2, l.y - h / 2, w, h);
      }
      ctx.globalCompositeOperation = op; ctx.globalAlpha = ga;
      return vis.length;
    }

    // ---------------------------------------------------------------- fog (every frame, replaces the per-tile loop)
    // fog: { w, h, expl: Uint8Array, vis: Uint8Array, rim: 'ember'|'ash' }. view in TILES {x0,y0,x1,y1}.
    // Two passes on the dual grid: shroud (not visible) then dark (not explored). Cells with bits 0 draw nothing,
    // bits 15 are one fillRect, only the edge cells draw a 32x32 atlas tile.
    function drawFog(ctx, fog, view) {
      const at = (A, x, y) => A[Math.min(fog.h - 1, Math.max(0, y)) * fog.w + Math.min(fog.w - 1, Math.max(0, x))];
      let edges = 0;
      const pass = (fogged, set, solid) => {
        ctx.fillStyle = solid;
        for (let vy = view.y0; vy <= view.y1 + 1; vy++) for (let vx = view.x0; vx <= view.x1 + 1; vx++) {
          const bits = (fogged(vx - 1, vy - 1) ? 1 : 0) | (fogged(vx, vy - 1) ? 2 : 0) | (fogged(vx, vy) ? 4 : 0) | (fogged(vx - 1, vy) ? 8 : 0);
          if (!bits) continue;
          const X0 = vx * TILE - 16, Y0 = vy * TILE - 16;
          if (bits === 15) { ctx.fillRect(X0, Y0, TILE, TILE); continue; }
          const r = X[`fog_${set}-${String(bits).padStart(2, '0')}-v${h32(vx, vy, 5) & 1}`].rect; edges++;
          ctx.drawImage(FI, r[0], r[1], TILE, TILE, X0, Y0, TILE, TILE);
        }
      };
      pass((x, y) => !at(fog.vis, x, y), 'shroud', 'rgba(0,0,0,0.45)');
      pass((x, y) => !at(fog.expl, x, y), fog.rim === 'ash' ? 'dark_ash' : 'dark_ember', '#000');
      return edges;
    }
    // ---------------------------------------------------------------- vehicle contact shadow (optional, r2)
    // Soft dark ground halo under a vehicle: 1 normal-blend drawImage, call before the vehicle's own +3,+3 shadow.
    function drawVehicleAO(ctx, x, y, size = 'm') {
      const f = X[`ao_vehicle_${size}`]; if (!f) return;
      ctx.drawImage(FI, f.rect[0], f.rect[1], f.rect[2], f.rect[3], Math.round(x + 2 - f.anchor[0]), Math.round(y + 2 - f.anchor[1]), f.rect[2], f.rect[3]);
    }

    // ---------------------------------------------------------------- Dezi map JSON -> env inputs (r2)
    // m: design-backlog/maps/*.json ({w, h, rows[], props[{key, v?, x, y}]}). Returns the bake input plus the y-sorted props
    // and a 'blocked' grid. Every blocker footprint lies on tiles that are already impassable in the map ('#', 'r', 'c', 't', 'o').
    const AL = PJ.aliases || {};
    const pick = (key, v, x, y) => { const a = AL[key]; if (!a) return null; const fr = a.frames; return fr[(v === undefined || v === null ? h32(x, y, 41) : v) % fr.length]; };
    function resolveMap(m, opt = {}) {
      const w = m.w, h = m.h, ch = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? '#' : m.rows[y][x];
      const openC = c => '.=PSAb12'.includes(c), rubbleC = c => c === '#' || c === 'r';
      const layer = new Uint8Array(w * h), blocked = new Uint8Array(w * h), claimed = new Uint8Array(w * h);
      const props = [], groundProps = [], decals = [], missing = {}, stats = { ruins: 0, ruin_fallback: 0, cars: 0, trees: 0, craters: 0, crater_big: 0, decals: 0, rubble_baked: 0 };
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const c = ch(x, y), i = y * w + x;
        if (!openC(c)) blocked[i] = 1;
        layer[i] = c === '=' ? 3 : c === '~' ? 4 : 0;
      }
      // salvage ground under and around Scrap Piles; scorched around craters
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const c = ch(x, y);
        if (c === 'S' || c === 'A') for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X1 = x + dx, Y1 = y + dy; if (X1 >= 0 && Y1 >= 0 && X1 < w && Y1 < h && layer[Y1 * w + X1] < 2) layer[Y1 * w + X1] = 2; }
        if (c === 'o') for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const X1 = x + dx, Y1 = y + dy; if (X1 >= 0 && Y1 >= 0 && X1 < w && Y1 < h && dx * dx + dy * dy <= 5 && layer[Y1 * w + X1] === 0) layer[Y1 * w + X1] = 1; }
      }
      const fits = (x0, y0, fw, fh) => { for (let y = y0; y < y0 + fh; y++) for (let x = x0; x < x0 + fw; x++) { if (x < 0 || y < 0 || x >= w || y >= h || !rubbleC(ch(x, y)) || claimed[y * w + x]) return false; } return true; };
      const claim = (x0, y0, fw, fh) => { for (let y = y0; y < y0 + fh; y++) for (let x = x0; x < x0 + fw; x++) claimed[y * w + x] = 1; };
      const listed = new Set();
      for (const p of m.props || []) {
        listed.add(p.y * w + p.x);
        const a = AL[p.key]; if (!a) { missing[p.key] = (missing[p.key] || 0) + 1; continue; }
        if (claimed[p.y * w + p.x]) continue;
        let name = pick(p.key, p.v, p.x, p.y);
        if (a.multi_tile) {
          const f = P[name], [fw, fh] = f.footprint; let best = null;
          // grow away from open ground: prefer placements whose tiles touch the fewest open tiles (into the block interior)
          for (let oy = 0; oy < fh; oy++) for (let ox = 0; ox < fw; ox++) { const x0 = p.x - ox, y0 = p.y - oy; if (!fits(x0, y0, fw, fh)) continue;
            let edge = 0; for (let y = y0; y < y0 + fh; y++) for (let x = x0; x < x0 + fw; x++) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (openC(ch(x + dx, y + dy))) edge++;
            if (!best || edge < best.edge || (edge === best.edge && y0 > best.y0)) best = { x0, y0, edge }; }
          if (best) { claim(best.x0, best.y0, fw, fh); props.push({ name, tx: best.x0, ty: best.y0, src: p.key }); stats.ruins++; continue; }
          name = pick(a.fallback, undefined, p.x, p.y); stats.ruin_fallback++;
          claim(p.x, p.y, 1, 1); props.push({ name, tx: p.x, ty: p.y, src: p.key }); continue;
        }
        if (p.key === 'cars') {
          const ns = (openC(ch(p.x, p.y - 1)) ? 1 : 0) + (openC(ch(p.x, p.y + 1)) ? 1 : 0), ew = (openC(ch(p.x - 1, p.y)) ? 1 : 0) + (openC(ch(p.x + 1, p.y)) ? 1 : 0);
          if (ns > ew || (ns === ew && (h32(p.x, p.y, 43) & 1))) name += '_ew'; stats.cars++;
          claim(p.x, p.y, 1, 1); props.push({ name, tx: p.x, ty: p.y, src: p.key }); continue;
        }
        if (p.key === 'craters') {
          if (a.group_2x2 && fitsCh(p.x, p.y)) { claim(p.x, p.y, 2, 2); groundProps.push({ name: a.group_2x2, tx: p.x, ty: p.y }); stats.crater_big++; continue; }
          claim(p.x, p.y, 1, 1); groundProps.push({ name, tx: p.x, ty: p.y }); stats.craters++; continue;
        }
        if (p.key === 'decals') { decals.push({ name, x: p.x * TILE + 16 + (h32(p.x, p.y, 45) % 9) - 4, y: p.y * TILE + 16 + (h32(p.x, p.y, 46) % 9) - 4 }); stats.decals++; continue; }
        if (p.key === 'trees') stats.trees++;
        claim(p.x, p.y, 1, 1); props.push({ name, tx: p.x, ty: p.y, src: p.key });
      }
      function fitsCh(x, y) { for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const X1 = x + dx, Y1 = y + dy; if (X1 >= w || Y1 >= h || ch(X1, Y1) !== 'o' || claimed[Y1 * w + X1]) return false; } return true; }
      // legend '#' (no props entry): 1x1 rubble. Edge rubble (touches open ground) gets every tile; the interior is thinned.
      // Rubble is <= ~1 tile tall, so it is BAKED into terrCanvas with its shadow (0 cost per frame).
      const density = opt.interiorRubble === undefined ? 0.3 : opt.interiorRubble;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (ch(x, y) !== '#' || claimed[y * w + x]) continue;
        let edge = false; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (openC(ch(x + dx, y + dy))) edge = true;
        if (!edge && (h32(x, y, 47) % 1000) / 1000 > density) { layer[y * w + x] = Math.max(layer[y * w + x], 1); continue; }
        if (!edge) layer[y * w + x] = Math.max(layer[y * w + x], 1);
        // interior rubble is jittered up to +-7 px so big blocks do not read as a grid (it never touches walkable tiles)
        const jx = edge ? 0 : ((h32(x, y, 48) % 15) - 7) / TILE, jy = edge ? 0 : ((h32(x, y, 49) % 15) - 7) / TILE;
        groundProps.push({ name: pick('rubble', undefined, x, y), tx: x + jx, ty: y + jy, shadow: true }); stats.rubble_baked++;
      }
      props.sort((a, b) => sortKey(a) - sortKey(b));
      return { w, h, layer, decals, groundProps, props, blocked, missing, stats };
    }

    return { resolveMap, drawVehicleAO, bakeTerrain, drawProp, drawPropShadow, sortKey, firePoint, drawFlame, drawLights, drawFog, frames: { tiles: F, props: P, fx: X }, layers };
  }
  const api = { create, TILE, hash: h32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.EnvTerrain = api;
})(typeof window !== 'undefined' ? window : this);
