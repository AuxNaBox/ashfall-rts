'use strict';
// ===================== ASHFALL: LAST LIGHT =====================
// A small classic-style RTS. Pure Canvas 2D, no assets.
const TILE = 32, MW = 80, MH = 80, N = MW * MH;
const $ = id => document.getElementById(id);
const view = $('view'), ctx = view.getContext('2d');
const mini = $('mini'), mctx = mini.getContext('2d');
let VW = 800, VH = 600;
function resize() { const g = $('game'); VW = view.width = g.clientWidth; VH = view.height = g.clientHeight; }
window.addEventListener('resize', resize);

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
let rng = Math.random;
const ri = n => Math.floor(rng() * n);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

const T = { GROUND: 0, RUBBLE: 1, SLUDGE: 2, CRATER: 3, ROAD: 4 };
const BLOCK = [false, true, true, true, false];

const SIDES = [
  { name: 'Survivors', color: '#3A7BFF', mm: '#5A9BFF', dot: '#9FE8FF', ui: '#6FA8FF' },
  { name: 'The Horde', color: '#d23a2a', mm: '#ff3020', dot: '#ff5040', ui: '#ff6a4a' },
];

// ranges & sight in tiles; speed in px/s; rof in seconds
const SD = Salvage.D; // balance table (salvage.js)
const UDEF = {
  gleaner: { side: 0, name: 'Scrap Truck', desc: 'Salvage harvester. Unarmed', cost: SD.haulerCost, time: SD.haulerBuildTime, hp: SD.haulerHp, speed: SD.haulerSpeedTiles * 32, r: 12, sight: 5, harv: true, cap: SD.haulerCapacity, cat: 'vehicle', from: ['hq', 'factory'], heavy: true },
  survivor: { side: 0, name: 'Rifleman', desc: 'Rifle infantry. Hits air', cost: 100, time: 4, hp: 100, speed: 58, r: 7, sight: 6, dmg: 11, rof: 0.75, range: 4.5, inf: true, cat: 'infantry', from: ['barracks'], weapon: 'bullet' },
  seraph: { side: 0, name: 'Angel', desc: 'Flying angel. Holy beam. Plague-immune. Purifies the dead within 4 tiles', cost: 450, time: 9, hp: 240, speed: 88, r: 10, sight: 8, dmg: 30, rof: 1.3, range: 5, fly: true, cat: 'infantry', from: ['barracks'], weapon: 'beam' },
  ark: { side: 0, name: 'Tank', desc: 'Heavy tank, splash shells. Cannot hit air', cost: 800, time: 13, hp: 700, speed: 40, r: 14, sight: 7, dmg: 75, rof: 2.2, range: 6, splash: 1.0, heavy: true, cat: 'vehicle', from: ['factory'], weapon: 'shell' },
  reaper: { side: 1, name: 'Scrap Eater', desc: 'Salvage harvester. Unarmed', cost: SD.haulerCost, time: SD.haulerBuildTime, hp: SD.haulerHp, speed: SD.haulerSpeedTiles * 32, r: 12, sight: 5, harv: true, cap: SD.haulerCapacity, cat: 'vehicle', from: ['hq', 'factory'], heavy: true },
  zombie: { side: 1, name: 'Zombie', desc: 'Cheap melee swarm. Cannot hit air. Heals in plague', cost: 60, time: 2.5, hp: 120, speed: 36, r: 7, sight: 5, dmg: 13, rof: 1, range: 0.8, inf: true, melee: true, cat: 'infantry', from: ['barracks'], weapon: 'claw' },
  imp: { side: 1, name: 'Imp', desc: 'Ranged fire demon. Hits air', cost: 200, time: 6, hp: 110, speed: 70, r: 8, sight: 6, dmg: 20, rof: 1.3, range: 4.5, inf: true, cat: 'infantry', from: ['barracks'], weapon: 'fireball' },
  brute: { side: 1, name: 'Hellbrute', desc: 'Huge demon, cleaving melee. Cannot hit air', cost: 900, time: 14, hp: 1000, speed: 36, r: 15, sight: 6, dmg: 70, rof: 1.6, range: 1.1, splash: 0.9, melee: true, heavy: true, cat: 'vehicle', from: ['factory'], weapon: 'cleave' },
};
// Loop 3: armor / damage type / hitsAir and spec stats come from combat.js (CS balance table)
for (const k in UDEF) {
  const c = Combat.UNITS[k], u = UDEF[k]; u.armor = c.armor; u.weapon = c.dmgType || undefined; u.hitsAir = !!c.dmgType && Combat.hitsAir(c.dmgType);
  if (c.dmgType) Object.assign(u, { cost: c.cost, time: c.time, hp: c.hp, dmg: c.dmg, rof: c.rof, range: c.range, speed: c.speed * 32, sight: c.sight, splash: c.splash || 0 });
}
const BDEF = {
  hq: { name: ['HQ', 'Hive'], desc: 'Headquarters. Trains Scrap Trucks. Stores 2,000 Credits', w: 3, h: 3, hp: 2200, cost: 0, time: 0, sight: 8 },
  power: { name: ['Power Plant', 'Power Plant'], desc: 'Makes +100 power', w: 2, h: 2, hp: SD.powerPlantHp, cost: SD.powerPlantCost, time: SD.powerPlantBuildTime, req: ['hq'], sight: 4 },
  refinery: { name: ['Scrap Yard', 'Grinder Pit'], desc: 'Salvage drop-off with one dock pad. Stores 2,000 Credits. Comes with a free truck. Uses 30 power', w: 3, h: 2, hp: SD.plantHp, cost: SD.plantCost, time: SD.plantBuildTime, req: ['power'], sight: 5 },
  depot: { name: ['Depot', 'Depot'], desc: 'Stores 1,500 more Credits. Uses 10 power', w: 2, h: 1, hp: SD.depotHp, cost: SD.depotCost, time: SD.depotBuildTime, req: ['refinery'], sight: 4 },
  barracks: { name: ['Barracks', 'Spawning Pit'], desc: 'Trains infantry. Uses 20 power', w: 2, h: 2, hp: 800, cost: 500, time: 8, req: ['hq'], sight: 5 },
  turret: { name: ['Turret', 'Bone Spire'], desc: 'Defense tower. Hits air. Uses 20 power', w: 1, h: 1, hp: 650, cost: 600, time: 9, req: ['barracks'], sight: 7, dmg: 28, rof: 0.9, range: 6.5 },
  factory: { name: ['Factory', 'Factory'], desc: 'Builds heavy units. Uses 40 power', w: 3, h: 3, hp: 1200, cost: 2000, time: 15, req: ['refinery'], sight: 5 },
  silo: { name: ['Nuke Silo', 'Hell Silo'], desc: 'Superweapon. Charges a nuke. Uses 50 power', w: 2, h: 2, hp: 1000, cost: 2500, time: 22, req: ['factory'], sight: 5 },
};
for (const k in BDEF) BDEF[k].armor = 'structure';
const BORDER = ['refinery', 'barracks', 'turret', 'factory', 'silo', 'power', 'depot'];
const UORDER = [['gleaner', 'survivor', 'seraph', 'ark'], ['reaper', 'zombie', 'imp', 'brute']];
const NUKE_CHARGE = 200, NUKE_R = 4.5;
const DIFF = {
  easy: { name: 'Easy', inc: 0.75, prod: 0.85, firstWave: 300, waveGap: 150, minWave: 5, siloTime: 600 },
  normal: { name: 'Normal', inc: 1.0, prod: 1.0, firstWave: 220, waveGap: 120, minWave: 6, siloTime: 420 },
  hard: { name: 'Hard', inc: 1.35, prod: 1.2, firstWave: 160, waveGap: 95, minWave: 8, siloTime: 300 },
};
const bname = (type, side) => BDEF[type].name[side];
const ename = e => e.kind === 'u' ? e.d.name : bname(e.type, e.side);

// ---------------- map state ----------------
let terr, res, plague, bgrid, vis, expl, plagueZones, craters, decos, terrCanvas, miniBase, resTiles;
let G = null, SAL = null; // SAL: salvage sim instance (salvage.js)
let idc = 0;
const bById = new Map();

function walk(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= MW || ty >= MH) return false;
  const i = ty * MW + tx; return !BLOCK[terr[i]] && !bgrid[i];
}
const tileOf = v => Math.floor(v / TILE);

// ---------------- pathfinding (A*) ----------------
const gS = new Float32Array(N), came = new Int32Array(N), stamp = new Uint32Array(N), closed = new Uint32Array(N);
let curStamp = 0;
const heapI = new Int32Array(N * 8), heapP = new Float32Array(N * 8); let hsz = 0;
function hpush(i, p) { let k = hsz++; heapI[k] = i; heapP[k] = p; while (k > 0) { const pa = (k - 1) >> 1; if (heapP[pa] <= heapP[k]) break; const ti = heapI[pa], tp = heapP[pa]; heapI[pa] = heapI[k]; heapP[pa] = heapP[k]; heapI[k] = ti; heapP[k] = tp; k = pa; } }
function hpop() { const top = heapI[0]; hsz--; if (hsz > 0) { heapI[0] = heapI[hsz]; heapP[0] = heapP[hsz]; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < hsz && heapP[l] < heapP[m]) m = l; if (r < hsz && heapP[r] < heapP[m]) m = r; if (m === k) break; const ti = heapI[m], tp = heapP[m]; heapI[m] = heapI[k]; heapP[m] = heapP[k]; heapI[k] = ti; heapP[k] = tp; k = m; } } return top; }
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
function octile(ax, ay, bx, by) { const dx = Math.abs(ax - bx), dy = Math.abs(ay - by); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); }

function nearestWalkable(gx, gy, sx, sy) {
  gx = clamp(gx, 0, MW - 1); gy = clamp(gy, 0, MH - 1);
  if (walk(gx, gy)) return [gx, gy];
  for (let r = 1; r < 25; r++) {
    let best = null, bd = 1e9;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
      const x = gx + dx, y = gy + dy;
      if (!walk(x, y)) continue;
      const d = sx === undefined ? dx * dx + dy * dy : (x - sx) * (x - sx) + (y - sy) * (y - sy);
      if (d < bd) { bd = d; best = [x, y]; }
    }
    if (best) return best;
  }
  return null;
}

function findPath(sx, sy, gx, gy) {
  if (!walk(gx, gy)) { const n = nearestWalkable(gx, gy, sx, sy); if (!n) return null; gx = n[0]; gy = n[1]; }
  if (sx === gx && sy === gy) return [[gx, gy]];
  curStamp++; hsz = 0;
  const start = sy * MW + sx, goal = gy * MW + gx;
  gS[start] = 0; stamp[start] = curStamp; came[start] = -1; hpush(start, octile(sx, sy, gx, gy));
  let best = start, bestH = 1e9, exp = 0;
  while (hsz > 0) {
    const cur = hpop();
    if (closed[cur] === curStamp) continue;
    closed[cur] = curStamp;
    if (cur === goal) { best = goal; break; }
    const cx = cur % MW, cy = (cur / MW) | 0;
    const h = octile(cx, cy, gx, gy); if (h < bestH) { bestH = h; best = cur; }
    if (++exp > 7000) break;
    for (let k = 0; k < 8; k++) {
      const dx = DIRS[k][0], dy = DIRS[k][1], nx = cx + dx, ny = cy + dy;
      if (!walk(nx, ny)) continue;
      if (k >= 4 && (!walk(cx + dx, cy) || !walk(cx, cy + dy))) continue;
      const ni = ny * MW + nx; if (closed[ni] === curStamp) continue;
      const ng = gS[cur] + (k >= 4 ? 1.414 : 1);
      if (stamp[ni] !== curStamp || ng < gS[ni]) { stamp[ni] = curStamp; gS[ni] = ng; came[ni] = cur; hpush(ni, ng + octile(nx, ny, gx, gy)); }
    }
  }
  const out = []; let c = best;
  while (c !== -1 && c !== start) { out.push([c % MW, (c / MW) | 0]); c = came[c]; }
  out.reverse();
  return smoothPath(sx, sy, out);
}
// line-of-sight smoothing on tile grid
function losClear(ax, ay, bx, by) {
  const steps = Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay)) * 3);
  for (let i = 1; i < steps; i++) {
    const t = i / steps, x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
    for (const ox of [-0.3, 0.3]) for (const oy of [-0.3, 0.3]) if (!walk(Math.floor(x + 0.5 + ox), Math.floor(y + 0.5 + oy))) return false;
  }
  return true;
}
function smoothPath(sx, sy, p) {
  if (p.length < 3) return p;
  const out = []; let ax = sx, ay = sy, i = 0;
  while (i < p.length) {
    let j = Math.min(p.length - 1, i + 12);
    while (j > i && !losClear(ax, ay, p[j][0], p[j][1])) j--;
    out.push(p[j]); ax = p[j][0]; ay = p[j][1]; i = j + 1;
  }
  return out;
}
// BFS from tile gathering n walkable tiles (formation targets)
function gatherTiles(gx, gy, n) {
  const s = nearestWalkable(gx, gy); if (!s) return [];
  const seen = new Set([s[1] * MW + s[0]]), q = [s], out = [];
  while (q.length && out.length < n) {
    const c = q.shift(); out.push(c);
    for (let k = 0; k < 8; k++) { const x = c[0] + DIRS[k][0], y = c[1] + DIRS[k][1], i = y * MW + x; if (!seen.has(i) && walk(x, y)) { seen.add(i); q.push([x, y]); } }
  }
  return out;
}
// ---------------- map generation ----------------
function mirrorPt(x, y) { return { x: MW - 1 - x, y: MH - 1 - y }; }
function genMap() {
  terr = new Uint8Array(N); res = new Uint16Array(N); plague = new Uint8Array(N);
  bgrid = new Int32Array(N); vis = new Uint8Array(N); expl = new Uint8Array(N);
  plagueZones = []; craters = []; decos = [];
  const P = G.baseP, E = G.baseE;
  const set = (x, y, t) => { if (x >= 0 && y >= 0 && x < MW && y < MH) terr[y * MW + x] = t; };
  // ruined highways
  for (let k = 0; k < 3; k++) {
    const y = 8 + ri(MH - 16); for (let x = 0; x < MW; x++) { set(x, y, T.ROAD); set(x, y + 1, T.ROAD); }
    const x = 8 + ri(MW - 16); for (let yy = 0; yy < MH; yy++) { set(x, yy, T.ROAD); set(x + 1, yy, T.ROAD); }
  }
  // ruined city blocks
  for (let k = 0; k < 60; k++) {
    const w = 2 + ri(4), h = 2 + ri(4), x0 = ri(MW - w), y0 = ri(MH - h);
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
      const edge = x === x0 || y === y0 || x === x0 + w - 1 || y === y0 + h - 1;
      if ((edge && rng() < 0.7) || (!edge && rng() < 0.3)) set(x, y, T.RUBBLE);
    }
  }
  // toxic sludge lakes
  for (let k = 0; k < 4; k++) {
    const cx = 10 + ri(MW - 20), cy = 10 + ri(MH - 20), r = 2.5 + rng() * 3; const ph = rng() * 6;
    for (let y = Math.floor(cy - r - 2); y <= cy + r + 2; y++) for (let x = Math.floor(cx - r - 2); x <= cx + r + 2; x++) {
      const a = Math.atan2(y - cy, x - cx), rr = r * (0.8 + 0.25 * Math.sin(a * 3 + ph));
      if (dist(x, y, cx, cy) < rr) set(x, y, T.SLUDGE);
    }
  }
  // bomb craters
  for (let k = 0; k < 16; k++) {
    const cx = 4 + rng() * (MW - 8), cy = 4 + rng() * (MH - 8), r = 1.2 + rng() * 1.8;
    craters.push({ x: cx * TILE, y: cy * TILE, r: r * TILE * 1.25 });
    for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) if (dist(x + 0.5, y + 0.5, cx, cy) < r * 0.75) set(x, y, T.CRATER);
  }
  const clearCircle = (c, r) => { for (let y = c.y - r; y <= c.y + r; y++) for (let x = c.x - r; x <= c.x + r; x++) if (dist(x, y, c.x, c.y) <= r) set(x, y, T.GROUND); };
  clearCircle(P, 9); clearCircle(E, 9);
  // salvage fields (symmetric)
  // Loop 1 spec: 24-tile home field, two 16-tile mid fields per side, one 10-tile centre field; every pile starts full
  const fieldsP = [{ x: 18, y: 66, n: SD.homeFieldTiles }, { x: 31, y: 61, n: SD.midFieldTiles }, { x: 15, y: 30, n: SD.midFieldTiles }];
  const growField = f => { // contiguous blob of exactly n tiles, grown outward from the centre
    const got = [f.y * MW + f.x], inSet = new Set(got);
    while (got.length < f.n) {
      let best = -1, bd = 1e9;
      for (const t of got) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = t % MW + dx, y = ((t / MW) | 0) + dy, i = y * MW + x; if (x < 1 || y < 1 || x >= MW - 1 || y >= MH - 1 || inSet.has(i)) continue;
        const d = dist(x, y, f.x, f.y) + hash(i * 31 + f.n) * 0.9; if (d < bd) { bd = d; best = i; }
      }
      got.push(best); inSet.add(best);
    }
    return got;
  };
  const paintField = tiles => { for (const i of tiles) { const x = i % MW, y = (i / MW) | 0; for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) if (xx >= 0 && yy >= 0 && xx < MW && yy < MH && terr[yy * MW + xx] !== T.ROAD) terr[yy * MW + xx] = T.GROUND; } for (const i of tiles) { terr[i] = T.GROUND; res[i] = SD.tileMax; } };
  for (const f of fieldsP) { const tl = growField(f); paintField(tl); paintField(tl.map(i => { const m = mirrorPt(i % MW, (i / MW) | 0); return m.y * MW + m.x; })); }
  paintField(growField({ x: 40, y: 40, n: SD.centreFieldTiles }));
  // plague zones
  const pz = [{ x: 40, y: 40, r: 5 }, { x: 24, y: 44, r: 3.5 }, { x: 55, y: 35, r: 3.5 }, { x: 22, y: 16, r: 4.5 }, { x: 57, y: 63, r: 4.5 }];
  for (const z of pz) {
    plagueZones.push({ x: z.x * TILE + 16, y: z.y * TILE + 16, r: z.r * TILE });
    for (let y = Math.floor(z.y - z.r); y <= z.y + z.r; y++) for (let x = Math.floor(z.x - z.r); x <= z.x + z.r; x++)
      if (x >= 0 && y >= 0 && x < MW && y < MH && dist(x, y, z.x, z.y) <= z.r) plague[y * MW + x] = 1;
  }
  ensureConnected(P, E);
  craters = craters.filter(c => terr[tileOf(c.y) * MW + tileOf(c.x)] === T.CRATER);
  resTiles = []; for (let i = 0; i < N; i++) if (res[i] > 0) resTiles.push(i);
  // cosmetic decorations
  for (let k = 0; k < 140; k++) {
    const x = ri(MW), y = ri(MH), i = y * MW + x;
    if (terr[i] !== T.GROUND || res[i] || dist(x, y, P.x, P.y) < 8 || dist(x, y, E.x, E.y) < 8) continue;
    decos.push({ t: ['tree', 'skull', 'car', 'bones', 'tree', 'cross'][ri(6)], x: x * TILE + 6 + rng() * 20, y: y * TILE + 6 + rng() * 20, a: rng() * 6.28, s: 0.8 + rng() * 0.5 });
  }
  renderTerrain();
}
function carveLine(ax, ay, bx, by) {
  const steps = Math.ceil(dist(ax, ay, bx, by) * 2);
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(ax + (bx - ax) * i / steps), y = Math.round(ay + (by - ay) * i / steps);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < MW && yy < MH && BLOCK[terr[yy * MW + xx]]) terr[yy * MW + xx] = T.GROUND; }
  }
}
function reach(P) {
  const seen = new Uint8Array(N), q = [P.y * MW + P.x]; seen[q[0]] = 1;
  while (q.length) { const c = q.pop(), x = c % MW, y = (c / MW) | 0; for (let k = 0; k < 4; k++) { const nx = x + DIRS[k][0], ny = y + DIRS[k][1]; if (nx < 0 || ny < 0 || nx >= MW || ny >= MH) continue; const ni = ny * MW + nx; if (!seen[ni] && !BLOCK[terr[ni]]) { seen[ni] = 1; q.push(ni); } } }
  return seen;
}
function ensureConnected(P, E) {
  let s = reach(P);
  if (!s[E.y * MW + E.x]) { carveLine(P.x, P.y, E.x, E.y); s = reach(P); }
  for (let i = 0; i < N; i++) if (res[i] && !s[i]) { carveLine(i % MW, (i / MW) | 0, P.x, P.y); s = reach(P); }
  // remove isolated pockets: turn unreachable ground into rubble so units never get stuck there
  for (let i = 0; i < N; i++) if (!BLOCK[terr[i]] && !s[i]) terr[i] = T.RUBBLE;
}

