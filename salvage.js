/* Ashfall RTS - salvage economy module (Loop 2, smallest playable loop).
 * Engine-agnostic: no DOM or canvas. game.js passes in a "host" adapter that does
 * movement, credits and buildings. Runs on a fixed step inside the game's frame loop.
 * Loaded as a plain <script> in the browser (global `Salvage`) and via require() in node tests.
 *
 * Sources: L1 = rts-loops/loop1/1-design-spec.md (+1b revision, 3-engineering-plan.md),
 *          ADD = rts-loops/loop2/1-design-addendum.md, DIR = Director rulings (Loop 2 steering),
 *          USER = user decisions of Oct 27. Every value without a design source is marked PLACEHOLDER.
 */
(function (root) {
  'use strict';

  // ---------------- balance table ----------------
  const TABLE = {
    // Scrap Hauler / Gorger
    haulerCost:          { v: 1200, src: 'L1 + DIR ruling 1 (not live 700)' },
    haulerBuildTime:     { v: 15,   src: 'L1' },
    haulerHp:            { v: 600,  src: 'L1' },
    haulerSpeedTiles:    { v: 1.2,  src: 'L1 (tiles/s)' },
    haulerCapacity:      { v: 500,  src: 'L1 + DIR ruling 1 (not live 300)' },
    gatherPerSec:        { v: 25,   src: 'L1 (~20 s to fill)' },
    unloadPerSec:        { v: 100,  src: 'L1 (5 s to empty)' },
    loadPips:            { v: 5,    src: 'L1 art notes rev 3' },
    // Wreck Yard tiles
    tileMax:             { v: 500,  src: 'L1' },
    stageCount:          { v: 4,    src: 'L1 (stage = ceil(amount/125))' },
    homeFieldTiles:      { v: 24,   src: 'L1 (~12,000 Scrip)' },
    midFieldTiles:       { v: 16,   src: 'L1' },
    centreFieldTiles:    { v: 10,   src: 'L1 (Seraph Wreckage out of scope: centre is normal salvage for now)' },
    // regrowth (in place, same tile)
    regrowAmount:        { v: 25,   src: 'L1 + USER D2 (in place)' },
    regrowEvery:         { v: 15,   src: 'L1 + ADD §4 (partly mined, up to original value)' },
    clearedRegrowDelay:  { v: 120,  src: 'ADD §4' },
    clearedRegrowEvery:  { v: 180,  src: 'ADD §4' },
    clearedRegrowCap:    { v: 100,  src: 'ADD §4' },
    // buildings
    plantCost:           { v: 2000, src: 'L1 + ADD §1 (includes free Hauler, USER D3)' },
    plantBuildTime:      { v: 20,   src: 'L1 + ADD §1' },
    plantHp:             { v: 900,  src: 'L1 + ADD §1' },
    plantPower:          { v: -30,  src: 'ADD §1' },
    powerPlantCost:      { v: 600,  src: 'ADD §1' },
    powerPlantBuildTime: { v: 10,   src: 'ADD §1' },
    powerPlantHp:        { v: 700,  src: 'ADD §1' },
    powerPlantPower:     { v: 100,  src: 'ADD §1' },
    factoryPower:        { v: -40,  src: 'ADD §1' },
    otherPower:          { v: 0,    src: 'PLACEHOLDER: addendum gives no power for HQ/barracks/turret/superweapon/depot' },
    lowPowerMult:        { v: 0.5,  src: 'ADD §1 (production and build speed halved below 0)' },
    depotCost:           { v: 300,  src: 'ADD §3' },
    depotBuildTime:      { v: 6,    src: 'ADD §3' },
    depotHp:             { v: 400,  src: 'ADD §3' },
    // storage
    hqStorage:           { v: 1000, src: 'ADD §3' },
    plantStorage:        { v: 2000, src: 'ADD §3' },
    depotStorage:        { v: 1500, src: 'ADD §3' },
    storageAmberAt:      { v: 0.9,  src: 'ADD §3' },
    storageAlertCooldown:{ v: 15,   src: 'ADD §3' },
    // start / AI
    startScripPlayer:    { v: 2500, src: 'L1 + ADD §2' },
    startScripAI:        { v: 3000, src: 'ADD §2 (Normal)' },
    aiGorgerReserve:     { v: 1200, src: 'ADD §2 (= Gorger cost per DIR ruling 1)' },
    // engineering
    tickRate:            { v: 15,   src: 'PLACEHOLDER (engineering): fixed salvage steps per second' },
    maxStepsPerFrame:    { v: 8,    src: 'PLACEHOLDER (engineering): spiral-of-death guard' },
    dockQueueRadius:     { v: 3,    src: 'PLACEHOLDER (engineering): tiles from the pad where a Hauler joins the queue' },
    reservePenalty:      { v: 4,    src: 'PLACEHOLDER (engineering): tiles added when another Hauler already targets a pile' },
    idleRetry:           { v: 2,    src: 'PLACEHOLDER (engineering): seconds between searches when no salvage is found' },
  };
  const D = {}; for (const k in TABLE) D[k] = TABLE[k].v;
  const STAGE_SIZE = D.tileMax / D.stageCount;

  const stageOf = a => a <= 0 ? 0 : Math.min(D.stageCount, Math.ceil(a / STAGE_SIZE));
  const pipsOf = (load, cap) => load <= 0 ? 0 : Math.min(D.loadPips, Math.ceil(load / cap * D.loadPips));
  const storageCap = c => (c.hq || 0) * D.hqStorage + (c.refinery || 0) * D.plantStorage + (c.depot || 0) * D.depotStorage;
  const powerOfType = t => t === 'power' ? D.powerPlantPower : t === 'refinery' ? D.plantPower : t === 'factory' ? D.factoryPower : D.otherPower;
  const powerBalance = types => { let made = 0, used = 0; for (const t of types) { const p = powerOfType(t); if (p > 0) made += p; else used -= p; } return { made, used, net: made - used }; };

  // ---------------- simulation ----------------
  // host: { MW, MH, TILE, res, units(), plants(side), dockPoint(plant)->{x,y}, moveTo(u,x,y), followPath(u,dt)->arrived,
  //         getCredits(side), addCredits(side,n), storageCap(side), incomeMult(side), tilePenalty?(u,i), emit?(ev,data) }
  function create(host) {
    const { MW, MH, TILE, res } = host;
    const NT = MW * MH, STEP = 1 / D.tickRate;
    const field = new Int32Array(NT).fill(-1), orig = new Uint16Array(NT), slow = new Uint8Array(NT), nextGrow = new Float64Array(NT);
    const fields = []; // { id, tiles: [], depleted }
    const S = { time: 0, acc: 0, steps: 0, field, orig, fields, STEP };
    const emit = (ev, data) => { if (host.emit) host.emit(ev, data); };
    const tx = i => i % MW, ty = i => (i / MW) | 0;
    const tileCenter = i => ({ x: tx(i) * TILE + TILE / 2, y: ty(i) * TILE + TILE / 2 });

    // 8-connected flood fill groups salvage tiles into fields
    function initFields() {
      field.fill(-1); fields.length = 0;
      for (let i = 0; i < NT; i++) {
        orig[i] = res[i];
        if (res[i] <= 0 || field[i] >= 0) continue;
        const f = { id: fields.length, tiles: [], depleted: false }; fields.push(f);
        const st = [i]; field[i] = f.id;
        while (st.length) {
          const c = st.pop(); f.tiles.push(c);
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const x = tx(c) + dx, y = ty(c) + dy; if (x < 0 || y < 0 || x >= MW || y >= MH) continue;
            const n = y * MW + x; if (res[n] > 0 && field[n] < 0) { field[n] = f.id; st.push(n); }
          }
        }
        f.tiles.sort((a, b) => a - b);
      }
      return fields;
    }
    const fieldTotal = id => { let s = 0; for (const i of fields[id].tiles) s += res[i]; return s; };
    const reserved = (u, i) => { for (const o of host.units()) if (o !== u && !o.dead && o.d.harv && o.htile === i && (o.hs === 'toField' || o.hs === 'gather')) return true; return false; };

    // nearest non-empty tile in the same field: BFS through the field from `from`, deterministic order
    function nearestInField(u, from) {
      const fid = field[from]; if (fid < 0) return -1;
      const seen = new Set([from]), q = [from]; let fallback = -1;
      for (let h = 0; h < q.length; h++) {
        const c = q[h];
        if (res[c] > 0) { if (!reserved(u, c)) return c; if (fallback < 0) fallback = c; }
        for (const [dx, dy] of NB) {
          const x = tx(c) + dx, y = ty(c) + dy; if (x < 0 || y < 0 || x >= MW || y >= MH) continue;
          const n = y * MW + x; if (field[n] === fid && !seen.has(n)) { seen.add(n); q.push(n); }
        }
      }
      return fallback;
    }
    // nearest non-empty tile anywhere (new Haulers, empty home field)
    function nearestAnywhere(u) {
      const ux = u.x / TILE - 0.5, uy = u.y / TILE - 0.5; let best = -1, bd = Infinity;
      for (const f of fields) for (const i of f.tiles) {
        if (res[i] <= 0) continue;
        let d = Math.hypot(tx(i) - ux, ty(i) - uy) + (host.tilePenalty ? host.tilePenalty(u, i) : 0);
        if (reserved(u, i)) d += D.reservePenalty;
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    }
    function nearestPile(u, from) {
      if (from !== undefined && from >= 0) { const t = nearestInField(u, from); if (t >= 0) return t; }
      return nearestAnywhere(u);
    }
    function nearestPlant(u) {
      let best = null, bd = Infinity;
      for (const p of host.plants(u.side)) { if (p.dead) continue; const dp = host.dockPoint(p), d = Math.hypot(dp.x - u.x, dp.y - u.y); if (d < bd) { bd = d; best = p; } }
      return best;
    }
    const queueOf = p => p.dockQ || (p.dockQ = []);
    const leaveQueue = u => { if (u.dock && u.dock.dockQ) { const k = u.dock.dockQ.indexOf(u); if (k >= 0) u.dock.dockQ.splice(k, 1); } };

    // ---------- orders (also used by right-click in game.js) ----------
    function orderPile(u, i) {
      leaveQueue(u); u.blocked = false;
      if (i < 0 || res[i] <= 0) { u.hs = 'idle'; u.ht = 0; return false; }
      u.hs = 'toField'; u.htile = i; u.retry = 0; const c = tileCenter(i); host.moveTo(u, c.x, c.y); return true;
    }
    function orderPlant(u, p) {
      if (!p || p.dead) { u.hs = 'idle'; u.ht = 0; return false; }
      if (u.dock !== p) leaveQueue(u);
      u.hs = 'toPlant'; u.dock = p; u.retry = 0; u.blocked = false; const dp = host.dockPoint(p); host.moveTo(u, dp.x, dp.y); return true;
    }
    function returnToPlant(u) { const p = nearestPlant(u); if (!p) { u.hs = 'noPlant'; u.ht = 0; u.path = null; return; } orderPlant(u, p); }
    function seek(u) {
      if (u.load >= u.d.cap) return returnToPlant(u);
      const t = nearestPile(u, u.lastTile);
      if (t >= 0) orderPile(u, t); else if (u.load > 0) returnToPlant(u); else { u.hs = 'idle'; u.ht = 0; u.path = null; }
    }
    function park(u) { leaveQueue(u); u.hs = 'parked'; u.blocked = false; }

    // ---------- hauler state machine (one fixed step) ----------
    function tickHauler(u, h) {
      switch (u.hs) {
        case 'seek': seek(u); break;
        case 'toField': {
          if (res[u.htile] <= 0) { seek(u); break; }
          const c = tileCenter(u.htile), arrived = host.followPath(u, h), d = Math.hypot(u.x - c.x, u.y - c.y);
          if (d < TILE * 0.6 || (arrived && d < TILE * 1.4)) { u.hs = 'gather'; u.path = null; u.moving = false; u.gAcc = 0; u.lastTile = u.htile; emit('harvestStart', { u, tile: u.htile }); }
          else if (arrived) { if (++u.retry > 4) { u.lastTile = undefined; u.htile = -1; seek(u); } else host.moveTo(u, c.x, c.y); }
          break;
        }
        case 'gather': {
          u.moving = false;
          const i = u.htile;
          if (res[i] <= 0) { seek(u); break; }
          u.gAcc = (u.gAcc || 0) + D.gatherPerSec * h;
          const take = Math.min(Math.floor(u.gAcc), res[i], u.d.cap - u.load);
          if (take > 0) {
            u.gAcc -= take; const s0 = stageOf(res[i]), p0 = pipsOf(u.load, u.d.cap);
            res[i] -= take; u.load += take;
            if (res[i] <= 0) { res[i] = 0; tileCleared(i); }
            const s1 = stageOf(res[i]); if (s1 !== s0) emit('tileStageChanged', { tile: i, stage: s1, by: u });
            if (pipsOf(u.load, u.d.cap) !== p0) emit('loadChanged', { u, load: u.load });
          }
          if (u.load >= u.d.cap) { u.gAcc = 0; returnToPlant(u); }
          else if (res[i] <= 0) seek(u);
          break;
        }
        case 'toPlant': {
          const p = u.dock; if (!p || p.dead) { returnToPlant(u); break; }
          const dp = host.dockPoint(p), arrived = host.followPath(u, h), d = Math.hypot(u.x - dp.x, u.y - dp.y);
          if (d < TILE * D.dockQueueRadius) { const q = queueOf(p); if (!q.includes(u)) { q.push(u); emit('dockQueued', { u, plant: p, pos: q.length }); } u.hs = 'queue'; }
          else if (arrived) { if (++u.retry > 4) { u.retry = 0; returnToPlant(u); } else host.moveTo(u, dp.x, dp.y); }
          break;
        }
        case 'queue': {
          const p = u.dock; if (!p || p.dead) { returnToPlant(u); break; }
          const q = queueOf(p); if (!q.includes(u)) q.push(u);
          if (q[0] !== u) { u.path = null; u.moving = false; break; } // wait our turn (FIFO, one pad)
          const dp = host.dockPoint(p), d = Math.hypot(u.x - dp.x, u.y - dp.y);
          if (d < 6) { u.x = dp.x; u.y = dp.y; u.hs = 'unload'; u.path = null; u.moving = false; u.uAcc = 0; u.unloaded = 0; emit('unloadStart', { u, plant: p }); break; }
          if (!u.path) host.moveTo(u, dp.x, dp.y);
          if (host.followPath(u, h) && Math.hypot(u.x - dp.x, u.y - dp.y) >= 6) { if (++u.retry > 20) { u.retry = 0; u.x = dp.x; u.y = dp.y; } else host.moveTo(u, dp.x, dp.y); }
          break;
        }
        case 'unload': {
          u.moving = false; u.path = null;
          const p = u.dock; if (!p || p.dead) { leaveQueue(u); returnToPlant(u); break; }
          const dp = host.dockPoint(p); u.x = dp.x; u.y = dp.y; // the pad holds the Hauler in place
          u.uAcc = Math.min((u.uAcc || 0) + D.unloadPerSec * h, D.unloadPerSec);
          const mult = host.incomeMult(u.side), free = host.storageCap(u.side) - host.getCredits(u.side);
          let amt = Math.min(Math.floor(u.uAcc), u.load, Math.max(0, Math.floor(free / mult + 1e-6)));
          if (amt > 0) {
            const p0 = pipsOf(u.load, u.d.cap);
            u.uAcc -= amt; u.load -= amt; u.unloaded += amt; host.addCredits(u.side, amt * mult);
            emit('scripChanged', { side: u.side, amount: amt * mult, u });
            if (pipsOf(u.load, u.d.cap) !== p0) emit('loadChanged', { u, load: u.load });
            if (u.blocked) { u.blocked = false; emit('storageUnblocked', { u, plant: p }); }
          } else if (u.load > 0 && Math.floor(u.uAcc) > 0) {
            // storage full (USER D1): hold the load and keep the pad
            if (!u.blocked) { u.blocked = true; emit('storageBlocked', { u, plant: p, side: u.side }); }
          }
          if (u.load <= 0) {
            u.load = 0; u.blocked = false; leaveQueue(u);
            emit('unload', { u, plant: p, amount: u.unloaded * mult, side: u.side });
            u.unloaded = 0; seek(u);
          }
          break;
        }
        case 'idle': u.moving = false; u.ht = (u.ht || 0) + h; if (u.ht >= D.idleRetry) { u.ht = 0; seek(u); } break;
        case 'noPlant': u.moving = false; u.ht = (u.ht || 0) + h; if (u.ht >= D.idleRetry) { u.ht = 0; returnToPlant(u); } break;
        case 'parked': if (host.followPath(u, h)) { u.path = null; u.order = 'idle'; } break;
        default: seek(u);
      }
    }

    // ---------- in-place regrowth (USER D2 + ADD §4) ----------
    function tileCleared(i) {
      slow[i] = 1; nextGrow[i] = S.time + D.clearedRegrowDelay;
      const f = field[i];
      if (f >= 0 && !fields[f].depleted && fieldTotal(f) <= 0) { fields[f].depleted = true; emit('fieldDepleted', { field: f, tile: i }); }
    }
    function growTile(i, cap) {
      const s0 = stageOf(res[i]), was = res[i];
      res[i] = Math.min(cap, res[i] + D.regrowAmount);
      if (was <= 0 && res[i] > 0) { const f = field[i]; if (f >= 0) fields[f].depleted = false; emit('rubbleGrow', { tile: i }); }
      const s1 = stageOf(res[i]); if (s1 !== s0) emit('tileStageChanged', { tile: i, stage: s1, by: null });
    }
    let fastClock = 0;
    function tickRegrowth(h) {
      fastClock += h;
      const fast = fastClock >= D.regrowEvery - 1e-9; if (fast) fastClock -= D.regrowEvery;
      for (const f of fields) for (const i of f.tiles) {
        if (slow[i]) {
          // cleared once: wait, then trickle back to a small cap
          if (res[i] < D.clearedRegrowCap && S.time + 1e-9 >= nextGrow[i]) { growTile(i, D.clearedRegrowCap); nextGrow[i] = S.time + D.clearedRegrowEvery; }
        } else if (fast && res[i] > 0 && res[i] < orig[i]) growTile(i, orig[i]);
      }
    }

    function tick(h) {
      S.time += h; S.steps++;
      tickRegrowth(h);
      for (const u of host.units()) if (!u.dead && u.d.harv) tickHauler(u, h);
      for (const p of host.plants(0).concat(host.plants(1))) if (p.dockQ) p.dockQ = p.dockQ.filter(u => !u.dead && u.dock === p && (u.hs === 'queue' || u.hs === 'unload'));
    }
    // fixed-step accumulator, called with the frame's variable dt
    function update(dt) {
      S.acc += dt; let n = 0;
      while (S.acc >= STEP - 1e-9 && n < D.maxStepsPerFrame) { tick(STEP); S.acc -= STEP; n++; }
      if (n >= D.maxStepsPerFrame) S.acc = Math.min(S.acc, STEP);
      return n;
    }

    return Object.assign(S, { initFields, update, tick, nearestPile, nearestInField, nearestAnywhere, nearestPlant, orderPile, orderPlant, park, seek, queueOf, leaveQueue, fieldTotal, stageOf, isSlow: i => !!slow[i] });
  }
  const NB = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]];

  const Salvage = { TABLE, D, stageOf, pipsOf, storageCap, powerOfType, powerBalance, create };
  if (typeof module !== 'undefined' && module.exports) module.exports = Salvage;
  else root.Salvage = Salvage;
})(typeof window !== 'undefined' ? window : this);