function hash(i) { let x = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; }

function renderTerrain() {
  terrCanvas = document.createElement('canvas'); terrCanvas.width = MW * TILE; terrCanvas.height = MH * TILE;
  const c = terrCanvas.getContext('2d');
  c.fillStyle = '#3a322a'; c.fillRect(0, 0, MW * TILE, MH * TILE);
  // large color variation blobs (ash, scorched earth, rust)
  const cols = ['rgba(20,15,12,0.25)', 'rgba(90,75,60,0.18)', 'rgba(110,50,30,0.12)', 'rgba(60,60,55,0.2)', 'rgba(15,10,8,0.3)'];
  for (let k = 0; k < 500; k++) {
    const x = rng() * MW * TILE, y = rng() * MH * TILE, r = 30 + rng() * 140;
    const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, cols[ri(cols.length)]); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let ty = 0; ty < MH; ty++) for (let tx = 0; tx < MW; tx++) {
    const i = ty * MW + tx, X = tx * TILE, Y = ty * TILE, t = terr[i];
    if (t === T.ROAD) {
      c.fillStyle = `rgba(30,30,32,${0.75 + hash(i) * 0.15})`; c.fillRect(X, Y, TILE, TILE);
      if (hash(i * 7) < 0.5) { c.strokeStyle = 'rgba(0,0,0,0.6)'; c.lineWidth = 1; c.beginPath(); c.moveTo(X + hash(i * 3) * 32, Y); c.lineTo(X + 16, Y + 16); c.lineTo(X + hash(i * 5) * 32, Y + 32); c.stroke(); }
      if (hash(i * 11) < 0.3) { c.fillStyle = 'rgba(200,170,60,0.25)'; c.fillRect(X + 14, Y + 4, 4, 10); }
    }
    // speckles
    for (let k = 0; k < 5; k++) { const h = hash(i * 31 + k); c.fillStyle = h < 0.5 ? 'rgba(0,0,0,0.25)' : 'rgba(160,140,120,0.15)'; c.fillRect(X + hash(i * 13 + k) * 30, Y + hash(i * 17 + k) * 30, 2, 2); }
  }
  for (const cr of craters) {
    const g = c.createRadialGradient(cr.x, cr.y, cr.r * 0.1, cr.x, cr.y, cr.r);
    g.addColorStop(0, 'rgba(8,6,5,0.95)'); g.addColorStop(0.6, 'rgba(25,18,14,0.85)'); g.addColorStop(0.85, 'rgba(120,100,80,0.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.beginPath(); c.arc(cr.x, cr.y, cr.r, 0, 7); c.fill();
  }
  for (let ty = 0; ty < MH; ty++) for (let tx = 0; tx < MW; tx++) {
    const i = ty * MW + tx, X = tx * TILE, Y = ty * TILE, t = terr[i];
    if (t === T.SLUDGE) {
      c.fillStyle = '#1c2a12'; c.beginPath(); c.arc(X + 16, Y + 16, 22, 0, 7); c.fill();
    } else if (t === T.CRATER) { c.fillStyle = 'rgba(10,8,6,0.7)'; c.beginPath(); c.arc(X + 16, Y + 16, 15, 0, 7); c.fill(); }
  }
  for (let ty = 0; ty < MH; ty++) for (let tx = 0; tx < MW; tx++) {
    const i = ty * MW + tx, X = tx * TILE, Y = ty * TILE;
    if (terr[i] === T.SLUDGE) {
      c.fillStyle = 'rgba(80,140,30,0.25)'; c.beginPath(); c.arc(X + 8 + hash(i) * 16, Y + 8 + hash(i * 3) * 16, 4 + hash(i * 5) * 6, 0, 7); c.fill();
      c.strokeStyle = 'rgba(160,220,80,0.15)'; c.beginPath(); c.moveTo(X + 4, Y + 10 + hash(i * 9) * 12); c.lineTo(X + 26, Y + 12 + hash(i * 9) * 12); c.stroke();
    } else if (terr[i] === T.RUBBLE) {
      c.fillStyle = 'rgba(0,0,0,0.45)'; c.fillRect(X + 3, Y + 5, TILE, TILE);
      const n = 3 + Math.floor(hash(i) * 4);
      for (let k = 0; k < n; k++) {
        const h1 = hash(i * 7 + k), h2 = hash(i * 13 + k), h3 = hash(i * 19 + k);
        const gx = X + h1 * 26, gy = Y + h2 * 26, s = 6 + h3 * 12, sh = 70 + Math.floor(h3 * 50);
        c.fillStyle = `rgb(${sh},${sh - 6},${sh - 14})`;
        c.beginPath(); c.moveTo(gx, gy); c.lineTo(gx + s, gy + h1 * 4); c.lineTo(gx + s * 0.8, gy + s * 0.9); c.lineTo(gx + h2 * 4, gy + s); c.closePath(); c.fill();
        c.fillStyle = 'rgba(255,240,220,0.12)'; c.fillRect(gx, gy, s * 0.7, 2);
      }
      if (hash(i * 23) < 0.35) { c.strokeStyle = '#5a3a2a'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(X + 6, Y + 26); c.lineTo(X + 10, Y + 2); c.moveTo(X + 18, Y + 28); c.lineTo(X + 24, Y + 6); c.stroke(); }
    }
  }
  for (const d of decos) drawDeco(c, d);
  miniBase = document.createElement('canvas'); miniBase.width = MW * 3; miniBase.height = MH * 3;
  const m = miniBase.getContext('2d');
  for (let i = 0; i < N; i++) { const t = terr[i]; m.fillStyle = t === T.RUBBLE ? '#6a625a' : t === T.SLUDGE ? '#2a4a18' : t === T.CRATER ? '#141010' : t === T.ROAD ? '#2a2a2c' : '#4a3e32'; m.fillRect((i % MW) * 3, ((i / MW) | 0) * 3, 3, 3); }
}
function drawDeco(c, d) {
  c.save(); c.translate(d.x, d.y); c.rotate(d.a); c.scale(d.s, d.s);
  if (d.t === 'tree') { c.strokeStyle = '#1a120c'; c.lineWidth = 2; c.beginPath(); c.moveTo(0, 0); c.lineTo(10, -3); c.moveTo(5, -1); c.lineTo(9, 5); c.moveTo(0, 0); c.lineTo(-8, 4); c.moveTo(-4, 2); c.lineTo(-6, -5); c.stroke(); c.fillStyle = 'rgba(0,0,0,0.3)'; c.beginPath(); c.arc(0, 0, 3, 0, 7); c.fill(); }
  else if (d.t === 'skull') { c.fillStyle = '#c8bca6'; c.beginPath(); c.arc(0, 0, 3.5, 0, 7); c.fill(); c.fillStyle = '#222'; c.fillRect(-2, -1, 1.5, 1.5); c.fillRect(1, -1, 1.5, 1.5); }
  else if (d.t === 'bones') { c.strokeStyle = '#bdb19a'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(-5, -3); c.lineTo(5, 3); c.moveTo(-5, 3); c.lineTo(5, -3); c.stroke(); }
  else if (d.t === 'car') { c.fillStyle = 'rgba(0,0,0,0.4)'; c.fillRect(-9, -4, 20, 11); c.fillStyle = '#5a3020'; c.fillRect(-10, -5, 20, 10); c.fillStyle = '#2a1810'; c.fillRect(-4, -4, 8, 8); c.fillStyle = '#7a4a2a'; c.fillRect(-10, -5, 3, 10); }
  else if (d.t === 'cross') { c.rotate(-d.a); c.fillStyle = '#4a3a2a'; c.fillRect(-1, -8, 2, 10); c.fillRect(-4, -5, 8, 2); }
  c.restore();
}
// ---------------- entities ----------------
function makeUnit(type, side, x, y) {
  const d = UDEF[type];
  const u = { id: ++idc, kind: 'u', type, side, d, x, y, hp: d.hp, maxhp: d.hp, r: d.r, ang: side ? 2.4 : -0.8, tang: side ? 2.4 : -0.8,
    order: 'idle', path: null, pi: 0, dest: null, target: null, tmode: null, cd: Math.random() * 0.5, scan: Math.random() * 0.3,
    repath: 0, load: 0, hs: 'seek', htile: -1, ht: 0, anim: Math.random() * 10, moving: false, stuckT: 0, sx: x, sy: y, hitT: 0, dead: false };
  G.units.push(u); return u;
}
function makeBld(type, side, tx, ty) {
  const d = BDEF[type];
  const b = { id: ++idc, kind: 'b', type, side, d, tx, ty, w: d.w, h: d.h, x: (tx + d.w / 2) * TILE, y: (ty + d.h / 2) * TILE, r: Math.max(d.w, d.h) * TILE / 2,
    hp: d.hp, maxhp: d.hp, cd: 0, target: null, weapon: type === 'turret' ? Combat.TOWERS.turret.dmgType[side] : null, armed: type === 'turret', charge: 0, rally: null, anim: Math.random() * 10, tang: 0, hitT: 0, dead: false, smokeT: 0 };
  for (let y = ty; y < ty + d.h; y++) for (let x = tx; x < tx + d.w; x++) bgrid[y * MW + x] = b.id;
  bById.set(b.id, b);
  G.blds.push(b);
  // push out units standing on the footprint
  for (const u of G.units) if (!u.d.fly && tileOf(u.x) >= tx && tileOf(u.x) < tx + d.w && tileOf(u.y) >= ty && tileOf(u.y) < ty + d.h) {
    const n = nearestWalkable(tileOf(u.x), tileOf(u.y)); if (n) { u.x = n[0] * TILE + 16; u.y = n[1] * TILE + 16; u.path = null; }
  }
  if (type === 'refinery') { b.pad = padTile(b); b.dockQ = []; const s = dockPoint(b); const h = makeUnit(side ? 'reaper' : 'gleaner', side, s.x, s.y + 20); h.hs = 'seek'; if (G.started && SAL) salvageEvent('haulerSpawned', { u: h, plant: b }); }
  if (type === 'silo' && side === 1 && G.started) msg('WARNING: The Horde has raised a Hell Silo!', '#ff6a3d', b.x, b.y);
  return b;
}
// one-pad dock directly under the bottom-centre of a Scrap Yard / Grinder Pit
function padTile(b) { const n = nearestWalkable(b.tx + 1, b.ty + b.h, b.tx + 1, b.ty + b.h) || [b.tx + 1, b.ty + b.h]; return n[1] * MW + n[0]; }
function dockPoint(b) { if (b.pad === undefined) b.pad = padTile(b); return { x: (b.pad % MW) * TILE + 16, y: ((b.pad / MW) | 0) * TILE + 16 }; }
function removeBld(b) { for (let y = b.ty; y < b.ty + b.h; y++) for (let x = b.tx; x < b.tx + b.w; x++) if (bgrid[y * MW + x] === b.id) bgrid[y * MW + x] = 0; bById.delete(b.id); }
function edgeDist(ax, ay, e) {
  if (e.kind === 'u') return Math.hypot(e.x - ax, e.y - ay) - e.r;
  const x0 = e.tx * TILE, y0 = e.ty * TILE, x1 = x0 + e.w * TILE, y1 = y0 + e.h * TILE;
  return Math.hypot(Math.max(x0 - ax, 0, ax - x1), Math.max(y0 - ay, 0, ay - y1));
}
function spawnPoint(b) {
  const n = nearestWalkable(b.tx + (b.w >> 1), b.ty + b.h, b.tx + (b.w >> 1), b.ty + b.h + 2) || [b.tx, b.ty + b.h];
  return { x: n[0] * TILE + 16, y: n[1] * TILE + 16 };
}
const hasBld = (side, type) => G.blds.some(b => b.side === side && b.type === type && !b.dead);
const countBld = (side, type) => G.blds.filter(b => b.side === side && b.type === type && !b.dead).length;

// ---------------- movement ----------------
function moveTo(u, px, py) {
  px = clamp(px, 4, MW * TILE - 4); py = clamp(py, 4, MH * TILE - 4);
  if (u.d.fly) { u.path = [{ x: px, y: py }]; u.pi = 0; u.dest = { x: px, y: py }; return; }
  const gx = tileOf(px), gy = tileOf(py);
  const p = findPath(tileOf(u.x), tileOf(u.y), gx, gy);
  u.dest = { x: px, y: py };
  if (!p) { u.path = null; return; }
  u.path = p.map(t => ({ x: t[0] * TILE + 16, y: t[1] * TILE + 16 }));
  const lt = p[p.length - 1];
  if (lt && lt[0] === gx && lt[1] === gy) u.path[u.path.length - 1] = { x: px, y: py };
  u.pi = 0; u.stuckT = 0;
}
function followPath(u, dt) {
  if (!u.path || u.pi >= u.path.length) { u.moving = false; return true; }
  const wp = u.path[u.pi];
  if (!u.d.fly && u.pi < u.path.length && !walk(tileOf(wp.x), tileOf(wp.y))) { const f = u.path[u.path.length - 1]; moveTo(u, f.x, f.y); if (!u.path) return true; }
  const w = u.path[u.pi]; if (!w) return true;
  const dx = w.x - u.x, dy = w.y - u.y, d = Math.hypot(dx, dy);
  let sp = u.d.speed; if (!u.d.fly && terr[tileOf(u.y) * MW + tileOf(u.x)] === T.ROAD) sp *= 1.2;
  const step = sp * dt;
  u.moving = true;
  if (d > 0.01) { u.ang = Math.atan2(dy, dx); if (!u.target) u.tang = u.ang; }
  if (d <= step) { u.x = w.x; u.y = w.y; u.pi++; }
  else { u.x += dx / d * step; u.y += dy / d * step; }
  // stuck detection
  u.stuckT += dt;
  if (u.stuckT > 1.2) { if (Math.hypot(u.x - u.sx, u.y - u.sy) < 6 && u.dest) { const f = u.path[u.path.length - 1]; if (f && Math.hypot(f.x - u.x, f.y - u.y) < u.r * 2.5 + 10) { u.path = null; return true; } moveTo(u, u.dest.x, u.dest.y); } u.stuckT = 0; u.sx = u.x; u.sy = u.y; }
  if (u.pi >= u.path.length) { u.moving = false; return true; }
  return false;
}
function separate() {
  const us = G.units; const n = us.length;
  for (let i = 0; i < n; i++) {
    const a = us[i]; if (a.d.fly || a.dead) continue;
    for (let j = i + 1; j < n; j++) {
      const b = us[j]; if (b.d.fly || b.dead) continue;
      if (a.d.harv && b.d.harv) continue; // trucks pass each other: avoids head-on jams at the dock
      if (a.side !== b.side && ((a.d.harv && b.d.armor === 'light') || (b.d.harv && a.d.armor === 'light'))) continue; // trucks drive over enemy infantry (crush)
      const dx = b.x - a.x, dy = b.y - a.y, md = (a.r + b.r) * 0.85;
      if (Math.abs(dx) > md || Math.abs(dy) > md) continue;
      let d = Math.hypot(dx, dy); if (d >= md) continue;
      let nx, ny; if (d < 0.01) { nx = Math.random() - 0.5; ny = Math.random() - 0.5; d = 0.01; const l = Math.hypot(nx, ny); nx /= l; ny /= l; } else { nx = dx / d; ny = dy / d; }
      const push = (md - d) * 0.5;
      const wa = a.moving && !b.moving ? 0.3 : (!a.moving && b.moving ? 0.7 : 0.5);
      const ax = a.x - nx * push * 2 * (1 - wa) * 0.5, ay = a.y - ny * push * 2 * (1 - wa) * 0.5;
      const bx = b.x + nx * push * 2 * wa * 0.5, by = b.y + ny * push * 2 * wa * 0.5;
      if (walk(tileOf(ax), tileOf(ay))) { a.x = ax; a.y = ay; }
      if (walk(tileOf(bx), tileOf(by))) { b.x = bx; b.y = by; }
    }
  }
}

// ---------------- orders ----------------
function issueMove(list, px, py, attackMove) {
  const ground = list.filter(u => !u.d.fly), fly = list.filter(u => u.d.fly);
  const tiles = gatherTiles(tileOf(px), tileOf(py), ground.length);
  ground.sort((a, b) => dist(a.x, a.y, px, py) - dist(b.x, b.y, px, py));
  ground.forEach((u, k) => { const t = tiles[k] || tiles[tiles.length - 1]; const tx = k === 0 && walk(tileOf(px), tileOf(py)) ? px : (t ? t[0] * TILE + 16 : px), ty = k === 0 && walk(tileOf(px), tileOf(py)) ? py : (t ? t[1] * TILE + 16 : py); orderMove(u, tx, ty, attackMove); });
  fly.forEach((u, k) => { const a = k * 2.4, r = k ? 14 + k * 4 : 0; orderMove(u, px + Math.cos(a) * r, py + Math.sin(a) * r, attackMove); });
}
function orderMove(u, x, y, am) {
  u.target = null; u.tmode = null;
  if (u.d.harv) { SAL.park(u); moveTo(u, x, y); u.order = 'move'; return; }
  u.order = am ? 'attackmove' : 'move'; moveTo(u, x, y);
}
function orderAttack(list, t) {
  for (const u of list) { if (u.d.harv || !canAttack(u, t)) continue; u.target = t; u.tmode = 'forced'; u.order = 'attack'; u.repath = 0; u.path = null; }
}
function orderHarvest(u, tileIdx) { u.lastTile = tileIdx; SAL.orderPile(u, tileIdx); }
function orderDock(u, b) { SAL.orderPlant(u, b); }
function stopUnits(list) { for (const u of list) { u.path = null; u.target = null; u.order = 'idle'; if (u.d.harv) SAL.park(u); } }

// ---------------- targeting / combat ----------------
const armorOf = e => e.kind === 'b' ? 'structure' : e.d.armor;
const weaponOf = e => e.kind === 'b' ? e.weapon : e.d.weapon;
const canAttack = (a, t) => { const w = weaponOf(a); return !!w && Combat.canHit(w, armorOf(t)); };
function findEnemy(e, range, side) {
  // tiers (combat.js targetTier): armed enemies first, then trucks (units only), then unarmed buildings; nearest within a tier
  const w = weaponOf(e); if (!w) return null;
  const isB = e.kind === 'b';
  let best = null, bt = 9, bd = 1e9;
  const consider = (o, tier) => { if (tier > bt) return; const d = edgeDist(e.x, e.y, o); if (d >= range) return; if (tier < bt || d < bd) { bt = tier; bd = d; best = o; } };
  for (const o of G.units) { if (o.side === side || o.dead || !Combat.canHit(w, o.d.armor)) continue; consider(o, Combat.targetTier(isB, { kind: 'u', harv: !!o.d.harv })); }
  if (!isB) for (const o of G.blds) { if (o.side === side || o.dead || !Combat.canHit(w, 'structure')) continue; consider(o, Combat.targetTier(false, o)); }
  return best;
}
function updUnit(u, dt) {
  u.cd -= dt; u.anim += dt; u.hitT -= dt;
  if (u.d.harv) return; // Scrap Trucks run on the salvage fixed step (SAL.update)
  if (u.target && u.target.dead) {
    u.target = null;
    if (u.order === 'attack') u.order = 'idle';
    if (u.order === 'attackmove' && u.dest) moveTo(u, u.dest.x, u.dest.y);
  }
  if (u.target) { engage(u, dt); return; }
  if (u.order === 'move') { if (followPath(u, dt)) { u.order = 'idle'; u.path = null; } return; }
  u.scan -= dt;
  if (u.scan <= 0) {
    u.scan = 0.3 + Math.random() * 0.1;
    const t = findEnemy(u, u.d.sight * TILE, u.side);
    if (t) { u.target = t; u.tmode = 'auto'; u.repath = 0; engage(u, dt); return; }
  }
  if (u.order === 'attackmove') { if (followPath(u, dt)) { u.order = 'idle'; u.path = null; } }
  else u.moving = false;
}
function engage(u, dt) {
  const t = u.target, rng = u.d.range * TILE;
  if (!canAttack(u, t)) { u.target = null; if (u.order === 'attack') u.order = 'idle'; return; }
  const ed = edgeDist(u.x, u.y, t) - u.r * 0.5;
  if (ed <= rng) {
    u.moving = false; u.path = null;
    u.tang = Math.atan2(t.y - u.y, t.x - u.x); if (!u.d.weapon || u.d.weapon !== 'shell') u.ang = u.tang;
    if (u.cd <= 0) { fire(u, t); u.cd = u.d.rof * (0.9 + Math.random() * 0.2); }
  } else {
    if (u.tmode === 'auto' && ed > u.d.sight * TILE * 1.7) { u.target = null; if (u.order === 'attackmove' && u.dest) moveTo(u, u.dest.x, u.dest.y); return; }
    // retarget to something closer if auto
    u.repath -= dt;
    if (!u.path || u.repath <= 0 || u.pi >= u.path.length) {
      u.repath = 0.7 + Math.random() * 0.4;
      const keep = u.dest; moveTo(u, t.x, t.y); if (u.order === 'attackmove') u.dest = keep;
      if (u.tmode === 'auto') { const c = findEnemy(u, u.d.sight * TILE, u.side); if (c && c !== t) u.target = c; }
    }
    followPath(u, dt);
  }
}
function fire(s, t) {
  const side = s.side;
  const w = weaponOf(s), air = t.kind === 'u' && t.d.fly ? Combat.D.projArcPx : 0;
  const dmg = s.d.dmg;
  const ox = s.x + Math.cos(s.tang) * (s.r * 0.8), oy = s.y + Math.sin(s.tang) * (s.r * 0.8) - (s.d.fly ? 9 : s.kind === 'b' ? 14 : 0);
  if (w === 'bullet') { const hx = t.x + (Math.random() - 0.5) * 6, hy = t.y - air + (Math.random() - 0.5) * 6; G.fx.push({ k: 'line', x1: ox, y1: oy, x2: hx, y2: hy, c: s.kind === 'b' ? '#DDF6FF' : '#ffe9a0', w: s.kind === 'b' ? 2 : 1.5, t: 0, dur: 0.07 }); G.fx.push({ k: 'spark', x: hx, y: hy, c: '#ffe9a0', t: 0, dur: 0.15 }); damage(t, dmg, s, w); sfx('shot', s.x, s.y); }
  else if (w === 'beam') { G.fx.push({ k: 'beam', x1: ox, y1: oy, x2: t.x, y2: t.y - air, c: side ? '#ff5030' : '#9FE8FF', t: 0, dur: 0.18 }); G.fx.push({ k: 'spark', x: t.x, y: t.y, c: '#fff6c0', t: 0, dur: 0.3 }); damage(t, dmg, s, w); sfx('beam', s.x, s.y); }
  else if (w === 'claw' || w === 'cleave') {
    G.fx.push({ k: 'slash', x: t.x, y: t.y, a: s.ang, r: w === 'cleave' ? 18 : 9, t: 0, dur: 0.2 });
    if (w === 'cleave') areaDamage(t.x, t.y, s.d.splash * TILE, dmg, s, w); else damage(t, dmg, s, w);
    sfx('claw', s.x, s.y);
  } else {
    const bolt = w === 'fire' && s.kind === 'b'; // Bone Spire fire bolt (Imp throws a fireball)
    G.proj.push({ x: ox, y: oy, sx: ox, sy: oy, t, tx: t.x, ty: t.y - air, air, sp: w === 'shell' ? 320 : bolt ? 380 : 220, w, bolt, dmg, s, side, splash: s.kind === 'b' ? 0 : (s.d.splash || 0) });
    sfx(w === 'fire' ? 'fire' : 'shot', s.x, s.y);
  }
}
function updProj(dt) {
  for (const p of G.proj) {
    if (p.t && !p.t.dead) { p.tx = p.t.x; p.ty = p.t.y - (p.air || 0); }
    const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy), st = p.sp * dt;
    if (p.w === 'fire' && Math.random() < 0.6) G.fx.push({ k: 'ember', x: p.x, y: p.y, vx: (Math.random() - 0.5) * 20, vy: (Math.random() - 0.5) * 20, c: '#ff9a30', t: 0, dur: 0.35 });
    if (d <= st) {
      p.done = true;
      if (p.splash) areaDamage(p.tx, p.ty + (p.air || 0), p.splash * TILE, p.dmg, p.s, p.w);
      else if (p.t && !p.t.dead) damage(p.t, p.dmg, p.s, p.w);
      G.fx.push({ k: 'boom', x: p.tx, y: p.ty, r: p.w === 'shell' ? 16 : 9, c: p.bolt ? '#ffb040' : '#ff8a30', t: 0, dur: 0.35 });
      if (p.w === 'shell') sfx('boom', p.tx, p.ty);
    } else { p.x += dx / d * st; p.y += dy / d * st; p.a = Math.atan2(dy, dx); }
  }
  G.proj = G.proj.filter(p => !p.done);
}
function areaDamage(x, y, r, dmg, src, w) {
  const side = src && src.side;
  for (const u of G.units) if (!u.dead && u.side !== side && Combat.canHit(w, u.d.armor)) { const d = edgeDist(x, y, u); if (d < r) damage(u, dmg * (1 - 0.5 * Math.max(0, d) / r), src, w); }
  for (const b of G.blds) if (!b.dead && b.side !== side) { const d = edgeDist(x, y, b); if (d < r) damage(b, dmg * (1 - 0.5 * d / r), src, w); }
}
function damage(t, amt, src, w) {
  if (t.dead) return;
  amt *= Combat.mult(w, armorOf(t)); // CS damage matrix (unknown types such as plague or nuke: x1)
  t.hp -= amt; t.hitT = 0.12;
  if (t.side === 0 && w !== 'plague') alertAttack(t);
  if (t.hp <= 0) kill(t, src, w);
  else if (t.kind === 'u' && t.d.harv) truckHurt(t);
  else if (t.kind === 'u' && t.side === 1 && src && src.kind === 'u' && !t.target && t.order !== 'move' && canAttack(t, src)) { t.target = src; t.tmode = 'auto'; }
  else if (t.kind === 'u' && t.side === 0 && src && src.kind === 'u' && !t.target && t.order === 'idle' && canAttack(t, src)) { t.target = src; t.tmode = 'auto'; }
}
// Loop 1 rule kept by CS: a truck below 50% HP goes home to unload (once per life: there is no repair yet), and never fights back
// Truck retreat below 50% HP, once per life (approved by Dezi, Loop 3). TODO: a future repair should reset t.retreated.
function truckHurt(t) {
  if (t.retreated || t.hp >= t.maxhp * Combat.D.truckRetreatPct) return;
  t.retreated = true;
  const p = SAL.nearestPlant(t); if (p && t.load > 0 && t.hs !== 'unload' && t.hs !== 'queue') SAL.orderPlant(t, p);
  if (t.side === 0) msg('Scrap Truck damaged: returning to the Scrap Yard.', '#ffb060', t.x, t.y);
}
function alertAttack(t) {
  const now = G.time;
  if (t.kind === 'b') { if (now - (G.alertB || -99) > 12) { G.alertB = now; G.lastAlert = { x: t.x, y: t.y }; msg('Our base is under attack!', '#ff6a3d', t.x, t.y); sfx('alert'); } }
  else if (!onScreen(t.x, t.y, 0) && now - (G.alertU || -99) > 20) { G.alertU = now; G.lastAlert = { x: t.x, y: t.y }; msg('Our forces are under attack! (Space to view)', '#ffb060', t.x, t.y); }
}
function kill(t, src, w) {
  t.dead = true; t.hp = 0;
  const st = G.stats;
  if (t.side === 1) st.kills++; else st.lost++;
  if (t.kind === 'u') {
    if (t.d.harv && t.side === 0) { G.lastAlert = { x: t.x, y: t.y }; msg('Scrap Truck lost!', '#ff6a3d', t.x, t.y); }
    if (t.d.inf) { G.fx.push({ k: 'blood', x: t.x, y: t.y, c: t.side ? (t.type === 'zombie' ? '#4a5a2a' : '#8a1a10') : '#7a1010', t: 0, dur: 0.6 }); G.decals.push({ k: 'blood', x: t.x, y: t.y, c: t.side ? '#3a3a1a' : '#4a0a08', a: Math.random() * 6, t: 0 }); }
    else { G.fx.push({ k: 'boom', x: t.x, y: t.y, r: 26, c: '#ffa040', t: 0, dur: 0.6 }); G.decals.push({ k: 'scorch', x: t.x, y: t.y, r: 18, t: 0 }); sfx('boom', t.x, t.y); }
    // the dead rise
    if (t.d.harv && t.load > 0) dropCargo(t);
    if (Combat.riseEligible(t.type, t.side, w) && Combat.purified(t.x, t.y, G.units.filter(a => a.side === 0 && a.type === 'seraph'), TILE)) {
      G.stats.purified = (G.stats.purified || 0) + 1; G.fx.push({ k: 'purify', x: t.x, y: t.y, t: 0, dur: 0.7 });
    } else if (Combat.riseEligible(t.type, t.side, w)) {
      G.rises.push({ x: t.x, y: t.y, t: Combat.D.riseDelay });
      if (!G.riseMsg) { G.riseMsg = true; msg('The dead rise! Fallen infantry return as zombies.', '#9fe07a', t.x, t.y); }
    }
  } else {
    removeBld(t);
    if (t.side === 1) st.bKills++; else st.bLost++;
    if (t.type === 'refinery' || t.type === 'depot' || t.type === 'hq') { const cap = storageCapOf(t.side); if (G.credits[t.side] > cap) { const lost = Math.floor(G.credits[t.side] - cap); G.credits[t.side] = cap; if (t.side === 0) msg(`Storage lost: ${lost} Credits destroyed.`, '#ff6a3d', t.x, t.y); } }
    for (let k = 0; k < 6; k++) G.fx.push({ k: 'boom', x: t.tx * TILE + Math.random() * t.w * TILE, y: t.ty * TILE + Math.random() * t.h * TILE, r: 22 + Math.random() * 18, c: '#ffa040', t: -k * 0.08, dur: 0.7 });
    G.decals.push({ k: 'scorch', x: t.x, y: t.y, r: t.w * 20, t: 0 });
    G.decals.push({ k: 'ruin', x: t.tx * TILE, y: t.ty * TILE, w: t.w, h: t.h, t: 0 });
    sfx('boom', t.x, t.y); shake(6);
    if (t.side === 0) msg(`${ename(t)} destroyed!`, '#ff6a3d', t.x, t.y);
    else msg(`Enemy ${ename(t)} destroyed.`, '#DDF6FF');
  }
}

// Cargo drop on truck death (approved by Dezi, Loop 3): half the load goes to the nearest Scrap Pile (a Salvage Field
// tile with Salvage on it) within 2 tiles, up to that tile's 500 cap; anything over the cap, or with no pile in range, is lost.
function dropCargo(t) {
  const amt = Math.floor(t.load * Combat.D.truckDropPct), cx = tileOf(t.x), cy = tileOf(t.y), R = Combat.D.truckDropSearchTiles, cap = Salvage.D.tileMax;
  let bi = -1, bd = 1e9;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= MW || y >= MH) continue;
    const i = y * MW + x; if (SAL.field[i] < 0 || res[i] <= 0 || bgrid[i]) continue;
    const d = dx * dx + dy * dy; if (d < bd) { bd = d; bi = i; }
  }
  if (bi < 0 || amt <= 0) return 0;
  const add = Math.max(0, Math.min(amt, cap - res[bi])); // over the cap is lost
  res[bi] += add; if (add > 0) G.fx.push({ k: 'dust', x: (bi % MW) * TILE + 16, y: ((bi / MW) | 0) * TILE + 16, t: 0, dur: 0.6 });
  return add;
}
// a moving truck crushes enemy Light infantry under its centre (CS); crushed bodies never rise
function updCrush() {
  for (const u of G.units) {
    if (u.dead || !u.d.harv) continue;
    const moved = u.cx0 !== undefined && Math.hypot(u.x - u.cx0, u.y - u.cy0) > 0.01; u.cx0 = u.x; u.cy0 = u.y;
    if (!moved) continue;
    for (const o of G.units) if (!o.dead && !o.d.fly && Combat.canCrush(u, { side: o.side, dead: o.dead, armor: o.d.armor, x: o.x, y: o.y })) {
      kill(o, u, 'crush'); G.stats.crushed = (G.stats.crushed || 0) + 1;
      G.fx.push({ k: 'blood', x: o.x, y: o.y, c: o.side ? '#4a5a2a' : '#7a1010', t: 0, dur: 0.6 }); G.decals.push({ k: 'blood', x: o.x, y: o.y, c: o.side ? '#3a3a1a' : '#4a0a08', a: Math.random() * 6, t: 0 });
    }
  }
}

// ---------------- salvage economy (salvage.js) ----------------
function sideCounts(side) { const c = {}; for (const b of G.blds) if (b.side === side && !b.dead) c[b.type] = (c[b.type] || 0) + 1; return c; }
function storageCapOf(side) { return Salvage.storageCap(sideCounts(side)); }
function powerOf(side) { return Salvage.powerBalance(G.blds.filter(b => b.side === side && !b.dead).map(b => b.type)); }
function makeSalvage() {
  const S = Salvage.create({
    MW, MH, TILE, res,
    units: () => G.units,
    plants: side => G.blds.filter(b => b.side === side && b.type === 'refinery' && !b.dead),
    dockPoint, moveTo, followPath,
    getCredits: side => G.credits[side],
    addCredits: (side, n) => { G.credits[side] += n; if (side === 0) G.stats.salvage += n; },
    storageCap: storageCapOf,
    incomeMult: side => side === 1 ? G.diff.inc : 1,
    tilePenalty: (u, i) => plague[i] && u.side === 0 ? 12 : 0, // Survivors avoid plague fields
    emit: salvageEvent,
  });
  S.initFields();
  return S;
}
function salvageEvent(ev, e) {
  const u = e && e.u;
  switch (ev) {
    case 'harvestStart': G.fx.push({ k: 'dust', x: u.x + Math.cos(u.ang) * 14, y: u.y + Math.sin(u.ang) * 14, t: 0, dur: 0.6 }); break;
    case 'tileStageChanged': { const x = (e.tile % MW) * TILE + 16, y = ((e.tile / MW) | 0) * TILE + 18; G.fx.push({ k: 'dust', x, y, t: 0, dur: 0.6 }); if (e.by) sfx('clank', x, y); break; }
    case 'fieldDepleted': { const x = (e.tile % MW) * TILE + 16, y = ((e.tile / MW) | 0) * TILE + 16; if (ownsNearby(0, x, y)) msg('Salvage Field depleted. Regrowth is slow: expand to a new field.', '#ffc93a', x, y); break; }
    case 'unload': if (e.amount > 0) { G.fx.push({ k: 'pop', x: e.plant.x, y: e.plant.ty * TILE - 4, n: Math.round(e.amount), side: e.side, t: 0, dur: 1.4 }); if (e.side === 0) sfx('chime', e.plant.x, e.plant.y); } break;
    case 'storageBlocked': if (e.side === 0 && G.time - (G.storageAlertT ?? -99) >= SD.storageAlertCooldown) { G.storageAlertT = G.time; G.lastAlert = { x: u.x, y: u.y }; msg('Storage full. Build a Depot. Trucks are waiting at the dock.', '#ffb347', u.x, u.y); sfx('alert'); } break;
    case 'haulerSpawned': if (u.side === 0) G.fx.push({ k: 'pop', x: u.x, y: u.y - 20, txt: 'Free Scrap Truck', side: 0, t: 0, dur: 1.6 }); break;
  }
}
const ownsNearby = (side, x, y) => G.units.some(u => u.side === side && u.d.harv && !u.dead && dist(u.x, u.y, x, y) < 6 * TILE);

// ---------------- production ----------------
const mkQ = () => ({ structure: { list: [], prog: 0, ready: null }, infantry: { list: [], prog: 0 }, vehicle: { list: [], prog: 0 } });
function catOf(type) { return BDEF[type] ? 'structure' : UDEF[type].cat; }
function costOf(type) { return BDEF[type] ? BDEF[type].cost : UDEF[type].cost; }
function timeOf(type) { return BDEF[type] ? BDEF[type].time : UDEF[type].time; }
function prereqOk(side, type) {
  if (BDEF[type]) return (BDEF[type].req || []).every(r => hasBld(side, r));
  return UDEF[type].from.some(f => hasBld(side, f));
}
function missingReq(side, type) {
  if (BDEF[type]) { const m = (BDEF[type].req || []).find(r => !hasBld(side, r)); return m ? bname(m, side) : null; }
  return UDEF[type].from.some(f => hasBld(side, f)) ? null : bname(UDEF[type].from[UDEF[type].from.length - 1], side);
}
function queueItem(side, type) {
  const q = G.queues[side][catOf(type)];
  if (!prereqOk(side, type)) { if (side === 0) msg('Requires ' + missingReq(side, type), '#ffb060'); return false; }
  if (q.ready && side === 0) { msg('Place the finished structure first.', '#ffb060'); return false; }
  if (q.list.length >= 5) return false;
  const c = costOf(type);
  if (G.credits[side] < c) { if (side === 0) { msg('Insufficient Credits.', '#ff6a5a'); sfx('err'); } return false; }
  G.credits[side] -= c; q.list.push(type); if (side === 0) sfx('click');
  return true;
}
function cancelItem(side, type) {
  const q = G.queues[side][catOf(type)];
  if (q.ready === type) { q.ready = null; G.credits[side] += costOf(type); if (G.placing === type) G.placing = null; return; }
  const i = q.list.lastIndexOf(type); if (i < 0) return;
  q.list.splice(i, 1); if (i === 0) q.prog = 0; G.credits[side] += costOf(type); if (side === 0) sfx('click');
}
function updProduction(dt) {
  for (let side = 0; side < 2; side++) {
    const Q = G.queues[side], mult = (side === 1 ? G.diff.prod : 1) * (powerOf(side).net < 0 ? SD.lowPowerMult : 1);
    for (const cat of ['structure', 'infantry', 'vehicle']) {
      const q = Q[cat]; if (!q.list.length || q.ready) continue;
      const type = q.list[0];
      if (!prereqOk(side, type)) continue;
      q.prog += dt * mult;
      if (q.prog >= timeOf(type)) {
        q.prog = 0; q.list.shift();
        if (cat === 'structure') { q.ready = type; if (side === 0) { msg(bname(type, 0) + ' ready. Click it to place.', '#7dff7d'); sfx('ready'); } }
        else {
          const from = G.blds.filter(b => b.side === side && !b.dead && UDEF[type].from.includes(b.type));
          const b = from.find(b => b.type !== 'hq') || from[0];
          const sp = spawnPoint(b); const u = makeUnit(type, side, sp.x, sp.y);
          if (side === 0) G.stats.built++;
          if (u.d.harv) u.hs = 'seek';
          else if (b.rally) issueMove([u], b.rally.x, b.rally.y, false);
          else issueMove([u], sp.x + (Math.random() - 0.5) * 60, sp.y + 30 + Math.random() * 30, false);
        }
      }
    }
  }
}
function canPlace(side, type, tx, ty, margin) {
  const d = BDEF[type];
  for (let y = ty - margin; y < ty + d.h + margin; y++) for (let x = tx - margin; x < tx + d.w + margin; x++) {
    const inside = x >= tx && x < tx + d.w && y >= ty && y < ty + d.h;
    if (x < 0 || y < 0 || x >= MW || y >= MH) { if (inside) return false; continue; }
    const i = y * MW + x;
    if (inside) { if (BLOCK[terr[i]] || bgrid[i] || res[i] > 0 || (SAL && SAL.field[i] >= 0) || isPad(i)) return false; }
    else if (bgrid[i]) return false;
  }
  if (type === 'refinery') { const px = tx + 1, py = ty + d.h; if (px >= MW || py >= MH) return false; const pi = py * MW + px; if (BLOCK[terr[pi]] || bgrid[pi] || (SAL && SAL.field[pi] >= 0)) return false; }
  // must be near own buildings
  for (const b of G.blds) {
    if (b.side !== side || b.dead) continue;
    const gx = Math.max(b.tx - (tx + d.w), tx - (b.tx + b.w), 0), gy = Math.max(b.ty - (ty + d.h), ty - (b.ty + b.h), 0);
    if (Math.max(gx, gy) <= 5) return true;
  }
  return false;
}
const isPad = i => G.blds.some(b => b.type === 'refinery' && !b.dead && b.pad === i);
function placeBld(side, type, tx, ty) {
  const q = G.queues[side].structure; if (q.ready !== type) return false;
  if (!canPlace(side, type, tx, ty, 0)) return false;
  q.ready = null; makeBld(type, side, tx, ty);
  if (side === 0) { sfx('place'); G.stats.bBuilt++; }
  return true;
}

// ---------------- superweapons ----------------
function readySilo(side) { return G.blds.find(b => b.side === side && b.type === 'silo' && !b.dead && b.charge >= NUKE_CHARGE); }
function launchNuke(side, x, y) {
  const s = readySilo(side); if (!s) return false;
  s.charge = 0;
  G.missiles.push({ side, sx: s.x, sy: s.y - 20, x: s.x, y: s.y, tx: x, ty: y, t: 0, dur: 4 });
  if (side === 0) msg('Nuke launched! Impact in 4 seconds.', '#fff3b0', x, y);
  else { msg('HELL SILO LAUNCH! Move your units away from the marker!', '#ff3a1a', x, y); G.lastAlert = { x, y }; }
  sfx('launch');
  return true;
}
function updMissiles(dt) {
  for (const m of G.missiles) {
    m.t += dt; const f = Math.min(1, m.t / m.dur);
    m.x = m.sx + (m.tx - m.sx) * f; m.y = m.sy + (m.ty - m.sy) * f - Math.sin(f * Math.PI) * 400;
    G.fx.push({ k: 'ember', x: m.x, y: m.y, vx: 0, vy: 30, c: m.side ? '#ff5a1a' : '#DDF6FF', t: 0, dur: 0.5 });
    if (f >= 1) { m.done = true; nukeExplode(m.tx, m.ty, m.side); }
  }
  G.missiles = G.missiles.filter(m => !m.done);
}
function nukeExplode(x, y, side) {
  const R = NUKE_R * TILE, src = { side, kind: 'nuke', type: 'nuke' };
  for (const u of G.units) if (!u.dead) { const d = dist(u.x, u.y, x, y); if (d < R) damage(u, 560 * (1 - 0.4 * d / R), src, 'nuke'); }
  for (const b of G.blds) if (!b.dead) { const d = edgeDist(x, y, b); if (d < R) damage(b, 1400 * (1 - 0.5 * d / R), src, 'nuke'); }
  G.rad.push({ x, y, r: R * 1.15, t: 45, max: 45, side });
  G.decals.push({ k: 'scorch', x, y, r: R * 1.1, t: 0 });
  G.fx.push({ k: 'nuke', x, y, r: R, c: side ? '#ff4a1a' : '#fff6c8', t: 0, dur: 2.5 });
  G.flash = { t: 0, c: side ? '255,80,30' : '255,250,220' };
  shake(18); sfx('nuke');
}

// ---------------- environment ----------------
function updEnv(dt) {
  G.envT = (G.envT || 0) + dt;
  if (G.envT >= 0.5) {
    G.envT -= 0.5;
    for (const u of G.units) {
      if (u.dead) continue;
      const i = tileOf(u.y) * MW + tileOf(u.x);
      if (plague[i] && !u.d.fly) {
        if (u.side === 0) { damage(u, -Combat.plagueTick(0, u.d.armor, 0.5), null, 'plague'); if (!G.plagueMsg) { G.plagueMsg = true; msg('Plague zone! It eats our ground units and heals the Horde.', '#9fe07a', u.x, u.y); } }
        else { if (u.hp < u.maxhp && Math.random() < 0.5) G.fx.push({ k: 'mote', x: u.x, y: u.y, t: 0, dur: 0.9, a: Math.random() * 6.28 }); u.hp = Math.min(u.maxhp, u.hp + Combat.plagueTick(1, u.d.armor, 0.5)); }
      }
      for (const r of G.rad) if (dist(u.x, u.y, r.x, r.y) < r.r) damage(u, 8 * (r.t / r.max) + 2, null, 'plague');
    }
  }
  for (const r of G.rad) r.t -= dt;
  G.rad = G.rad.filter(r => r.t > 0);
  for (const r of G.rises) { r.t -= dt; if (r.t <= 0) { r.done = true; const z = makeUnit('zombie', 1, r.x, r.y); z.order = 'idle'; z.risen = true; G.stats.risen = (G.stats.risen || 0) + 1; G.fx.push({ k: 'rise', x: r.x, y: r.y, t: 0, dur: 0.8 }); sfx('rise', r.x, r.y); } }
  G.rises = G.rises.filter(r => !r.done);
}
function updBld(b, dt) {
  b.anim += dt; b.hitT -= dt;
  if (b.type === 'silo' && b.charge < NUKE_CHARGE) { b.charge += dt; if (b.charge >= NUKE_CHARGE && b.side === 0) { msg('Nuke Silo charged! Press N or click LAUNCH.', '#fff3b0'); sfx('ready'); } }
  if (b.type === 'turret') {
    b.cd -= dt;
    if (!b.target || b.target.dead || edgeDist(b.x, b.y, b.target) > b.d.range * TILE) { b.target = null; b.scanT = (b.scanT || 0) - dt; if (b.scanT <= 0) { b.scanT = 0.3; b.target = findEnemy(b, b.d.range * TILE, b.side); } }
    if (b.target) { b.tang = Math.atan2(b.target.y - b.y, b.target.x - b.x); if (b.cd <= 0) { fire(b, b.target); b.cd = b.d.rof; } }
  }
  if (b.hp < b.maxhp * 0.5) { b.smokeT -= dt; if (b.smokeT <= 0) { b.smokeT = 0.25; G.fx.push({ k: 'smoke', x: b.x + (Math.random() - 0.5) * b.w * 20, y: b.y + (Math.random() - 0.5) * b.h * 20, t: 0, dur: 2 }); } }
}

// ---------------- fog of war ----------------
function updFog() {
  vis.fill(0);
  const mark = (x, y, r) => {
    const cx = tileOf(x), cy = tileOf(y), r2 = r * r;
    for (let dy = -r; dy <= r; dy++) { const yy = cy + dy; if (yy < 0 || yy >= MH) continue; for (let dx = -r; dx <= r; dx++) { const xx = cx + dx; if (xx < 0 || xx >= MW || dx * dx + dy * dy > r2) continue; const i = yy * MW + xx; vis[i] = 1; expl[i] = 1; } }
  };
  for (const u of G.units) if (u.side === 0 && !u.dead) mark(u.x, u.y, u.d.sight);
  for (const b of G.blds) if (b.side === 0 && !b.dead) mark(b.x, b.y, b.d.sight);
  for (const r of G.rad) mark(r.x, r.y, 3);
}
const isVisible = e => { if (e.kind === 'b') { for (let y = e.ty; y < e.ty + e.h; y++) for (let x = e.tx; x < e.tx + e.w; x++) if (expl[y * MW + x]) return true; return false; } return !!vis[tileOf(e.y) * MW + tileOf(e.x)]; };
// ---------------- enemy AI (the Horde) ----------------
const AI_ORDER = ['power', 'refinery', 'barracks', 'turret', 'factory', 'turret', 'barracks', 'depot', 'power', 'refinery', 'silo', 'turret', 'turret', 'turret'];
function aiNextBuild() {
  const cnt = {}; for (const b of G.blds) if (b.side === 1 && !b.dead) cnt[b.type] = (cnt[b.type] || 0) + 1;
  const q = G.queues[1].structure; for (const t of q.list) cnt[t] = (cnt[t] || 0) + 1; if (q.ready) cnt[q.ready] = (cnt[q.ready] || 0) + 1;
  const need = {};
  for (const t of AI_ORDER) {
    need[t] = (need[t] || 0) + 1;
    if ((cnt[t] || 0) < need[t]) { if (t === 'silo' && G.time < G.diff.siloTime) continue; if (t !== 'power' && aiPowerAfter(cnt, t) < 0) return 'power'; return t; }
  }
  return null;
}
function aiPowerAfter(cnt, t) { const list = [t]; for (const k in cnt) for (let i = 0; i < cnt[k]; i++) list.push(k); return Salvage.powerBalance(list).net; }
function aiFindSpot(type) {
  const hq = G.blds.find(b => b.side === 1 && b.type === 'hq' && !b.dead) || G.blds.find(b => b.side === 1 && !b.dead);
  if (!hq) return null;
  let cx = tileOf(hq.x), cy = tileOf(hq.y);
  const P = G.baseP, dx = P.x - cx, dy = P.y - cy, l = Math.hypot(dx, dy) || 1;
  if (type === 'turret') { const k = 5 + ri(4), a = (rng() - 0.5) * 1.6, ang = Math.atan2(dy, dx) + a; cx += Math.round(Math.cos(ang) * k); cy += Math.round(Math.sin(ang) * k); }
  else if (type === 'silo') { cx -= Math.round(dx / l * 4); cy -= Math.round(dy / l * 4); }
  const d = BDEF[type];
  for (let r = 0; r < 14; r++) {
    const cand = [];
    for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) {
      if (Math.abs(xx) !== r && Math.abs(yy) !== r) continue;
      const tx = cx + xx - (d.w >> 1), ty = cy + yy - (d.h >> 1);
      if (canPlace(1, type, tx, ty, 1)) cand.push([tx, ty]);
    }
    if (cand.length) return cand[ri(cand.length)];
  }
  return null;
}
function aiArmy() { return G.units.filter(u => u.side === 1 && !u.dead && !u.d.harv); }
function nearestPlayerTarget(x, y) {
  let best = null, bd = 1e9;
  for (const b of G.blds) if (b.side === 0 && !b.dead) { const d = dist(b.x, b.y, x, y); if (d < bd) { bd = d; best = b; } }
  return best;
}
function updAI(dt) {
  const A = G.ai; A.t -= dt; if (A.t > 0) return; A.t = 0.5;
  const side = 1, Q = G.queues[1], cr = () => G.credits[1];
  if (!G.blds.some(b => b.side === 1 && !b.dead)) return;
  // structures
  const next = aiNextBuild();
  // harvesters: once the first Grinder Pit stands, hold back the cost of the 2nd Scrap Eater before spending on anything else
  const harv = G.units.filter(u => u.side === 1 && u.d.harv && !u.dead).length + Q.vehicle.list.filter(t => t === 'reaper').length;
  const eaterReserve = hasBld(1, 'refinery') && harv < 2 ? SD.aiGorgerReserve : 0;
  const econBuild = next === 'power' || next === 'refinery';
  if (Q.structure.ready) {
    const spot = aiFindSpot(Q.structure.ready);
    if (spot) placeBld(1, Q.structure.ready, spot[0], spot[1]); else cancelItem(1, Q.structure.ready);
  } else if (next && !Q.structure.list.length && prereqOk(1, next) && cr() - (econBuild ? 0 : eaterReserve) >= BDEF[next].cost) queueItem(1, next);
  const reserve = (next && !Q.structure.list.length && !Q.structure.ready ? BDEF[next].cost : 0) + eaterReserve;
  const want = Math.min(5, Math.max(1, countBld(1, 'refinery')) * 2);
  if (hasBld(1, 'refinery') && harv < want && Q.vehicle.list.length === 0 && cr() >= costOf('reaper') && prereqOk(1, 'reaper')) { if (queueItem(1, 'reaper') && harv === 1) G.ai.eater2At = G.time; }
  // army (capped so waves stay beatable; the cap grows with every wave)
  const armyN = G.units.filter(u => u.side === 1 && !u.d.harv && !u.dead).length;
  const cap = Math.min(45, Math.round((10 + 5 * A.waveN) * G.diff.inc) + (G.credits[1] > 3000 ? 8 : 0));
  if (armyN < cap && hasBld(1, 'barracks') && Q.infantry.list.length < 2) {
    const t = rng() < (G.time > 240 ? 0.4 : 0.25) ? 'imp' : 'zombie';
    if (cr() - UDEF[t].cost >= reserve) queueItem(1, t);
  }
  if (armyN < cap && hasBld(1, 'factory') && Q.vehicle.list.length === 0 && harv >= want && cr() - 900 >= reserve) queueItem(1, 'brute');
  // superweapon
  const silo = readySilo(1);
  if (silo) {
    let best = null, bs = -1;
    for (const b of G.blds) if (b.side === 0 && !b.dead) { let s = 0; for (const o of G.blds) if (o.side === 0 && !o.dead && dist(o.x, o.y, b.x, b.y) < NUKE_R * TILE * 1.3) s += o.d.hp; if (s > bs) { bs = s; best = b; } }
    if (best) launchNuke(1, best.x + (rng() - 0.5) * 40, best.y + (rng() - 0.5) * 40);
  }
  // waves
  const army = aiArmy();
  const idle = army.filter(u => !u.target && u.order !== 'attackmove' && u.order !== 'attack');
  const hq = G.blds.find(b => b.side === 1 && b.type === 'hq' && !b.dead) || G.blds.find(b => b.side === 1 && !b.dead);
  if (G.time >= A.nextWave) {
    const need = Math.min(26, G.diff.minWave + A.waveN * 2);
    if (idle.length >= need) {
      const keep = idle.length > 10 ? 3 : 0;
      const send = idle.slice(keep, keep + need + 4);
      let cx = 0, cy = 0; for (const u of send) { cx += u.x; cy += u.y; } cx /= send.length; cy /= send.length;
      const tgt = nearestPlayerTarget(cx, cy);
      if (tgt) { issueMove(send, tgt.x, tgt.y, true); A.waveN++; msg(A.waveN === 1 ? 'Scouts report: a Horde wave is marching on our base!' : `Horde wave ${A.waveN} incoming!`, '#ff6a3d'); sfx('alert'); }
      A.nextWave = G.time + G.diff.waveGap;
    } else A.nextWave = G.time + 10;
  }
  // defense: respond to intruders near the Horde base
  A.defT = (A.defT || 0) - 0.5;
  if (A.defT <= 0 && hq) {
    A.defT = 2;
    let intr = null;
    for (const u of G.units) if (u.side === 0 && !u.dead) for (const b of G.blds) if (b.side === 1 && !b.dead && dist(u.x, u.y, b.x, b.y) < 12 * TILE) { intr = u; break; }
    if (intr) { const def = idle.filter(u => dist(u.x, u.y, hq.x, hq.y) < 28 * TILE); if (def.length) issueMove(def, intr.x, intr.y, true); }
    // keep pressure: idle units stranded far from home push on to the next target
    const far = idle.filter(u => dist(u.x, u.y, hq.x, hq.y) > 20 * TILE);
    if (far.length) { const t = nearestPlayerTarget(far[0].x, far[0].y); if (t) issueMove(far, t.x, t.y, true); }
  }
}
// ---------------- rendering ----------------
const cam = { x: 0, y: 0 };
function onScreen(x, y, m) { return x > cam.x - m && x < cam.x + VW + m && y > cam.y - m && y < cam.y + VH + m; }
function shake(a) { G.shakeA = Math.max(G.shakeA || 0, a); }
function circ(c, x, y, r) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); }
function ell(c, x, y, rx, ry) { c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fill(); }

function drawUnit(c, u) {
  const t = u.type, A = u.anim;
  c.save(); c.translate(u.x, u.y);
  if (u.hitT > 0) c.globalAlpha = 0.75;
  if (t === 'survivor') {
    c.fillStyle = 'rgba(0,0,0,0.35)'; ell(c, 1, 4, 7, 3.5);
    c.rotate(u.ang); const bob = u.moving ? Math.sin(A * 12) * 2 : 0;
    c.fillStyle = '#2e281e'; c.fillRect(-3 + bob, -5, 4, 3); c.fillRect(-3 - bob, 2, 4, 3);
    c.fillStyle = '#7d6c4c'; circ(c, 0, 0, 5.5);
    c.fillStyle = '#3A7BFF'; c.fillRect(-1.5, -5.5, 2, 11);
    c.strokeStyle = '#151515'; c.lineWidth = 2; c.beginPath(); c.moveTo(2, 2.5); c.lineTo(11, 2.5); c.stroke();
    c.fillStyle = '#d9b38c'; circ(c, 1, 0, 3);
  } else if (t === 'seraph') {
    const h = 9 + Math.sin(A * 3) * 2;
    c.fillStyle = 'rgba(0,0,0,0.25)'; ell(c, 0, 6, 9, 4);
    c.translate(0, -h);
    const g = c.createRadialGradient(0, 0, 0, 0, 0, 20); g.addColorStop(0, 'rgba(159,232,255,0.45)'); g.addColorStop(1, 'rgba(159,232,255,0)'); c.fillStyle = g; circ(c, 0, 0, 20);
    const f = Math.sin(A * 9) * 0.35;
    for (const s of [-1, 1]) {
      c.save(); c.scale(s, 1); c.rotate(-f);
      c.fillStyle = 'rgba(214,226,236,0.92)'; c.beginPath(); c.moveTo(2, -1); c.quadraticCurveTo(12, -14, 20, -8); c.quadraticCurveTo(14, -4, 17, 0); c.quadraticCurveTo(10, 0, 12, 4); c.quadraticCurveTo(6, 3, 2, 3); c.fill();
      c.strokeStyle = 'rgba(58,123,255,0.8)'; c.lineWidth = 0.8; c.stroke(); c.restore();
    }
    c.fillStyle = '#B8B2A2'; c.beginPath(); c.moveTo(-4, -2); c.lineTo(4, -2); c.lineTo(5, 7); c.lineTo(-5, 7); c.fill();
    c.fillStyle = '#e8c890'; circ(c, 0, -4, 3);
    c.strokeStyle = '#9FE8FF'; c.lineWidth = 1.5; c.beginPath(); c.ellipse(0, -9, 4, 1.5, 0, 0, 7); c.stroke();
    c.fillStyle = '#3A7BFF'; c.fillRect(-4, 1, 8, 2);
    c.strokeStyle = '#9fe8ff'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(5, 0); c.lineTo(5, 9); c.stroke();
  } else if (t === 'ark') {
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.save(); c.rotate(u.ang); c.fillRect(-12, -8, 28, 20); c.restore();
    c.save(); c.rotate(u.ang);
    c.fillStyle = '#2a2620'; c.fillRect(-14, -11, 28, 5); c.fillRect(-14, 6, 28, 5);
    c.fillStyle = '#4a4436'; for (let k = 0; k < 6; k++) { const o = ((k * 5 + (u.moving ? A * 30 : 0)) % 28) - 14; c.fillRect(o, -11, 1.5, 5); c.fillRect(o, 6, 1.5, 5); }
    c.fillStyle = '#B8B2A2'; c.fillRect(-12, -7, 24, 14);
    c.fillStyle = '#3A7BFF'; c.fillRect(-12, -7, 24, 2);
    c.fillStyle = '#5A564C'; c.fillRect(8, -7, 4, 14);
    c.restore();
    c.rotate(u.tang);
    c.fillStyle = '#9a9488'; circ(c, 0, 0, 6.5);
    c.fillStyle = '#5A564C'; c.fillRect(4, -2, 14, 4);
    c.fillStyle = '#3A7BFF'; c.fillRect(-1, -4.5, 2, 9); c.fillRect(-3.5, -1, 7, 2);
  } else if (t === 'gleaner') { // Scrap Truck: khaki hull, open bin that fills in pip steps, scoop dips while gathering
    const pips = Salvage.pipsOf(u.load, u.d.cap), dip = u.hs === 'gather' ? Math.sin(A * 8) * 2 : 0;
    c.rotate(u.ang);
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(-13, -9, 30, 22);
    c.fillStyle = '#5A564C'; c.fillRect(-15, -11, 28, 4); c.fillRect(-15, 7, 28, 4);
    c.fillStyle = '#B8B2A2'; c.fillRect(-15, -8, 28, 16);
    c.fillStyle = '#3A7BFF'; c.fillRect(-15, -8, 28, 2); // team trim
    c.fillStyle = '#5A564C'; c.fillRect(-13, -6, 15, 12); // bin
    if (pips) { const f = pips / 5; c.fillStyle = PAL.rust; c.fillRect(-13, -6 + 12 * (1 - f), 15, 12 * f); c.fillStyle = PAL.steel; for (let k = 0; k < pips; k++) c.fillRect(-12 + (k * 3) % 13, -5 + 12 * (1 - f) + (k % 2), 2, 2); }
    c.fillStyle = '#8a8476'; c.fillRect(4, -6, 7, 12); c.fillStyle = '#9FE8FF'; c.fillRect(7, -4, 3, 8); // cab + halo glass
    c.fillStyle = '#6A6458'; c.beginPath(); c.moveTo(13, -8 + dip); c.lineTo(19, -6 + dip); c.lineTo(19, 6 + dip); c.lineTo(13, 8 + dip); c.fill(); // scoop
  } else if (t === 'reaper') { // Scrap Eater: flesh oval, bone ridges, belly swells with load
    const sc = 1 + 0.15 * (u.load / u.d.cap), chew = u.hs === 'gather' ? Math.abs(Math.sin(A * 8)) * 3 : 0;
    c.rotate(u.ang);
    c.fillStyle = 'rgba(0,0,0,0.35)'; ell(c, 2, 3, 15 * sc, 11 * sc);
    c.fillStyle = '#4A1A30'; ell(c, 0, 0, 15 * sc, 11 * sc);
    c.fillStyle = '#8C3A5A'; ell(c, -1, 0, 13 * sc, 9 * sc);
    c.fillStyle = '#E3D6B8'; for (let k = -2; k <= 2; k++) { c.beginPath(); c.moveTo(-8 + k * 3, -3); c.lineTo(-6 + k * 3, 0); c.lineTo(-8 + k * 3, 3); c.fill(); }
    c.fillStyle = '#2a0a14'; c.beginPath(); c.moveTo(11, -4 - chew); c.lineTo(17, 0); c.lineTo(11, 4 + chew); c.fill();
    c.fillStyle = '#E3D6B8'; c.fillRect(11, -5 - chew, 4, 1.5); c.fillRect(11, 3.5 + chew, 4, 1.5);
    c.fillStyle = '#FF3A2A'; circ(c, 7, -4, 1.6); circ(c, 7, 4, 1.6);
  } else if (t === 'zombie') {
    c.fillStyle = 'rgba(0,0,0,0.35)'; ell(c, 1, 4, 7, 3.5);
    c.rotate(u.ang + Math.sin(A * 4) * 0.2);
    c.strokeStyle = '#6a7a4e'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(1, -4); c.lineTo(10, -3 + Math.sin(A * 5) * 1.5); c.moveTo(1, 4); c.lineTo(10, 3 - Math.sin(A * 5) * 1.5); c.stroke();
    c.fillStyle = '#4a4a38'; circ(c, -1, 0, 6); c.fillStyle = '#3a2a22'; c.fillRect(-5, -2, 5, 5);
    c.fillStyle = '#7a8a5c'; circ(c, 2, 0, 3.6);
    c.fillStyle = '#ff2a10'; c.fillRect(4, -1.8, 1.4, 1.4); c.fillRect(4, 0.6, 1.4, 1.4);
  } else if (t === 'imp') {
    const h = 4 + Math.sin(A * 6) * 1.5;
    c.fillStyle = 'rgba(0,0,0,0.3)'; ell(c, 0, 5, 6, 3); c.translate(0, -h);
    const f = Math.sin(A * 16) * 0.5;
    c.fillStyle = '#4a0c0c';
    for (const s of [-1, 1]) { c.save(); c.scale(s, 1); c.rotate(f); c.beginPath(); c.moveTo(2, 0); c.lineTo(12, -8); c.lineTo(10, -2); c.lineTo(13, 1); c.lineTo(8, 1); c.lineTo(9, 4); c.closePath(); c.fill(); c.restore(); }
    c.strokeStyle = '#8a1a10'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(0, 4); c.quadraticCurveTo(-4, 10, 2, 12); c.stroke();
    c.fillStyle = '#c0392b'; circ(c, 0, 1, 5);
    c.fillStyle = '#e8d8b0'; c.beginPath(); c.moveTo(-3, -3); c.lineTo(-5, -8); c.lineTo(-1, -4); c.moveTo(3, -3); c.lineTo(5, -8); c.lineTo(1, -4); c.fill();
    c.fillStyle = '#ffe040'; c.fillRect(-2.5, -1, 1.5, 1.5); c.fillRect(1, -1, 1.5, 1.5);
  } else if (t === 'brute') {
    c.fillStyle = 'rgba(0,0,0,0.4)'; ell(c, 2, 6, 16, 8);
    c.rotate(u.ang); const sw = u.moving ? Math.sin(A * 5) * 3 : 0;
    c.fillStyle = '#3a0a08'; circ(c, 6 + sw, -12, 5.5); circ(c, 6 - sw, 12, 5.5);
    c.fillStyle = '#6b1a12'; ell(c, 0, 0, 11, 15);
    c.strokeStyle = '#ff7a20'; c.lineWidth = 1; c.beginPath(); c.moveTo(-6, -8); c.lineTo(-2, -2); c.lineTo(-7, 4); c.moveTo(2, 6); c.lineTo(-3, 10); c.stroke();
    c.fillStyle = '#8a2418'; circ(c, 6, 0, 6);
    c.fillStyle = '#e0d0b0'; c.beginPath(); c.moveTo(5, -5); c.quadraticCurveTo(2, -14, 10, -13); c.lineTo(7, -5); c.moveTo(5, 5); c.quadraticCurveTo(2, 14, 10, 13); c.lineTo(7, 5); c.fill();
    c.fillStyle = '#ffb020'; c.fillRect(9, -3, 2, 2); c.fillRect(9, 1, 2, 2);
  }
  c.restore();
}
function drawBld(c, b) {
  const x = b.tx * TILE, y = b.ty * TILE, w = b.w * TILE, h = b.h * TILE, A = b.anim, ev = b.side === 1, t = b.type;
  c.save();
  c.fillStyle = 'rgba(0,0,0,0.4)'; c.fillRect(x + 6, y + 6, w, h);
  c.fillStyle = ev ? '#1c1012' : '#5A564C'; c.fillRect(x + 1, y + 1, w - 2, h - 2);
  c.strokeStyle = ev ? '#7a1a10' : '#3A7BFF'; c.lineWidth = 2; c.strokeRect(x + 2, y + 2, w - 4, h - 4);
  const cx = x + w / 2, cy = y + h / 2;
  const busy = t === 'refinery' && b.dockQ && b.dockQ[0] && b.dockQ[0].hs === 'unload' && !b.dockQ[0].blocked;
  if (t === 'refinery') { // dock pad (one truck at a time)
    const pi = b.pad !== undefined ? b.pad : (b.ty + b.h) * MW + b.tx + 1, px = (pi % MW) * TILE, py = ((pi / MW) | 0) * TILE;
    c.save(); c.beginPath(); c.rect(px + 1, py + 1, 30, 30); c.clip();
    if (!ev) { c.fillStyle = '#2A2A2A'; c.fillRect(px, py, 32, 32); c.fillStyle = '#E8D23A'; for (let k = -4; k < 8; k++) { c.beginPath(); c.moveTo(px + k * 8, py + 32); c.lineTo(px + k * 8 + 4, py + 32); c.lineTo(px + k * 8 + 36, py); c.lineTo(px + k * 8 + 32, py); c.fill(); } c.fillStyle = '#3a3a36'; c.fillRect(px + 5, py + 5, 22, 22); }
    else { c.fillStyle = '#4A1A30'; ell(c, px + 16, py + 14, 14, 16); c.fillStyle = '#8C3A5A'; ell(c, px + 16, py + 16, 10, 13); c.fillStyle = '#5a1a2a'; c.fillRect(px + 15, py + 6, 2, 20); }
    c.restore();
  }
  if (t === 'power' || t === 'depot') {
    if (!ev && t === 'power') { // Power Plant: two cooling drums + halo coil
      c.fillStyle = '#B8B2A2'; c.fillRect(x + 6, y + 6, w - 12, h - 12);
      for (const ox of [-12, 12]) { c.fillStyle = '#8E959C'; circ(c, cx + ox, cy - 6, 10); c.fillStyle = '#5A564C'; circ(c, cx + ox, cy - 6, 6); }
      c.globalAlpha = 0.5 + 0.3 * Math.sin(A * 5); c.fillStyle = '#9FE8FF'; c.fillRect(cx - 14, cy + 12, 28, 3); c.globalAlpha = 1;
    } else if (t === 'power') { // Horde: brimstone furnace
      c.fillStyle = '#2a1a18'; ell(c, cx, cy, w / 2 - 6, h / 2 - 6);
      c.fillStyle = '#E3D6B8'; for (let k = 0; k < 6; k++) { const an = k * 1.05; c.fillRect(cx + Math.cos(an) * 20 - 2, cy + Math.sin(an) * 20 - 2, 4, 4); }
      c.fillStyle = `rgba(255,${110 + 60 * Math.sin(A * 4)},20,0.9)`; circ(c, cx, cy, 10);
    } else { // Depot: stacked bins of sorted scrap
      c.fillStyle = ev ? '#3a1a22' : '#6E6A60'; c.fillRect(x + 4, y + 4, w - 8, h - 8);
      for (let k = 0; k < 3; k++) { c.fillStyle = ev ? '#8C3A5A' : '#5E6B34'; c.fillRect(x + 8 + k * 18, y + 8, 14, h - 16); c.fillStyle = ev ? '#E3D6B8' : '#E8D23A'; c.fillRect(x + 9 + k * 18, cy - 0.5, 12, 1); }
    }
  } else if (!ev) {
    if (t === 'hq') {
      c.fillStyle = '#B8B2A2'; c.fillRect(x + 8, y + 8, w - 16, h - 16);
      c.fillStyle = '#8E959C'; for (const [px, py] of [[x + 10, y + 10], [x + w - 10, y + 10], [x + 10, y + h - 10], [x + w - 10, y + h - 10]]) circ(c, px, py, 5);
      const g = c.createRadialGradient(cx - 6, cy - 6, 2, cx, cy, 26); g.addColorStop(0, '#DDF6FF'); g.addColorStop(1, '#5A8ab0'); c.fillStyle = g; circ(c, cx, cy, 22);
      c.fillStyle = '#3A7BFF'; c.fillRect(cx - 2, cy - 14, 4, 28); c.fillRect(cx - 10, cy - 6, 20, 4);
      c.globalAlpha = 0.2 + 0.12 * Math.sin(A * 2); c.fillStyle = '#9FE8FF'; circ(c, cx, cy, 34); c.globalAlpha = 1;
    } else if (t === 'refinery') { // Scrap Yard
      c.fillStyle = '#6E6A60'; c.fillRect(x + 4, y + 4, w - 8, h - 8);
      c.fillStyle = '#5A564C'; c.fillRect(x + 8, y + 8, 40, h - 24); // crusher housing
      for (const oy of [y + 16, y + 30]) { c.fillStyle = '#8E959C'; c.fillRect(x + 10, oy - 5, 36, 10); c.fillStyle = '#DDE3E8'; const ph = busy ? (A * 40) % 8 : 0; for (let k = 0; k < 5; k++) c.fillRect(x + 11 + ((k * 8 + ph) % 34), oy - 4, 2, 8); }
      c.fillStyle = '#C2622D'; c.fillRect(x + 54, y + 10, 30, 14); c.fillStyle = '#7A3A1C'; c.fillRect(x + 54, y + 22, 30, 3); // rust bins
      c.fillStyle = '#5E6B34'; c.fillRect(x + 54, y + 30, 14, 12); c.fillStyle = '#E8D23A'; c.fillRect(x + 55, y + 35, 12, 1);
      c.fillStyle = '#3a3a36'; c.fillRect(x + w - 16, y + 26, 8, 28); c.fillStyle = '#2a2a2a'; c.fillRect(x + w - 17, y + 24, 10, 3); // stack
      if (busy && Math.random() < 0.3) G.fx.push({ k: 'smoke', x: x + w - 12, y: y + 20, t: 0, dur: 1.6 });
      c.fillStyle = '#E8D23A'; c.fillRect(cx - 1, y + h - 8, 2, 6); // feed chute to the pad
    } else if (t === 'barracks') {
      c.fillStyle = '#B8B2A2'; c.fillRect(x + 6, y + 10, w - 12, h - 16);
      c.fillStyle = '#7a5a3a'; c.beginPath(); c.moveTo(x + 4, y + 14); c.lineTo(cx, y + 4); c.lineTo(x + w - 4, y + 14); c.fill();
      c.fillStyle = '#5a4030'; c.fillRect(cx - 5, y + h - 18, 10, 12);
      c.fillStyle = '#3A7BFF'; c.fillRect(cx - 1.5, y + 16, 3, 14); c.fillRect(cx - 6, y + 20, 12, 3);
      c.fillStyle = '#9fd4ff'; c.fillRect(x + 10, y + 22, 6, 8); c.fillRect(x + w - 16, y + 22, 6, 8);
    } else if (t === 'turret') {
      c.fillStyle = '#5A564C'; circ(c, cx, cy, 13); c.fillStyle = '#B8B2A2'; circ(c, cx, cy - 4, 9);
      const g = c.createRadialGradient(cx, cy - 6, 0, cx, cy - 6, 9); g.addColorStop(0, '#fff'); g.addColorStop(0.5, '#9fe8ff'); g.addColorStop(1, 'rgba(159,232,255,0)');
      c.fillStyle = g; circ(c, cx + Math.cos(b.tang) * 2, cy - 6 + Math.sin(b.tang) * 2, 9 + Math.sin(A * 4));
    } else if (t === 'factory') {
      c.fillStyle = '#B8B2A2'; c.fillRect(x + 6, y + 6, w - 12, h - 12);
      c.fillStyle = '#9a9488'; for (let k = 0; k < 5; k++) c.fillRect(x + 8, y + 10 + k * 12, w - 16, 5);
      c.fillStyle = '#3a3a3a'; c.fillRect(cx - 18, y + h - 22, 36, 16);
      for (let k = 0; k < 6; k++) { c.fillStyle = k % 2 ? '#222' : '#e8c040'; c.fillRect(cx - 18 + k * 6, y + h - 8, 6, 3); }
      c.save(); c.translate(cx, cy - 10); c.rotate(A * 0.5); c.fillStyle = '#3A7BFF'; for (let k = 0; k < 8; k++) { c.rotate(Math.PI / 4); c.fillRect(-2, -12, 4, 5); } circ(c, 0, 0, 8); c.fillStyle = '#b8b2a2'; circ(c, 0, 0, 3); c.restore();
    } else if (t === 'silo') {
      c.fillStyle = '#B8B2A2'; c.beginPath(); for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4 + Math.PI / 8; c.lineTo(cx + Math.cos(a) * 26, cy + Math.sin(a) * 26); } c.fill();
      c.fillStyle = '#b8b0a0'; c.beginPath(); for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4 + Math.PI / 8; c.lineTo(cx + Math.cos(a) * 16, cy + Math.sin(a) * 16); } c.fill();
      const f = b.charge / NUKE_CHARGE;
      c.strokeStyle = f >= 1 ? '#DDF6FF' : '#3A7BFF'; c.lineWidth = 3; c.beginPath(); c.arc(cx, cy, 21, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2); c.stroke();
      const g = c.createRadialGradient(cx, cy, 0, cx, cy, 14); g.addColorStop(0, 'rgba(221,246,255,' + (0.3 + 0.7 * f) + ')'); g.addColorStop(1, 'rgba(159,232,255,0)'); c.fillStyle = g; circ(c, cx, cy, 14 + (f >= 1 ? Math.sin(A * 6) * 3 : 0));
    }
  } else {
    if (t === 'hq') {
      c.strokeStyle = '#ff4a10'; c.lineWidth = 1; c.beginPath(); c.moveTo(x + 6, y + 20); c.lineTo(x + 20, y + 30); c.lineTo(x + 14, y + 50); c.moveTo(x + w - 8, y + 60); c.lineTo(x + w - 20, y + 74); c.stroke();
      c.fillStyle = '#3a1a18'; c.fillRect(x + 10, y + 10, 14, h - 20); c.fillRect(x + w - 24, y + 10, 14, h - 20);
      c.fillStyle = '#d8ccb0'; for (const px of [x + 17, x + w - 17]) { c.beginPath(); c.moveTo(px - 6, y + 12); c.quadraticCurveTo(px - 10, y, px - 2, y - 4); c.lineTo(px, y + 12); c.fill(); }
      for (let k = 3; k > 0; k--) { c.fillStyle = ['#ffd040', '#ff7a10', '#a01808'][k - 1]; c.beginPath(); c.ellipse(cx, cy, 6 + k * 5 + Math.sin(A * 3 + k) * 2, 10 + k * 7, 0, 0, 7); c.globalAlpha = 0.9; c.fill(); }
      c.globalAlpha = 1; c.save(); c.translate(cx, cy); c.rotate(A * 1.5); c.strokeStyle = 'rgba(255,240,180,0.6)'; c.lineWidth = 2; c.beginPath(); c.arc(0, 0, 10, 0, 4); c.stroke(); c.restore();
    } else if (t === 'refinery') {
      c.fillStyle = '#c8bca0'; ell(c, cx, cy - 4, w / 2 - 6, h / 2 - 8);
      c.fillStyle = '#0a0608'; ell(c, cx, cy - 4, w / 2 - 12, h / 2 - 13);
      for (let k = 0; k < 10; k++) { const a = A * (busy ? 2.4 : 0.6) + k * 0.63, rx = Math.cos(a) * (w / 2 - 16), ry = Math.sin(a) * 9; c.fillStyle = '#E3D6B8'; c.beginPath(); c.moveTo(cx + rx - 3, cy - 4 + ry); c.lineTo(cx + rx * 0.8, cy - 4 + ry * 0.8); c.lineTo(cx + rx + 3, cy - 4 + ry); c.fill(); }
      for (let k = 0; k < 8; k++) { c.fillStyle = k % 2 ? '#111' : '#8a1a10'; c.fillRect(x + 8 + k * ((w - 16) / 8), y + h - 10, (w - 16) / 8, 6); }
    } else if (t === 'barracks') {
      c.fillStyle = '#5a2a2a'; ell(c, cx, cy, w / 2 - 5, h / 2 - 5);
      c.fillStyle = '#7a3a34'; ell(c, cx - 4, cy - 4, w / 2 - 12, h / 2 - 12);
      for (let k = 0; k < 4; k++) { const s = 3 + Math.sin(A * 3 + k * 2) * 2; c.fillStyle = '#9adf4a'; circ(c, cx + [-10, 9, -4, 8][k], cy + [-6, -9, 10, 7][k], Math.max(1, s)); }
    } else if (t === 'turret') {
      c.fillStyle = '#d8ccb0'; c.beginPath(); c.moveTo(cx - 10, cy + 12); c.lineTo(cx, cy - 16); c.lineTo(cx + 10, cy + 12); c.fill();
      c.fillStyle = '#b8ac90'; for (let k = 0; k < 3; k++) { c.beginPath(); c.moveTo(cx - 5 + k * 2, cy + 6 - k * 8); c.lineTo(cx - 14 + k * 3, cy - k * 8); c.lineTo(cx - 3 + k * 2, cy + 2 - k * 8); c.fill(); c.beginPath(); c.moveTo(cx + 5 - k * 2, cy + 6 - k * 8); c.lineTo(cx + 14 - k * 3, cy - k * 8); c.lineTo(cx + 3 - k * 2, cy + 2 - k * 8); c.fill(); }
      c.fillStyle = '#ff2a10'; circ(c, cx, cy - 6, 3 + Math.sin(A * 5) * 0.8);
    } else if (t === 'factory') {
      c.fillStyle = '#2a2224'; c.fillRect(x + 6, y + 6, w - 12, h - 12);
      c.strokeStyle = '#ff6a10'; c.lineWidth = 4; c.globalAlpha = 0.6 + 0.3 * Math.sin(A * 2); c.beginPath(); c.moveTo(x + 10, cy); c.lineTo(x + w - 10, cy); c.moveTo(cx, y + 10); c.lineTo(cx, y + h - 10); c.stroke(); c.globalAlpha = 1;
      c.fillStyle = '#1a1416'; for (const [px, py] of [[x + 18, y + 18], [x + w - 18, y + 18]]) { circ(c, px, py, 8); c.fillStyle = 'rgba(255,120,20,0.7)'; circ(c, px, py, 4); c.fillStyle = '#1a1416'; }
      c.fillStyle = '#ff8a20'; circ(c, cx, cy, 9 + Math.sin(A * 4));
    } else if (t === 'silo') {
      const f = b.charge / NUKE_CHARGE;
      c.fillStyle = '#3a1a18'; circ(c, cx, cy, 26);
      const g = c.createRadialGradient(cx, cy, 0, cx, cy, 18); g.addColorStop(0, `rgba(255,${120 + 100 * f},40,${0.4 + 0.6 * f})`); g.addColorStop(1, 'rgba(120,10,0,0.9)'); c.fillStyle = g; circ(c, cx, cy, 18);
      c.fillStyle = '#e0d4b8'; for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6 + A * 0.2; c.beginPath(); c.moveTo(cx + Math.cos(a) * 18, cy + Math.sin(a) * 18); c.lineTo(cx + Math.cos(a + 0.12) * 11, cy + Math.sin(a + 0.12) * 11); c.lineTo(cx + Math.cos(a + 0.26) * 18, cy + Math.sin(a + 0.26) * 18); c.fill(); }
      c.strokeStyle = '#ff5a1a'; c.lineWidth = 3; c.beginPath(); c.arc(cx, cy, 23, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2); c.stroke();
    }
  }
  if (b.hitT > 0) { c.fillStyle = 'rgba(255,255,255,0.2)'; c.fillRect(x, y, w, h); }
  c.restore();
}
function hpBar(c, x, y, w, f) {
  c.fillStyle = 'rgba(0,0,0,0.7)'; c.fillRect(x - w / 2 - 1, y - 1, w + 2, 5);
  c.fillStyle = f > 0.6 ? '#4CD94C' : f > 0.3 ? '#E8D23A' : '#E8432F'; c.fillRect(x - w / 2, y, w * f, 3);
}
const PAL = { rust: '#C2622D', rustD: '#7A3A1C', steel: '#8E959C', steelHi: '#DDE3E8', olive: '#5E6B34', oliveD: '#3A4220', stencil: '#E8D23A', rubble: '#57524A', cleared: '#3C3933', bolt: '#6A6A6A', oil: '#2A2824', gold: '#FFC93A' };
const PILE_N = [0, 2, 5, 7, 9], PILE_H = [0, 3, 7, 13, 18];
function drawGear(c, x, y, r, a) {
  c.fillStyle = PAL.rust; c.beginPath();
  for (let k = 0; k < 16; k++) { const rr = k % 2 ? r * 0.72 : r, an = a + k * Math.PI / 8; c.lineTo(x + Math.cos(an) * rr, y + Math.sin(an) * rr * 0.8); }
  c.fill(); c.fillStyle = PAL.rustD; ell(c, x, y, r * 0.35, r * 0.28);
}
function drawPile(c, i, X, Y, a) {
  const st = Salvage.stageOf(a), n = PILE_N[st], H = PILE_H[st];
  c.fillStyle = 'rgba(0,0,0,0.3)'; ell(c, X + 16, Y + 22, 6 + st * 2.2, 3 + st * 1.1);
  c.fillStyle = PAL.rubble; ell(c, X + 16, Y + 21, 4 + st * 2.4, 2 + st * 1.2);
  const pcs = [];
  for (let k = 0; k < n; k++) {
    const h1 = hash(i * 17 + k), h2 = hash(i * 29 + k * 7), h3 = hash(i * 43 + k * 13), lift = n > 1 ? (k / (n - 1)) * H : 0;
    pcs.push({ x: X + 16 + (h1 - 0.5) * (8 + st * 4) * (1 - lift / 30), y: Y + 22 + (h2 - 0.5) * (2 + st * 1.5) - lift, t: (h3 * 3) | 0, a: h2 * 6.28, s: 0.75 + h1 * 0.5, k });
  }
  // pieces are generated bottom-of-stack first (lift grows with k), which draws them back to front
  for (const p of pcs) {
    if (p.t === 0) drawGear(c, p.x, p.y, 3 + p.s * 2.5, p.a);
    else if (p.t === 1) { c.save(); c.translate(p.x, p.y); c.rotate(p.a); c.fillStyle = PAL.steel; c.fillRect(-6 * p.s, -1.5, 12 * p.s, 3); c.fillStyle = PAL.steelHi; c.fillRect(-6 * p.s, -1.5, 12 * p.s, 1); c.restore(); }
    else { const w = 5 + p.s * 2; c.fillStyle = PAL.oliveD; c.fillRect(p.x - w / 2, p.y - w / 2 + 1, w, w); c.fillStyle = PAL.olive; c.fillRect(p.x - w / 2, p.y - w / 2, w, w - 1); c.fillStyle = PAL.stencil; c.fillRect(p.x - w / 2 + 1, p.y - 0.5, w - 2, 1); }
  }
  if (st >= 2) { const top = pcs[pcs.length - 1], gl = Math.sin(G.time * 2 + i) > 0.6; if (gl) { c.fillStyle = PAL.steelHi; c.fillRect(top.x, top.y - 2, 1, 1); } }
}
function drawResources(c, x0, y0, x1, y1) {
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    const i = ty * MW + tx; if (SAL.field[i] < 0) continue;
    const X = tx * TILE, Y = ty * TILE, a = res[i];
    if (!a) { // cleared: bare ground with bolts and an oil stain
      c.fillStyle = PAL.oil; ell(c, X + 10 + hash(i) * 12, Y + 12 + hash(i + 7) * 10, 4 + hash(i + 3) * 3, 2 + hash(i + 5) * 2);
      c.fillStyle = PAL.bolt; for (let k = 0; k < 3; k++) c.fillRect(X + 4 + hash(i * 3 + k) * 24, Y + 4 + hash(i * 5 + k) * 24, 1, 1);
      continue;
    }
    drawPile(c, i, X, Y, a);
  }
}
function drawFx(c, f) {
  const p = f.t / f.dur; if (p < 0) return;
  c.save();
  switch (f.k) {
    case 'line': c.strokeStyle = f.c; c.lineWidth = f.w; c.globalAlpha = 1 - p; c.beginPath(); c.moveTo(f.x1, f.y1); c.lineTo(f.x2, f.y2); c.stroke(); break;
    case 'beam': c.globalAlpha = 1 - p; c.strokeStyle = f.c; c.lineWidth = 6 * (1 - p) + 1; c.globalCompositeOperation = 'lighter'; c.beginPath(); c.moveTo(f.x1, f.y1); c.lineTo(f.x2, f.y2); c.stroke(); c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.stroke(); break;
    case 'spark': c.globalAlpha = 1 - p; c.fillStyle = f.c; for (let k = 0; k < 4; k++) circ(c, f.x + Math.cos(k * 1.6 + f.x) * p * 10, f.y + Math.sin(k * 1.6 + f.y) * p * 10, 1.5); break;
    case 'slash': c.globalAlpha = 1 - p; c.strokeStyle = '#ffd0c0'; c.lineWidth = 2; c.beginPath(); c.arc(f.x, f.y, f.r, f.a - 1 + p, f.a + 0.2 + p); c.stroke(); break;
    case 'boom': { c.globalCompositeOperation = 'lighter'; const r = f.r * (0.4 + p); const g = c.createRadialGradient(f.x, f.y, 0, f.x, f.y, r); g.addColorStop(0, `rgba(255,240,200,${1 - p})`); g.addColorStop(0.4, f.c); g.addColorStop(1, 'rgba(80,20,0,0)'); c.globalAlpha = 1 - p * 0.8; c.fillStyle = g; circ(c, f.x, f.y, r); break; }
    case 'ember': c.globalAlpha = 1 - p; c.fillStyle = f.c; circ(c, f.x + f.vx * f.t, f.y + f.vy * f.t, 2); break;
    case 'smoke': c.globalAlpha = 0.35 * (1 - p); c.fillStyle = '#222'; circ(c, f.x + p * 10, f.y - p * 40, 6 + p * 12); break;
    case 'blood': c.globalAlpha = 1 - p; c.fillStyle = f.c; for (let k = 0; k < 6; k++) circ(c, f.x + Math.cos(k) * p * 12, f.y + Math.sin(k * 1.3) * p * 12, 2); break;
    case 'purify': c.globalAlpha = 1 - p; c.strokeStyle = '#ffffff'; c.lineWidth = 3 * (1 - p) + 1; c.beginPath(); c.arc(f.x, f.y, 4 + p * 26, 0, 7); c.stroke(); c.fillStyle = `rgba(255,255,255,${0.7 * (1 - p)})`; circ(c, f.x, f.y, 10 * (1 - p) + 2); c.fillRect(f.x - 1, f.y - 30 * (1 - p) - 4, 2, 30 * (1 - p)); break;
    case 'mote': { c.globalAlpha = p < 0.2 ? p * 5 : 1 - p; c.fillStyle = '#9fe07a'; const rr = 16 * (1 - p); for (let k = 0; k < 3; k++) circ(c, f.x + Math.cos(f.a + k * 2.1) * rr, f.y + Math.sin(f.a + k * 2.1) * rr * 0.6 - p * 6, 1.6); break; }
    case 'rise': c.globalAlpha = 1 - p; c.fillStyle = '#7aff4a'; c.globalCompositeOperation = 'lighter'; circ(c, f.x, f.y, 6 + p * 18); break;
    case 'dust': c.globalAlpha = 0.5 * (1 - p); c.fillStyle = '#8a8276'; for (let k = 0; k < 4; k++) circ(c, f.x + Math.cos(k * 1.7) * p * 10, f.y - p * 8 + Math.sin(k * 1.7) * p * 4, 2 + p * 4); break;
    case 'pop': { const txt = f.txt || '+' + f.n; c.globalAlpha = p < 0.7 ? 1 : (1 - p) / 0.3; c.font = 'bold 14px monospace'; c.textAlign = 'center'; c.lineWidth = 3; c.strokeStyle = '#000'; c.strokeText(txt, f.x, f.y - p * 26); c.fillStyle = f.side ? '#ff8a6a' : PAL.gold; c.fillText(txt, f.x, f.y - p * 26); break; }
    case 'arrow': { c.globalAlpha = 1 - p; c.fillStyle = PAL.gold; const yy = f.y - 18 - Math.sin(p * Math.PI) * 6; c.beginPath(); c.moveTo(f.x - 7, yy - 8); c.lineTo(f.x + 7, yy - 8); c.lineTo(f.x, yy); c.fill(); c.strokeStyle = PAL.gold; c.lineWidth = 2; c.beginPath(); c.ellipse(f.x, f.y, 12 * (1 - p * 0.4), 6 * (1 - p * 0.4), 0, 0, 7); c.stroke(); break; }
    case 'nuke': {
      c.globalCompositeOperation = 'lighter';
      const r = f.r * (0.3 + p * 1.1);
      const g = c.createRadialGradient(f.x, f.y, 0, f.x, f.y, r); g.addColorStop(0, `rgba(255,255,240,${1 - p})`); g.addColorStop(0.3, f.c); g.addColorStop(0.7, `rgba(255,${f.c === '#ff4a1a' ? 40 : 160},20,${0.6 * (1 - p)})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; circ(c, f.x, f.y, r);
      c.strokeStyle = `rgba(255,220,160,${1 - p})`; c.lineWidth = 6; c.beginPath(); c.arc(f.x, f.y, f.r * p * 2, 0, 7); c.stroke();
      if (f.c !== '#ff4a1a') { c.fillStyle = `rgba(255,255,220,${0.6 * (1 - p)})`; c.fillRect(f.x - 12 * (1 - p), f.y - 600, 24 * (1 - p), 600); }
      break;
    }
  }
  c.restore();
}
function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, VW, VH);
  if (!G) return;
  let sx = 0, sy = 0; if (G.shakeA > 0.2) { sx = (Math.random() - 0.5) * G.shakeA; sy = (Math.random() - 0.5) * G.shakeA; }
  const cx = Math.round(cam.x + sx), cy = Math.round(cam.y + sy);
  const sw = Math.min(VW, MW * TILE - Math.max(0, cx)), sh = Math.min(VH, MH * TILE - Math.max(0, cy));
  ctx.drawImage(terrCanvas, Math.max(0, cx), Math.max(0, cy), sw, sh, Math.max(0, -cx), Math.max(0, -cy), sw, sh);
  ctx.translate(-cx, -cy);
  const x0 = Math.max(0, tileOf(cx)), y0 = Math.max(0, tileOf(cy)), x1 = Math.min(MW - 1, tileOf(cx + VW)), y1 = Math.min(MH - 1, tileOf(cy + VH));
  // decals
  for (const d of G.decals) {
    if (!onScreen(d.x, d.y, 200)) continue;
    if (d.k === 'scorch') { const g = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.r); g.addColorStop(0, 'rgba(0,0,0,0.6)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; circ(ctx, d.x, d.y, d.r); }
    else if (d.k === 'blood') { ctx.fillStyle = d.c; ctx.globalAlpha = 0.6; ell(ctx, d.x, d.y, 5, 3); ctx.globalAlpha = 1; }
    else if (d.k === 'ruin') { if (!bgrid[d.y / TILE * MW + d.x / TILE]) { ctx.fillStyle = 'rgba(40,34,30,0.7)'; for (let k = 0; k < d.w * d.h * 2; k++) ctx.fillRect(d.x + hash(k + d.x) * d.w * TILE, d.y + hash(k * 3 + d.y) * d.h * TILE, 6, 4); } }
  }
  drawResources(ctx, x0, y0, x1, y1);
  // plague & radiation
  for (const z of plagueZones) {
    if (!onScreen(z.x, z.y, z.r)) continue;
    const pulse = 0.85 + 0.15 * Math.sin(G.time * 1.5 + z.x);
    const g = ctx.createRadialGradient(z.x, z.y, 0, z.x, z.y, z.r * pulse + 16); g.addColorStop(0, 'rgba(120,220,40,0.32)'); g.addColorStop(0.7, 'rgba(90,180,30,0.2)'); g.addColorStop(1, 'rgba(60,120,20,0)');
    ctx.fillStyle = g; circ(ctx, z.x, z.y, z.r + 16);
    for (let k = 0; k < 10; k++) { const a = k * 2.4 + z.x, rr = (hash(k + z.y) * z.r), ph = (G.time * 0.4 + hash(k * 7 + z.x)) % 1; ctx.fillStyle = `rgba(170,255,90,${0.5 * (1 - ph)})`; circ(ctx, z.x + Math.cos(a) * rr, z.y + Math.sin(a) * rr - ph * 14, 2 + ph * 3); }
  }
  for (const r of G.rad) {
    const f = r.t / r.max; const g = ctx.createRadialGradient(r.x, r.y, 0, r.x, r.y, r.r); g.addColorStop(0, `rgba(230,255,60,${0.3 * f})`); g.addColorStop(1, 'rgba(160,200,0,0)');
    ctx.fillStyle = g; circ(ctx, r.x, r.y, r.r);
    ctx.strokeStyle = `rgba(255,230,0,${0.5 * f})`; ctx.setLineDash([10, 8]); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, 7); ctx.stroke(); ctx.setLineDash([]);
  }
  // rally point of selected building
  for (const e of G.sel) if (e.kind === 'b' && e.rally) { ctx.strokeStyle = 'rgba(125,255,125,0.6)'; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.rally.x, e.rally.y); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = '#7dff7d'; ctx.fillRect(e.rally.x - 1, e.rally.y - 12, 2, 12); ctx.fillRect(e.rally.x, e.rally.y - 12, 8, 5); }
  // buildings
  for (const b of G.blds) { if (b.dead || !onScreen(b.x, b.y, 120)) continue; if (b.side === 1 && !isVisible(b)) continue; drawBld(ctx, b); }
  // selection circles under units
  for (const e of G.sel) {
    if (e.dead) continue;
    ctx.strokeStyle = e.side === 0 ? '#6CFF6C' : '#FF5A5A'; ctx.lineWidth = 1.5;
    if (e.kind === 'u') { ctx.beginPath(); ctx.ellipse(e.x, e.y + 2, e.r + 3, (e.r + 3) * 0.7, 0, 0, 7); ctx.stroke(); }
    else { ctx.strokeRect(e.tx * TILE - 1, e.ty * TILE - 1, e.w * TILE + 2, e.h * TILE + 2); }
  }
  // units, ground then air
  const vu = G.units.filter(u => !u.dead && onScreen(u.x, u.y, 40) && (u.side === 0 || vis[tileOf(u.y) * MW + tileOf(u.x)]));
  vu.sort((a, b) => (a.d.fly - b.d.fly) || (a.y - b.y));
  for (const u of vu) drawUnit(ctx, u);
  for (const p of G.proj) {
    if (!onScreen(p.x, p.y, 20)) continue;
    // projectiles aimed at air arc up toward the lifted sprite
    let py = p.y; if (p.air) { const tot = Math.hypot(p.tx - p.sx, p.ty - p.sy) || 1, left = Math.hypot(p.tx - p.x, p.ty - p.y); py -= Math.sin(Math.PI * clamp(1 - left / tot, 0, 1)) * 14; }
    if (p.bolt) { ctx.save(); ctx.translate(p.x, py); ctx.rotate(p.a || 0); ctx.fillStyle = '#e8dcc0'; ctx.fillRect(-7, -1.5, 9, 3); ctx.fillStyle = '#ff7a20'; ctx.beginPath(); ctx.moveTo(2, -3); ctx.lineTo(9, 0); ctx.lineTo(2, 3); ctx.fill(); ctx.fillStyle = 'rgba(255,90,20,0.5)'; ctx.fillRect(-14, -1, 7, 2); ctx.restore(); }
    else if (p.w === 'fire') { ctx.fillStyle = '#ff7a20'; circ(ctx, p.x, py, 4); ctx.fillStyle = '#ffe080'; circ(ctx, p.x, py, 2); }
    else { ctx.fillStyle = '#8E959C'; circ(ctx, p.x, py, 2.5); }
  }
  for (const f of G.fx) if (onScreen(f.x !== undefined ? f.x : f.x1, f.y !== undefined ? f.y : f.y1, 300)) drawFx(ctx, f);
  // missiles + target markers
  for (const m of G.missiles) {
    const blink = Math.sin(G.time * 12) > 0;
    ctx.strokeStyle = m.side ? '#ff3a1a' : '#fff3b0'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(m.tx, m.ty, NUKE_R * TILE, 0, 7); ctx.stroke();
    if (blink) { ctx.beginPath(); ctx.moveTo(m.tx - 20, m.ty); ctx.lineTo(m.tx + 20, m.ty); ctx.moveTo(m.tx, m.ty - 20); ctx.lineTo(m.tx, m.ty + 20); ctx.stroke(); }
    ctx.fillStyle = m.side ? '#ff6a2a' : '#fffbe0'; circ(ctx, m.x, m.y, 6);
  }
  // health bars
  for (const u of vu) if ((u.hp < u.maxhp || G.sel.includes(u))) hpBar(ctx, u.x, u.y - u.r - (u.d.fly ? 18 : 7), Math.max(16, u.r * 2), u.hp / u.maxhp);
  for (const b of G.blds) if (!b.dead && (b.hp < b.maxhp || G.sel.includes(b)) && onScreen(b.x, b.y, 100) && (b.side === 0 || isVisible(b))) hpBar(ctx, b.x, b.ty * TILE - 6, b.w * TILE - 8, b.hp / b.maxhp);
  for (const u of vu) if (u.d.harv && u.side === 0 && (G.sel.includes(u) || u.blocked)) { const n = Salvage.pipsOf(u.load, u.d.cap); for (let k = 0; k < 5; k++) { ctx.fillStyle = '#000'; ctx.fillRect(u.x - 17 + k * 7, u.y - u.r - 4, 6, 4); ctx.fillStyle = k < n ? (u.blocked ? '#ffb347' : PAL.steel) : '#333333'; ctx.fillRect(u.x - 16.5 + k * 7, u.y - u.r - 3.5, 5, 3); } }
  // fog
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    const i = ty * MW + tx;
    if (!expl[i]) { ctx.fillStyle = '#000'; ctx.fillRect(tx * TILE, ty * TILE, TILE + 1, TILE + 1); }
    else if (!vis[i]) { ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(tx * TILE, ty * TILE, TILE, TILE); }
  }
  // placement ghost
  if (G.placing) {
    const d = BDEF[G.placing], tx = tileOf(mouse.wx) - (d.w >> 1), ty = tileOf(mouse.wy) - (d.h >> 1), ok = canPlace(0, G.placing, tx, ty, 0);
    ctx.globalAlpha = 0.5; drawBld(ctx, { tx, ty, w: d.w, h: d.h, x: (tx + d.w / 2) * TILE, y: (ty + d.h / 2) * TILE, anim: G.time, side: 0, type: G.placing, charge: 0, tang: 0, hitT: 0 }); ctx.globalAlpha = 1;
    for (let y = ty; y < ty + d.h; y++) for (let x = tx; x < tx + d.w; x++) { const i = y * MW + x, good = x >= 0 && y >= 0 && x < MW && y < MH && !BLOCK[terr[i]] && !bgrid[i] && !res[i]; ctx.fillStyle = ok && good ? 'rgba(80,255,80,0.3)' : 'rgba(255,60,60,0.4)'; ctx.fillRect(x * TILE, y * TILE, TILE, TILE); }
  }
  if (G.mode === 'nuke') { ctx.strokeStyle = '#fff3b0'; ctx.lineWidth = 2; ctx.setLineDash([8, 6]); ctx.beginPath(); ctx.arc(mouse.wx, mouse.wy, NUKE_R * TILE, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
  // drag box
  if (mouse.drag && mouse.down) { ctx.strokeStyle = '#7dff7d'; ctx.lineWidth = 1; ctx.strokeRect(mouse.dx, mouse.dy, mouse.wx - mouse.dx, mouse.wy - mouse.dy); }
  // screen-space atmosphere
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const vg = ctx.createRadialGradient(VW / 2, VH / 2, Math.min(VW, VH) * 0.4, VW / 2, VH / 2, Math.max(VW, VH) * 0.75);
  vg.addColorStop(0, 'rgba(60,10,0,0)'); vg.addColorStop(1, 'rgba(60,10,0,0.45)'); ctx.fillStyle = vg; ctx.fillRect(0, 0, VW, VH);
  for (const a of ash) { ctx.fillStyle = a.e ? `rgba(255,${120 + a.s * 40},40,${0.6})` : 'rgba(200,190,180,0.35)'; ctx.fillRect(a.x, a.y, a.s, a.s); }
  if (G.flash) { ctx.fillStyle = `rgba(${G.flash.c},${Math.max(0, 1 - G.flash.t / 1.2)})`; ctx.fillRect(0, 0, VW, VH); }
}
const ash = []; for (let k = 0; k < 70; k++) ash.push({ x: Math.random() * 2000, y: Math.random() * 1200, s: 1 + Math.random() * 2, e: Math.random() < 0.3, v: 10 + Math.random() * 25 });
function updAsh(dt) { for (const a of ash) { a.y += (a.e ? -a.v : a.v) * dt; a.x += Math.sin(a.y * 0.01) * 10 * dt + 6 * dt; if (a.y > VH) a.y = 0; if (a.y < 0) a.y = VH; if (a.x > VW) a.x = 0; } }
function drawMini() {
  const s = mini.width / MW;
  mctx.drawImage(miniBase, 0, 0, mini.width, mini.height);
  for (const i of resTiles) if (res[i] && expl[i]) { mctx.fillStyle = '#E8B830'; mctx.fillRect((i % MW) * s, ((i / MW) | 0) * s, s, s); }
  mctx.fillStyle = 'rgba(120,230,40,0.35)'; for (const z of plagueZones) { mctx.beginPath(); mctx.arc(z.x / TILE * s, z.y / TILE * s, z.r / TILE * s, 0, 7); mctx.fill(); }
  for (const b of G.blds) if (!b.dead && (b.side === 0 || isVisible(b))) { mctx.fillStyle = SIDES[b.side].mm; mctx.fillRect(b.tx * s, b.ty * s, b.w * s, b.h * s); }
  for (const u of G.units) if (!u.dead && (u.side === 0 || vis[tileOf(u.y) * MW + tileOf(u.x)])) { mctx.fillStyle = SIDES[u.side].dot; mctx.fillRect(u.x / TILE * s - 1, u.y / TILE * s - 1, 2.5, 2.5); }
  mctx.fillStyle = 'rgba(0,0,0,1)';
  for (let ty = 0; ty < MH; ty++) for (let tx = 0; tx < MW; tx++) { const i = ty * MW + tx; if (!expl[i]) mctx.fillRect(tx * s, ty * s, s + 0.5, s + 0.5); else if (!vis[i]) { mctx.fillStyle = 'rgba(0,0,0,0.4)'; mctx.fillRect(tx * s, ty * s, s, s); mctx.fillStyle = '#000'; } }
  for (const m of G.missiles) { mctx.strokeStyle = m.side ? '#ff3a1a' : '#fff'; mctx.beginPath(); mctx.arc(m.tx / TILE * s, m.ty / TILE * s, 6, 0, 7); mctx.stroke(); }
  mctx.strokeStyle = '#fff'; mctx.lineWidth = 1; mctx.strokeRect(cam.x / TILE * s, cam.y / TILE * s, VW / TILE * s, VH / TILE * s);
}
// ---------------- sound (WebAudio synth) ----------------
let AC = null, muted = false, noiseBuf = null; const lastS = {};
function initAudio() {
  if (AC) return; try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { AC = null; return; }
  noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}
function sfx(k, x, y) {
  if (muted || !AC || !G) return;
  if (x !== undefined && !onScreen(x, y, 150)) return;
  const now = AC.currentTime; if (lastS[k] && now - lastS[k] < 0.06) return; lastS[k] = now;
  const out = AC.createGain(); out.connect(AC.destination);
  const noise = (dur, f, type, vol) => { const s = AC.createBufferSource(); s.buffer = noiseBuf; const fl = AC.createBiquadFilter(); fl.type = type; fl.frequency.value = f; const g = AC.createGain(); g.gain.setValueAtTime(vol, now); g.gain.exponentialRampToValueAtTime(0.001, now + dur); s.connect(fl); fl.connect(g); g.connect(out); s.start(now); s.stop(now + dur); };
  const tone = (f1, f2, dur, type, vol, delay = 0) => { const o = AC.createOscillator(); o.type = type; o.frequency.setValueAtTime(f1, now + delay); o.frequency.exponentialRampToValueAtTime(f2, now + delay + dur); const g = AC.createGain(); g.gain.setValueAtTime(vol, now + delay); g.gain.exponentialRampToValueAtTime(0.001, now + delay + dur); o.connect(g); g.connect(out); o.start(now + delay); o.stop(now + delay + dur); };
  switch (k) {
    case 'shot': noise(0.06, 2500, 'highpass', 0.08); break;
    case 'beam': tone(1400, 600, 0.18, 'sine', 0.06); break;
    case 'fire': noise(0.25, 700, 'lowpass', 0.08); break;
    case 'claw': noise(0.05, 1200, 'bandpass', 0.07); break;
    case 'boom': noise(0.5, 300, 'lowpass', 0.25); break;
    case 'nuke': noise(3, 150, 'lowpass', 0.6); tone(200, 30, 2.5, 'sawtooth', 0.15); break;
    case 'launch': tone(100, 600, 1.5, 'sawtooth', 0.08); break;
    case 'click': tone(800, 600, 0.05, 'square', 0.04); break;
    case 'err': tone(200, 150, 0.15, 'square', 0.05); break;
    case 'ready': tone(660, 660, 0.12, 'triangle', 0.08); tone(990, 990, 0.18, 'triangle', 0.08, 0.12); break;
    case 'place': noise(0.2, 500, 'lowpass', 0.15); break;
    case 'alert': tone(880, 440, 0.25, 'square', 0.05); tone(880, 440, 0.25, 'square', 0.05, 0.3); break;
    case 'rise': tone(90, 50, 0.6, 'sawtooth', 0.08); break;
    case 'clank': noise(0.08, 1800, 'bandpass', 0.06); tone(320, 260, 0.08, 'square', 0.02); break;
    case 'chime': tone(1320, 1320, 0.08, 'triangle', 0.06); tone(1760, 1760, 0.14, 'triangle', 0.06, 0.08); break;
  }
}

// ---------------- messages ----------------
function msg(text, color, x, y) {
  const box = $('msgs'); const d = document.createElement('div'); d.textContent = text; d.style.color = color || '#D8DCDF';
  box.appendChild(d); while (box.children.length > 5) box.removeChild(box.firstChild);
  setTimeout(() => { d.style.opacity = 0; }, 5000); setTimeout(() => d.remove(), 6000);
  if (x !== undefined) G.lastAlert = { x, y };
}

// ---------------- sidebar ----------------
const btns = {};
function iconFor(type) {
  const cv = document.createElement('canvas'); cv.width = 56; cv.height = 38; const c = cv.getContext('2d');
  if (BDEF[type]) {
    const d = BDEF[type], s = Math.min(50 / (d.w * TILE), 34 / (d.h * TILE));
    c.translate(28 - d.w * TILE * s / 2, 19 - d.h * TILE * s / 2); c.scale(s, s);
    drawBld(c, { tx: 0, ty: 0, w: d.w, h: d.h, x: d.w * 16, y: d.h * 16, anim: 1, side: 0, type, charge: NUKE_CHARGE * 0.7, tang: 0, hitT: 0 });
  } else {
    c.translate(28, 22); c.scale(1.4, 1.4);
    drawUnit(c, { type, x: 0, y: 0, ang: -Math.PI / 2, tang: -Math.PI / 2, anim: 1, d: UDEF[type], load: 150, hs: '', moving: false, hitT: 0, r: UDEF[type].r });
  }
  return cv;
}
function buildSidebar() {
  for (const [grid, list] of [[$('bGrid'), BORDER], [$('uGrid'), UORDER[0]]]) {
    grid.innerHTML = '';
    for (const type of list) {
      const b = document.createElement('div'); b.className = 'btn';
      const isB = !!BDEF[type], d = isB ? BDEF[type] : UDEF[type];
      b.appendChild(iconFor(type));
      b.insertAdjacentHTML('beforeend', `<span class="nm">${isB ? d.name[0] : d.name}</span><span class="cs">$${d.cost}</span><div class="bar"></div><span class="cnt"></span>`);
      b.title = `${isB ? d.name[0] : d.name}: ${d.desc}. Cost ${d.cost}, ${d.time}s.`;
      b.addEventListener('click', () => onBuildBtn(type));
      b.addEventListener('contextmenu', e => { e.preventDefault(); if (G) { cancelItem(0, type); if (G.placing === type && !G.queues[0].structure.ready) G.placing = null; } });
      grid.appendChild(b); btns[type] = b;
    }
  }
}
function onBuildBtn(type) {
  if (!G || G.over) return; initAudio();
  const q = G.queues[0].structure;
  if (BDEF[type] && q.ready === type) { G.placing = type; G.mode = null; hint('Click to place ' + bname(type, 0) + ' near your base · Right-click / Esc to cancel'); return; }
  queueItem(0, type);
}
function updSidebar() {
  if (!G) return;
  const cap = storageCapOf(0), crd = G.credits[0], pw = powerOf(0);
  $('cr').textContent = Math.floor(crd); $('cap').textContent = '/' + cap;
  $('credits').classList.toggle('amber', crd >= cap * SD.storageAmberAt && crd < cap); $('credits').classList.toggle('full', crd >= cap);
  $('power').className = pw.net < 0 ? 'low' : '';
  const ph = `<span>POWER</span><div class="meter"><div style="width:${pw.made ? Math.min(100, 100 * pw.used / pw.made) : 100}%"></div></div><span>${pw.used}/${pw.made}${pw.net < 0 ? ' LOW' : ''}</span>`;
  if ($('power').innerHTML !== ph) $('power').innerHTML = ph;
  const Q = G.queues[0];
  for (const type in btns) {
    const b = btns[type], cat = catOf(type), q = Q[cat];
    const locked = !prereqOk(0, type);
    b.classList.toggle('locked', locked);
    b.classList.toggle('poor', G.credits[0] < costOf(type));
    b.classList.toggle('ready', cat === 'structure' && q.ready === type && G.placing !== type);
    b.classList.toggle('placing', G.placing === type);
    const n = q.list.filter(t => t === type).length;
    b.querySelector('.cnt').textContent = n > (cat === 'structure' ? 1 : 0) || (cat !== 'structure' && n) ? n : '';
    b.querySelector('.bar').style.width = q.list[0] === type ? (100 * q.prog / timeOf(type)) + '%' : '0';
    b.querySelector('.cs').textContent = q.ready === type ? 'READY' : locked ? 'Needs ' + missingReq(0, type) : '$' + costOf(type);
  }
  // superweapons
  let h = '';
  const ps = G.blds.filter(b => b.side === 0 && b.type === 'silo' && !b.dead).sort((a, b) => b.charge - a.charge)[0];
  if (ps) { const f = Math.min(1, ps.charge / NUKE_CHARGE); h += `<div class="row"><span class="gold">Nuke</span><div class="meter"><div style="width:${f * 100}%"></div></div>${f >= 1 ? '<button id="bNuke">LAUNCH (N)</button>' : fmtT(NUKE_CHARGE - ps.charge)}</div>`; }
  const es = G.blds.filter(b => b.side === 1 && b.type === 'silo' && !b.dead).sort((a, b) => b.charge - a.charge)[0];
  if (es) { const f = Math.min(1, es.charge / NUKE_CHARGE); h += `<div class="row"><span class="red">Hell Silo</span><div class="meter enemy"><div style="width:${f * 100}%"></div></div>${fmtT(NUKE_CHARGE - es.charge)}</div>`; }
  if (!h) h = '<span style="color:#6E7378">Superweapon: build a Nuke Silo (needs Factory).</span>';
  if ($('super').innerHTML !== h) { $('super').innerHTML = h; const bn = $('bNuke'); if (bn) bn.onclick = () => startNuke(); }
  // selection info
  let s = '';
  const sel = G.sel.filter(e => !e.dead);
  if (sel.length === 1) {
    const e = sel[0];
    s = `<b style="color:${SIDES[e.side].ui}">${ename(e)}</b> <small>${e.side ? '(enemy)' : ''}</small><div class="hp"><div style="width:${100 * e.hp / e.maxhp}%"></div></div>HP ${Math.ceil(e.hp)}/${e.maxhp}<br><small>${e.kind === 'u' ? e.d.desc : e.d.desc}</small>`;
    if (e.kind === 'u' && e.d.harv) s += `<br>Load: ${e.load}/${e.d.cap} · ${e.blocked ? 'storage full, waiting at dock' : ({ seek: 'looking for Salvage', toField: 'heading to a Scrap Pile', gather: 'gathering', toPlant: 'returning to ' + bname('refinery', e.side), queue: 'waiting for the dock', unload: 'unloading', idle: 'no Salvage found', noPlant: 'no ' + bname('refinery', e.side) + ' to unload at', parked: 'parked (right-click a Scrap Pile to resume)' })[e.hs] || ''}`;
    if (e.kind === 'b' && e.type === 'refinery' && e.dockQ) s += `<br>Dock: ${e.dockQ.length ? e.dockQ.length + ' truck(s), 1 unloading at a time' : 'free'}`;
    if (e.kind === 'b' && e.side === 0 && ['hq', 'barracks', 'factory'].includes(e.type)) s += '<br><small>Right-click the ground to set a rally point.</small>';
  } else if (sel.length > 1) {
    const c = {}; for (const e of sel) c[ename(e)] = (c[ename(e)] || 0) + 1;
    s = `<b>${sel.length} selected</b><br>` + Object.entries(c).map(([k, v]) => `${v} × ${k}`).join('<br>');
  } else s = '<span style="color:#6E7378">Nothing selected.<br>Drag to select units. Right-click to command.</span>';
  s += `<br><small style="color:#6E7378">Time ${fmtT(G.time)} · ${G.diff.name} · Horde waves sent: ${G.ai.waveN}</small>`;
  $('sel').innerHTML = s;
}
const fmtT = t => { t = Math.max(0, Math.ceil(t)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
function hint(t) { const h = $('modeHint'); if (t) { h.textContent = t; h.style.display = 'block'; } else h.style.display = 'none'; }
function startNuke() { if (!G || !readySilo(0)) return; G.mode = 'nuke'; G.placing = null; hint('Click a target for the nuke · Right-click / Esc to cancel'); }

// ---------------- input ----------------
const mouse = { x: 0, y: 0, wx: 0, wy: 0, in: false, down: false, drag: false, dx: 0, dy: 0, sx: 0, sy: 0 };
const keys = {};
let lastClick = { t: 0, type: null };
function updMouseWorld() { mouse.wx = mouse.x + cam.x; mouse.wy = mouse.y + cam.y; }
function entityAt(wx, wy) {
  for (let i = G.units.length - 1; i >= 0; i--) { const u = G.units[i]; if (u.dead) continue; if (u.side === 1 && !vis[tileOf(u.y) * MW + tileOf(u.x)]) continue; const oy = u.d.fly ? -9 : 0; if (dist(wx, wy, u.x, u.y + oy) < u.r + 4) return u; }
  const tx = tileOf(wx), ty = tileOf(wy); if (tx < 0 || ty < 0 || tx >= MW || ty >= MH) return null;
  const id = bgrid[ty * MW + tx]; if (id) { const b = bById.get(id); if (b && (b.side === 0 || isVisible(b))) return b; }
  return null;
}
view.addEventListener('mousemove', e => { const r = view.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; mouse.in = true; updMouseWorld(); if (mouse.down && Math.hypot(mouse.x - mouse.sx, mouse.y - mouse.sy) > 6) mouse.drag = true; });
view.addEventListener('mouseleave', () => { mouse.in = false; });
view.addEventListener('mouseenter', e => { const r = view.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; mouse.in = true; });
view.addEventListener('contextmenu', e => e.preventDefault());
view.addEventListener('mousedown', e => {
  if (!G || G.over) return; initAudio();
  { const r = view.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; }
  updMouseWorld();
  if (e.button === 2) {
    if (G.placing || G.mode) { G.placing = null; G.mode = null; hint(); return; }
    command(mouse.wx, mouse.wy); return;
  }
  if (e.button !== 0) return;
  if (G.placing) {
    const d = BDEF[G.placing], tx = tileOf(mouse.wx) - (d.w >> 1), ty = tileOf(mouse.wy) - (d.h >> 1);
    if (placeBld(0, G.placing, tx, ty)) { G.placing = null; hint(); } else { msg('Cannot place there. Build on clear ground near your base.', '#ff6a5a'); sfx('err'); }
    return;
  }
  if (G.mode === 'nuke') { if (launchNuke(0, mouse.wx, mouse.wy)) G.stats.nukes++; G.mode = null; hint(); return; }
  if (G.mode === 'amove') { const my = G.sel.filter(u => u.kind === 'u' && u.side === 0 && !u.dead); if (my.length) { issueMove(my, mouse.wx, mouse.wy, true); G.fx.push({ k: 'spark', x: mouse.wx, y: mouse.wy, c: '#ff6a4a', t: 0, dur: 0.4 }); } G.mode = null; hint(); return; }
  mouse.down = true; mouse.drag = false; mouse.sx = mouse.x; mouse.sy = mouse.y; mouse.dx = mouse.wx; mouse.dy = mouse.wy;
});
window.addEventListener('mouseup', e => {
  if (e.button !== 0 || !mouse.down || !G) return;
  mouse.down = false; updMouseWorld();
  const add = e.shiftKey;
  if (mouse.drag) {
    const x0 = Math.min(mouse.dx, mouse.wx), x1 = Math.max(mouse.dx, mouse.wx), y0 = Math.min(mouse.dy, mouse.wy), y1 = Math.max(mouse.dy, mouse.wy);
    const got = G.units.filter(u => u.side === 0 && !u.dead && u.x >= x0 && u.x <= x1 && u.y >= y0 && u.y <= y1);
    const combat = got.filter(u => !u.d.harv);
    const pick = combat.length ? combat : got;
    G.sel = add ? [...new Set([...G.sel, ...pick])] : pick;
    if (pick.length) sfx('click');
  } else {
    const e2 = entityAt(mouse.wx, mouse.wy);
    const now = performance.now();
    if (e2 && e2.kind === 'u' && e2.side === 0 && lastClick.type === e2.type && now - lastClick.t < 350) {
      G.sel = G.units.filter(u => u.side === 0 && !u.dead && u.type === e2.type && onScreen(u.x, u.y, 0));
    } else if (e2) { if (add && e2.side === 0 && e2.kind === 'u') { if (G.sel.includes(e2)) G.sel = G.sel.filter(x => x !== e2); else G.sel.push(e2); } else G.sel = [e2]; sfx('click'); }
    else if (!add) G.sel = [];
    lastClick = { t: now, type: e2 && e2.kind === 'u' ? e2.type : null };
  }
  mouse.drag = false;
});
function command(wx, wy) {
  const my = G.sel.filter(e => e.side === 0 && !e.dead);
  if (!my.length) return;
  const units = my.filter(e => e.kind === 'u');
  const blds = my.filter(e => e.kind === 'b');
  const t = entityAt(wx, wy);
  const ti = tileOf(wy) * MW + tileOf(wx);
  if (!units.length) { for (const b of blds) if (['hq', 'barracks', 'factory'].includes(b.type)) { b.rally = { x: wx, y: wy }; sfx('click'); } return; }
  if (t && t.side === 1) { orderAttack(units, t); for (const u of units.filter(u => u.d.harv)) orderMove(u, wx, wy); G.fx.push({ k: 'spark', x: wx, y: wy, c: '#ff4a3a', t: 0, dur: 0.4 }); sfx('click'); return; }
  const harv = units.filter(u => u.d.harv), rest = units.filter(u => !u.d.harv);
  for (const h of harv) {
    if (ti >= 0 && ti < N && res[ti] > 0) orderHarvest(h, ti);
    else if (t && t.kind === 'b' && t.side === 0 && t.type === 'refinery') orderDock(h, t);
    else orderMove(h, wx, wy);
  }
  if (harv.length && ((ti >= 0 && ti < N && res[ti] > 0) || (t && t.kind === 'b' && t.side === 0 && t.type === 'refinery'))) {
    const dp = t && t.type === 'refinery' ? dockPoint(t) : { x: (ti % MW) * TILE + 16, y: ((ti / MW) | 0) * TILE + 16 };
    G.fx.push({ k: 'arrow', x: dp.x, y: dp.y, t: 0, dur: 0.8 });
    if (!rest.length) { sfx('click'); return; }
  }
  if (rest.length) issueMove(rest, wx, wy, false);
  G.fx.push({ k: 'spark', x: wx, y: wy, c: '#7dff7d', t: 0, dur: 0.4 });
  sfx('click');
}
// minimap
function miniToWorld(e) { const r = mini.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * MW * TILE, y: (e.clientY - r.top) / r.height * MH * TILE }; }
let miniDown = false;
mini.addEventListener('contextmenu', e => e.preventDefault());
mini.addEventListener('mousedown', e => { if (!G) return; const p = miniToWorld(e); if (e.button === 2) { const my = G.sel.filter(u => u.kind === 'u' && u.side === 0 && !u.dead); if (my.length) command(p.x, p.y); return; } miniDown = true; centerOn(p.x, p.y); });
window.addEventListener('mousemove', e => { if (miniDown && G) { const p = miniToWorld(e); centerOn(p.x, p.y); } });
window.addEventListener('mouseup', () => { miniDown = false; });
function centerOn(x, y) { cam.x = x - VW / 2; cam.y = y - VH / 2; clampCam(); }
function clampCam() { cam.x = clamp(cam.x, -40, MW * TILE - VW + 40); cam.y = clamp(cam.y, -40, MH * TILE - VH + 40); }
window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (!G || !G.started) return;
  if (e.code === 'Escape') { if (G.placing || G.mode) { G.placing = null; G.mode = null; hint(); } else togglePause(); e.preventDefault(); return; }
  if (e.code === 'KeyP') { togglePause(); return; }
  if (e.code === 'KeyM') { toggleMute(); return; }
  if (G.paused || G.over) return;
  const m = /^Digit([1-9])$/.exec(e.code);
  if (m) {
    const n = m[1];
    if (e.ctrlKey || e.shiftKey || e.metaKey) { G.groups[n] = G.sel.filter(x => x.kind === 'u' && x.side === 0); msg(`Group ${n} set (${G.groups[n].length} units).`, '#7dd4ff'); e.preventDefault(); }
    else if (G.groups[n]) { const g = G.groups[n].filter(u => !u.dead); const now = performance.now(); if (G.lastGroup === n && now - G.lastGroupT < 400 && g.length) centerOn(g[0].x, g[0].y); G.sel = g; G.lastGroup = n; G.lastGroupT = now; }
    return;
  }
  if (e.code === 'KeyF') { if (G.sel.some(u => u.kind === 'u' && u.side === 0)) { G.mode = 'amove'; hint('Attack-move: click a destination'); } }
  if (e.code === 'KeyX') { stopUnits(G.sel.filter(u => u.kind === 'u' && u.side === 0)); }
  if (e.code === 'KeyH') { const hq = G.blds.find(b => b.side === 0 && b.type === 'hq' && !b.dead) || G.blds.find(b => b.side === 0 && !b.dead); if (hq) centerOn(hq.x, hq.y); }
  if (e.code === 'Space') { if (G.lastAlert) centerOn(G.lastAlert.x, G.lastAlert.y); e.preventDefault(); }
  if (e.code === 'KeyN') startNuke();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
function updCamera(dt) {
  const sp = 800 * dt; let dx = 0, dy = 0;
  if (keys.ArrowLeft || keys.KeyA) dx -= sp;
  if (keys.ArrowRight || keys.KeyD) dx += sp; if (keys.ArrowUp || keys.KeyW) dy -= sp; if (keys.ArrowDown || keys.KeyS) dy += sp;
  if (mouse.in && !mouse.down && document.hasFocus()) { const m = 14; if (mouse.x < m) dx -= sp; if (mouse.x > VW - m) dx += sp; if (mouse.y < m) dy -= sp; if (mouse.y > VH - m) dy += sp; }
  if (dx || dy) { cam.x += dx; cam.y += dy; clampCam(); updMouseWorld(); }
}

// ---------------- game flow ----------------
function togglePause() { if (!G || G.over) return; G.paused = !G.paused; showPanel(G.paused ? 'pausePanel' : null); $('bPause').textContent = G.paused ? 'Resume (P)' : 'Pause (P)'; }
function toggleMute() { muted = !muted; $('bMute').textContent = 'Sound: ' + (muted ? 'Off' : 'On'); }
function showPanel(id) { for (const p of document.querySelectorAll('.panel')) p.classList.toggle('show', p.id === id); $('overlay').classList.toggle('show', !!id); }
function newGame(diffKey) {
  const seed = (Math.random() * 1e9) | 0; rng = mulberry32(seed);
  idc = 0; bById.clear();
  if ($('msgs')) $('msgs').innerHTML = '';
  G = { seed, time: 0, diff: DIFF[diffKey] || DIFF.normal, diffKey, units: [], blds: [], proj: [], fx: [], decals: [], rad: [], missiles: [], rises: [], sel: [], groups: {},
    credits: [SD.startScripPlayer, SD.startScripAI], queues: [mkQ(), mkQ()], stats: { kills: 0, lost: 0, bKills: 0, bLost: 0, built: 0, bBuilt: 0, salvage: 0, nukes: 0 },
    over: false, paused: false, started: false, mode: null, placing: null, ai: { t: 1, nextWave: 0, waveN: 0 }, fogT: 0, winT: 0, shakeA: 0,
    baseP: { x: 9, y: MH - 10 }, baseE: { x: MW - 10, y: 9 } };
  G.ai.nextWave = G.diff.firstWave;
  genMap();
  SAL = makeSalvage();
  const P = G.baseP;
  for (const side of [0, 1]) {
    const place = (type, tx, ty) => { const d = BDEF[type]; if (side === 1) { tx = MW - tx - d.w; ty = MH - ty - d.h; } return makeBld(type, side, tx, ty); };
    const hq = place('hq', P.x - 1, P.y - 1);
    // Survivors start with a Power Plant + Scrap Yard (2,500 cannot buy both); the AI builds its own from 3,000 (ADD §2)
    if (side === 0) { place('power', P.x + 3, P.y - 2); place('refinery', P.x + 3, P.y + 1); }
    const types = side ? ['zombie', 'zombie', 'zombie', 'zombie', 'imp'] : ['survivor', 'survivor', 'survivor', 'survivor', 'seraph'];
    types.forEach((t, k) => { const tx = side ? MW - 1 - (P.x + 3 + (k % 3)) : P.x + 3 + (k % 3), ty = side ? MH - 1 - (P.y - 4 - Math.floor(k / 3)) : P.y - 4 - Math.floor(k / 3); const n = nearestWalkable(tx, ty); makeUnit(t, side, n[0] * TILE + 16, n[1] * TILE + 16); });
  }
  G.started = true;
  updFog();
  centerOn(P.x * TILE, P.y * TILE - 100);
  buildSidebar();
  hint();
  msg('Gather Salvage, build up, and destroy every Horde structure.', '#DDF6FF');
  msg('Tip: your Scrap Truck hauls Salvage to the Scrap Yard for Credits. Right-click a Scrap Pile or Yard to direct it.', '#d8c8a8');
}
// headless combat arena (CS automated matchups): open ground, no plague, no buildings, no AI
function newArena(seed) {
  rng = mulberry32(seed | 0); idc = 0; bById.clear();
  G = { seed, time: 0, diff: DIFF.normal, diffKey: 'normal', units: [], blds: [], proj: [], fx: [], decals: [], rad: [], missiles: [], rises: [], sel: [], groups: {},
    credits: [0, 0], queues: [mkQ(), mkQ()], stats: { kills: 0, lost: 0, bKills: 0, bLost: 0, built: 0, bBuilt: 0, salvage: 0, nukes: 0, risen: 0, purified: 0, crushed: 0 },
    over: false, paused: false, started: true, mode: null, placing: null, ai: { t: 1e9, nextWave: 1e9, waveN: 0 }, fogT: 0, winT: 0, shakeA: 0, arena: true,
    baseP: { x: 2, y: 2 }, baseE: { x: MW - 3, y: MH - 3 } };
  terr = new Uint8Array(N); res = new Uint16Array(N); plague = new Uint8Array(N);
  bgrid = new Int32Array(N); vis = new Uint8Array(N); expl = new Uint8Array(N);
  plagueZones = []; craters = []; decos = [];
  SAL = makeSalvage();
  return G;
}
function step(dt) {
  G.time += dt;
  if (!G.arena) { updProduction(dt); updAI(dt); }
  SAL.update(dt); // fixed-step salvage sim (accumulator)
  for (const u of G.units) if (!u.dead) updUnit(u, dt);
  updCrush();
  separate();
  for (const b of G.blds) if (!b.dead) updBld(b, dt);
  updProj(dt); updMissiles(dt); updEnv(dt);
  for (const f of G.fx) { f.t += dt; if (f.k === 'smoke') { } }
  G.fx = G.fx.filter(f => f.t < f.dur);
  if (G.fx.length > 900) G.fx.splice(0, G.fx.length - 900);
  if (G.decals.length > 400) G.decals.splice(0, G.decals.length - 400);
  if (G.units.some(u => u.dead)) G.units = G.units.filter(u => !u.dead);
  if (G.blds.some(b => b.dead)) G.blds = G.blds.filter(b => !b.dead);
  if (G.sel.some(e => e.dead)) G.sel = G.sel.filter(e => !e.dead);
  if (G.flash) { G.flash.t += dt; if (G.flash.t > 1.2) G.flash = null; }
  G.shakeA *= Math.pow(0.02, dt);
  G.fogT -= dt; if (G.fogT <= 0) { G.fogT = 0.2; updFog(); }
  G.winT -= dt; if (G.winT <= 0 && !G.arena) { G.winT = 0.5; checkEnd(); const low = powerOf(0).net < 0; if (low && !G.lowPower) { msg('Low power: production at half speed. Build a Power Plant.', '#ff5a4a'); sfx('alert'); } G.lowPower = low; }
}
function checkEnd() {
  const p = G.blds.some(b => b.side === 0), e = G.blds.some(b => b.side === 1);
  if (p && e) return;
  G.over = true;
  const win = !e;
  $('endTitle').textContent = win ? 'VICTORY' : 'DEFEAT';
  $('endTitle').style.color = win ? '#6FA8FF' : '#ff4a2a';
  $('endText').textContent = win ? 'The Horde is banished. Dawn breaks over the ashes.' : 'Your last light is extinguished. The Horde inherits the earth.';
  const s = G.stats;
  $('endStats').textContent = `Time played      ${fmtT(G.time)}\nDifficulty       ${G.diff.name}\nEnemies slain    ${s.kills}\nEnemy structures ${s.bKills}\nUnits lost       ${s.lost - s.bLost}\nStructures lost  ${s.bLost}\nUnits trained    ${s.built}\nCredits earned   ${Math.floor(s.salvage)}\nNukes fired      ${s.nukes}`;
  setTimeout(() => showPanel('endPanel'), 1200);
}
let lastTs = 0, uiT = 0, miniT = 0;
function frame(ts) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (ts - lastTs) / 1000 || 0); lastTs = ts;
  if (G) {
    if (G.started && !G.paused && !G.over) step(dt);
    else if (G.over) { for (const f of G.fx) f.t += dt; G.fx = G.fx.filter(f => f.t < f.dur); }
    updCamera(dt); updAsh(dt);
    uiT -= dt; if (uiT <= 0) { uiT = 0.15; updSidebar(); }
    miniT -= dt; if (miniT <= 0) { miniT = 0.2; drawMini(); }
  }
  render();
}
function selectedDiff() { const r = document.querySelector('input[name=diff]:checked'); return r ? r.value : 'normal'; }
$('bStart').onclick = () => { initAudio(); newGame(selectedDiff()); showPanel(null); };
$('bAgain').onclick = () => { showPanel('startPanel'); };
$('bRestart').onclick = () => { if (!G) return; if (G.over || confirm('Restart the battle? Current progress will be lost.')) { G.paused = false; $('bPause').textContent = 'Pause (P)'; newGame(G.diffKey); showPanel(null); } };
$('bPause').onclick = () => togglePause();
$('bResume').onclick = () => togglePause();
$('bMute').onclick = () => toggleMute();
resize();
showPanel('startPanel');
requestAnimationFrame(frame);
// test hook
window.RTS = { get plague() { return plague; }, get res() { return res; }, newArena, Combat, findEnemy, kill, damage, issueMove, orderAttack, separate, makeUnit, makeBld, get G() { return G; }, get SAL() { return SAL; }, Salvage, storageCapOf, powerOf, dockPoint, command, step, newGame, UDEF, BDEF, queueItem, placeBld, canPlace, launchNuke, cam, centerOn };
