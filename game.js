'use strict';
// ===================== ASHFALL: LAST LIGHT =====================
// A small classic-style RTS. Pure Canvas 2D, no assets.
const TILE = 32;
let MW = 80, MH = 80, N = MW * MH;   // env pass 1: design maps can be 64x64 (Ash Ring), so the map size is set per game (setMapSize)
const $ = id => document.getElementById(id);
const view = $('view'), ctx = view.getContext('2d');
const mini = $('mini'), mctx = mini.getContext('2d');
// view: SW x SH is the canvas in CSS px; DPR scales the backing store. UI notes §5.1-2 (integer pixel art): the world is drawn at
// KS = max(1, floor(DPR x ZOOM)) whole device px per art px, so ZS = KS / DPR css px per world px and VW x VH = SW / ZS x SH / ZS
// is the visible world. At DPR 1 / 2 this is just ZOOM; a fractional DPR (1.25 / 1.5) rounds down to the next whole device scale.
let VW = 800, VH = 600, SW = 800, SH = 600, DPR = 1, ZOOM = 1, KS = 1, ZS = 1;
// resolution governor: the backing store follows devicePixelRatio (capped at 2) while the game holds its frame rate; if a 2 s window
// averages < 55 fps it drops to 1x for the rest of the session (the canvas is upscaled nearest-neighbour, so pixel art looks the same;
// only text / thin lines lose sharpness). Windows with a frame gap > 250 ms (hidden tab, breakpoint) are ignored.
let lowRes = false; const perfWin = { t0: 0, n: 0, gap: false };
function govern(ts, gapMs) {
  if (lowRes || DPR <= 1) { perfWin.t0 = 0; return; }
  if (!perfWin.t0) { perfWin.t0 = ts; perfWin.n = 0; perfWin.gap = false; return; }
  perfWin.n++; if (gapMs > 250) perfWin.gap = true;
  if (ts - perfWin.t0 >= 2000) { const fps = perfWin.n * 1000 / (ts - perfWin.t0); if (!perfWin.gap && fps < 55) { lowRes = true; resize(); } perfWin.t0 = 0; }
}
// Job E: mouse-wheel zoom steps, nearest-neighbour (imageSmoothingEnabled false). Director ruling (Oct 28, 2026): whole-number
// steps only, 1x / 2x / 3x, plus 4x on very large windows (where the auto zoom of UI notes §7 already starts at 2x). No fractional step:
// on small screens 1x is the widest view (ui-layout reports the tiles visible at 1x per size).
const ZOOMS = [1, 2, 3, 4];
let userZoom = false; // once the player wheels, a resize keeps their step (clamped) instead of the auto zoom
// UI notes §7: very large windows get an integer zoom so the world stays readable: 1920x1080 -> 1, 2560x1440 -> 1, 3840x2160 -> 2
function autoZoom() { return Math.max(1, Math.floor(Math.min(SW / 1280, SH / 800))); }
function zoomMax() { return autoZoom() >= 2 ? 4 : 3; }
// mouse-over edge-scroll zone of the game view, in px, all four edges.
// History: 14 (original) -> 17 (x1.2 = 16.8, rounded) -> 20 (ruling Oct 27, 2026).
const EDGE_SCROLL_PX = 20;
function resize() {
  DPR = lowRes ? 1 : Math.max(1, Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1));
  applyTier(); // sidebar width, minimap box and icon set for this window (changes the playfield width)
  const g = $('game'); SW = Math.max(1, g.clientWidth || 0); SH = Math.max(1, g.clientHeight || 0);
  view.width = Math.round(SW * DPR); view.height = Math.round(SH * DPR);
  setZoom(userZoom ? ZOOM : autoZoom());
}
window.addEventListener('resize', resize);
// 1x is always allowed: a map smaller than the view is centred by clampCam (UI notes §7), never forced up to a fractional step
function zoomMin() { return ZOOMS[0]; }
// zoom to z (clamped to a whole step in [zoomMin, zoomMax]) keeping the world point under screen point (ax, ay) fixed (default: the view centre)
function setZoom(z, ax, ay) {
  if (ax === undefined) { ax = SW / 2; ay = SH / 2; }
  const nz = Math.max(zoomMin(), Math.min(zoomMax(), Math.round(z) || 1));
  const wx = ax / ZS + cam.x, wy = ay / ZS + cam.y;
  ZOOM = nz; KS = Math.max(1, Math.floor(DPR * ZOOM + 1e-6)); ZS = KS / DPR; VW = SW / ZS; VH = SH / ZS;
  cam.x = wx - ax / ZS; cam.y = wy - ay / ZS; clampCam(); updMouseWorld();
  return ZOOM;
}
function zoomStep(dir, ax, ay) { userZoom = true; return setZoom(ZOOM + Math.sign(dir), ax, ay); }

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
// Sim RNG (seeding fix): every sim / AI random draw goes through simRand (render-only cosmetics - screen shake, ash, audio noise,
// building smoke overlays - keep Math.random). By default it delegates to Math.random, so the headless harness (which seeds the
// vm's Math.random) is unchanged. ?seed=N or RTS.seed(N) gives the browser the same stream as a headless seed N.
let simRand = () => Math.random();
function seedSim(s) { simRand = s === null || s === undefined ? () => Math.random() : mulberry32(s | 0); }
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
  // Loop 4 (stats from combat.js UNITS). reqBld / reqRes: extra requirements on top of the producing building (from)
  flamer: { side: 0, name: 'Flamer', desc: 'Anti-swarm fire infantry. Its kills burn and never rise', r: 7, inf: true, cat: 'infantry', from: ['barracks'], reqBld: ['armory'], flame: true },
  rocket: { side: 0, name: 'Rocket Soldier', desc: 'Anti-heavy rocket infantry. Cannot hit air', r: 7, inf: true, cat: 'infantry', from: ['barracks'], reqRes: ['rockets'], rocket: true },
  medic: { side: 0, name: 'Medic', desc: 'Unarmed. Heals one infantry unit at a time (never vehicles)', r: 7, inf: true, cat: 'infantry', from: ['barracks'], reqBld: ['church'] },
  archangel: { side: 0, name: 'Archangel', desc: 'Big flying unit, holy beam hits several targets. Heals allies within 4 tiles, stops the dead rising within 6. Plague-immune. One alive at a time', r: 16, fly: true, cat: 'church', from: ['church'], big: true, plagueImmune: true },
  templar: { side: 0, name: 'Templar', desc: 'Big holy knight on foot. Plague-immune, its kills never rise. Two alive at a time', r: 11, inf: true, melee: true, heavy: true, cat: 'church', from: ['church'], big: true, plagueImmune: true },
  demon: { side: 1, name: 'Demon Lord', desc: 'Horned giant. Fire hits air. Plague aura (3 tiles). One alive at a time', r: 22, heavy: true, cat: 'altar', from: ['altar'], big: true },
};
// Loop 3: armor / damage type / hitsAir and spec stats come from combat.js (CS balance table)
for (const k in UDEF) {
  const c = Combat.UNITS[k], u = UDEF[k]; u.armor = c.armor; u.weapon = c.dmgType || undefined; u.hitsAir = !!c.dmgType && Combat.hitsAir(c.dmgType);
  if (c.dmgType || c.heal) Object.assign(u, { cost: c.cost, time: c.time, hp: c.hp, dmg: c.dmg || 0, rof: c.rof || 0, range: c.range, speed: c.speed * 32, sight: c.sight, splash: c.splash || 0 });
  if (c.heal) u.heal = c.heal;
  if (c.limit) u.limit = c.limit;
}
const BDEF = {
  hq: { name: ['HQ', 'Hive'], desc: 'Headquarters. Trains Scrap Trucks only. Slow drop-off (one dock pad) until a Scrap Yard exists. Stores 2,000 Credits. Built-in turret (' + Combat.TOWERS.hq.range + ' tiles, hits air)', w: 3, h: 3, hp: 2200, cost: 0, time: 0, sight: 8,
    dmg: Combat.TOWERS.hq.dmg, rof: Combat.TOWERS.hq.rof, range: Combat.TOWERS.hq.range, dmgType: Combat.TOWERS.hq.dmgType, hitsAir: true, power: 0 },
  power: { name: ['Power Plant', 'Power Plant'], desc: 'Makes +100 power', w: 2, h: 2, hp: SD.powerPlantHp, cost: SD.powerPlantCost, time: SD.powerPlantBuildTime, req: ['hq'], sight: 4 },
  refinery: { name: ['Scrap Yard', 'Grinder Pit'], desc: 'Salvage drop-off with one dock pad. Stores 2,000 Credits. Comes with a free truck. Uses 30 power', w: 3, h: 2, hp: SD.plantHp, cost: SD.plantCost, time: SD.plantBuildTime, req: ['power'], sight: 5 },
  depot: { name: ['Depot', 'Depot'], desc: 'Stores 1,500 more Credits. Uses 10 power', w: 2, h: 1, hp: SD.depotHp, cost: SD.depotCost, time: SD.depotBuildTime, req: ['refinery'], sight: 4 },
  barracks: { name: ['Barracks', 'Spawning Pit'], desc: 'Trains infantry. Uses 20 power', w: 2, h: 2, hp: 800, cost: 500, time: 8, req: ['hq'], sight: 5 }, // req: see BARRACKS_NEEDS_YARD
  turret: { name: ['Turret', 'Bone Spire'], desc: 'Defense tower. Hits air. Uses 20 power', w: 1, h: 1, hp: 650, cost: 600, time: 9, req: ['barracks'], sight: 7, dmg: 28, rof: 0.9, range: 6.5 },
  factory: { name: ['Factory', 'Factory'], desc: 'Builds heavy units. Uses 40 power', w: 3, h: 3, hp: 1200, cost: 2000, time: 15, req: ['refinery'], sight: 5 },
  silo: { name: ['Nuke Silo', 'Hell Silo'], desc: 'Superweapon. Charges a nuke. Uses 50 power', w: 2, h: 2, hp: 1000, cost: 2500, time: 22, req: ['factory'], sight: 5 },
  // Loop 4 tech buildings (L4 "Tech path"); side = the only faction that can build it
  armory: { name: ['Armory', 'Armory'], desc: 'Military research. Unlocks the Flamer. Uses 30 power', w: 2, h: 2, hp: 900, cost: 1200, time: 12, req: ['barracks', 'refinery'], sight: 5, side: 0, research: true },
  church: { name: ['Church', 'Church'], desc: 'Holy research. Unlocks the Medic; trains the Archangel and Templar. Uses 40 power', w: 2, h: 3, hp: 1000, cost: 1500, time: 15, req: ['armory'], sight: 6, side: 0, research: true },
  altar: { name: ['Dark Altar', 'Dark Altar'], desc: 'Trains the Demon Lord. Uses 40 power', w: 2, h: 3, hp: 1000, cost: 1500, time: 15, req: ['factory'], sight: 5, side: 1 },
};
// addendum 1d lever (backlog call B): when true, the Barracks / Spawning Pit need a Scrap Yard / Grinder Pit instead of the HQ / Hive
// (the sidebar then shows "Needs Scrap Yard" / "Needs Grinder Pit"). User decision via the Director, Oct 28: OFF.
let BARRACKS_NEEDS_YARD = false;
function setBarracksNeedsYard(v) { BARRACKS_NEEDS_YARD = !!v; BDEF.barracks.req = [BARRACKS_NEEDS_YARD ? 'refinery' : 'hq']; }
setBarracksNeedsYard(BARRACKS_NEEDS_YARD);

// Loop 4 buildings without art yet: drawn by the procedural drawBld (unitart.js BLD_MAP has no entry)
const ART_PENDING = [];
for (const k in BDEF) BDEF[k].armor = 'structure';
const BORDER = ['refinery', 'barracks', 'turret', 'factory', 'silo', 'power', 'depot', 'armory', 'church'];
const UORDER = [['gleaner', 'survivor', 'seraph', 'ark', 'flamer', 'rocket', 'medic', 'archangel', 'templar'], ['reaper', 'zombie', 'imp', 'brute', 'demon']];
const QCATS = ['structure', 'infantry', 'vehicle', 'church', 'altar'];
const NUKE_CHARGE = 200, NUKE_R = 4.5;
// visual only: newly placed buildings play the art's scaffold + bottom-up reveal over this many seconds (fully functional at once)
const BUILD_REVEAL_S = 2;
// Remote Scrap Yards / Grinder Pits (rts-loops/features/1-remote-scrap-yards.md). A Scrap Yard may go anywhere on your own half
// of the map, outside the strip along the half line; every other building keeps the 'near own buildings' rule.
const REMOTE_STRIP = 3, REMOTE_ENEMY_UNIT = 6, REMOTE_ENEMY_BLD = 10, REMOTE_SALVAGE_GAP = 1;
const REMOTE_EXTENDS_RADIUS = true;                  // R1 (open with Don): a remote yard extends the build radius. Dezi's default: yes
const REMOTE_SETUP_S = 10, REMOTE_SETUP_HP0 = 0.25;  // R2 (open with Don): remote yards deploy over 10 s from 25% HP; set REMOTE_SETUP_S = 0 for instant
const AI_PIT_CAP = { easy: 2, normal: 3, hard: 4 };  // AI_PIT_CAP = [2, 3, 4] (Easy / Normal / Hard)
const AI_REMOTE_EASY_FROM = 600;                     // Easy: no remote Grinder Pit before 10:00
const AI_FIELD_LIVE = 0.25, AI_FIELD_SERVED = 8, AI_FIELD_PLAYER_UNIT = 8, AI_FIELD_PLAYER_BLD = 10;
const DIFF = {
  // firstWave / wave1: Loop 4 opening addendum overrides (wave 1 is a fixed group; later waves use minWave + 2 per wave)
  easy: { name: 'Easy', inc: 0.75, prod: 0.85, firstWave: 390, wave1: { zombie: 3 }, waveGap: 150, minWave: 5, siloTime: 600, altarTime: 720 },
  normal: { name: 'Normal', inc: 1.0, prod: 1.0, firstWave: 300, wave1: { zombie: 5, imp: 1 }, /* 1d §8 ruling 1 (was 4 Zombies + 1 Imp) */ waveGap: 120, minWave: 6, siloTime: 420, altarTime: 540 },
  hard: { name: 'Hard', inc: 1.35, prod: 1.2, firstWave: 240, wave1: { zombie: 5, imp: 1 }, startScripAI: 2000, /* 1d §8 steering: Hard AI starts on 2,000 (was SD.startScripAI 2,500); inc stays 1.35 */ waveGap: 95, minWave: 8, siloTime: 300, altarTime: 420 },
};
const bname = (type, side) => BDEF[type].name[side];
const ename = e => e.kind === 'u' ? e.d.name : bname(e.type, e.side);

// ---------------- map state ----------------
let terr, res, plague, bgrid, vis, expl, plagueZones, craters, decos, terrCanvas, miniBase, resTiles;
let G = null, SAL = null; // SAL: salvage sim instance (salvage.js)
let designMap = null;   // ?map=<name> (assets/maps/<name>.json) or RTS.newGame(diff, { map })
let idc = 0;
const bById = new Map();

function walk(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= MW || ty >= MH) return false;
  const i = ty * MW + tx; return !BLOCK[terr[i]] && !bgrid[i];
}
const tileOf = v => Math.floor(v / TILE);

// ---------------- pathfinding (A*) ----------------
let gS, came, stamp, closed, heapI, heapP, curStamp = 0, hsz = 0;
function allocPath() { gS = new Float32Array(N); came = new Int32Array(N); stamp = new Uint32Array(N); closed = new Uint32Array(N); heapI = new Int32Array(N * 8); heapP = new Float32Array(N * 8); curStamp = 0; }
allocPath();
function setMapSize(w, h) { if (w === MW && h === MH) return; MW = w; MH = h; N = w * h; allocPath(); }
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
  // decorations. Env pass 1: trees and cars are BLOCKERS (HANDOFF-env §4): their tile becomes RUBBLE (impassable for pathing,
  // units and building placement). Never on a Scrap Pile or its 1-tile ring (fields never sit under them, trucks keep their approach),
  // and never where the blocker would cut off ground that was reachable (flood-fill check per blocker). Skulls/bones/crosses stay walkable decals.
  let reachN = 0; { const s0 = reach(P); for (let i = 0; i < N; i++) reachN += s0[i]; }
  const nearRes = (x, y) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < MW && yy < MH && res[yy * MW + xx]) return true; } return false; };
  for (let k = 0; k < 140; k++) {
    const x = ri(MW), y = ri(MH), i = y * MW + x;
    if (terr[i] !== T.GROUND || res[i] || dist(x, y, P.x, P.y) < 8 || dist(x, y, E.x, E.y) < 8) continue;
    const d = { t: ['tree', 'skull', 'car', 'bones', 'tree', 'cross'][ri(6)], x: x * TILE + 6 + rng() * 20, y: y * TILE + 6 + rng() * 20, a: rng() * 6.28, s: 0.8 + rng() * 0.5, tx: x, ty: y };
    if (d.t === 'tree' || d.t === 'car') {
      if (nearRes(x, y)) continue;
      terr[i] = T.RUBBLE; let n = 0; const s1 = reach(P); for (let j = 0; j < N; j++) n += s1[j];
      if (n !== reachN - 1) { terr[i] = T.GROUND; continue; }
      reachN = n; d.block = true; d.v = Math.floor(hash(i * 41) * 4); d.x = x * TILE + 16; d.y = y * TILE + 20;
    }
    decos.push(d);
  }
  G.mapSrc = null;
  renderTerrain();
}
// ---------------- design maps (Dezi, design-backlog/maps/*.json) ----------------
// Gameplay reads the map's rows/legend only (never the sprites); the env art resolves the same JSON through EnvTerrain.resolveMap().
const LEGEND_T = { '=': T.ROAD, '~': T.SLUDGE, '#': T.RUBBLE, r: T.RUBBLE, c: T.RUBBLE, t: T.RUBBLE, o: T.CRATER };
function applyDesignMap(m) {
  setMapSize(m.w, m.h);
  terr = new Uint8Array(N); res = new Uint16Array(N); plague = new Uint8Array(N);
  bgrid = new Int32Array(N); vis = new Uint8Array(N); expl = new Uint8Array(N);
  plagueZones = []; craters = []; decos = [];
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    const c = m.rows[y][x], i = y * MW + x;
    terr[i] = LEGEND_T[c] !== undefined ? LEGEND_T[c] : T.GROUND;
    if (c === 'S' || c === 'A') res[i] = SD.tileMax;
    if (c === 'o') craters.push({ x: x * TILE + 16, y: y * TILE + 16, r: 22 });
  }
  for (const z of m.plague || []) {
    plagueZones.push({ x: z.x * TILE + 16, y: z.y * TILE + 16, r: z.r * TILE });
    for (let y = Math.floor(z.y - z.r); y <= z.y + z.r; y++) for (let x = Math.floor(z.x - z.r); x <= z.x + z.r; x++)
      if (x >= 0 && y >= 0 && x < MW && y < MH && dist(x, y, z.x, z.y) <= z.r) plague[y * MW + x] = 1;
  }
  // procedural-renderer fallback decorations (only drawn when the env atlases are off / failed)
  for (const p of m.props || []) {
    const t = p.key === 'trees' ? 'tree' : p.key === 'cars' ? 'car' : p.key === 'decals' ? ['bones', 'skull', 'cross'][(p.v || 0) % 3] : null;
    if (t) decos.push({ t, x: p.x * TILE + 16, y: p.y * TILE + (t === 'tree' || t === 'car' ? 20 : 16), a: hash(p.y * MW + p.x) * 6.28, s: 1, tx: p.x, ty: p.y, block: t === 'tree' || t === 'car', v: p.v || 0 });
  }
  // no ensureConnected on a loaded map (1-maps.md): validate-maps.js already proves both starts and every pile connect
  resTiles = []; for (let i = 0; i < N; i++) if (res[i] > 0) resTiles.push(i);
  G.mapSrc = m;
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
  renderMiniBase();
  if (envPrepare()) { for (let k = 0; k < PROC_TERRAIN_DRAWS; k++) rng(); return; }   // env atlases ready: baked env ground, no procedural ground.
  // The procedural ground takes PROC_TERRAIN_DRAWS from the map rng, which the AI keeps using; burn the same draws so a seed gives the
  // same game with or without env art (browser = headless)
  renderProcTerrain();
}
const PROC_TERRAIN_BLOBS = 500, PROC_TERRAIN_DRAWS = PROC_TERRAIN_BLOBS * 4;   // 3 rng() + 1 ri() per blob
function renderProcTerrain() {
  const blk = new Set(decos.filter(d => d.block).map(d => d.ty * MW + d.tx));
  terrCanvas = document.createElement('canvas'); terrCanvas.width = MW * TILE; terrCanvas.height = MH * TILE;
  const c = terrCanvas.getContext('2d');
  c.fillStyle = '#3a322a'; c.fillRect(0, 0, MW * TILE, MH * TILE);
  // large color variation blobs (ash, scorched earth, rust)
  const cols = ['rgba(20,15,12,0.25)', 'rgba(90,75,60,0.18)', 'rgba(110,50,30,0.12)', 'rgba(60,60,55,0.2)', 'rgba(15,10,8,0.3)'];
  for (let k = 0; k < PROC_TERRAIN_BLOBS; k++) {
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
    } else if (terr[i] === T.RUBBLE && !blk.has(i)) {
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
}
// UI notes §5.7: a fixed minimap box per tier (160 / 240 css px) with the map at a whole px/tile = floor(box / max(MW, MH)),
// centred, the rest of the box black. 80x80 -> 2 / 3 px/tile (fills the box); 64x64 Ash Ring -> 128 / 192 centred. Drawn 1:1.
let MBOX = 240, MP = 3, MOX = 0, MOY = 0;
function miniLayout() {
  MP = Math.max(1, Math.floor(MBOX / Math.max(MW, MH))); MOX = Math.floor((MBOX - MW * MP) / 2); MOY = Math.floor((MBOX - MH * MP) / 2);
  const k = Math.max(1, Math.floor(DPR + 1e-6)); // backing store at a whole multiple of the css box
  if (mini.width !== MBOX * k || mini.height !== MBOX * k) { mini.width = MBOX * k; mini.height = MBOX * k; }
  mctx.setTransform(k, 0, 0, k, 0, 0); mctx.imageSmoothingEnabled = false;
}
function renderMiniBase() {
  miniLayout();
  miniBase = document.createElement('canvas'); miniBase.width = MW * MP; miniBase.height = MH * MP;
  const m = miniBase.getContext('2d');
  for (let i = 0; i < N; i++) { const t = terr[i]; m.fillStyle = t === T.RUBBLE ? '#6a625a' : t === T.SLUDGE ? '#2a4a18' : t === T.CRATER ? '#141010' : t === T.ROAD ? '#2a2a2c' : '#4a3e32'; m.fillRect((i % MW) * MP, ((i / MW) | 0) * MP, MP, MP); }
}
// ---------------- env art pass 1 (rts-loops/art/env/HANDOFF-env.md; envart.js + env-terrain.js) ----------------
// G.env = { R: resolveMap() result, props (y-sorted blockers), fires, lights (static), stats }. Purely visual: every blocker
// footprint lies on a tile that is already impassable in terr[] (asserted below, counted in stats.offGrid).
const envEnabled = () => typeof EnvArt !== 'undefined' && !!EnvArt.env && !!G && !G.arena;
function envSourceMap() {
  if (G.mapSrc) return G.mapSrc;
  // procedural map -> Dezi map format, so one resolver drives both. Only cosmetic choices here (ruin seeds, variants).
  const rows = [], props = [], decoAt = new Map();
  for (const d of decos) decoAt.set(d.ty * MW + d.tx, d);
  for (let y = 0; y < MH; y++) { const r = []; for (let x = 0; x < MW; x++) {
    const i = y * MW + x, t = terr[i], d = decoAt.get(i);
    r.push(t === T.ROAD ? '=' : t === T.SLUDGE ? '~' : t === T.CRATER ? 'o' : t === T.RUBBLE ? (d && d.block ? (d.t === 'tree' ? 't' : 'c') : '#') : res[i] ? 'S' : '.');
  } rows.push(r); }
  const at = (x, y) => (x < MW && y < MH ? rows[y][x] : '');
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    const i = y * MW + x, c = rows[y][x];
    if (c === '#' && at(x + 1, y) === '#' && at(x, y + 1) === '#' && at(x + 1, y + 1) === '#' && hash(i * 53) < 0.35) { rows[y][x] = 'r'; props.push({ key: 'ruin', x, y }); }
    else if (c === 'o') props.push({ key: 'craters', x, y });
    const d = decoAt.get(i);
    if (d && d.block) props.push({ key: d.t === 'tree' ? 'trees' : 'cars', v: d.v, x, y });
    else if (d && terr[i] === T.GROUND) props.push({ key: 'decals', v: d.t === 'bones' ? 0 : d.t === 'skull' ? 1 : 2, x, y });
  }
  return { name: 'procedural', w: MW, h: MH, rows: rows.map(r => r.join('')), props };
}
function envPrepare() {
  if (!envEnabled()) {
    if (G && !G.arena && typeof EnvArt !== 'undefined' && EnvArt.state.mode === 'loading') { const g = G; EnvArt.onReady(() => { if (G === g && !G.env) { envPrepare(); } }); }
    if (G) G.env = null;
    return false;
  }
  const env = EnvArt.env, now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const t0 = now(), src = envSourceMap(), R = env.resolveMap(src), t1 = now();
  let offGrid = 0;
  for (const p of R.props.concat(R.groundProps)) { const f = env.frames.props[p.name]; if (!f || !f.footprint) continue;
    for (let y = Math.round(p.ty); y < Math.round(p.ty) + f.footprint[1]; y++) for (let x = Math.round(p.tx); x < Math.round(p.tx) + f.footprint[0]; x++) if (x < 0 || y < 0 || x >= MW || y >= MH || !BLOCK[terr[y * MW + x]]) offGrid++; }
  const cv = document.createElement('canvas'); cv.width = MW * TILE; cv.height = MH * TILE;
  const c = cv.getContext('2d'); c.imageSmoothingEnabled = false;
  env.bakeTerrain(c, R);
  const t2 = now();
  terrCanvas = cv;
  // burning props (cosmetic, stable per tile): ~30% of cars, ~40% of ruins, a few tall trees
  const fires = [], lights = [];
  for (const p of R.props) {
    const h = hash(Math.round(p.tx) * 7 + Math.round(p.ty) * 131 + 5), ruin = p.name.startsWith('ruin_');
    const size = ruin ? (h < 0.4 ? 'l' : null) : p.src === 'cars' ? (h < 0.3 ? 'm' : null) : p.name === 'tree_tall' ? (h < 0.1 ? 's' : null) : null;
    if (!size) continue;
    const [fx, fy] = env.firePoint(p); p.burn = true;
    fires.push({ size: 'fire_' + size, x: fx, y: fy, ph: h * 7 });
    lights.push({ name: 'light_fire_' + size, x: fx, y: fy, phase: h * 13 });
  }
  // Angel Wreck fields ('A' tiles): one light_wreck per 8-connected cluster
  if (src.rows) { const seen = new Uint8Array(N);
    for (let i = 0; i < N; i++) { if (seen[i] || src.rows[(i / MW) | 0][i % MW] !== 'A') continue;
      let sx = 0, sy = 0, n = 0; const q = [i]; seen[i] = 1;
      while (q.length) { const k = q.pop(), x = k % MW, y = (k / MW) | 0; sx += x; sy += y; n++;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy, j = Y * MW + X; if (X >= 0 && Y >= 0 && X < MW && Y < MH && !seen[j] && src.rows[Y][X] === 'A') { seen[j] = 1; q.push(j); } } }
      lights.push({ name: 'light_wreck', x: (sx / n + 0.5) * TILE, y: (sy / n + 0.5) * TILE, phase: i }); } }
  G.env = { R, props: R.props, fires, lights, stats: { map: src.name, resolveMs: +(t1 - t0).toFixed(1), bakeMs: +(t2 - t1).toFixed(1), props: R.props.length, groundProps: R.groundProps.length, decals: R.decals.length, fires: fires.length, offGrid, missing: R.missing, resolved: R.stats, loadMs: EnvArt.state.loadMs, frame: {} } };
  return true;
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
// ---------------- Loop 4 research modifiers (never mutate UDEF / BDEF) ----------------
const doneOf = side => (G && G.research && G.research[side]) || null;
const isDone = (side, id) => !!(doneOf(side) && doneOf(side)[id]);
const kindOf = e => e.kind === 'b' ? 'blds' : 'units';
const dmgOf = e => e.d.dmg * Combat.modifier(doneOf(e.side), 'dmgMult', kindOf(e), e.type);
const rangeOf = e => e.d.range + Combat.modifier(doneOf(e.side), 'rangeAdd', kindOf(e), e.type);
const speedOf = u => u.d.speed * Combat.modifier(doneOf(u.side), 'speedMult', 'units', u.type);
const maxHpOf = (type, side) => Math.round(UDEF[type].hp * Combat.modifier(doneOf(side), 'hpMult', 'units', type));
const aliveOf = (side, type) => G.units.filter(u => u.side === side && u.type === type && !u.dead).length;
function makeUnit(type, side, x, y) {
  const d = UDEF[type], mhp = maxHpOf(type, side);
  const u = { id: ++idc, kind: 'u', type, side, d, x, y, hp: mhp, maxhp: mhp, r: d.r, ang: side ? 2.4 : -0.8, tang: side ? 2.4 : -0.8,
    order: 'idle', path: null, pi: 0, dest: null, target: null, tmode: null, cd: simRand() * 0.5, scan: simRand() * 0.3,
    repath: 0, load: 0, hs: 'seek', htile: -1, ht: 0, anim: simRand() * 10, moving: false, stuckT: 0, sx: x, sy: y, hitT: 0, dead: false };
  G.units.push(u); return u;
}
function makeBld(type, side, tx, ty) {
  const d = BDEF[type];
  const b = { id: ++idc, kind: 'b', type, side, d, tx, ty, w: d.w, h: d.h, x: (tx + d.w / 2) * TILE, y: (ty + d.h / 2) * TILE, r: Math.max(d.w, d.h) * TILE / 2,
    hp: d.hp, maxhp: d.hp, cd: 0, target: null, weapon: Combat.TOWERS[type] ? Combat.TOWERS[type].dmgType[side] : null, armed: !!Combat.TOWERS[type], charge: 0, rally: null, anim: simRand() * 10, tang: 0, hitT: 0, dead: false, smokeT: 0, bornT: G.started ? G.time : -1e9 };
  for (let y = ty; y < ty + d.h; y++) for (let x = tx; x < tx + d.w; x++) bgrid[y * MW + x] = b.id;
  bById.set(b.id, b);
  G.blds.push(b);
  // push out units standing on the footprint
  for (const u of G.units) if (!u.d.fly && tileOf(u.x) >= tx && tileOf(u.x) < tx + d.w && tileOf(u.y) >= ty && tileOf(u.y) < ty + d.h) {
    const n = nearestWalkable(tileOf(u.x), tileOf(u.y)); if (n) { u.x = n[0] * TILE + 16; u.y = n[1] * TILE + 16; u.path = null; }
  }
  if (type === 'hq') { b.pad = padTile(b); b.dockQ = []; } // opening addendum: HQ dock pad (no free Truck)
  if (type === 'refinery') { b.pad = padTile(b); b.dockQ = []; const s = dockPoint(b); const h = makeUnit(side ? 'reaper' : 'gleaner', side, s.x, s.y + 20); h.hs = 'seek'; if (G.started && SAL) salvageEvent('haulerSpawned', { u: h, plant: b }); }
  if (type === 'silo' && side === 1 && G.started) msg('WARNING: The Horde has raised a Hell Silo!', '#ff6a3d', b.x, b.y);
  return b;
}
// one-pad dock directly under the bottom-centre of a Scrap Yard / Grinder Pit (and the HQ / Hive)
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
  let sp = speedOf(u); if (!u.d.fly && terr[tileOf(u.y) * MW + tileOf(u.x)] === T.ROAD) sp *= 1.2;
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
      let nx, ny; if (d < 0.01) { nx = simRand() - 0.5; ny = simRand() - 0.5; d = 0.01; const l = Math.hypot(nx, ny); nx /= l; ny /= l; } else { nx = dx / d; ny = dy / d; }
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
  if (u.d.heal) { updMedic(u, dt); return; }
  if (u.target && u.target.dead) {
    u.target = null;
    if (u.order === 'attack') u.order = 'idle';
    if (u.order === 'attackmove' && u.dest) moveTo(u, u.dest.x, u.dest.y);
  }
  if (u.target) { engage(u, dt); return; }
  if (u.order === 'move') { if (followPath(u, dt)) { u.order = 'idle'; u.path = null; } return; }
  u.scan -= dt;
  if (u.scan <= 0) {
    u.scan = 0.3 + simRand() * 0.1;
    const t = findEnemy(u, u.d.sight * TILE, u.side);
    if (t) { u.target = t; u.tmode = 'auto'; u.repath = 0; engage(u, dt); return; }
  }
  if (u.order === 'attackmove') { if (followPath(u, dt)) { u.order = 'idle'; u.path = null; } }
  else u.moving = false;
}
// Medic (L4): unarmed; heals the most hurt friendly infantry in sight (one target, 10 HP/s, range 3); move orders come first
function updMedic(u, dt) {
  if (u.order === 'move') { u.heal = null; if (followPath(u, dt)) { u.order = 'idle'; u.path = null; } return; }
  const ok = t => t && !t.dead && t !== u && t.side === u.side && t.kind === 'u' && t.d.inf && t.hp < t.maxhp;
  u.scan -= dt;
  if (!ok(u.heal) || u.scan <= 0) {
    u.scan = 0.3 + simRand() * 0.1;
    let best = null, bf = 2, bd = 1e9; const sr = u.d.sight * TILE;
    for (const o of G.units) { if (!ok(o)) continue; const d = dist(u.x, u.y, o.x, o.y); if (d > sr) continue; const f = o.hp / o.maxhp; if (f < bf - 1e-6 || (Math.abs(f - bf) <= 1e-6 && d < bd)) { best = o; bf = f; bd = d; } }
    if (best !== u.heal) { u.heal = best; u.repath = 0; }
  }
  const t = u.heal;
  if (!t) { u.healing = false; if (u.order === 'attackmove') { if (followPath(u, dt)) { u.order = 'idle'; u.path = null; } } else u.moving = false; return; }
  const d = edgeDist(u.x, u.y, t);
  if (d <= rangeOf(u) * TILE) {
    u.moving = false; u.path = null; u.healing = true; u.ang = u.tang = Math.atan2(t.y - u.y, t.x - u.x);
    t.hp = Math.min(t.maxhp, t.hp + Combat.D.medicHealDps * dt);
    u.fxT = (u.fxT || 0) - dt; if (u.fxT <= 0) { u.fxT = 0.25; G.fx.push({ k: 'heal', x1: u.x, y1: u.y - 3, x2: t.x, y2: t.y - 3, t: 0, dur: 0.25 }); }
  } else {
    u.healing = false; u.repath -= dt;
    if (!u.path || u.repath <= 0 || u.pi >= u.path.length) { u.repath = 0.7 + simRand() * 0.4; const keep = u.dest; moveTo(u, t.x, t.y); if (u.order === 'attackmove') u.dest = keep; }
    followPath(u, dt);
  }
}
function engage(u, dt) {
  const t = u.target, rng = rangeOf(u) * TILE;
  if (!canAttack(u, t)) { u.target = null; if (u.order === 'attack') u.order = 'idle'; return; }
  const ed = edgeDist(u.x, u.y, t) - u.r * 0.5;
  if (ed <= rng) {
    u.moving = false; u.path = null;
    u.tang = Math.atan2(t.y - u.y, t.x - u.x); if (!u.d.weapon || u.d.weapon !== 'shell') u.ang = u.tang;
    if (u.cd <= 0) { fire(u, t); u.cd = u.d.rof * (0.9 + simRand() * 0.2); }
  } else {
    if (u.tmode === 'auto' && ed > u.d.sight * TILE * 1.7) { u.target = null; if (u.order === 'attackmove' && u.dest) moveTo(u, u.dest.x, u.dest.y); return; }
    // retarget to something closer if auto
    u.repath -= dt;
    if (!u.path || u.repath <= 0 || u.pi >= u.path.length) {
      u.repath = 0.7 + simRand() * 0.4;
      const keep = u.dest; moveTo(u, t.x, t.y); if (u.order === 'attackmove') u.dest = keep;
      if (u.tmode === 'auto') { const c = findEnemy(u, u.d.sight * TILE, u.side); if (c && c !== t) u.target = c; }
    }
    followPath(u, dt);
  }
}
function fire(s, t) {
  const side = s.side;
  const w = weaponOf(s), air = t.kind === 'u' && t.d.fly ? Combat.D.projArcPx : 0;
  const dmg = dmgOf(s);
  const ox = s.x + Math.cos(s.tang) * (s.r * 0.8), oy = s.y + Math.sin(s.tang) * (s.r * 0.8) - (s.d.fly ? 9 : s.kind === 'b' ? 14 : 0);
  if (w === 'bullet') { const hx = t.x + (simRand() - 0.5) * 6, hy = t.y - air + (simRand() - 0.5) * 6; G.fx.push({ k: 'line', x1: ox, y1: oy, x2: hx, y2: hy, c: s.kind === 'b' ? '#DDF6FF' : '#ffe9a0', w: s.kind === 'b' ? 2 : 1.5, t: 0, dur: 0.07 }); G.fx.push({ k: 'spark', x: hx, y: hy, c: '#ffe9a0', t: 0, dur: 0.15 }); damage(t, dmg, s, w); sfx('shot', s.x, s.y); }
  else if (w === 'beam') {
    const big = s.kind === 'u' && s.type === 'archangel';
    G.fx.push({ k: 'beam', x1: ox, y1: oy - (big ? 6 : 0), x2: t.x, y2: t.y - air, c: side ? '#ff5030' : '#9FE8FF', t: 0, dur: big ? 0.3 : 0.18, w: big ? 2 : 1 }); G.fx.push({ k: 'spark', x: t.x, y: t.y, c: '#fff6c0', t: 0, dur: 0.3 });
    if (s.kind === 'u' && s.d.splash) { areaDamage(t.x, t.y, s.d.splash * TILE, dmg, s, w); G.fx.push({ k: 'holyburst', x: t.x, y: t.y - air, r: s.d.splash * TILE, t: 0, dur: 0.35 }); } else damage(t, dmg, s, w);
    sfx('beam', s.x, s.y);
  }
  else if (w === 'claw' || w === 'cleave' || w === 'holy') {
    G.fx.push({ k: 'slash', x: t.x, y: t.y, a: s.ang, r: w === 'claw' ? 9 : 18, c: w === 'holy' ? '#DDF6FF' : undefined, t: 0, dur: 0.2 });
    if (w !== 'claw' && s.d.splash) areaDamage(t.x, t.y, s.d.splash * TILE, dmg, s, w); else damage(t, dmg, s, w);
    sfx('claw', s.x, s.y);
  } else if (s.kind === 'u' && s.d.flame) { // Flamer (L4): short flame cone, splash at the target, no projectile
    G.fx.push({ k: 'flame', x1: ox, y1: oy, x2: t.x, y2: t.y - air, ux: s.x, uy: s.y, t: 0, dur: 0.3 });
    areaDamage(t.x, t.y, s.d.splash * TILE, dmg, s, w);
    sfx('fire', s.x, s.y);
  } else {
    const bolt = w === 'fire' && s.kind === 'b'; // Bone Spire fire bolt (Imp throws a fireball)
    const rocket = s.kind === 'u' && !!s.d.rocket, big = s.kind === 'u' && s.type === 'demon';
    G.proj.push({ x: ox, y: oy, sx: ox, sy: oy, t, tx: t.x, ty: t.y - air, air, sp: rocket ? 280 : w === 'shell' ? 320 : bolt ? 380 : 220, w, bolt, rocket, big, dmg, s, side, splash: s.kind === 'b' ? 0 : (s.d.splash || 0) });
    sfx(w === 'fire' ? 'fire' : 'shot', s.x, s.y);
  }
}
function updProj(dt) {
  for (const p of G.proj) {
    if (p.t && !p.t.dead) { p.tx = p.t.x; p.ty = p.t.y - (p.air || 0); }
    const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy), st = p.sp * dt;
    if (p.rocket && simRand() < 0.7) G.fx.push({ k: 'smoke', x: p.x, y: p.y, t: 0, dur: 0.6, s: 0.4 });
    if (p.w === 'fire' && simRand() < (p.big ? 1 : 0.6)) G.fx.push({ k: 'ember', x: p.x, y: p.y, vx: (simRand() - 0.5) * 20, vy: (simRand() - 0.5) * 20, c: '#ff9a30', t: 0, dur: 0.35 });
    if (d <= st) {
      p.done = true;
      if (p.splash) areaDamage(p.tx, p.ty + (p.air || 0), p.splash * TILE, p.dmg, p.s, p.w);
      else if (p.t && !p.t.dead) damage(p.t, p.dmg, p.s, p.w);
      G.fx.push({ k: 'boom', x: p.tx, y: p.ty, r: p.big ? 30 : p.w === 'shell' ? 16 : 9, c: p.bolt ? '#ffb040' : '#ff8a30', t: 0, dur: 0.35 });
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
  amt *= Combat.mult(w, armorOf(t), t.kind === 'u' ? t.type : null); // CS damage matrix (unknown types such as plague or nuke: x1)
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
    if (t.d.inf) { G.fx.push({ k: 'blood', x: t.x, y: t.y, c: t.side ? (t.type === 'zombie' ? '#4a5a2a' : '#8a1a10') : '#7a1010', t: 0, dur: 0.6 }); G.decals.push({ k: 'blood', x: t.x, y: t.y, c: t.side ? '#3a3a1a' : '#4a0a08', a: simRand() * 6, t: 0 }); }
    else { G.fx.push({ k: 'boom', x: t.x, y: t.y, r: 26, c: '#ffa040', t: 0, dur: 0.6 }); G.decals.push({ k: 'scorch', x: t.x, y: t.y, r: 18, t: 0 }); sfx('boom', t.x, t.y); }
    // the dead rise
    if (t.d.harv && t.load > 0) dropCargo(t);
    // L4: bodies killed by fire are marked burned (burn decal) and never rise; holy (Templar) kills never rise either
    if (w === 'fire') { t.burned = true; const bs = burnScaleOf(t); G.decals.push({ k: 'burn', x: t.x, y: t.y, s: bs, r: bs === 2 ? 16 : 7, a: simRand() * 6, t: 0, born: G.time }); G.stats.burned = (G.stats.burned || 0) + 1; }
    if (w === 'holy') t.hallowed = true;
    const eligible = Combat.riseEligible(t.type, t.side, w) && !t.burned && !t.hallowed;
    if (eligible && Combat.noRiseBy(doneOf(t.side), t.type)) {
      G.stats.blessed = (G.stats.blessed || 0) + 1; G.fx.push({ k: 'purify', x: t.x, y: t.y, t: 0, dur: 0.7 });   // Blessed Rounds
    } else if (eligible && (Combat.purified(t.x, t.y, G.units.filter(a => a.side === 0 && a.type === 'seraph'), TILE) ||
        G.units.some(a => a.side === 0 && a.type === 'archangel' && !a.dead && dist(a.x, a.y, t.x, t.y) <= Combat.D.archangelNoRiseTiles * TILE))) {
      G.stats.purified = (G.stats.purified || 0) + 1; G.fx.push({ k: 'purify', x: t.x, y: t.y, t: 0, dur: 0.7 });
    } else if (eligible) {
      G.rises.push({ x: t.x, y: t.y, t: Combat.D.riseDelay });
      if (!G.riseMsg) { G.riseMsg = true; msg('The dead rise! Fallen infantry return as zombies.', '#9fe07a', t.x, t.y); }
    }
    if (t.type === 'archangel' || t.type === 'demon') { // L4 big units: a horn for both sides
      sfx('horn'); msg(t.type === 'archangel' ? (t.side ? 'The enemy Archangel has fallen.' : 'The Archangel has fallen!') : (t.side ? 'The Demon Lord is slain!' : 'Our Demon Lord is slain.'), t.type === 'archangel' ? '#9FE8FF' : '#ff8a5a', t.x, t.y);
      if (t.type === 'demon' && t.side === 1 && G.ai) G.ai.demonDiedAt = G.time;
    }
  } else {
    removeBld(t);
    if (t.side === 1) st.bKills++; else st.bLost++;
    if (t.d.research) loseResearch(t.side, t.type);
    if (t.type === 'refinery' || t.type === 'depot' || t.type === 'hq') { const cap = storageCapOf(t.side); if (G.credits[t.side] > cap) { const lost = Math.floor(G.credits[t.side] - cap); G.credits[t.side] = cap; if (t.side === 0) msg(`Storage lost: ${lost} Credits destroyed.`, '#ff6a3d', t.x, t.y); } }
    for (let k = 0; k < 6; k++) G.fx.push({ k: 'boom', x: t.tx * TILE + simRand() * t.w * TILE, y: t.ty * TILE + simRand() * t.h * TILE, r: 22 + simRand() * 18, c: '#ffa040', t: -k * 0.08, dur: 0.7 });
    G.decals.push({ k: 'scorch', x: t.x, y: t.y, r: t.w * 20, t: 0 });
    G.decals.push({ k: 'ruin', x: t.tx * TILE, y: t.ty * TILE, w: t.w, h: t.h, t: 0, type: t.type, side: t.side, tx: t.tx, ty: t.ty });   // loop 4: art {id}-destroyed while it lives
    sfx('boom', t.x, t.y); shake(6);
    if (t.side === 0) msg(`${ename(t)} destroyed!`, '#ff6a3d', t.x, t.y);
    else msg(`Enemy ${ename(t)} destroyed.`, '#DDF6FF');
  }
}

// Cargo drop on truck death (Dezi option B, Loop 3): half the load drops on the nearest Salvage Field tile within 2 tiles
// that has room (cleared/empty tiles included), up to 500 on that tile; anything over the cap, or with no field tile in
// range, is lost (no spreading). Regrowth limits are untouched by a drop: see SAL.dropOnTile.
function dropCargo(t) {
  const amt = Math.floor(t.load * Combat.D.truckDropPct), cx = tileOf(t.x), cy = tileOf(t.y), R = Combat.D.truckDropSearchTiles, cap = Salvage.D.tileMax;
  if (amt <= 0) return 0;
  let bi = -1, bd = 1e9;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= MW || y >= MH) continue;
    const i = y * MW + x; if (SAL.field[i] < 0 || res[i] >= cap || bgrid[i]) continue;
    const d = dx * dx + dy * dy; if (d < bd) { bd = d; bi = i; }
  }
  if (bi < 0) return 0;
  const add = SAL.dropOnTile(bi, amt); // over the cap is lost
  if (add > 0) G.fx.push({ k: 'dust', x: (bi % MW) * TILE + 16, y: ((bi / MW) | 0) * TILE + 16, t: 0, dur: 0.6 });
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
      G.fx.push({ k: 'blood', x: o.x, y: o.y, c: o.side ? '#4a5a2a' : '#7a1010', t: 0, dur: 0.6 }); G.decals.push({ k: 'blood', x: o.x, y: o.y, c: o.side ? '#3a3a1a' : '#4a0a08', a: simRand() * 6, t: 0 });
    }
  }
}

// ---------------- salvage economy (salvage.js) ----------------
function sideCounts(side) { const c = {}; for (const b of G.blds) if (b.side === side && !b.dead) c[b.type] = (c[b.type] || 0) + 1; return c; }
function storageCapOf(side) { const c = {}; for (const b of G.blds) if (b.side === side && !b.dead && !b.setup) c[b.type] = (c[b.type] || 0) + 1; return Salvage.storageCap(c); } // a deploying yard adds no storage until online
// burn decal scale (Dezi, art/units/HANDOFF.md §9.1): 2x for units 2 or more tiles in size, else 1x. Size = the unit's art height,
// or about 3.5 r without art (Demon Lord 77 px ~ its 78 px art; Archangel 56, Templar 39) - a size test, not UDEF big
function burnScaleOf(u) {
  const f = typeof UnitArt !== 'undefined' && UnitArt.unitFrame ? UnitArt.unitFrame(u) : null, h = f ? f.rect[3] : u.r * 3.5;
  return typeof UnitArt !== 'undefined' && UnitArt.burnScale ? UnitArt.burnScale(h) : (h >= 64 ? 2 : 1);
}
function powerOf(side) { return Salvage.powerBalance(G.blds.filter(b => b.side === side && !b.dead && !b.setup).map(b => b.type)); } // a deploying yard draws no power
function makeSalvage() {
  const S = Salvage.create({
    MW, MH, TILE, res,
    units: () => G.units,
    plants: dropOffs,
    dockReady: p => !p.setup,
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
// drop-offs (opening addendum): Scrap Yards; the HQ / Hive is the temporary drop-off only while the side has no Scrap Yard
// (a Truck can still be sent to the HQ by right-click)
function dropOffs(side) {
  const yards = G.blds.filter(b => b.side === side && b.type === 'refinery' && !b.dead && !b.setup); // not a drop-off while deploying
  return yards.length ? yards : G.blds.filter(b => b.side === side && b.type === 'hq' && !b.dead);
}
const ownsNearby = (side, x, y) => G.units.some(u => u.side === side && u.d.harv && !u.dead && dist(u.x, u.y, x, y) < 6 * TILE);

// ---------------- production ----------------
const mkQ = () => ({ structure: { list: [], prog: 0, ready: null }, infantry: { list: [], prog: 0 }, vehicle: { list: [], prog: 0 }, church: { list: [], prog: 0 }, altar: { list: [], prog: 0 } });
// L4 research queues, one per research building type: G.rq[side][at] = { list, prog }; finished ids in G.research[side]
const mkRQ = () => ({ armory: { list: [], prog: 0 }, church: { list: [], prog: 0 } });
function catOf(type) { return BDEF[type] ? 'structure' : UDEF[type].cat; }
function costOf(type) { return BDEF[type] ? BDEF[type].cost : UDEF[type].cost; }
function timeOf(type) { return BDEF[type] ? BDEF[type].time : UDEF[type].time; }
function prereqOk(side, type) {
  if (BDEF[type]) return (BDEF[type].side === undefined || BDEF[type].side === side) && (BDEF[type].req || []).every(r => hasBld(side, r));
  const d = UDEF[type];
  return d.from.some(f => hasBld(side, f)) && (d.reqBld || []).every(r => hasBld(side, r)) && (d.reqRes || []).every(r => isDone(side, r));
}
function missingReq(side, type) {
  if (BDEF[type]) { const m = (BDEF[type].req || []).find(r => !hasBld(side, r)); return m ? bname(m, side) : null; }
  const d = UDEF[type];
  if (!d.from.some(f => hasBld(side, f))) return bname(d.from[d.from.length - 1], side);
  const mb = (d.reqBld || []).find(r => !hasBld(side, r)); if (mb) return bname(mb, side);
  const mr = (d.reqRes || []).find(r => !isDone(side, r)); return mr ? Combat.RESEARCH[mr].name + ' research' : null;
}
// L4 unit limits (Archangel 1, Templar 2, Demon Lord 1): alive + queued count against the limit
const inQueue = (side, type) => G.queues[side][catOf(type)].list.filter(t => t === type).length;
const atLimit = (side, type) => !!UDEF[type] && !!UDEF[type].limit && aliveOf(side, type) + inQueue(side, type) >= UDEF[type].limit;
function queueItem(side, type) {
  const q = G.queues[side][catOf(type)];
  if (!prereqOk(side, type)) { if (side === 0) msg('Requires ' + missingReq(side, type), '#ffb060'); return false; }
  if (q.ready && side === 0) { msg('Place the finished structure first.', '#ffb060'); return false; }
  if (atLimit(side, type)) { if (side === 0) { msg(`Limit reached: ${UDEF[type].limit} ${UDEF[type].name}${UDEF[type].limit > 1 ? 's' : ''} at a time.`, '#ffb060'); sfx('err'); } return false; }
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
    for (const cat of QCATS) {
      const q = Q[cat]; if (!q.list.length || q.ready) continue;
      const type = q.list[0];
      if (!prereqOk(side, type)) continue;
      if (UDEF[type] && UDEF[type].limit && aliveOf(side, type) >= UDEF[type].limit) continue; // hold at the limit (checked again at spawn)
      q.prog += dt * mult;
      if (q.prog >= timeOf(type)) {
        q.prog = 0; q.list.shift();
        if (cat === 'structure') { q.ready = type; if (side === 0) { msg(bname(type, 0) + ' ready. Click it to place.', '#7dff7d'); sfx('ready'); } }
        else {
          const from = G.blds.filter(b => b.side === side && !b.dead && UDEF[type].from.includes(b.type));
          const b = from.find(b => b.type !== 'hq') || from[0];
          const sp = spawnPoint(b); const u = makeUnit(type, side, sp.x, sp.y);
          if (side === 0) G.stats.built++;
          if (type === 'archangel') { msg(side ? 'An enemy Archangel descends.' : 'The Archangel descends.', '#DDF6FF', u.x, u.y); sfx('ready'); }
          if (type === 'demon') { msg(side ? 'A Demon Lord rises!' : 'Our Demon Lord rises.', '#ff8a5a', u.x, u.y); sfx('horn'); if (side === 0) G.lastAlert = { x: u.x, y: u.y }; }
          if (u.d.harv) u.hs = 'seek';
          else if (b.rally) issueMove([u], b.rally.x, b.rally.y, false);
          else issueMove([u], sp.x + (simRand() - 0.5) * 60, sp.y + 30 + simRand() * 30, false);
        }
      }
    }
  }
}
// ---------------- research (L4) ----------------
function researchState(side, id) {
  const R = Combat.RESEARCH[id], q = G.rq[side][R.at];
  if (isDone(side, id)) return 'done';
  if (q.list[0] === id) return 'active';
  if (q.list.includes(id)) return 'queued';
  return researchMissing(side, id) ? 'locked' : 'ready';
}
function researchMissing(side, id) {
  const R = Combat.RESEARCH[id];
  if (!hasBld(side, R.at)) return bname(R.at, side);
  const mb = (R.reqBld || []).find(b => !hasBld(side, b)); if (mb) return bname(mb, side);
  const mr = (R.reqRes || []).find(r => !isDone(side, r)); return mr ? Combat.RESEARCH[mr].name : null;
}
function queueResearch(side, id) {
  const R = Combat.RESEARCH[id]; if (!R) return false;
  const q = G.rq[side][R.at];
  if (isDone(side, id) || q.list.includes(id)) return false;
  const miss = (R.reqRes || []).filter(r => !isDone(side, r) && !q.list.includes(r)); // a queued prerequisite counts: it finishes first
  if (!hasBld(side, R.at) || (R.reqBld || []).some(b => !hasBld(side, b)) || miss.length) { if (side === 0) msg('Requires ' + (miss.length ? Combat.RESEARCH[miss[0]].name : researchMissing(side, id)), '#ffb060'); return false; }
  if (q.list.length >= 5) return false;
  if (G.credits[side] < R.cost) { if (side === 0) { msg('Insufficient Credits.', '#ff6a5a'); sfx('err'); } return false; }
  G.credits[side] -= R.cost; q.list.push(id); if (side === 0) sfx('click');
  return true;
}
function cancelResearch(side, id) {
  const R = Combat.RESEARCH[id]; if (!R) return;
  const q = G.rq[side][R.at], i = q.list.indexOf(id); if (i < 0) return;
  // cancelling a prerequisite also cancels anything queued that needs it
  const drop = [id, ...q.list.filter(x => (Combat.RESEARCH[x].reqRes || []).includes(id))];
  for (const x of drop) { const j = q.list.indexOf(x); if (j < 0) continue; q.list.splice(j, 1); if (j === 0) q.prog = 0; G.credits[side] += Combat.RESEARCH[x].cost; }
  if (side === 0) sfx('click');
}
function applyResearch(side, id) {
  G.research[side][id] = true;
  const hp = Combat.RESEARCH[id].effect.hpMult;
  if (hp) for (const u of G.units) if (u.side === side && !u.dead && hp.units.includes(u.type)) { const m = maxHpOf(u.type, side), gain = m - u.maxhp; u.maxhp = m; u.hp = Math.min(m, u.hp + gain); }
}
function updResearch(dt) {
  for (let side = 0; side < 2; side++) {
    const mult = powerOf(side).net < 0 ? SD.lowPowerMult : 1;
    for (const at in G.rq[side]) {
      const q = G.rq[side][at]; if (!q.list.length || !hasBld(side, at)) continue;
      const id = q.list[0], R = Combat.RESEARCH[id];
      if ((R.reqBld || []).some(b => !hasBld(side, b)) || (R.reqRes || []).some(r => !isDone(side, r))) continue;
      q.prog += dt * mult;
      if (q.prog >= R.time) { q.prog = 0; q.list.shift(); applyResearch(side, id); if (side === 0) { msg(R.name + ' research complete.', '#7dff7d'); sfx('ready'); } }
    }
  }
}
// last research building of a type destroyed: the item in progress is lost (no refund), queued items are refunded; finished research is kept
function loseResearch(side, at) {
  if (hasBld(side, at) || !G.rq[side][at]) return;
  const q = G.rq[side][at]; if (!q.list.length) return;
  const [cur, ...rest] = q.list; let back = 0;
  for (const id of rest) back += Combat.RESEARCH[id].cost;
  G.credits[side] += back; q.list = []; q.prog = 0;
  if (side === 0) msg(`${Combat.RESEARCH[cur].name} research lost${back ? `; ${back} Credits refunded for queued research` : ''}.`, '#ff6a3d');
}
// placement: { ok, remote, reason }. The footprint rules, then 'near own buildings' (5 tiles), then for a Scrap Yard only the remote rules.
function placeCheck(side, type, tx, ty, margin) {
  const d = BDEF[type];
  for (let y = ty - margin; y < ty + d.h + margin; y++) for (let x = tx - margin; x < tx + d.w + margin; x++) {
    const inside = x >= tx && x < tx + d.w && y >= ty && y < ty + d.h;
    if (x < 0 || y < 0 || x >= MW || y >= MH) { if (inside) return { ok: false, reason: 'Blocked' }; continue; }
    const i = y * MW + x;
    if (inside) { if (BLOCK[terr[i]] || bgrid[i] || res[i] > 0 || (SAL && SAL.field[i] >= 0) || isPad(i)) return { ok: false, reason: 'Blocked' }; }
    else if (bgrid[i]) return { ok: false, reason: 'Blocked' };
  }
  if (type === 'refinery') { const px = tx + 1, py = ty + d.h; if (px >= MW || py >= MH) return { ok: false, reason: 'Blocked' }; const pi = py * MW + px; if (BLOCK[terr[pi]] || bgrid[pi] || (SAL && SAL.field[pi] >= 0)) return { ok: false, reason: 'Blocked' }; }
  // must be near own buildings (R1: a remote yard counts unless REMOTE_EXTENDS_RADIUS is off)
  for (const b of G.blds) {
    if (b.side !== side || b.dead || (b.remote && !REMOTE_EXTENDS_RADIUS)) continue;
    const gx = Math.max(b.tx - (tx + d.w), tx - (b.tx + b.w), 0), gy = Math.max(b.ty - (ty + d.h), ty - (b.ty + b.h), 0);
    if (Math.max(gx, gy) <= 5) return { ok: true, remote: false };
  }
  if (type !== 'refinery') return { ok: false, reason: 'Too far from your base' };
  return remoteCheck(side, tx, ty);
}
function canPlace(side, type, tx, ty, margin) { return placeCheck(side, type, tx, ty, margin).ok; }
// the remote rules (spec §4), in order; the footprint rules are checked by placeCheck
function remoteCheck(side, tx, ty) {
  const d = BDEF.refinery, px = tx + 1, py = ty + d.h, tiles = [];
  for (let y = ty; y < ty + d.h; y++) for (let x = tx; x < tx + d.w; x++) tiles.push(y * MW + x);
  if (px < 0 || py < 0 || px >= MW || py >= MH) return { ok: false, reason: 'Blocked' };
  const dock = py * MW + px; tiles.push(dock);
  if (!G.half) buildHalf();
  for (const i of tiles) if (G.half[i] !== side) return { ok: false, reason: 'Enemy half' };                         // 1 own half (footprint + dock)
  for (const i of tiles) if (!G.halfIn[side][i]) return { ok: false, reason: 'Too close to the front line' };         //   and outside the strip
  if (side === 0) for (let k = 0; k < tiles.length - 1; k++) if (!expl[tiles[k]]) return { ok: false, reason: 'Unexplored' }; // 2 explored (the AI is exempt)
  const g = REMOTE_SALVAGE_GAP;                                                                                         // 3 a 1-tile gap from Salvage
  for (let y = ty - g; y < ty + d.h + g; y++) for (let x = tx - g; x < tx + d.w + g; x++) {
    if (x < 0 || y < 0 || x >= MW || y >= MH) continue;
    const i = y * MW + x; if (res[i] > 0 || (SAL && SAL.field[i] >= 0)) return { ok: false, reason: 'Too close to Salvage' };
  }
  const gap = (x0, y0, w0, h0) => Math.max(Math.max(x0 - (tx + d.w), tx - (x0 + w0), 0), Math.max(y0 - (ty + d.h), ty - (y0 + h0), 0));
  for (const u of G.units) {                                                                                            // 4 no enemy unit within 6 (that you can see)
    if (u.dead || u.side === side) continue;
    const ux = tileOf(u.x), uy = tileOf(u.y);
    if (side === 0 && !vis[uy * MW + ux]) continue;
    if (gap(ux, uy, 1, 1) <= REMOTE_ENEMY_UNIT) return { ok: false, reason: 'Enemies nearby' };
  }
  for (const b of G.blds) {                                                                                             //   and no enemy building within 10 (that you know of)
    if (b.dead || b.side === side || (side === 0 && !isVisible(b))) continue;
    if (gap(b.tx, b.ty, b.w, b.h) <= REMOTE_ENEMY_BLD) return { ok: false, reason: 'Enemies nearby' };
  }
  if (!(reachOf(side)[dock] >= 0)) return { ok: false, reason: 'No path' };                                            // 5 ground path HQ -> dock
  return { ok: true, remote: true };
}
// map halves (spec §3): a tile belongs to the side whose HQ start centre (start tile + 1.5) is strictly closer; ties are neutral (-1).
// halfIn[side][i]: own half and no tile of another half within REMOTE_STRIP (Chebyshev), i.e. outside the strip along the line.
function buildHalf() {
  const P = G.baseP, E = G.baseE, half = new Int8Array(N);
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    const dp = (x - P.x) * (x - P.x) + (y - P.y) * (y - P.y), de = (x - E.x) * (x - E.x) + (y - E.y) * (y - E.y); // centres are base + 0.5, tiles x + 0.5: the halves cancel
    half[y * MW + x] = dp < de ? 0 : de < dp ? 1 : -1;
  }
  const halfIn = [new Uint8Array(N), new Uint8Array(N)], R = REMOTE_STRIP;
  for (const side of [0, 1]) {
    const inn = halfIn[side];
    for (let i = 0; i < N; i++) inn[i] = half[i] === side ? 1 : 0;
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
      if (half[y * MW + x] === side) continue;
      for (let yy = Math.max(0, y - R); yy <= Math.min(MH - 1, y + R); yy++) for (let xx = Math.max(0, x - R); xx <= Math.min(MW - 1, x + R); xx++) inn[yy * MW + xx] = 0;
    }
  }
  G.half = half; G.halfIn = halfIn; G.reach = [null, null];
}
// ground reach from a side's HQ (4-connected BFS over walkable tiles; -1 = unreachable). Cached per sim time; also the AI's path distance
function reachOf(side) {
  const c = G.reach && G.reach[side];
  if (c && c.t === G.time && c.n === G.blds.length) return c.dist;
  const dist = new Int32Array(N).fill(-1), qu = new Int32Array(N); let qh = 0, qt = 0;
  const hq = G.blds.find(b => b.side === side && b.type === 'hq' && !b.dead) || G.blds.find(b => b.side === side && !b.dead);
  if (hq) for (let y = hq.ty - 1; y <= hq.ty + hq.h; y++) for (let x = hq.tx - 1; x <= hq.tx + hq.w; x++) {
    if (x < 0 || y < 0 || x >= MW || y >= MH) continue;
    const i = y * MW + x; if (dist[i] < 0 && walk(x, y)) { dist[i] = 0; qu[qt++] = i; }
  }
  while (qh < qt) {
    const i = qu[qh++], x = i % MW, y = (i / MW) | 0, dd = dist[i] + 1;
    if (x > 0 && dist[i - 1] < 0 && walk(x - 1, y)) { dist[i - 1] = dd; qu[qt++] = i - 1; }
    if (x < MW - 1 && dist[i + 1] < 0 && walk(x + 1, y)) { dist[i + 1] = dd; qu[qt++] = i + 1; }
    if (y > 0 && dist[i - MW] < 0 && walk(x, y - 1)) { dist[i - MW] = dd; qu[qt++] = i - MW; }
    if (y < MH - 1 && dist[i + MW] < 0 && walk(x, y + 1)) { dist[i + MW] = dd; qu[qt++] = i + MW; }
  }
  if (!G.reach) G.reach = [null, null];
  G.reach[side] = { t: G.time, n: G.blds.length, dist };
  return dist;
}
const isPad = i => G.blds.some(b => (b.type === 'refinery' || b.type === 'hq') && !b.dead && b.pad === i);
function placeBld(side, type, tx, ty) {
  const q = G.queues[side].structure; if (q.ready !== type) return false;
  const pc = placeCheck(side, type, tx, ty, 0); if (!pc.ok) return false;
  q.ready = null; const b = makeBld(type, side, tx, ty);
  if (side === 0) { sfx('place'); G.stats.bBuilt++; }
  if (pc.remote) {
    b.remote = true;
    if (REMOTE_SETUP_S > 0) { b.setup = true; b.setupT0 = G.time; b.hp = b.maxhp * REMOTE_SETUP_HP0; } // R2 deploy
    if (side === 0) { msg(REMOTE_SETUP_S > 0 ? 'Scrap Yard deploying.' : 'Scrap Yard online.', '#DDF6FF', b.x, b.y); ping(b.x, b.y, '#6FA8FF'); }
  }
  return b;
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
    const demons = G.units.filter(d => d.type === 'demon' && !d.dead), arch = G.units.filter(a => a.type === 'archangel' && !a.dead);
    for (const u of G.units) {
      if (u.dead) continue;
      const i = tileOf(u.y) * MW + tileOf(u.x);
      if (!u.d.fly && !u.d.plagueImmune && inPlague(u, i, demons) && !holyGround(u.x, u.y)) {
        if (u.side === 0) { damage(u, -Combat.plagueTick(0, u.d.armor, 0.5), null, 'plague'); if (!G.plagueMsg) { G.plagueMsg = true; msg('Plague zone! It eats our ground units and heals the Horde.', '#9fe07a', u.x, u.y); } }
        else { if (u.hp < u.maxhp && simRand() < 0.5) G.fx.push({ k: 'mote', x: u.x, y: u.y, t: 0, dur: 0.9, a: simRand() * 6.28 }); u.hp = Math.min(u.maxhp, u.hp + Combat.plagueTick(1, u.d.armor, 0.5)); }
      }
      for (const r of G.rad) if (dist(u.x, u.y, r.x, r.y) < r.r) damage(u, 8 * (r.t / r.max) + 2, null, 'plague');
    }
    // Archangel aura (L4): allies within 4 tiles (not itself) heal 5 HP/s
    for (const a of arch) for (const u of G.units) if (!u.dead && u !== a && u.side === a.side && u.hp < u.maxhp && dist(u.x, u.y, a.x, a.y) <= Combat.D.archangelHealTiles * TILE) {
      u.hp = Math.min(u.maxhp, u.hp + Combat.D.archangelHealDps * 0.5); if (simRand() < 0.3) G.fx.push({ k: 'mote', x: u.x, y: u.y, t: 0, dur: 0.9, a: simRand() * 6.28, c: '#DDF6FF' });
    }
  }
  for (const r of G.rad) r.t -= dt;
  G.rad = G.rad.filter(r => r.t > 0);
  for (const r of G.rises) { r.t -= dt; if (r.t <= 0) { r.done = true; const z = makeUnit('zombie', 1, r.x, r.y); z.order = 'idle'; z.risen = true; G.stats.risen = (G.stats.risen || 0) + 1; G.fx.push({ k: 'rise', x: r.x, y: r.y, t: 0, dur: 0.8 }); sfx('rise', r.x, r.y); } }
  G.rises = G.rises.filter(r => !r.done);
}
// plague (L4): a static plague tile, or within 3 tiles of a living Demon Lord (its moving plague aura; it acts like a plague tile, but the Demon Lord does not heal from its own aura)
function inPlague(u, i, demons) {
  if (plague[i]) return true;
  const tx = tileOf(u.x), ty = tileOf(u.y), R = Combat.D.demonAuraTiles;
  for (const d of demons || G.units.filter(d => d.type === 'demon' && !d.dead)) if (d !== u && Math.hypot(tileOf(d.x) - tx, tileOf(d.y) - ty) <= R) return true;
  return false;
}
// Holy Ground (L4): within 7 tiles of a Survivor Church once researched, plague neither hurts Survivors nor heals the Horde
function holyGround(x, y) {
  if (!isDone(0, 'holyground')) return false;
  const R = Combat.D.holyGroundTiles * TILE;
  return G.blds.some(b => b.side === 0 && b.type === 'church' && !b.dead && dist(b.x, b.y, x, y) <= R);
}
function updBld(b, dt) {
  b.anim += dt; b.hitT -= dt;
  if (b.setup) { // R2: a remote yard deploys, HP grows linearly to full; no power, no drop-off until online
    b.hp = Math.min(b.maxhp, b.hp + b.maxhp * (1 - REMOTE_SETUP_HP0) / REMOTE_SETUP_S * dt);
    if (G.time - b.setupT0 >= REMOTE_SETUP_S - 1e-9) { b.setup = false; if (b.side === 0) { msg('Scrap Yard online.', '#DDF6FF', b.x, b.y); ping(b.x, b.y, '#6FA8FF'); sfx('ready'); } }
  }
  if (b.type === 'silo' && b.charge < NUKE_CHARGE) { b.charge += dt; if (b.charge >= NUKE_CHARGE && b.side === 0) { msg('Nuke Silo charged! Press N or click LAUNCH.', '#fff3b0'); sfx('ready'); } }
  if (b.type === 'turret' || b.type === 'hq') { // the HQ turret needs no power
    b.cd -= dt;
    const rr = rangeOf(b) * TILE;
    if (!b.target || b.target.dead || edgeDist(b.x, b.y, b.target) > rr) { b.target = null; b.scanT = (b.scanT || 0) - dt; if (b.scanT <= 0) { b.scanT = 0.3; b.target = findEnemy(b, rr, b.side); } }
    if (b.target) { b.tang = Math.atan2(b.target.y - b.y, b.target.x - b.x); if (b.cd <= 0) { fire(b, b.target); b.cd = b.d.rof; } }
  }
  if (b.hp < b.maxhp * 0.5) { b.smokeT -= dt; if (b.smokeT <= 0) { b.smokeT = 0.25; G.fx.push({ k: 'smoke', x: b.x + (simRand() - 0.5) * b.w * 20, y: b.y + (simRand() - 0.5) * b.h * 20, t: 0, dur: 2 }); } }
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
// opening addendum: the Hive first trains a Scrap Eater (updAI), then Power Plant, Grinder Pit, Spawning Pit, then the rest.
// Loop 4: the Dark Altar after the first Factory, held until DIFF.altarTime unless the player has built a Church
// Remote yards (spec §7): the 2nd Grinder Pit comes right after the Factory and goes remote (aiFindSpot); the later 2nd 'refinery' slot is gone
const AI_ORDER = ['power', 'refinery', 'barracks', 'turret', 'factory', 'refinery', 'altar', 'turret', 'barracks', 'depot', 'power', 'silo', 'turret', 'turret', 'turret'];
const aiPitCap = () => AI_PIT_CAP[G.diffKey] || AI_PIT_CAP.normal;
const aiRemoteAllowed = () => G.diffKey !== 'easy' || G.time >= AI_REMOTE_EASY_FROM;
function aiNextBuild() {
  const cnt = {}; for (const b of G.blds) if (b.side === 1 && !b.dead && !b.spire) cnt[b.type] = (cnt[b.type] || 0) + 1; // a Hard Bone Spire is extra
  const q = G.queues[1].structure; for (const t of q.list) cnt[t] = (cnt[t] || 0) + 1; if (q.ready) cnt[q.ready] = (cnt[q.ready] || 0) + 1;
  // re-expand (spec §7): the fields the pits serve are below 25%, under the cap and a field qualifies (checked every 5 s)
  const A = G.ai, pits = cnt.refinery || 0;
  if (pits >= 2 && pits < aiPitCap() && aiRemoteAllowed() && G.time >= (A.reexpT || 0)) {
    A.reexpT = G.time + 5;
    if (aiServedLow() && aiRemoteSpot()) return aiPowerAfter(cnt, 'refinery') < 0 ? 'power' : 'refinery';
  }
  const need = {};
  for (const t of AI_ORDER) {
    need[t] = (need[t] || 0) + 1;
    if (t === 'refinery' && (cnt[t] || 0) >= aiPitCap()) continue;
    if ((cnt[t] || 0) < need[t]) { if (t === 'silo' && G.time < G.diff.siloTime) continue; if (t === 'altar' && G.time < G.diff.altarTime && !G.ai.churchSeen) continue; if (t !== 'power' && aiPowerAfter(cnt, t) < 0) return 'power'; return t; }
  }
  return null;
}
function aiPowerAfter(cnt, t) { const list = [t]; for (const k in cnt) for (let i = 0; i < cnt[k]; i++) list.push(k); return Salvage.powerBalance(list).net; }
// fields (spec §7): start = the map's original Salvage, rem = what is left
function aiFields() {
  const out = [];
  if (!SAL || !SAL.fields) return out;
  for (const f of SAL.fields) {
    let start = 0, rem = 0, own = false;
    for (const i of f.tiles) { start += SAL.orig[i]; rem += res[i]; if (G.half && G.half[i] === 1) own = true; }
    out.push({ f, start, rem, own });
  }
  return out;
}
const tileGap = (i, x0, y0, w, h) => { const x = i % MW, y = (i / MW) | 0; return Math.max(Math.max(x0 - x, x - (x0 + w - 1), 0), Math.max(y0 - y, y - (y0 + h - 1), 0)); };
const fieldGap = (f, x0, y0, w, h) => { let m = 1e9; for (const i of f.tiles) { const g = tileGap(i, x0, y0, w, h); if (g < m) m = g; } return m; };
// every field served by a Horde pit (within 8 tiles) is below 25% of its start (or none is served)
function aiServedLow() {
  const pits = G.blds.filter(b => b.side === 1 && b.type === 'refinery' && !b.dead);
  for (const F of aiFields()) if (F.start > 0 && pits.some(b => fieldGap(F.f, b.tx, b.ty, b.w, b.h) <= AI_FIELD_SERVED) && F.rem >= AI_FIELD_LIVE * F.start) return false;
  return true;
}
// the best remote Grinder Pit spot: score fields on the Horde half (no Horde drop-off within 8, > 25% left, no player unit within 8
// or building within 10) by remaining / path distance from the Hive; the closest valid spot with the dock toward the field
function aiRemoteSpot() {
  const reach = reachOf(1), drops = G.blds.filter(b => b.side === 1 && !b.dead && (b.type === 'refinery' || b.type === 'hq'));
  const pu = G.units.filter(u => u.side === 0 && !u.dead), pb = G.blds.filter(b => b.side === 0 && !b.dead);
  const scored = [];
  for (const F of aiFields()) {
    const f = F.f;
    if (!F.own || F.start <= 0 || F.rem <= AI_FIELD_LIVE * F.start) continue;
    if (drops.some(b => fieldGap(f, b.tx, b.ty, b.w, b.h) <= AI_FIELD_SERVED)) continue;
    if (pu.some(u => fieldGap(f, tileOf(u.x), tileOf(u.y), 1, 1) <= AI_FIELD_PLAYER_UNIT)) continue;
    if (pb.some(b => fieldGap(f, b.tx, b.ty, b.w, b.h) <= AI_FIELD_PLAYER_BLD)) continue;
    let d = 1e9; for (const i of f.tiles) if (reach[i] >= 0 && reach[i] < d) d = reach[i];
    if (d >= 1e9) continue;
    scored.push({ f, score: F.rem / Math.max(1, d) });
  }
  scored.sort((a, b) => b.score - a.score);
  const D = BDEF.refinery;
  for (const { f } of scored) {
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (const i of f.tiles) { const x = i % MW, y = (i / MW) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    let best = null, bk = 1e9;
    for (let ty = y0 - D.h - 3; ty <= y1 + 3; ty++) for (let tx = x0 - D.w - 3; tx <= x1 + 3; tx++) {
      if (!canPlace(1, 'refinery', tx, ty, 1)) continue;
      const dd = fieldGap(f, tx + 1, ty + D.h, 1, 1), dc = fieldGap(f, tx + 1, ty + 1, 1, 1), k = dd * 10 - (dc - dd); // dock nearest the field, facing it
      if (k < bk) { bk = k; best = [tx, ty]; }
    }
    if (best) return best;
  }
  return null;
}
// Hard: the Bone Spire beside a remote pit
function aiSpotNear(b, type) {
  const d = BDEF[type], cx = b.tx + (b.w >> 1), cy = b.ty + (b.h >> 1);
  for (let r = 2; r < 7; r++) {
    const cand = [];
    for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) { if (Math.abs(xx) !== r && Math.abs(yy) !== r) continue; const tx = cx + xx - (d.w >> 1), ty = cy + yy - (d.h >> 1); if (canPlace(1, type, tx, ty, 1)) cand.push([tx, ty]); }
    if (cand.length) return cand[ri(cand.length)];
  }
  return null;
}
function aiFindSpot(type) {
  if (type === 'refinery' && countBld(1, 'refinery') >= 1 && aiRemoteAllowed()) { const sp = aiRemoteSpot(); if (sp) return sp; } // else today's spot near the Hive
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
// L4: the player's most valuable unit group (unit cost summed within 6 tiles); returns its centroid, or null
function valuableGroup() {
  const P = G.units.filter(u => u.side === 0 && !u.dead && !u.d.harv);
  let best = null, bv = 0;
  for (const u of P) { let v = 0, x = 0, y = 0; for (const o of P) if (dist(u.x, u.y, o.x, o.y) <= 6 * TILE) { const c = o.d.cost || 0; v += c; x += o.x * c; y += o.y * c; } if (v > bv) { bv = v; best = { x: x / v, y: y / v, value: v }; } }
  return best;
}
// addendum 1d §8 ruling 4: AI rush response (off on Easy). 3+ enemy combat units within 8 tiles of the Hive before 6:00 -> pause the
// build order, fill the infantry queue with Zombies until the army is 1.5x the attackers (most seen at once), and hold waves (a held
// wave launches on the AI tick the response ends). Ends once no enemy unit has been within 10 tiles for 15 s.
// 1d §9 ruling 1: the Eater pull is removed (the home pit sits within 4 tiles of the Hive, so it cut the income the defence needs).
// (Enemy harvesters don't count. The Horde has one shared infantry queue, so every Spawning Pit feeds the same queue.)
const AI_RUSH_DEFENSE = true;
// 1d §9 ruling 3: earliest time (s) of the AI's FIRST Hell Silo launch, per difficulty (null = no floor). The Silo is still built and
// charged on its own schedule and holds while charged; later launches are not floored.
const AI_FIRST_NUKE_MIN = { easy: 900, normal: 780, hard: null };
const RUSH = { trigTiles: 8, trigCount: 3, before: 360, ratio: 1.5, clearTiles: 10, clearS: 15 };
function aiRushCheck() {
  const A = G.ai, hive = G.blds.find(b => b.side === 1 && b.type === 'hq' && !b.dead); if (!hive) return null;
  const within = r => G.units.filter(u => u.side === 0 && !u.dead && !u.d.harv && dist(u.x, u.y, hive.x, hive.y) <= r * TILE);
  const att = within(RUSH.trigTiles);
  if (!A.rush) {
    if (G.time >= RUSH.before || att.length < RUSH.trigCount) return null;
    A.rush = { t0: G.time, n: att.length, seen: G.time };
    (A.rushLog || (A.rushLog = [])).push({ t0: G.time, n: att.length, t1: null });
  }
  const R = A.rush; R.n = Math.max(R.n, att.length);
  const near = within(RUSH.clearTiles); if (near.length) R.seen = G.time;
  const log = A.rushLog[A.rushLog.length - 1]; log.n = R.n;
  if (G.time - R.seen >= RUSH.clearS) { log.t1 = G.time; A.rush = null; return null; } // all clear
  return R;
}
function updAI(dt) {
  const A = G.ai; A.t -= dt; if (A.t > 0) return; A.t = 0.5;
  const side = 1, Q = G.queues[1], cr = () => G.credits[1];
  if (!G.blds.some(b => b.side === 1 && !b.dead)) return;
  if (hasBld(0, 'church')) A.churchSeen = true; // L4: sticky, the Altar may come early
  // opening addendum: the first Scrap Eater comes from the Hive before anything else
  const harv = G.units.filter(u => u.side === 1 && u.d.harv && !u.dead).length + Q.vehicle.list.filter(t => t === 'reaper').length;
  if (harv === 0 && Q.vehicle.list.length === 0 && cr() >= costOf('reaper') && prereqOk(1, 'reaper')) queueItem(1, 'reaper');
  const firstEater = harv === 0 ? costOf('reaper') : 0;
  const rush = AI_RUSH_DEFENSE && G.diffKey !== 'easy' ? aiRushCheck() : null;
  // structures
  const next = aiNextBuild();
  // harvesters: hold back the cost of the 2nd Scrap Eater (2 by 3:00; the Grinder Pit's free one counts) before spending on anything else
  const eaterReserve = firstEater || (harv < 2 && next !== 'refinery' ? SD.aiGorgerReserve : 0);
  const econBuild = next === 'power' || next === 'refinery';
  // L4 Demon Lord: once the Dark Altar stands, save 2,500 while none is alive or queued
  const demonUp = aliveOf(1, 'demon') + inQueue(1, 'demon') > 0, demonWait = A.demonDiedAt !== undefined && G.time - A.demonDiedAt < Combat.D.demonRebuildS;
  const demonReserve = hasBld(1, 'altar') && !demonUp ? costOf('demon') : 0;
  if (hasBld(1, 'altar') && !demonUp && !demonWait && cr() >= costOf('demon')) queueItem(1, 'demon');
  if (A.spireFor && A.spireFor.dead) A.spireFor = null;
  if (Q.structure.ready) {
    const t = Q.structure.ready, spire = t === 'turret' && A.spireFor;
    const spot = (spire && aiSpotNear(A.spireFor, t)) || aiFindSpot(t);
    if (spot) {
      const b = placeBld(1, t, spot[0], spot[1]);
      if (b && spire) { b.spire = true; A.spireFor = null; }
      if (b && t === 'refinery') (A.pitLog || (A.pitLog = [])).push({ t: G.time, tx: b.tx, ty: b.ty, remote: !!b.remote });
      if (b && b.remote && t === 'refinery') { if (A.remote2At === undefined) { A.remote2At = G.time; A.remote2 = { tx: b.tx, ty: b.ty }; } if (G.diffKey === 'hard') A.spireFor = b; }
    } else cancelItem(1, t);
  } else if (rush) { /* rush response: build order paused */ }
  else if (A.spireFor && !Q.structure.list.length && prereqOk(1, 'turret') && cr() >= BDEF.turret.cost) queueItem(1, 'turret');
  else if (next && !Q.structure.list.length && prereqOk(1, next) && cr() - (econBuild ? firstEater : eaterReserve + demonReserve) >= BDEF[next].cost) queueItem(1, next);
  const reserve = (next && !Q.structure.list.length && !Q.structure.ready ? BDEF[next].cost : 0) + eaterReserve + demonReserve;
  const want = Math.min(5, Math.max(1, countBld(1, 'refinery')) * 2);
  if (!rush && hasBld(1, 'refinery') && harv < want && Q.vehicle.list.length === 0 && cr() >= costOf('reaper') && prereqOk(1, 'reaper')) { if (queueItem(1, 'reaper') && harv === 1) G.ai.eater2At = G.time; }
  // army (capped so waves stay beatable; the cap grows with every wave)
  const armyN = G.units.filter(u => u.side === 1 && !u.d.harv && !u.dead).length;
  const cap = Math.min(45, Math.round((10 + 5 * A.waveN) * G.diff.inc) + (G.credits[1] > 3000 ? 8 : 0));
  if (rush) { // rush response: Zombies until the army is 1.5x the attackers (no cap, no reserves)
    const goal = Math.ceil(RUSH.ratio * rush.n);
    let have = armyN + Q.infantry.list.length;
    while (have < goal && hasBld(1, 'barracks') && cr() >= UDEF.zombie.cost && queueItem(1, 'zombie')) have++;
  } else if (armyN < cap && hasBld(1, 'barracks') && Q.infantry.list.length < 2) {
    let t = rng() < (G.time > 240 ? 0.4 : 0.25) ? 'imp' : 'zombie';
    if (A.waveN === 0 && G.diff.wave1) { // build the fixed wave-1 group first (addendum)
      const short = Object.keys(G.diff.wave1).find(k => aliveOf(1, k) + inQueue(1, k) < G.diff.wave1[k]); if (short) t = short;
    }
    if (cr() - UDEF[t].cost >= reserve) queueItem(1, t);
  }
  if (!rush && armyN < cap && hasBld(1, 'factory') && Q.vehicle.list.length === 0 && harv >= want && cr() - 900 >= reserve) queueItem(1, 'brute');
  // superweapon
  const silo = readySilo(1), nukeMin = AI_FIRST_NUKE_MIN[G.diffKey];
  if (silo && silo.chargedAt === undefined) silo.chargedAt = G.time;
  if (silo && (A.nukeN || nukeMin === null || nukeMin === undefined || G.time >= nukeMin)) {
    let best = null, bs = -1;
    for (const b of G.blds) if (b.side === 0 && !b.dead) { let s = 0; for (const o of G.blds) if (o.side === 0 && !o.dead && dist(o.x, o.y, b.x, b.y) < NUKE_R * TILE * 1.3) s += o.d.hp; if (s > bs) { bs = s; best = b; } }
    if (best && launchNuke(1, best.x + (rng() - 0.5) * 40, best.y + (rng() - 0.5) * 40)) { A.nukeN = (A.nukeN || 0) + 1; (A.nukeLog || (A.nukeLog = [])).push(G.time); }
  }
  // waves
  const army = aiArmy();
  const idle = army.filter(u => !u.target && u.order !== 'attackmove' && u.order !== 'attack');
  const hq = G.blds.find(b => b.side === 1 && b.type === 'hq' && !b.dead) || G.blds.find(b => b.side === 1 && !b.dead);
  if (G.time >= A.nextWave && !rush) { // waves hold while the rush response is on
    const w1 = A.waveN === 0 && G.diff.wave1;
    const need = w1 ? Object.values(w1).reduce((a, b) => a + b, 0) : Math.min(26, G.diff.minWave + A.waveN * 2);
    let send = null;
    if (w1) { // wave 1 override: exactly the listed group
      const pick = []; for (const k in w1) pick.push(...idle.filter(u => u.type === k).slice(0, w1[k]));
      if (pick.length >= need) send = pick;
    } else if (idle.length >= need) { const keep = idle.length > 10 ? 3 : 0; send = idle.slice(keep, keep + need + 4); }
    // L4: the Demon Lord leads the next wave (even while busy defending)
    const dl = G.units.find(u => u.side === 1 && u.type === 'demon' && !u.dead);
    if (send && dl && !send.includes(dl)) send.unshift(dl);
    if (send) {
      // L4 wave bonus while the player has a Church: 2 free Imps, plus 1 free Hellbrute until the Dark Altar exists
      if (hasBld(0, 'church') && hq) {
        const bonus = []; for (let k = 0; k < Combat.D.waveBonusImps; k++) bonus.push('imp');
        if (!hasBld(1, 'altar')) for (let k = 0; k < Combat.D.waveBonusBrutes; k++) bonus.push('brute');
        for (const t of bonus) { const sp = spawnPoint(hq); send.push(makeUnit(t, 1, sp.x + (rng() - 0.5) * 40, sp.y + (rng() - 0.5) * 40)); }
        G.stats.waveBonus = (G.stats.waveBonus || 0) + bonus.length;
      }
      let cx = 0, cy = 0; for (const u of send) { cx += u.x; cy += u.y; } cx /= send.length; cy /= send.length;
      const grp = dl ? valuableGroup() : null;
      const tgt = grp || nearestPlayerTarget(cx, cy);
      if (tgt) { issueMove(send, tgt.x, tgt.y, true); A.waveN++; if (A.waveN === 1) A.wave1At = G.time; (A.waveLog || (A.waveLog = [])).push({ t: G.time, n: send.length }); msg(A.waveN === 1 ? 'Scouts report: a Horde wave is marching on our base!' : `Horde wave ${A.waveN} incoming!`, '#ff6a3d'); sfx('alert'); }
      A.nextWave = G.time + G.diff.waveGap;
    } else A.nextWave = G.time + 10;
  }
  // L4 Demon Lord: goes after a player Archangel in sight first
  for (const dl of G.units) if (dl.side === 1 && dl.type === 'demon' && !dl.dead) {
    const arc = G.units.find(u => u.side === 0 && u.type === 'archangel' && !u.dead && dist(u.x, u.y, dl.x, dl.y) <= dl.d.sight * TILE);
    if (arc && dl.target !== arc) orderAttack([dl], arc);
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
  // unit art v2 (unitart.js): atlas sprite if loaded and the frame exists, else the procedural sprite below
  if (typeof UnitArt !== 'undefined' && (u.side === 0 || u.side === 1)) {
    const lift = t === 'seraph' ? 9 + Math.sin(A * 3) * 2 : t === 'imp' ? 4 + Math.sin(A * 6) * 1.5 : 0;
    const bob = u.moving && !u.d.fly && t !== 'imp' && !u.d.harv && t !== 'ark' ? -Math.round(Math.abs(Math.sin(A * 10))) : 0;
    c.save(); if (u.hitT > 0) c.globalAlpha = 0.75;
    const ok = UnitArt.draw(c, u, { lift, bob });
    c.restore(); if (ok) return;
  }
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
  } else drawUnitL4(c, u, t, A);
  c.restore();
}
// Loop 4 procedural sprites (no unit art yet; team colour kept on every one: Survivor blue #3A7BFF, Horde red)
function drawUnitL4(c, u, t, A) {
  const team = u.side ? '#d0342a' : '#3A7BFF';
  if (t === 'flamer' || t === 'rocket' || t === 'medic') {
    c.fillStyle = 'rgba(0,0,0,0.35)'; ell(c, 1, 4, 7, 3.5);
    c.rotate(u.ang); const bob = u.moving ? Math.sin(A * 12) * 2 : 0;
    c.fillStyle = '#2e281e'; c.fillRect(-3 + bob, -5, 4, 3); c.fillRect(-3 - bob, 2, 4, 3);
    if (t === 'flamer') { // fuel tank on the back, stubby nozzle
      c.fillStyle = '#8a3a1a'; c.fillRect(-8, -4, 4, 8); c.fillStyle = '#c2622d'; c.fillRect(-8, -4, 4, 2);
      c.fillStyle = '#6e5a3c'; circ(c, 0, 0, 5.5); c.fillStyle = team; c.fillRect(-1.5, -5.5, 2, 11);
      c.strokeStyle = '#2a2a2a'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(2, 2.5); c.lineTo(9, 2.5); c.stroke();
      c.fillStyle = `rgba(255,${140 + 60 * Math.sin(A * 20)},40,0.9)`; circ(c, 10, 2.5, 1.5);
      c.fillStyle = '#c8b090'; circ(c, 1, 0, 3); c.fillStyle = '#333'; c.fillRect(2, -1.5, 2, 3); // mask
    } else if (t === 'rocket') { // shoulder tube
      c.fillStyle = '#5E6B34'; circ(c, 0, 0, 5.5); c.fillStyle = team; c.fillRect(-1.5, -5.5, 2, 11);
      c.fillStyle = '#3a4220'; c.fillRect(-6, -5, 16, 3.5); c.fillStyle = '#222'; c.fillRect(9, -5.2, 2, 4);
      c.fillStyle = '#d9b38c'; circ(c, 1, 0, 3);
    } else { // Medic: white with a red cross
      c.fillStyle = '#e8e8e2'; circ(c, 0, 0, 5.5); c.fillStyle = team; c.fillRect(-5.5, -1, 2, 2);
      c.fillStyle = '#d02020'; c.fillRect(-3, -1, 6, 2); c.fillRect(-1, -3, 2, 6);
      c.fillStyle = '#f4f0e8'; circ(c, 2.5, 0, 2.6);
      if (u.healing) { c.globalAlpha = 0.5 + 0.3 * Math.sin(A * 10); c.fillStyle = '#7dff9a'; circ(c, 6, 0, 2); c.globalAlpha = 1; }
    }
  } else if (t === 'archangel') { // ~1.5x the Angel: big wings, halo, soft aura ring
    const h = 12 + Math.sin(A * 2.5) * 2.5;
    c.fillStyle = 'rgba(0,0,0,0.28)'; ell(c, 0, 8, 15, 6);
    c.translate(0, -h);
    const g = c.createRadialGradient(0, 0, 0, 0, 0, 32); g.addColorStop(0, 'rgba(221,246,255,0.5)'); g.addColorStop(1, 'rgba(159,232,255,0)'); c.fillStyle = g; circ(c, 0, 0, 32);
    const f = Math.sin(A * 6) * 0.3;
    for (const s of [-1, 1]) {
      c.save(); c.scale(s * 1.5, 1.5); c.rotate(-f);
      c.fillStyle = 'rgba(240,244,250,0.95)'; c.beginPath(); c.moveTo(2, -1); c.quadraticCurveTo(12, -15, 21, -9); c.quadraticCurveTo(15, -5, 18, 0); c.quadraticCurveTo(11, 0, 13, 4); c.quadraticCurveTo(6, 3, 2, 3); c.fill();
      c.strokeStyle = team; c.lineWidth = 0.7; c.stroke(); c.restore();
    }
    c.fillStyle = '#E8E2D0'; c.beginPath(); c.moveTo(-6, -3); c.lineTo(6, -3); c.lineTo(7, 11); c.lineTo(-7, 11); c.fill();
    c.fillStyle = team; c.fillRect(-6, 2, 12, 3);
    c.fillStyle = '#f0d8a0'; circ(c, 0, -6, 4);
    c.strokeStyle = '#FFE9A0'; c.lineWidth = 2; c.beginPath(); c.ellipse(0, -13, 6, 2, 0, 0, 7); c.stroke();
    c.strokeStyle = '#DDF6FF'; c.lineWidth = 2; c.beginPath(); c.moveTo(8, -4); c.lineTo(8, 14); c.stroke();
  } else if (t === 'templar') { // big knight on foot: plate, tabard cross, sword
    c.fillStyle = 'rgba(0,0,0,0.4)'; ell(c, 1, 5, 11, 5);
    c.rotate(u.ang); const bob = u.moving ? Math.sin(A * 8) * 2.5 : 0;
    c.fillStyle = '#3a3a3a'; c.fillRect(-4 + bob, -8, 6, 4); c.fillRect(-4 - bob, 4, 6, 4);
    c.fillStyle = '#B8B2A2'; circ(c, 0, 0, 8.5);
    c.fillStyle = '#f2efe6'; c.fillRect(-5, -6, 9, 12); c.fillStyle = team; c.fillRect(-1.5, -6, 3, 12); c.fillRect(-5, -1.5, 9, 3);
    c.fillStyle = '#8E959C'; circ(c, 2, 0, 4); c.fillStyle = '#222'; c.fillRect(4, -1, 2, 2);
    const sw = u.cd > u.d.rof - 0.25 ? 0.9 : 0;
    c.save(); c.translate(3, 7); c.rotate(-0.4 + sw); c.fillStyle = '#DDE3E8'; c.fillRect(0, -1.2, 15, 2.4); c.fillStyle = '#FFE9A0'; c.fillRect(-1, -3, 2, 6); c.restore();
  } else if (t === 'demon') { // horned giant, ~2x a Hellbrute
    c.fillStyle = 'rgba(0,0,0,0.45)'; ell(c, 3, 10, 28, 13);
    c.rotate(u.ang); const sw = u.moving ? Math.sin(A * 3.5) * 5 : 0;
    c.fillStyle = '#2a0606'; circ(c, 10 + sw, -22, 9); circ(c, 10 - sw, 22, 9);
    c.fillStyle = '#4a0e0a'; ell(c, -2, 0, 20, 26);
    c.fillStyle = '#6b1a12'; ell(c, 0, 0, 16, 21);
    c.strokeStyle = '#ff7a20'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(-10, -14); c.lineTo(-3, -4); c.lineTo(-12, 6); c.moveTo(2, 10); c.lineTo(-6, 18); c.moveTo(-4, -18); c.lineTo(4, -10); c.stroke();
    c.fillStyle = '#8a2418'; circ(c, 11, 0, 10);
    c.fillStyle = '#e8dcc0'; c.beginPath(); c.moveTo(9, -8); c.quadraticCurveTo(2, -26, 18, -26); c.lineTo(13, -8); c.moveTo(9, 8); c.quadraticCurveTo(2, 26, 18, 26); c.lineTo(13, 8); c.fill();
    c.fillStyle = team; c.fillRect(-14, -3, 6, 6);
    c.fillStyle = '#ffd040'; c.fillRect(17, -5, 3, 3); c.fillRect(17, 2, 3, 3);
    c.fillStyle = `rgba(255,${120 + 80 * Math.sin(A * 6)},20,0.9)`; circ(c, 21, 0, 2.5 + Math.sin(A * 9));
  } else { c.fillStyle = team; circ(c, 0, 0, u.r); }
}
// building art options for this frame: build progress (visual reveal), remote setup progress + o.setup (deploy frames, §12), silo charge/launch, the game's actual dock pad tile
function bldArtOpts(b) {
  const o = { p: b.setup ? Math.min(0.99, (G.time - b.setupT0) / REMOTE_SETUP_S) : (G.time - (b.bornT !== undefined ? b.bornT : -1e9)) / BUILD_REVEAL_S, nukeCharge: NUKE_CHARGE };
  if (b.setup) o.setup = true;
  if (b.type === 'silo') o.launching = UnitArt.launching(b, G.missiles);
  if (b.pad !== undefined) o.padTile = [b.pad % MW, (b.pad / MW) | 0];
  return o;
}
// loop 4 tech-building overlay (Dezi, loop4/1-tech-spec.md; replaces the research-only rule of HANDOFF-buildings §10.1):
// plays whenever the building's own queue is busy - research (G.rq) or training (G.queues church / altar) - and it is powered; off when idle or unpowered.
// Armory: research. Church: research or Archangel / Templar training. Dark Altar: no research, so its flames play during the Demon Lord build.
const L4_OVERLAY = ['armory', 'church', 'altar'];
function bldBusy(b) {
  const rq = G.rq && G.rq[b.side] && G.rq[b.side][b.type], q = G.queues && G.queues[b.side] && G.queues[b.side][b.type];
  return !!((rq && rq.list.length > 0) || (q && q.list.length > 0 && !q.ready));
}
function bldOverlayOn(b) { return !!b && !b.dead && L4_OVERLAY.includes(b.type) && bldBusy(b) && powerOf(b.side).net >= 0; }
// HQ / Hive shot: fraction (0..1) through the 0.1 s flash window after a shot, or -1 (same window the procedural flash used)
function hqShotPhase(b) { return b.type === 'hq' && b.d && b.target && b.cd > b.d.rof - 0.1 ? clamp((b.d.rof - b.cd) / 0.1, 0, 0.999) : -1; }
// procedural extras kept on top of the art: silo charge ring while charging, Scrap Yard stack smoke while unloading; loop 4 overlays
function bldArtOverlay(c, b, P) {
  if (bldOverlayOn(b)) UnitArt.drawBuildingOverlay(c, P, G.time);
  if (b.setup) UnitArt.drawBuildingDeployFx(c, P, G.time);   // HANDOFF-buildings §12: remote setup dust over the deploy frame
  if (b.type === 'silo' && P.sel.p >= 1 && b.charge < NUKE_CHARGE) {
    const f = b.charge / NUKE_CHARGE, cx = b.x, cy = b.y;
    c.save(); c.globalAlpha *= 0.85; c.strokeStyle = b.side ? '#ff5a1a' : '#3A7BFF'; c.lineWidth = 2; c.beginPath(); c.arc(cx, cy + 4, 22, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2); c.stroke(); c.restore();
  }
  if (b.type === 'refinery' && b.side === 0 && b.dockQ && b.dockQ[0] && b.dockQ[0].hs === 'unload' && !b.dockQ[0].blocked && Math.random() < 0.3)
    G.fx.push({ k: 'smoke', x: b.tx * TILE + b.w * TILE - 12, y: P.oy + 6, t: 0, dur: 1.6 });
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
  if (t === 'armory' || t === 'church' || t === 'altar') drawBldL4(c, b, x, y, w, h, cx, cy, A);
  if (t === 'hq') drawHqTurret(c, b);
  if (b.hitT > 0) { c.fillStyle = 'rgba(255,255,255,0.2)'; c.fillRect(x, y, w, h); }
  c.restore();
}
// Loop 4 tech buildings, procedural (art pending: see ART_PENDING). Team trim from the base frame drawn above.
function drawBldL4(c, b, x, y, w, h, cx, cy, A) {
  const t = b.type, ev = b.side === 1, team = ev ? '#7a1a10' : '#3A7BFF';
  if (t === 'armory') { // bunker with ammo crates and a gun rack
    c.fillStyle = ev ? '#3a2224' : '#6E6A60'; c.fillRect(x + 5, y + 8, w - 10, h - 14);
    c.fillStyle = ev ? '#2a1416' : '#5A564C'; c.beginPath(); c.moveTo(x + 4, y + 14); c.lineTo(x + 10, y + 5); c.lineTo(x + w - 10, y + 5); c.lineTo(x + w - 4, y + 14); c.fill();
    for (let k = 0; k < 3; k++) { c.fillStyle = PAL.olive; c.fillRect(x + 8 + k * 16, y + h - 20, 13, 10); c.fillStyle = PAL.stencil; c.fillRect(x + 9 + k * 16, y + h - 16, 11, 1.5); }
    c.strokeStyle = '#222'; c.lineWidth = 2.5; for (let k = 0; k < 4; k++) { c.beginPath(); c.moveTo(x + 14 + k * 10, y + 16); c.lineTo(x + 14 + k * 10, y + 32); c.stroke(); }
    c.fillStyle = team; c.fillRect(cx - 10, y + 9, 20, 3);
    if (G && bldOverlayOn(b)) { c.globalAlpha = 0.5 + 0.4 * Math.sin(A * 6); c.fillStyle = '#ffe9a0'; circ(c, x + w - 9, y + 10, 3); c.globalAlpha = 1; }
  } else if (t === 'church') { // white chapel, steeple and cross, stained glass
    c.fillStyle = '#E8E2D0'; c.fillRect(x + 8, y + 22, w - 16, h - 28);
    c.fillStyle = '#7a5a3a'; c.beginPath(); c.moveTo(x + 4, y + 26); c.lineTo(cx, y + 12); c.lineTo(x + w - 4, y + 26); c.fill();
    c.fillStyle = '#d8d2c0'; c.fillRect(cx - 7, y + 4, 14, 30); c.fillStyle = '#6a4a30'; c.beginPath(); c.moveTo(cx - 9, y + 6); c.lineTo(cx, y - 8); c.lineTo(cx + 9, y + 6); c.fill();
    c.fillStyle = '#FFE9A0'; c.fillRect(cx - 1, y - 18, 2, 11); c.fillRect(cx - 4, y - 15, 8, 2);
    c.fillStyle = '#5a4030'; c.fillRect(cx - 6, y + h - 22, 12, 16);
    for (const ox of [-18, 18]) { const g = c.createLinearGradient(0, y + 40, 0, y + 60); g.addColorStop(0, '#9FE8FF'); g.addColorStop(1, team); c.fillStyle = g; c.fillRect(cx + ox - 3, y + 40, 6, 18); }
    c.globalAlpha = 0.15 + 0.1 * Math.sin(A * 2); c.fillStyle = '#DDF6FF'; circ(c, cx, cy, 30); c.globalAlpha = 1;
  } else { // Dark Altar: obsidian slab, bone pillars, green plague fire
    c.fillStyle = '#140a0c'; c.fillRect(x + 6, y + 10, w - 12, h - 16);
    c.fillStyle = '#2a1a1c'; c.beginPath(); c.moveTo(x + 10, y + h - 10); c.lineTo(cx, y + 18); c.lineTo(x + w - 10, y + h - 10); c.fill();
    c.fillStyle = '#d8ccb0'; for (const px of [x + 10, x + w - 14]) { c.fillRect(px, y + 12, 4, h - 26); c.beginPath(); c.moveTo(px - 2, y + 14); c.quadraticCurveTo(px - 4, y + 2, px + 4, y + 2); c.lineTo(px + 4, y + 14); c.fill(); }
    for (let k = 3; k > 0; k--) { c.fillStyle = ['#d0ff7a', '#7adf3a', '#2a6a10'][k - 1]; c.globalAlpha = 0.85; c.beginPath(); c.ellipse(cx, cy + 6, 3 + k * 3 + Math.sin(A * 4 + k) * 1.5, 5 + k * 5, 0, 0, 7); c.fill(); }
    c.globalAlpha = 1; c.fillStyle = team; c.fillRect(x + 6, y + h - 9, w - 12, 3);
    c.fillStyle = '#ff2a10'; circ(c, cx - 6, y + 30, 1.5); circ(c, cx + 6, y + 30, 1.5);
  }
}
// opening addendum: the HQ / Hive's small built-in turret (weaker-looking than a Turret / Bone Spire), drawn over art or procedural
function drawHqTurret(c, b) {
  const x = b.tx * TILE + b.w * TILE - 20, y = b.ty * TILE + 18, ev = b.side === 1, a = b.tang || 0;
  c.save(); c.translate(x, y);
  if (!ev) { c.fillStyle = '#3a3a36'; circ(c, 0, 0, 6.5); c.fillStyle = '#8E959C'; circ(c, 0, 0, 4.5); c.rotate(a); c.fillStyle = '#2a2a2a'; c.fillRect(2, -1.2, 9, 2.4); c.fillStyle = '#3A7BFF'; c.fillRect(-2, -1, 3, 2); }
  else { c.fillStyle = '#3a1a18'; circ(c, 0, 0, 6.5); c.fillStyle = '#d8ccb0'; c.rotate(a); c.beginPath(); c.moveTo(-4, -4); c.lineTo(10, 0); c.lineTo(-4, 4); c.fill(); c.fillStyle = `rgba(255,${120 + 60 * Math.sin(b.anim * 6)},20,0.9)`; circ(c, 8, 0, 2); }
  if (b.d && b.cd > b.d.rof - 0.1 && b.target) { c.fillStyle = ev ? 'rgba(255,140,40,0.9)' : 'rgba(255,240,180,0.9)'; circ(c, 12, 0, 3); } // muzzle flash / fire puff
  c.restore();
}
// ground markers: HQ dock pad, Demon Lord plague aura, Holy Ground and Archangel aura rings, HQ / Turret range ring when selected
function drawGroundL4(c, vb) {
  for (const b of vb) if (b.type === 'hq' && b.pad !== undefined && !(typeof UnitArt !== 'undefined' && UnitArt.planBuilding(b, bldArtOpts(b)))) {   // loop 4: the art draws hq_pad / hive_pad
    const px = (b.pad % MW) * TILE, py = ((b.pad / MW) | 0) * TILE;
    c.save(); c.globalAlpha = 0.75; c.strokeStyle = b.side ? '#8C3A5A' : '#E8D23A'; c.setLineDash([5, 4]); c.lineWidth = 2; c.strokeRect(px + 3, py + 3, 26, 26); c.setLineDash([]);
    c.fillStyle = b.side ? '#8C3A5A' : '#E8D23A'; c.beginPath(); c.moveTo(px + 11, py + 10); c.lineTo(px + 21, py + 10); c.lineTo(px + 16, py + 18); c.fill(); c.restore();
  }
  for (const u of G.units) if (!u.dead && u.type === 'demon' && (u.side === 0 || vis[tileOf(u.y) * MW + tileOf(u.x)]) && onScreen(u.x, u.y, 140)) {
    if (typeof UnitArt !== 'undefined') UnitArt.drawFx(c, 'plague_aura', Math.floor(G.time * 6 + u.id * 0.37), u.x, u.y, 0, 1);   // loop 4 flavour ring (~6 fps)
    const R = (Combat.D.demonAuraTiles + 0.5) * TILE, g = c.createRadialGradient(u.x, u.y, R * 0.2, u.x, u.y, R);
    g.addColorStop(0, 'rgba(120,220,40,0.05)'); g.addColorStop(0.85, 'rgba(110,210,40,0.2)'); g.addColorStop(1, 'rgba(90,180,30,0)'); c.fillStyle = g; circ(c, u.x, u.y, R);
    c.strokeStyle = `rgba(150,255,70,${0.45 + 0.15 * Math.sin(G.time * 3)})`; c.lineWidth = 2; c.beginPath(); c.ellipse(u.x, u.y, R - 4, (R - 4) * 0.8, 0, 0, 7); c.stroke();
  }
  if (isDone(0, 'holyground')) for (const b of vb) if (b.type === 'church' && b.side === 0) {
    c.save(); c.strokeStyle = 'rgba(159,232,255,0.35)'; c.setLineDash([12, 10]); c.lineWidth = 2; c.beginPath(); c.arc(b.x, b.y, Combat.D.holyGroundTiles * TILE, 0, 7); c.stroke(); c.setLineDash([]); c.restore();
  }
  for (const u of G.units) if (!u.dead && u.type === 'archangel' && (u.side === 0 || vis[tileOf(u.y) * MW + tileOf(u.x)]) && onScreen(u.x, u.y, 160)) {
    if (typeof UnitArt !== 'undefined') UnitArt.drawFx(c, 'holy_aura', Math.floor(G.time * 6 + u.id * 0.37), u.x, u.y, 0, 1);    // loop 4 flavour ring (~6 fps)
    c.strokeStyle = 'rgba(221,246,255,0.3)'; c.lineWidth = 1.5; c.beginPath(); c.ellipse(u.x, u.y, Combat.D.archangelHealTiles * TILE, Combat.D.archangelHealTiles * TILE * 0.8, 0, 0, 7); c.stroke();
  }
  for (const e of G.sel) if (!e.dead && e.kind === 'b' && (e.type === 'hq' || e.type === 'turret')) {
    c.save(); c.strokeStyle = e.side ? 'rgba(255,90,90,0.5)' : 'rgba(125,255,125,0.45)'; c.setLineDash([6, 6]); c.lineWidth = 1.5; c.beginPath(); c.arc(e.x, e.y, rangeOf(e) * TILE, 0, 7); c.stroke(); c.setLineDash([]); c.restore();
  }
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
    case 'flame': if (f.ux !== undefined && typeof UnitArt !== 'undefined' && UnitArt.fxFrame('flame_cone', 0)) { // art flame_cone (~15 fps) at the nozzle (+8 along the aim, 7 px up), chained to reach the target
        const ny = f.uy - 7, a = Math.atan2(f.y2 - ny, f.x2 - f.ux), x0 = f.ux + Math.cos(a) * 8, y0 = ny + Math.sin(a) * 8, L = Math.hypot(f.x2 - x0, f.y2 - y0), k0 = Math.floor(f.t * 15);
        if (L >= 56 && UnitArt.fxFrame('flame_cone_long', 0)) { UnitArt.drawFx(c, 'flame_cone_long', k0, x0, y0, a, 1, { add: true, alpha: 1 - p * 0.6 }); break; }   // units HANDOFF §9.4: one ~80 px jet
        const n = Math.max(1, Math.ceil(L / 26)); for (let k = 0; k < n; k++) UnitArt.drawFx(c, 'flame_cone', k0 + k, x0 + Math.cos(a) * k * 26, y0 + Math.sin(a) * k * 26, a, 1, { add: true, alpha: (1 - p * 0.6) * (1 - k / (n + 1) * 0.5) });
        break; }
      { c.globalCompositeOperation = 'lighter'; const a = Math.atan2(f.y2 - f.y1, f.x2 - f.x1), L = Math.hypot(f.x2 - f.x1, f.y2 - f.y1) + 8; c.translate(f.x1, f.y1); c.rotate(a);
      for (let k = 0; k < 7; k++) { const q = (k / 7 + p) % 1, rr = 2 + q * 9; c.globalAlpha = (1 - p) * (1 - q * 0.6); c.fillStyle = q < 0.3 ? '#ffe080' : q < 0.65 ? '#ff8a20' : '#c03010'; circ(c, q * L, Math.sin(k * 2.3 + f.t * 30) * q * 5, rr); } break; }
    case 'heal': if (typeof UnitArt !== 'undefined' && UnitArt.fxFrame('heal_beam', 0)) { // art: 8x3 beam segments tiled Medic -> target (2-frame scroll), heal_plus 14 px over the target
        const a = Math.atan2(f.y2 - f.y1, f.x2 - f.x1), L = Math.hypot(f.x2 - f.x1, f.y2 - f.y1), k = Math.floor(p * 2) % 2;
        for (let d = -k * 2; d < L - 2; d += 8) UnitArt.drawFx(c, 'heal_beam', k, f.x1 + Math.cos(a) * Math.max(0, d), f.y1 + Math.sin(a) * Math.max(0, d), a, 1, { add: true });
        UnitArt.drawFx(c, 'heal_plus', Math.min(2, Math.floor(p * 3)), f.x2, f.y2 + 3 - 14, 0, 1); break; }
      c.globalAlpha = 1 - p; c.strokeStyle = '#7dff9a'; c.lineWidth = 2.5; c.globalCompositeOperation = 'lighter'; c.beginPath(); c.moveTo(f.x1, f.y1); c.lineTo(f.x2, f.y2); c.stroke(); c.strokeStyle = '#fff'; c.lineWidth = 1; c.stroke(); c.fillStyle = '#7dff9a'; c.fillRect(f.x2 - 1, f.y2 - 9 - p * 6, 2, 6); c.fillRect(f.x2 - 3, f.y2 - 7 - p * 6, 6, 2); break;
    case 'holyburst': c.globalAlpha = 0.8 * (1 - p); c.globalCompositeOperation = 'lighter'; c.strokeStyle = '#DDF6FF'; c.lineWidth = 3 * (1 - p) + 1; c.beginPath(); c.arc(f.x, f.y, f.r * (0.4 + 0.6 * p), 0, 7); c.stroke(); break;
    case 'slash': c.globalAlpha = 1 - p; c.strokeStyle = f.c || '#ffd0c0'; c.lineWidth = 2; c.beginPath(); c.arc(f.x, f.y, f.r, f.a - 1 + p, f.a + 0.2 + p); c.stroke(); break;
    case 'boom': { c.globalCompositeOperation = 'lighter'; const r = f.r * (0.4 + p); const g = c.createRadialGradient(f.x, f.y, 0, f.x, f.y, r); g.addColorStop(0, `rgba(255,240,200,${1 - p})`); g.addColorStop(0.4, f.c); g.addColorStop(1, 'rgba(80,20,0,0)'); c.globalAlpha = 1 - p * 0.8; c.fillStyle = g; circ(c, f.x, f.y, r); break; }
    case 'ember': c.globalAlpha = 1 - p; c.fillStyle = f.c; circ(c, f.x + f.vx * f.t, f.y + f.vy * f.t, 2); break;
    case 'smoke': c.globalAlpha = 0.35 * (1 - p); c.fillStyle = '#222'; circ(c, f.x + p * 10, f.y - p * 40, 6 + p * 12); break;
    case 'blood': c.globalAlpha = 1 - p; c.fillStyle = f.c; for (let k = 0; k < 6; k++) circ(c, f.x + Math.cos(k) * p * 12, f.y + Math.sin(k * 1.3) * p * 12, 2); break;
    case 'purify': c.globalAlpha = 1 - p; c.strokeStyle = '#ffffff'; c.lineWidth = 3 * (1 - p) + 1; c.beginPath(); c.arc(f.x, f.y, 4 + p * 26, 0, 7); c.stroke(); c.fillStyle = `rgba(255,255,255,${0.7 * (1 - p)})`; circ(c, f.x, f.y, 10 * (1 - p) + 2); c.fillRect(f.x - 1, f.y - 30 * (1 - p) - 4, 2, 30 * (1 - p)); break;
    case 'mote': { c.globalAlpha = p < 0.2 ? p * 5 : 1 - p; c.fillStyle = f.c || '#9fe07a'; const rr = 16 * (1 - p); for (let k = 0; k < 3; k++) circ(c, f.x + Math.cos(f.a + k * 2.1) * rr, f.y + Math.sin(f.a + k * 2.1) * rr * 0.6 - p * 6, 1.6); break; }
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
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, SW, SH);
  if (!G) return;
  let sx = 0, sy = 0; if (G.shakeA > 0.2) { sx = (Math.random() - 0.5) * G.shakeA; sy = (Math.random() - 0.5) * G.shakeA; }
  const cx = Math.round((cam.x + sx) * KS) / KS, cy = Math.round((cam.y + sy) * KS) / KS; // whole device px
  ctx.setTransform(KS, 0, 0, KS, 0, 0);
  const sw = Math.min(VW, MW * TILE - Math.max(0, cx)), sh = Math.min(VH, MH * TILE - Math.max(0, cy));
  ctx.drawImage(terrCanvas, Math.max(0, cx), Math.max(0, cy), sw, sh, Math.max(0, -cx), Math.max(0, -cy), sw, sh);
  ctx.translate(-cx, -cy);
  const x0 = Math.max(0, tileOf(cx)), y0 = Math.max(0, tileOf(cy)), x1 = Math.min(MW - 1, tileOf(cx + VW)), y1 = Math.min(MH - 1, tileOf(cy + VH));
  // decals
  for (const d of G.decals) {
    if (!onScreen(d.x, d.y, 200)) continue;
    if (d.k === 'scorch') { const g = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.r); g.addColorStop(0, 'rgba(0,0,0,0.6)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; circ(ctx, d.x, d.y, d.r); }
    else if (d.k === 'burn' && typeof UnitArt !== 'undefined' && UnitArt.drawFx(ctx, 'burn_decal', (G.time - (d.born || 0)) < 1.5 ? 0 : (G.time - (d.born || 0)) < 3 ? 1 : 2, d.x, d.y, 0, d.s || 1)) { /* art: frame 0, 1 after 1.5 s, then hold 2 */ }
    else if (d.k === 'burn') { ctx.fillStyle = 'rgba(20,14,10,0.7)'; ell(ctx, d.x, d.y + 2, d.r, d.r * 0.6); ctx.fillStyle = 'rgba(255,120,30,0.25)'; for (let k = 0; k < 3; k++) circ(ctx, d.x + Math.cos(d.a + k * 2) * d.r * 0.5, d.y + 2 + Math.sin(d.a + k * 2) * d.r * 0.3, 1.2); }
    else if (d.k === 'blood') { ctx.fillStyle = d.c; ctx.globalAlpha = 0.6; ell(ctx, d.x, d.y, 5, 3); ctx.globalAlpha = 1; }
    else if (d.k === 'ruin') { if (!bgrid[d.y / TILE * MW + d.x / TILE] && !(d.type && typeof UnitArt !== 'undefined' && UnitArt.drawBuildingDestroyed(ctx, d))) { ctx.fillStyle = 'rgba(40,34,30,0.7)'; for (let k = 0; k < d.w * d.h * 2; k++) ctx.fillRect(d.x + hash(k + d.x) * d.w * TILE, d.y + hash(k * 3 + d.y) * d.h * TILE, 6, 4); } }
  }
  drawResources(ctx, x0, y0, x1, y1);
  drawGroundL4(ctx, G.blds.filter(b => !b.dead && onScreen(b.x, b.y, 300) && (b.side === 0 || isVisible(b))));
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
  // buildings + ground units, y-sorted (buildings by footprint bottom); art buildings put shadows/pads on the ground first
  const vb = G.blds.filter(b => !b.dead && onScreen(b.x, b.y, 140) && (b.side === 0 || isVisible(b)));
  const plans = new Map();
  if (typeof UnitArt !== 'undefined') for (const b of vb) { const P = UnitArt.planBuilding(b, bldArtOpts(b)); if (P) plans.set(b, P); }
  for (const P of plans.values()) UnitArt.drawBuildingGround(ctx, P);
  // selection circles under units
  for (const e of G.sel) {
    if (e.dead || e.kind !== 'u') continue;
    ctx.strokeStyle = e.side === 0 ? '#6CFF6C' : '#FF5A5A'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(e.x, e.y + 2, e.r + 3, (e.r + 3) * 0.7, 0, 0, 7); ctx.stroke();
  }
  const vu = G.units.filter(u => !u.dead && onScreen(u.x, u.y, 40) && (u.side === 0 || vis[tileOf(u.y) * MW + tileOf(u.x)]));
  const ysort = [];
  for (const b of vb) { const k = (b.ty + b.h) * TILE; ysort.push({ k, b, o: 0 }); const P = plans.get(b); if (P && P.sel.top) ysort.push({ k, b, o: 1 }); }
  for (const u of vu) if (!u.d.fly) ysort.push({ k: u.y, u, o: 0 });
  const EV = G.env, env = EV ? EnvArt.env : null, FS = EV ? EV.stats.frame : null;
  if (EV) { // env blockers, culled to the view (+3 tiles for tall sprites), y-sorted by footprint bottom like buildings
    const vx0 = cx / TILE - 3, vx1 = (cx + VW) / TILE + 1, vy0 = cy / TILE - 1, vy1 = (cy + VH) / TILE + 3; let n = 0;
    for (const p of EV.props) { if (p.tx > vx1 || p.tx + 3 < vx0 || p.ty > vy1 || p.ty + 2 < vy0) continue; ysort.push({ k: env.sortKey(p) - 0.5, p, o: 0 }); n++; }
    FS.props = n;
  }
  ysort.sort((a, b) => (a.k - b.k) || (a.o - b.o));   // tops after every base on the same row
  for (const e of ysort) {
    if (e.p) { env.drawPropShadow(ctx, e.p); env.drawProp(ctx, e.p); continue; }
    if (e.u) { if (env && e.u.d.cat === 'vehicle') env.drawVehicleAO(ctx, e.u.x, e.u.y, e.u.r >= 14 ? 'm' : 's'); drawUnit(ctx, e.u); continue; }
    const b = e.b, P = plans.get(b);
    if (!P) { drawBld(ctx, b); continue; }
    if (e.o) { UnitArt.drawBuildingTop(ctx, P, { hit: b.hitT > 0 }); const k = hqShotPhase(b); if (k >= 0) UnitArt.drawBuildingTopFx(ctx, P, k); continue; }
    UnitArt.drawBuildingBody(ctx, P, { hit: b.hitT > 0 });
    bldArtOverlay(ctx, b, P);
  }
  for (const u of vu.filter(u => u.d.fly).sort((a, b) => a.y - b.y)) drawUnit(ctx, u);
  // building selection boxes on top of the sprites
  for (const e of G.sel) if (!e.dead && e.kind === 'b') { ctx.strokeStyle = e.side === 0 ? '#6CFF6C' : '#FF5A5A'; ctx.lineWidth = 1.5; ctx.strokeRect(e.tx * TILE - 1, e.ty * TILE - 1, e.w * TILE + 2, e.h * TILE + 2); }
  for (const p of G.proj) {
    if (!onScreen(p.x, p.y, 20)) continue;
    // projectiles aimed at air arc up toward the lifted sprite
    let py = p.y; if (p.air) { const tot = Math.hypot(p.tx - p.sx, p.ty - p.sy) || 1, left = Math.hypot(p.tx - p.x, p.ty - p.y); py -= Math.sin(Math.PI * clamp(1 - left / tot, 0, 1)) * 14; }
    if (p.bolt) { ctx.save(); ctx.translate(p.x, py); ctx.rotate(p.a || 0); ctx.fillStyle = '#e8dcc0'; ctx.fillRect(-7, -1.5, 9, 3); ctx.fillStyle = '#ff7a20'; ctx.beginPath(); ctx.moveTo(2, -3); ctx.lineTo(9, 0); ctx.lineTo(2, 3); ctx.fill(); ctx.fillStyle = 'rgba(255,90,20,0.5)'; ctx.fillRect(-14, -1, 7, 2); ctx.restore(); }
    else if (p.rocket) { const a = Math.atan2(p.ty - p.sy, p.tx - p.sx); ctx.save(); ctx.translate(p.x, py); ctx.rotate(a); ctx.fillStyle = '#5E6B34'; ctx.fillRect(-6, -1.5, 9, 3); ctx.fillStyle = '#ddd'; ctx.fillRect(3, -1.5, 2, 3); ctx.fillStyle = 'rgba(255,170,60,0.9)'; ctx.fillRect(-10, -1, 4, 2); ctx.restore(); }
    else if (p.w === 'fire') { const r = p.big ? 7 : 4; ctx.fillStyle = '#ff7a20'; circ(ctx, p.x, py, r); ctx.fillStyle = '#ffe080'; circ(ctx, p.x, py, r / 2); }
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
  if (EV) { // burning props (flames), then lights: additive 'lighter' sprites, capped at 24 by priority, before fog
    let nf = 0;
    for (const f of EV.fires) if (f.x > cx - 64 && f.x < cx + VW + 64 && f.y > cy - 64 && f.y < cy + VH + 96) { env.drawFlame(ctx, f.size, f.x, f.y, G.time, f.ph); nf++; }
    const L = EV.lights.slice();
    for (const u of vu) if (u.type === 'seraph') L.push({ name: 'light_halo', x: u.x, y: u.y - 28, phase: u.id }); else if (u.type === 'archangel') L.push({ name: 'light_archangel', x: u.x, y: u.y - 28, phase: u.id });
    for (const b of vb) if (b.type === 'silo' && b.charge >= NUKE_CHARGE) L.push({ name: b.side ? 'light_hell_open' : 'light_nuke_open', x: (b.tx + 1) * TILE, y: (b.ty + 0.8) * TILE, phase: b.id });
    FS.flames = nf; FS.lightsIn = L.length;
    FS.lights = env.drawLights(ctx, L, G.time, { x0: cx, y0: cy, x1: cx + VW, y1: cy + VH }, 24);
  }
  // health bars
  for (const u of vu) if ((u.hp < u.maxhp || G.sel.includes(u))) hpBar(ctx, u.x, u.d.fly ? u.y - u.r - 18 : u.d.big && typeof UnitArt !== 'undefined' ? UnitArt.hpBarY(u, UnitArt.unitFrame(u)) : u.y - u.r - 7, Math.max(16, u.r * 2), u.hp / u.maxhp);   // loop 4: art > 2 tiles tall (Demon Lord) -> above the sprite
  for (const b of G.blds) if (!b.dead && (b.hp < b.maxhp || G.sel.includes(b) || b.setup) && onScreen(b.x, b.y, 100) && (b.side === 0 || isVisible(b))) hpBar(ctx, b.x, b.ty * TILE - 6, b.w * TILE - 8, b.hp / b.maxhp);
  for (const u of vu) if (u.d.harv && u.side === 0 && (G.sel.includes(u) || u.blocked)) { const n = Salvage.pipsOf(u.load, u.d.cap); for (let k = 0; k < 5; k++) { ctx.fillStyle = '#000'; ctx.fillRect(u.x - 17 + k * 7, u.y - u.r - 4, 6, 4); ctx.fillStyle = k < n ? (u.blocked ? '#ffb347' : PAL.steel) : '#333333'; ctx.fillRect(u.x - 16.5 + k * 7, u.y - u.r - 3.5, 5, 3); } }
  // fog: env = dual-grid edge tiles only, clipped to the view (bits 0 nothing, bits 15 one fillRect); else the per-tile loop
  if (EV) FS.fogEdges = env.drawFog(ctx, { w: MW, h: MH, expl, vis, rim: 'ember' }, { x0, y0, x1, y1 });
  else for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    const i = ty * MW + tx;
    if (!expl[i]) { ctx.fillStyle = '#000'; ctx.fillRect(tx * TILE, ty * TILE, TILE + 1, TILE + 1); }
    else if (!vis[i]) { ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(tx * TILE, ty * TILE, TILE, TILE); }
  }
  // placement ghost
  if (G.placing) {
    const d = BDEF[G.placing], tx = tileOf(mouse.wx) - (d.w >> 1), ty = tileOf(mouse.wy) - (d.h >> 1), pc = placeCheck(0, G.placing, tx, ty, 0), ok = pc.ok;
    if (G.placing === 'refinery' && G.half) { // remote yards: tint what is outside your half (red) and the strip along the line (amber)
      const x0 = Math.max(0, tileOf(cam.x)), y0 = Math.max(0, tileOf(cam.y)), x1 = Math.min(MW - 1, tileOf(cam.x + VW)), y1 = Math.min(MH - 1, tileOf(cam.y + VH));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = y * MW + x; if (G.halfIn[0][i] || !expl[i]) continue; ctx.fillStyle = G.half[i] === 0 ? 'rgba(255,170,60,0.13)' : 'rgba(255,60,60,0.13)'; ctx.fillRect(x * TILE, y * TILE, TILE, TILE); }
    }
    const gb = { tx, ty, w: d.w, h: d.h, x: (tx + d.w / 2) * TILE, y: (ty + d.h / 2) * TILE, anim: G.time, side: 0, type: G.placing, charge: 0, tang: 0, hitT: 0, hp: 1, maxhp: 1 };
    const GP = typeof UnitArt !== 'undefined' ? UnitArt.planBuilding(gb, { ghost: true }) : null;   // HANDOFF-buildings §6: construct frame at 55%, red when invalid
    ctx.globalAlpha = GP ? 0.55 : 0.5; if (GP) { UnitArt.drawBuildingGround(ctx, GP); UnitArt.drawBuildingBody(ctx, GP, { invalid: !ok }); } else drawBld(ctx, gb); ctx.globalAlpha = 1;
    for (let y = ty; y < ty + d.h; y++) for (let x = tx; x < tx + d.w; x++) { const i = y * MW + x, good = x >= 0 && y >= 0 && x < MW && y < MH && !BLOCK[terr[i]] && !bgrid[i] && !res[i]; ctx.fillStyle = ok && good ? 'rgba(80,255,80,0.3)' : 'rgba(255,60,60,0.4)'; ctx.fillRect(x * TILE, y * TILE, TILE, TILE); }
    const label = !ok ? pc.reason : pc.remote && REMOTE_SETUP_S > 0 ? `Remote: deploys in ${REMOTE_SETUP_S} s` : null;
    if (label) { ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; const lx = (tx + d.w / 2) * TILE, ly = ty * TILE - 8; ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(lx - ctx.measureText(label).width / 2 - 4, ly - 12, ctx.measureText(label).width + 8, 16); ctx.fillStyle = ok ? '#9dff9d' : '#ff8a7a'; ctx.fillText(label, lx, ly); ctx.textAlign = 'left'; }
  }
  if (G.mode === 'nuke') { ctx.strokeStyle = '#fff3b0'; ctx.lineWidth = 2; ctx.setLineDash([8, 6]); ctx.beginPath(); ctx.arc(mouse.wx, mouse.wy, NUKE_R * TILE, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
  // drag box
  if (mouse.drag && mouse.down) { ctx.strokeStyle = '#7dff7d'; ctx.lineWidth = 1 / ZS; ctx.strokeRect(mouse.dx, mouse.dy, mouse.wx - mouse.dx, mouse.wy - mouse.dy); }
  // screen-space atmosphere
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0); { const VW = SW, VH = SH; // (screen px)
  if (EV) { // env pass 1: ONE vignette over the pre-darkened palette (HANDOFF-env §6), cached per viewport size
    if (!EV.vg || EV.vgW !== VW || EV.vgH !== VH) { EV.vg = ctx.createRadialGradient(VW / 2, VH / 2, Math.min(VW, VH) * 0.35, VW / 2, VH / 2, Math.max(VW, VH) * 0.72); EV.vg.addColorStop(0, 'rgba(14,6,2,0)'); EV.vg.addColorStop(1, 'rgba(14,6,2,0.55)'); EV.vgW = VW; EV.vgH = VH; }
    ctx.fillStyle = EV.vg; ctx.fillRect(0, 0, VW, VH);
  } else {
    const vg = ctx.createRadialGradient(VW / 2, VH / 2, Math.min(VW, VH) * 0.4, VW / 2, VH / 2, Math.max(VW, VH) * 0.75);
    vg.addColorStop(0, 'rgba(60,10,0,0)'); vg.addColorStop(1, 'rgba(60,10,0,0.45)'); ctx.fillStyle = vg; ctx.fillRect(0, 0, VW, VH);
  }
  for (const a of ash) { ctx.fillStyle = a.e ? `rgba(255,${120 + a.s * 40},40,${0.6})` : 'rgba(200,190,180,0.35)'; ctx.fillRect(a.x, a.y, a.s, a.s); }
  if (G.flash) { ctx.fillStyle = `rgba(${G.flash.c},${Math.max(0, 1 - G.flash.t / 1.2)})`; ctx.fillRect(0, 0, VW, VH); }
  }
}
const ash = []; for (let k = 0; k < 70; k++) ash.push({ x: Math.random() * 2000, y: Math.random() * 1200, s: 1 + Math.random() * 2, e: Math.random() < 0.3, v: 10 + Math.random() * 25 });
function updAsh(dt) { for (const a of ash) { a.y += (a.e ? -a.v : a.v) * dt; a.x += Math.sin(a.y * 0.01) * 10 * dt + 6 * dt; if (a.y > SH) a.y = 0; if (a.y < 0) a.y = SH; if (a.x > SW) a.x = 0; } }
function drawMini() {
  if (!miniBase) return;
  const s = MP;
  mctx.save(); mctx.fillStyle = '#000'; mctx.fillRect(0, 0, MBOX, MBOX); mctx.translate(MOX, MOY);
  mctx.beginPath(); mctx.rect(0, 0, MW * s, MH * s); mctx.clip();
  mctx.drawImage(miniBase, 0, 0);
  for (const i of resTiles) if (res[i] && expl[i]) { mctx.fillStyle = '#E8B830'; mctx.fillRect((i % MW) * s, ((i / MW) | 0) * s, s, s); }
  mctx.fillStyle = 'rgba(120,230,40,0.35)'; for (const z of plagueZones) { mctx.beginPath(); mctx.arc(z.x / TILE * s, z.y / TILE * s, z.r / TILE * s, 0, 7); mctx.fill(); }
  for (const b of G.blds) if (!b.dead && (b.side === 0 || isVisible(b))) { mctx.fillStyle = SIDES[b.side].mm; mctx.fillRect(b.tx * s, b.ty * s, b.w * s, b.h * s); }
  for (const u of G.units) if (!u.dead && (u.side === 0 || vis[tileOf(u.y) * MW + tileOf(u.x)])) { mctx.fillStyle = SIDES[u.side].dot; mctx.fillRect(tileOf(u.x) * s, tileOf(u.y) * s, s, s); } // 2x2 / 3x3 team dots
  mctx.fillStyle = 'rgba(0,0,0,1)';
  for (let ty = 0; ty < MH; ty++) for (let tx = 0; tx < MW; tx++) { const i = ty * MW + tx; if (!expl[i]) mctx.fillRect(tx * s, ty * s, s + 0.5, s + 0.5); else if (!vis[i]) { mctx.fillStyle = 'rgba(0,0,0,0.4)'; mctx.fillRect(tx * s, ty * s, s, s); mctx.fillStyle = '#000'; } }
  for (const m of G.missiles) { mctx.strokeStyle = m.side ? '#ff3a1a' : '#fff'; mctx.beginPath(); mctx.arc(m.tx / TILE * s, m.ty / TILE * s, 6, 0, 7); mctx.stroke(); }
  if (G.pings) for (const p of G.pings) { const a = (G.time - p.t) / PING_S; if (a < 0 || a > 1) continue; mctx.strokeStyle = p.c; mctx.globalAlpha = 1 - a; mctx.lineWidth = 2; mctx.beginPath(); mctx.arc(p.x / TILE * s, p.y / TILE * s, 3 + 9 * (a * 3 % 1), 0, 7); mctx.stroke(); mctx.globalAlpha = 1; }
  mctx.strokeStyle = '#D8DCDF'; mctx.lineWidth = 1; mctx.strokeRect(Math.round(cam.x / TILE * s) + 0.5, Math.round(cam.y / TILE * s) + 0.5, Math.round(VW / TILE * s) - 1, Math.round(VH / TILE * s) - 1);
  mctx.restore();
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
    case 'horn': tone(110, 104, 1.2, 'sawtooth', 0.09); tone(165, 156, 1.2, 'sawtooth', 0.05); tone(82, 78, 1.4, 'triangle', 0.08, 0.1); break;
  }
}

// ---------------- messages ----------------
// minimap pings (remote yards): an expanding ring for PING_S seconds
const PING_S = 3;
function ping(x, y, c) { if (!G.pings) G.pings = []; G.pings.push({ x, y, t: G.time, c: c || '#fff' }); if (G.pings.length > 8) G.pings.shift(); }
function msg(text, color, x, y) {
  const box = $('msgs'); const d = document.createElement('div'); d.textContent = text; d.style.color = color || '#D8DCDF';
  box.appendChild(d); while (box.children.length > 5) box.removeChild(box.firstChild);
  setTimeout(() => { d.style.opacity = 0; }, 5000); setTimeout(() => d.remove(), 6000);
  if (x !== undefined) G.lastAlert = { x, y };
}

// ---------------- sidebar (rts-loops/ui/1-ui-layout-notes.md) ----------------
// Tier from the inner viewport: S 720-799 (and < 720, plus any width < 1100), M 800-899, L 900-1079, XL >= 1080.
// S / M / L: three tabs (queue badge + ready dot); XL: one merged list of all 25 items with section headers, no scroll.
const SB_TIERS = {
  S: { W: 196, mini: 160, icon: 32, cw: 40, ch: 48, sel: 40, tabH: 20, tabs: ['BUILD', 'UNITS', 'TECH'] },
  M: { W: 228, mini: 160, icon: 48, cw: 48, ch: 60, sel: 48, tabH: 22, tabs: ['STRUCT', 'UNITS', 'RESEARCH'] },
  L: { W: 260, mini: 240, icon: 48, cw: 56, ch: 62, sel: 56, tabH: 22, tabs: ['STRUCT', 'UNITS', 'RESEARCH'] },
  XL: { W: 260, mini: 240, icon: 48, cw: 56, ch: 62, sel: 64, tabH: 22, tabs: ['STRUCT', 'UNITS', 'RESEARCH'] },
};
// Tab hot-keys. Q / W / E per the notes, but W already pans the camera (WASD), so W is left off until that clash is ruled on.
const TAB_KEYS = { KeyQ: 0, KeyE: 2 };
let TIER = null, SHORT = false, merged = false, mergePref = false, sbTab = 0, iconKey = '';
function tierOf(w, h) { if (h < 800 || w < 1100) return 'S'; if (h < 900) return 'M'; if (h < 1080) return 'L'; return 'XL'; }
function applyTier() {
  if (typeof document === 'undefined' || !document.body || !document.documentElement) { TIER = tierOf(window.innerWidth || 1280, window.innerHeight || 720); MBOX = SB_TIERS[TIER].mini; return; }   // headless (node tests)
  const w = window.innerWidth || 1280, h = window.innerHeight || 720, t = tierOf(w, h), K = SB_TIERS[t], bd = document.body, st = document.documentElement.style;
  SHORT = h < 720; merged = t === 'XL' || (t === 'L' && mergePref); TIER = t;
  bd.dataset.tier = t; bd.classList.toggle('short', SHORT); bd.classList.toggle('merged', merged); bd.classList.toggle('tiny', w < 1000 || h < 600);
  const px = (k, v) => st.setProperty(k, v + 'px');
  px('--sbW', K.W); px('--mini', K.mini); px('--cw', K.cw); px('--ch', K.ch); px('--icon', K.icon); px('--sel', SHORT ? 24 : K.sel); px('--tabH', K.tabH);
  px('--ix', (K.cw - K.icon) / 2 - 1); px('--iy', K.cw > K.icon ? 1 : -1); // icon box inside the 1 px cell border (M: the icon's own bevel is the frame)
  document.querySelectorAll('#tabs .tab .tl').forEach((e, i) => { e.textContent = K.tabs[i]; });
  const m = $('bMenu'); if (m) { const L = t === 'L'; m.textContent = L ? '⇅' : '≡'; m.title = L ? (merged ? 'Back to tabs' : 'Show all lists (scrolls)') : 'Menu: pause, restart, sound (P)'; }
  MBOX = K.mini; if (terr) renderMiniBase(); else miniLayout();
  const key = t + ':' + DPR; if (key !== iconKey) { iconKey = key; bakeIcons(); }
  showTab(sbTab, true);
}
function showTab(i, quiet) {
  sbTab = i;
  document.querySelectorAll('#tabs .tab').forEach((e, k) => e.classList.toggle('on', k === i));
  document.querySelectorAll('#sbScroll .sec').forEach((e, k) => e.classList.toggle('on', k === i));
  if (merged && !quiet) { const sec = document.querySelectorAll('#sbScroll .sec')[i]; if (sec && sec.offsetParent) $('sbScroll').scrollTop = sec.offsetTop - $('sbScroll').offsetTop; }
  else if (!quiet) $('sbScroll').scrollTop = 0;
}
// ---- icons: pre-baked sizes only (notes §5.3-6). Tiles are baked at B = 24 / 32 / 48 css-art px and shown at a whole factor f
// (48 x2 / x3 on DPR 2 / 3 screens); the browser never resamples them by a non-integer factor.
const btns = {}, rbtns = {}, cells = [];
const RICON_ORDER = ['hollow', 'plating', 'rockets', 'barrels', 'blessed', 'halo', 'holyground'];
const RICON = {}; // B -> Image (assets/ui/loop4-research-icons{,-32,-24}.png; rect x = 2 + i (B + 2), y = 2)
if (typeof Image !== 'undefined') for (const B of [48, 32, 24]) { const im = new Image(); im.onload = () => { RICON[B] = im; iconKey = ''; if (cells.length) bakeIcons(); }; im.src = 'assets/ui/loop4-research-icons' + (B === 48 ? '' : '-' + B) + '.png'; }
function iconScale(css) { const D = Math.round(css * DPR); for (const [B, f] of [[48, 3], [48, 2], [48, 1], [32, 1], [24, 1]]) if (B * f <= D) return { D, B, f, o: Math.floor((D - B * f) / 2) }; return { D, B: 24, f: 1, o: 0 }; }
const bevelOf = B => (B >= 48 ? 2 : 1);
function bevelTile(c, B) {
  const b = bevelOf(B);
  c.fillStyle = '#121314'; c.fillRect(0, 0, B, B); c.fillStyle = '#55595D'; c.fillRect(1, 1, B - 2, B - 2);
  c.fillStyle = '#26282A'; c.fillRect(1 + b, 1 + b, B - 2 - b, B - 2 - b); c.fillStyle = '#232527'; c.fillRect(1 + b, 1 + b, B - 2 - 2 * b, B - 2 - 2 * b);
}
// the engine's own sprite (atlas art when loaded, else procedural) at 1:1, trimmed to its bounding box
function cameoSrc(kind, id) {
  const cv = document.createElement('canvas'), c = cv.getContext('2d');
  if (kind === 'b') {
    const d = BDEF[id]; cv.width = d.w * TILE + 64; cv.height = d.h * TILE + 96; c.imageSmoothingEnabled = false; c.translate(32, 64);
    const fb = { tx: 0, ty: 0, w: d.w, h: d.h, x: d.w * 16, y: d.h * 16, anim: 1, side: 0, type: id, charge: 0, tang: 0, hitT: 0, hp: 1, maxhp: 1 };
    const P = typeof UnitArt !== 'undefined' ? UnitArt.planBuilding(fb, { p: 1, nukeCharge: NUKE_CHARGE }) : null; // the idle frame (silo: closed), turret head at its mount
    if (P) { UnitArt.drawBuildingBody(c, P, {}); if (P.sel.top) UnitArt.drawBuildingTop(c, P, {}); } else drawBld(c, fb);
  } else {
    cv.width = 128; cv.height = 128; c.imageSmoothingEnabled = false; c.translate(64, 72);
    drawUnit(c, { type: id, x: 0, y: 0, ang: Math.PI / 2, tang: Math.PI / 2, anim: 1, d: UDEF[id], load: 150, hs: '', moving: false, hitT: 0, r: UDEF[id].r, side: 0, hp: 1, maxhp: 1 });
  }
  const im = c.getImageData(0, 0, cv.width, cv.height).data; let x0 = cv.width, y0 = cv.height, x1 = -1, y1 = -1;
  for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) if (im[(y * cv.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  return { cv, im, W: cv.width, x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
// exact k x k box average (premultiplied alpha), k a whole number: the engine version of PIL reduce(k)
function boxReduce(S, k) {
  const W = Math.ceil(S.w / k), H = Math.ceil(S.h / k), out = new ImageData(W, H), o = out.data, n = k * k;
  for (let oy = 0; oy < H; oy++) for (let ox = 0; ox < W; ox++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) {
      const x = S.x + ox * k + i, y = S.y + oy * k + j; if (x >= S.x + S.w || y >= S.y + S.h) continue;
      const p = (y * S.W + x) * 4, al = S.im[p + 3]; r += S.im[p] * al; g += S.im[p + 1] * al; b += S.im[p + 2] * al; a += al;
    }
    const q = (oy * W + ox) * 4; if (a > 0) { o[q] = r / a; o[q + 1] = g / a; o[q + 2] = b / a; } o[q + 3] = a / n;
  }
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; cv.getContext('2d').putImageData(out, 0, 0); return cv;
}
const tileCache = new Map();
let artDone = typeof UnitArt === 'undefined';
function rebakeArt() { artDone = true; tileCache.clear(); bakeIcons(); }
function bakeTile(kind, id, B) {
  const key = kind + ':' + id + ':' + B; if (tileCache.has(key)) return tileCache.get(key);
  const cv = document.createElement('canvas'); cv.width = B; cv.height = B; const c = cv.getContext('2d'); c.imageSmoothingEnabled = false;
  let final = true;
  if (kind === 'r') {
    const im = RICON[B], i = RICON_ORDER.indexOf(id);
    if (im && i >= 0) c.drawImage(im, 2 + i * (B + 2), 2, B, B, 0, 0, B, B);
    else { bevelTile(c, B); const g = researchIcon(id); c.drawImage(g, 0, 0, 56, 38, 0, Math.floor((B - B * 38 / 56) / 2), B, Math.floor(B * 38 / 56)); final = false; }
  } else {
    bevelTile(c, B);
    const small = B < 48, inner = B - (small ? 4 : 6);
    let S = null; try { S = cameoSrc(kind, id); } catch (e) { S = null; }
    if (S) {
      let art;
      if (kind === 'u' && Math.max(S.w, S.h) <= inner) { const k = Math.max(1, Math.floor(inner / Math.max(S.w, S.h))); art = document.createElement('canvas'); art.width = S.w * k; art.height = S.h * k; const a = art.getContext('2d'); a.imageSmoothingEnabled = false; a.drawImage(S.cv, S.x, S.y, S.w, S.h, 0, 0, S.w * k, S.h * k); }
      else art = boxReduce(S, Math.max(1, Math.ceil(Math.max(S.w, S.h) / inner)));
      c.drawImage(art, Math.floor((B - art.width) / 2), B - (small ? 2 : 3) - art.height - Math.max(0, Math.floor((inner - art.height) / 4)));
    }
    final = artDone; // until the atlases load the cameo is procedural; it is re-baked once they are in
  }
  if (final) tileCache.set(key, cv);
  return cv;
}
function bakeIcons() {
  if (typeof document === 'undefined' || !TIER) return;
  const css = SB_TIERS[TIER].icon;
  for (const cell of cells) {
    const sc = iconScale(css); cell.sc = sc;
    for (const cv of [cell.ic, cell.wipe]) { if (cv.width !== sc.D) { cv.width = sc.D; cv.height = sc.D; } }
    const c = cell.ic.getContext('2d'); c.imageSmoothingEnabled = false; c.clearRect(0, 0, sc.D, sc.D);
    try { c.drawImage(bakeTile(cell.kind, cell.id, sc.B), sc.o, sc.o, sc.B * sc.f, sc.B * sc.f); } catch (e) { /* keep the cell blank rather than break the sidebar */ }
    cell.lastWipe = null;
  }
}
// clock-wipe (notes §9, Director decision): the dark sector covers the *remaining* part, clearing clockwise from 12 o'clock; clipped
// to the tile's inner rect (inside the edge + bevel) with a half-diagonal radius, so the wipe is square. 48 px tiers only.
function drawWipe(cell, p) {
  const w = cell.wipe, c = w.getContext('2d'), key = p === null ? 'off' : Math.round(p * 400);
  if (cell.lastWipe === key) return; cell.lastWipe = key;
  c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, w.width, w.height);
  if (p === null) return;
  const { B, f, o } = cell.sc, ins = (1 + bevelOf(B)) * f, x0 = o + ins, s = B * f - 2 * ins, cx = x0 + s / 2, cy = x0 + s / 2, R = Math.SQRT2 * s / 2 + 1;
  const a0 = -Math.PI / 2 + 2 * Math.PI * Math.min(1, Math.max(0, p));
  c.save(); c.beginPath(); c.rect(x0, x0, s, s); c.clip();
  if (p < 1) { c.fillStyle = 'rgba(0,0,0,0.6)'; c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, R, a0, 1.5 * Math.PI); c.closePath(); c.fill(); }
  c.strokeStyle = 'rgba(159,232,255,0.7)'; c.lineWidth = f; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R); c.stroke();
  c.restore();
}
function makeCell(grid, kind, id, name, onClick, onCancel) {
  const b = document.createElement('div'); b.className = 'btn'; b.dataset.id = id;
  b.innerHTML = `<canvas class="ic"></canvas><canvas class="wipe"></canvas><span class="nm">${name}</span><span class="cs"></span><div class="bar"></div><span class="cnt"></span>`;
  b.addEventListener('click', onClick);
  b.addEventListener('contextmenu', e => { e.preventDefault(); onCancel(); });
  grid.appendChild(b);
  const cell = { el: b, kind, id, name, ic: b.querySelector('.ic'), wipe: b.querySelector('.wipe'), cs: b.querySelector('.cs'), bar: b.querySelector('.bar'), cnt: b.querySelector('.cnt'), lastWipe: null, sc: null };
  cells.push(cell); return cell;
}
function buildSidebar() {
  cells.length = 0;
  for (const [grid, list] of [[$('bGrid'), BORDER], [$('uGrid'), UORDER[0]]]) {
    grid.innerHTML = '';
    for (const type of list) {
      const isB = !!BDEF[type], d = isB ? BDEF[type] : UDEF[type];
      btns[type] = makeCell(grid, isB ? 'b' : 'u', type, isB ? d.name[0] : d.name, () => onBuildBtn(type), () => { if (G) { cancelItem(0, type); if (G.placing === type && !G.queues[0].structure.ready) G.placing = null; } });
    }
  }
  // Loop 4 research (Armory / Church): click to queue, right-click to cancel
  const rg = $('rGrid'); if (rg) {
    rg.innerHTML = '';
    for (const at of ['armory', 'church']) for (const id of Combat.RORDER[at]) {
      const R = Combat.RESEARCH[id];
      rbtns[id] = makeCell(rg, 'r', id, R.name, () => { if (G && !G.over) { initAudio(); queueResearch(0, id); } }, () => { if (G) cancelResearch(0, id); });
    }
  }
  iconKey = ''; applyTier();
}
// procedural research icons (art pending): a glyph on the research building's colours
function researchIcon(id) {
  const cv = document.createElement('canvas'); cv.width = 56; cv.height = 38; const c = cv.getContext('2d');
  const at = Combat.RESEARCH[id].at, holy = at === 'church';
  c.fillStyle = holy ? '#E8E2D0' : '#5E6B34'; c.beginPath(); c.arc(28, 19, 16, 0, 7); c.fill();
  c.strokeStyle = holy ? '#9FE8FF' : '#E8D23A'; c.lineWidth = 2; c.stroke();
  c.fillStyle = holy ? '#3A7BFF' : '#E8D23A'; c.strokeStyle = c.fillStyle;
  switch (id) {
    case 'hollow': for (const ox of [-6, 0, 6]) { c.fillRect(25 + ox, 13, 5, 10); c.beginPath(); c.arc(27.5 + ox, 13, 2.5, Math.PI, 0); c.fill(); } break;
    case 'plating': c.beginPath(); c.moveTo(28, 8); c.lineTo(38, 12); c.lineTo(36, 24); c.lineTo(28, 30); c.lineTo(20, 24); c.lineTo(18, 12); c.fill(); break;
    case 'rockets': c.save(); c.translate(28, 19); c.rotate(-0.8); c.fillRect(-10, -2.5, 16, 5); c.beginPath(); c.moveTo(6, -3); c.lineTo(12, 0); c.lineTo(6, 3); c.fill(); c.fillStyle = '#ff7a20'; c.fillRect(-14, -1.5, 4, 3); c.restore(); break;
    case 'barrels': c.fillRect(16, 16, 24, 6); c.fillRect(22, 22, 5, 7); c.fillStyle = '#ff7a20'; c.beginPath(); c.arc(42, 19, 3, 0, 7); c.fill(); break;
    case 'blessed': c.fillRect(26, 9, 4, 20); c.fillRect(20, 14, 16, 4); break;
    case 'halo': c.lineWidth = 3; c.beginPath(); c.ellipse(28, 19, 11, 5, 0, 0, 7); c.stroke(); break;
    case 'holyground': c.lineWidth = 2; for (const r of [5, 10]) { c.beginPath(); c.arc(28, 19, r, 0, 7); c.stroke(); } c.fillRect(27, 15, 2, 8); c.fillRect(25, 17, 6, 2); break;
  }
  return cv;
}
function onBuildBtn(type) {
  if (!G || G.over) return; initAudio();
  const q = G.queues[0].structure;
  if (BDEF[type] && q.ready === type) { G.placing = type; G.mode = null; hint('Click to place ' + bname(type, 0) + ' near your base · Right-click / Esc to cancel'); return; }
  queueItem(0, type);
}
const fmtN = n => Math.floor(n).toLocaleString('en-US');
// one cell's look: state classes, the cost line, the queue count, the 2 px bar and (48 px tiers) the clock-wipe
function setCell(cell, o) {
  const b = cell.el;
  for (const k of ['locked', 'poor', 'ready', 'placing', 'prog', 'hold', 'stall', 'limit', 'done']) b.classList.toggle(k, !!o[k]);
  if (cell.cs.textContent !== o.label) cell.cs.textContent = o.label;
  const cnt = o.cnt ? String(o.cnt) : ''; if (cell.cnt.textContent !== cnt) cell.cnt.textContent = cnt;
  const bw = o.p === null ? '0' : (100 * o.p).toFixed(1) + '%'; if (cell.bar.style.width !== bw) cell.bar.style.width = bw;
  if (b.title !== o.title) b.title = o.title;
  if (cell.sc) drawWipe(cell, SB_TIERS[TIER].icon >= 48 && o.p !== null && o.prog ? o.p : null);
}
function updSidebar() {
  if (!G) return;
  if (!artDone && typeof UnitArt !== 'undefined' && UnitArt.state) { const r = UnitArt.state.ready; if (r['bld:survivors'] && r.survivors && r['survivors-l4']) { rebakeArt(); setTimeout(rebakeArt, 1500); } }
  const cap = storageCapOf(0), crd = G.credits[0], pw = powerOf(0);
  $('cr').textContent = fmtN(crd); $('cap').textContent = '/' + fmtN(cap);
  $('credits').classList.toggle('amber', crd >= cap * SD.storageAmberAt && crd < cap); $('credits').classList.toggle('full', crd >= cap);
  $('credits').title = `Credits ${fmtN(crd)} / storage ${fmtN(cap)}`;
  // superweapon charge (only while a Silo exists on either side); short screens fold it into the power row (notes §7)
  const ps = G.blds.filter(b => b.side === 0 && b.type === 'silo' && !b.dead).sort((a, b) => b.charge - a.charge)[0];
  const es = G.blds.filter(b => b.side === 1 && b.type === 'silo' && !b.dead).sort((a, b) => b.charge - a.charge)[0];
  $('power').className = pw.net < 0 ? 'low' : '';
  let ph = `<span>PWR</span><div class="meter"><div style="width:${pw.made ? Math.min(100, 100 * pw.used / pw.made) : 100}%"></div></div><span>${pw.used}/${pw.made}${pw.net < 0 ? ' LOW' : ''}</span>`;
  if (SHORT && (ps || es)) { const sv = ps || es, f = Math.min(1, sv.charge / NUKE_CHARGE); ph += ps && f >= 1 ? '<button id="bNuke2">FIRE</button>' : `<div class="smeter${ps ? '' : ' enemy'}" title="${ps ? 'Nuke' : 'Hell Silo'} ${Math.floor(f * 100)}%"><div style="width:${f * 100}%"></div></div>`; }
  if ($('power').innerHTML !== ph) { $('power').innerHTML = ph; const bn = $('bNuke2'); if (bn) bn.onclick = () => startNuke(); }
  let h = '';
  if (!SHORT) {
    if (ps) { const f = Math.min(1, ps.charge / NUKE_CHARGE); h += `<div class="row"><span class="gold">NUKE</span><div class="meter"><div style="width:${f * 100}%"></div></div>${f >= 1 ? '<button id="bNuke">FIRE</button>' : Math.floor(f * 100) + '%'}</div>`; }
    if (es) { const f = Math.min(1, es.charge / NUKE_CHARGE); h += `<div class="row"><span class="red">${TIER === 'S' ? 'HELL' : 'HELL SILO'}</span><div class="meter enemy"><div style="width:${f * 100}%"></div></div>${Math.floor(f * 100)}%</div>`; }
  }
  $('super').style.display = h ? '' : 'none';
  if ($('super').innerHTML !== h) { $('super').innerHTML = h; const bn = $('bNuke'); if (bn) bn.onclick = () => startNuke(); }
  // build / unit cells
  const Q = G.queues[0];
  for (const type in btns) {
    const cell = btns[type], cat = catOf(type), q = Q[cat], d = BDEF[type] || UDEF[type], nm = BDEF[type] ? d.name[0] : d.name;
    const locked = !prereqOk(0, type), lim = UDEF[type] && UDEF[type].limit, full = !!(lim && atLimit(0, type));
    const ready = cat === 'structure' && q.ready === type, active = q.list[0] === type && !q.ready;
    const hold = active && (locked || !!(lim && aliveOf(0, type) >= lim)), n = q.list.filter(t => t === type).length;
    setCell(cell, {
      locked, ready: ready && G.placing !== type, placing: G.placing === type, prog: active, hold, limit: full,
      poor: !active && !ready && G.credits[0] < costOf(type), stall: false, // paid in full when queued, so a build never stalls on Credits
      p: active ? q.prog / timeOf(type) : null,
      cnt: cat === 'structure' ? (n > 1 ? n : 0) : n,
      label: ready ? 'READY' : full ? `Limit ${lim}` : fmtN(costOf(type)),
      title: `${nm}${locked ? ' (needs ' + missingReq(0, type) + ')' : ''}: ${d.desc}. Cost ${d.cost}, ${d.time}s.${ready ? ' Ready: click to place.' : ''}`,
    });
  }
  for (const id in rbtns) {
    const cell = rbtns[id], R = Combat.RESEARCH[id], st = researchState(0, id), q = G.rq[0][R.at];
    setCell(cell, {
      locked: st === 'locked', done: st === 'done', prog: st === 'active', poor: st === 'ready' && G.credits[0] < R.cost,
      p: st === 'active' ? q.prog / R.time : null, cnt: st === 'queued' ? q.list.indexOf(id) + 1 : 0,
      label: st === 'done' ? 'DONE' : fmtN(R.cost),
      title: `${R.name} (${BDEF[R.at].name[0]})${st === 'locked' ? ' (needs ' + researchMissing(0, id) + ')' : ''}: ${R.desc}. Cost ${R.cost}, ${R.time}s.${st === 'active' ? ' Researching ' + Math.floor(100 * q.prog / R.time) + '%.' : st === 'queued' ? ' Queued.' : ''}`,
    });
  }
  // tabs: queue badge (items queued in that tab) + ready dot (a structure waiting to be placed); hidden tabs still report progress
  const nB = Q.structure.list.length, nU = QCATS.filter(c => c !== 'structure').reduce((a, c) => a + Q[c].list.length, 0), nR = Object.values(G.rq[0]).reduce((a, q) => a + q.list.length, 0);
  document.querySelectorAll('#tabs .tab').forEach((e, i) => {
    const n = [nB, nU, nR][i], qb = e.querySelector('.qb'), t = n ? String(n) : ''; if (qb.textContent !== t) qb.textContent = t;
    e.classList.toggle('rdy', i === 0 && !!Q.structure.ready);
  });
  const uq = $('uQueue'); if (uq) { const t = nU ? 'queue ' + nU : ''; if (uq.textContent !== t) uq.textContent = t; }
  // merged list: the Research block shows once an Armory or Church exists
  $('secR').classList.toggle('none', merged && !hasBld(0, 'armory') && !hasBld(0, 'church'));
  const sc = $('sbScroll'); sc.classList.toggle('more', sc.scrollHeight - sc.scrollTop - sc.clientHeight > 1);
  // selection info
  let s = '';
  const sel = G.sel.filter(e => !e.dead);
  if (sel.length === 1) {
    const e = sel[0];
    s = `<b style="color:${SIDES[e.side].ui}">${ename(e)}</b> <small>${e.side ? '(enemy)' : ''}</small><div class="hp"><div style="width:${100 * e.hp / e.maxhp}%"></div></div>HP ${Math.ceil(e.hp)}/${e.maxhp}<br><small>${e.kind === 'u' ? e.d.desc : e.d.desc}</small>`;
    if (e.kind === 'u' && e.d.harv) s += `<br>Load: ${e.load}/${e.d.cap} · ${e.blocked ? 'storage full, waiting at dock' : ({ seek: 'looking for Salvage', toField: 'heading to a Scrap Pile', gather: 'gathering', toPlant: 'returning to ' + bname(e.dock && e.dock.type === 'hq' ? 'hq' : 'refinery', e.side), queue: 'waiting for the dock', unload: 'unloading', idle: 'no Salvage found', noPlant: 'no ' + bname('refinery', e.side) + ' to unload at', parked: 'parked (right-click a Scrap Pile to resume)' })[e.hs] || ''}`;
    if (e.kind === 'b' && (e.type === 'refinery' || e.type === 'hq') && e.dockQ) s += `<br>Dock: ${e.dockQ.length ? e.dockQ.length + ' truck(s), 1 unloading at a time' : 'free'}`;
    if (e.kind === 'b' && e.side === 0 && ['hq', 'barracks', 'factory', 'church'].includes(e.type)) s += '<br><small>Right-click the ground to set a rally point.</small>';
    if (e.kind === 'b' && Combat.RORDER[e.type] && (e.side === 0 || isVisible(e))) {
      const q = G.rq[e.side][e.type];
      s += '<br>Research: ' + Combat.RORDER[e.type].map(id => { const st = researchState(e.side, id), R = Combat.RESEARCH[id]; return `<span style="color:${st === 'done' ? '#7dff7d' : st === 'active' ? '#9FE8FF' : '#8a8e92'}">${R.name}${st === 'done' ? ' ✓' : st === 'active' ? ' ' + Math.floor(100 * q.prog / R.time) + '%' : st === 'queued' ? ' (queued)' : ''}</span>`; }).join(' · ');
    }
    if (e.kind === 'u' && e.d.limit) s += `<br><small>Limit ${e.d.limit} alive (${aliveOf(e.side, e.type)}/${e.d.limit})</small>`;
    if (e.kind === 'b' && e.type === 'hq') s += `<br><small>Built-in turret: ${Combat.TOWERS.hq.dmg} dmg, range ${Combat.TOWERS.hq.range} tiles, hits air, no power.</small>`;
  } else if (sel.length > 1) {
    const c = {}; for (const e of sel) c[ename(e)] = (c[ename(e)] || 0) + 1;
    s = `<b>${sel.length} selected</b><br>` + Object.entries(c).map(([k, v]) => `${v} × ${k}`).join('<br>');
  } else s = '<span style="color:#6E7378">Nothing selected.<br>Drag to select units. Right-click to command.</span>';
  s += `<br><small style="color:#6E7378">Time ${fmtT(G.time)} · ${G.diff.name} · Horde waves sent: ${G.ai.waveN}</small>`;
  // short screens (< 720 tall): one 24 px line, name + HP bar (notes §7); the full text stays in the tooltip
  if (SHORT) {
    const e = sel.length === 1 ? sel[0] : null;
    s = e ? `<div class="one"><b style="color:${SIDES[e.side].ui}">${ename(e)}</b><div class="hp"><div style="width:${100 * e.hp / e.maxhp}%"></div></div></div>`
      : `<div class="one">${sel.length ? `<b>${sel.length} selected</b>` : '<span style="color:#6E7378">Nothing selected</span>'}<small style="color:#6E7378">${fmtT(G.time)}</small></div>`;
  }
  if ($('sel').innerHTML !== s) $('sel').innerHTML = s;
}
const fmtT = t => { t = Math.max(0, Math.ceil(t)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
function hint(t) { const h = $('modeHint'); if (t) { h.textContent = t; h.style.display = 'block'; } else h.style.display = 'none'; }
function startNuke() { if (!G || !readySilo(0)) return; G.mode = 'nuke'; G.placing = null; hint('Click a target for the nuke · Right-click / Esc to cancel'); }

// ---------------- input ----------------
const mouse = { x: 0, y: 0, wx: 0, wy: 0, in: false, down: false, drag: false, dx: 0, dy: 0, sx: 0, sy: 0 };
const keys = {};
let lastClick = { t: 0, type: null };
function updMouseWorld() { mouse.wx = mouse.x / ZS + cam.x; mouse.wy = mouse.y / ZS + cam.y; }
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
// Job E: wheel zoom toward the cursor (the view only: the sidebar / minimap scroll or ignore the wheel); never scrolls the page
view.addEventListener('wheel', e => {
  e.preventDefault(); if (!G || !e.deltaY) return;
  const r = view.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top;
  zoomStep(e.deltaY < 0 ? 1 : -1, mouse.x, mouse.y);
}, { passive: false });
mini.addEventListener('wheel', e => e.preventDefault(), { passive: false });
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
    if (placeBld(0, G.placing, tx, ty)) { G.placing = null; hint(); } else { const r = placeCheck(0, G.placing, tx, ty, 0).reason; msg(r && r !== 'Blocked' ? `Cannot place there: ${r}.` : 'Cannot place there. Build on clear ground near your base.', '#ff6a5a'); sfx('err'); }
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
    else if (t && t.kind === 'b' && t.side === 0 && (t.type === 'refinery' || t.type === 'hq')) orderDock(h, t);
    else orderMove(h, wx, wy);
  }
  if (harv.length && ((ti >= 0 && ti < N && res[ti] > 0) || (t && t.kind === 'b' && t.side === 0 && (t.type === 'refinery' || t.type === 'hq')))) {
    const dp = t && (t.type === 'refinery' || t.type === 'hq') ? dockPoint(t) : { x: (ti % MW) * TILE + 16, y: ((ti / MW) | 0) * TILE + 16 };
    G.fx.push({ k: 'arrow', x: dp.x, y: dp.y, t: 0, dur: 0.8 });
    if (!rest.length) { sfx('click'); return; }
  }
  if (rest.length) issueMove(rest, wx, wy, false);
  G.fx.push({ k: 'spark', x: wx, y: wy, c: '#7dff7d', t: 0, dur: 0.4 });
  sfx('click');
}
// minimap
function miniToWorld(e) { const r = mini.getBoundingClientRect(), f = MBOX / (mini.clientWidth || MBOX), px = (e.clientX - r.left - mini.clientLeft) * f, py = (e.clientY - r.top - mini.clientTop) * f; return { x: clamp((px - MOX) / MP, 0, MW) * TILE, y: clamp((py - MOY) / MP, 0, MH) * TILE }; }
let miniDown = false;
mini.addEventListener('contextmenu', e => e.preventDefault());
mini.addEventListener('mousedown', e => { if (!G) return; const p = miniToWorld(e); if (e.button === 2) { const my = G.sel.filter(u => u.kind === 'u' && u.side === 0 && !u.dead); if (my.length) command(p.x, p.y); return; } miniDown = true; centerOn(p.x, p.y); });
window.addEventListener('mousemove', e => { if (miniDown && G) { const p = miniToWorld(e); centerOn(p.x, p.y); } });
window.addEventListener('mouseup', () => { miniDown = false; });
function centerOn(x, y) { cam.x = x - VW / 2; cam.y = y - VH / 2; clampCam(); }
// a map narrower / shorter than the view is centred (UI notes §7: the outside stays the void)
function clampCam() {
  cam.x = VW > MW * TILE + 80 ? (MW * TILE - VW) / 2 : clamp(cam.x, -40, MW * TILE - VW + 40);
  cam.y = VH > MH * TILE + 80 ? (MH * TILE - VH) / 2 : clamp(cam.y, -40, MH * TILE - VH + 40);
}
window.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (!G || !G.started) return;
  if (e.code === 'Escape') { if (G.placing || G.mode) { G.placing = null; G.mode = null; hint(); } else togglePause(); e.preventDefault(); return; }
  if (e.code === 'KeyP') { togglePause(); return; }
  if (e.code === 'KeyM') { toggleMute(); return; }
  if (G.paused || G.over) return;
  if (e.code in TAB_KEYS && !e.ctrlKey && !e.metaKey && !e.altKey) { showTab(TAB_KEYS[e.code]); return; } // tabs (merged list: scroll to the section)
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
  const sp = 800 * dt / ZS; let dx = 0, dy = 0; // the same screen speed at every zoom
  if (keys.ArrowLeft || keys.KeyA) dx -= sp;
  if (keys.ArrowRight || keys.KeyD) dx += sp; if (keys.ArrowUp || keys.KeyW) dy -= sp; if (keys.ArrowDown || keys.KeyS) dy += sp;
  if (mouse.in && !mouse.down && document.hasFocus()) { const m = EDGE_SCROLL_PX; if (mouse.x < m) dx -= sp; if (mouse.x > SW - m) dx += sp; if (mouse.y < m) dy -= sp; if (mouse.y > SH - m) dy += sp; }
  if (dx || dy) { cam.x += dx; cam.y += dy; clampCam(); updMouseWorld(); }
}

// ---------------- game flow ----------------
function togglePause() { if (!G || G.over) return; G.paused = !G.paused; showPanel(G.paused ? 'pausePanel' : null); $('bPause').textContent = G.paused ? 'Resume (P)' : 'Pause (P)'; }
function toggleMute() { muted = !muted; $('bMute').textContent = $('bMute2').textContent = 'Sound: ' + (muted ? 'Off' : 'On'); }
function showPanel(id) { for (const p of document.querySelectorAll('.panel')) p.classList.toggle('show', p.id === id); $('overlay').classList.toggle('show', !!id); }
function newGame(diffKey, opts) {
  opts = opts || {};
  const seed = (simRand() * 1e9) | 0; rng = mulberry32(seed);
  const dm = opts.map || (opts.map === undefined ? designMap : null);
  setMapSize(dm ? dm.w : 80, dm ? dm.h : 80);
  setZoom(ZOOM); // re-clamp the camera to the new map size
  idc = 0; bById.clear();
  if ($('msgs')) $('msgs').innerHTML = '';
  G = { seed, time: 0, diff: DIFF[diffKey] || DIFF.normal, diffKey, units: [], blds: [], proj: [], fx: [], decals: [], rad: [], missiles: [], rises: [], sel: [], groups: {},
    credits: [SD.startScripPlayer, (DIFF[diffKey] || DIFF.normal).startScripAI ?? SD.startScripAI], queues: [mkQ(), mkQ()], rq: [mkRQ(), mkRQ()], research: [{}, {}], stats: { kills: 0, lost: 0, bKills: 0, bLost: 0, built: 0, bBuilt: 0, salvage: 0, nukes: 0 },
    over: false, paused: false, started: false, mode: null, placing: null, ai: { t: 1, nextWave: 0, waveN: 0 }, fogT: 0, winT: 0, shakeA: 0,
    baseP: { x: 9, y: MH - 10 }, baseE: { x: MW - 10, y: 9 } };
  G.ai.nextWave = G.diff.firstWave;
  if (dm) { // starts are the HQ / Hive top-left tiles
    const s1 = dm.starts.find(s => s.id === 1 || s.side === 'survivors'), s2 = dm.starts.find(s => s.id === 2 || s.side === 'horde');
    G.baseP = { x: s1.x + 1, y: s1.y + 1 }; G.baseE = { x: s2.x + 1, y: s2.y + 1 }; G.mapName = dm.name;
    applyDesignMap(dm);
  } else genMap();
  SAL = makeSalvage();
  buildHalf();
  const P = G.baseP;
  for (const side of [0, 1]) {
    const place = (type, tx, ty) => { const d = BDEF[type]; if (side === 1) { tx = MW - tx - d.w; ty = MH - ty - d.h; } return makeBld(type, side, tx, ty); };
    // Loop 4 opening: the HQ / Hive (+ addendum 1d: one free harvester each, below; player 2,000, AI 2,500 Credits)
    if (dm && side === 1) makeBld('hq', 1, G.baseE.x - 1, G.baseE.y - 1);
    else place('hq', P.x - 1, P.y - 1);
  }
  // addendum 1d: one free Scrap Truck / Scrap Eater per side, at the HQ / Hive spawn point (dock side), gathering from 0:00
  for (const side of [0, 1]) { const hq = G.blds.find(b => b.side === side && b.type === 'hq'); const sp = spawnPoint(hq); const h = makeUnit(side ? 'reaper' : 'gleaner', side, sp.x, sp.y); h.hs = 'seek'; }
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
  rng = mulberry32(seed | 0); idc = 0; bById.clear(); setMapSize(80, 80);
  G = { seed, time: 0, diff: DIFF.normal, diffKey: 'normal', units: [], blds: [], proj: [], fx: [], decals: [], rad: [], missiles: [], rises: [], sel: [], groups: {},
    credits: [0, 0], queues: [mkQ(), mkQ()], rq: [mkRQ(), mkRQ()], research: [{}, {}], stats: { kills: 0, lost: 0, bKills: 0, bLost: 0, built: 0, bBuilt: 0, salvage: 0, nukes: 0, risen: 0, purified: 0, crushed: 0, burned: 0, blessed: 0 },
    over: false, paused: false, started: true, mode: null, placing: null, ai: { t: 1e9, nextWave: 1e9, waveN: 0 }, fogT: 0, winT: 0, shakeA: 0, arena: true,
    baseP: { x: 2, y: 2 }, baseE: { x: MW - 3, y: MH - 3 }, mapSrc: null };
  terr = new Uint8Array(N); res = new Uint16Array(N); plague = new Uint8Array(N);
  bgrid = new Int32Array(N); vis = new Uint8Array(N); expl = new Uint8Array(N);
  plagueZones = []; craters = []; decos = [];
  SAL = makeSalvage();
  buildHalf();
  return G;
}
function step(dt) {
  G.time += dt;
  if (!G.arena) { updProduction(dt); updResearch(dt); updAI(dt); }
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
  G.winT -= dt; if (G.winT <= 0 && !G.arena) { G.winT = 0.5; checkEnd(); spotExpansions(); const low = powerOf(0).net < 0; if (low && !G.lowPower) { msg('Low power: production at half speed. Build a Power Plant.', '#ff5a4a'); sfx('alert'); } G.lowPower = low; }
}
// spec §6: the first time the player sees a remote Grinder Pit: a line and a minimap ping, no map reveal
function spotExpansions() { for (const b of G.blds) if (b.side === 1 && b.remote && !b.dead && !b.spotted && isVisible(b)) { b.spotted = true; msg('Enemy expansion spotted', '#ff9a5a', b.x, b.y); ping(b.x, b.y, '#ff5a3a'); sfx('alert'); } }
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
  govern(ts, ts - lastTs);
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
$('bRestart2').onclick = () => $('bRestart').onclick();
$('bMute2').onclick = () => toggleMute();
document.querySelectorAll('#tabs .tab').forEach((e, i) => { e.onclick = () => showTab(i); });
$('bMenu').onclick = () => { if (TIER === 'L') { mergePref = !mergePref; applyTier(); if (G) updSidebar(); } else togglePause(); };
$('sbScroll').addEventListener('scroll', () => { const sc = $('sbScroll'); sc.classList.toggle('more', sc.scrollHeight - sc.scrollTop - sc.clientHeight > 1); });
resize();
showPanel('startPanel');
// unit art v2: ?unitart=off forces procedural sprites; ?unitart=baked skips the recolour (baked colour atlases); ?team0=red / ?team1=red pick the alternate team colour
if (typeof UnitArt !== 'undefined') {
  const q = new URLSearchParams(location.search), team = {};
  if (q.get('team0')) team[0] = q.get('team0'); if (q.get('team1')) team[1] = q.get('team1');
  if (q.get('unitart') !== 'off') UnitArt.load({ team, baked: q.get('unitart') === 'baked' }).then(() => { rebakeArt(); setTimeout(rebakeArt, 1500); }, rebakeArt); // re-bake the cameos from the atlases (again after a baked-atlas fallback)
  else artDone = true;
}
// env art pass 1: ?envart=off keeps the procedural ground (nothing fetched); atlas failure -> same fallback, one warning
if (typeof EnvArt !== 'undefined') EnvArt.load({ off: new URLSearchParams(location.search).get('envart') === 'off' });
// design maps: ?map=crossroads | fallen-city | ash-ring (assets/maps/<name>.json). The Start button waits for it; a failed fetch keeps the procedural map.
// ?seed=N: fixed sim seed (same stream as a headless seed N); RTS.seed(N) does the same from a script
{ const sq = typeof URLSearchParams !== 'undefined' && typeof location !== 'undefined' ? new URLSearchParams(location.search).get('seed') : null; if (sq !== null && sq !== '' && isFinite(+sq)) seedSim(+sq); }
{ const mq = typeof URLSearchParams !== 'undefined' && typeof location !== 'undefined' ? new URLSearchParams(location.search).get('map') : null;
  if (mq && /^[a-z0-9-]+$/.test(mq) && typeof fetch !== 'undefined') {
    const bs = $('bStart'); bs.disabled = true;
    fetch('assets/maps/' + mq + '.json').then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(m => { designMap = m; }, e => console.warn('[map] ' + mq + ': ' + e.message + ' - using the procedural map'))
      .then(() => { bs.disabled = false; });
  } }
requestAnimationFrame(frame);
// test hook
window.RTS = { AI_RUSH_DEFENSE, AI_FIRST_NUKE_MIN, RUSH, aiRushCheck, seed: seedSim, get simRand() { return simRand; }, get BARRACKS_NEEDS_YARD() { return BARRACKS_NEEDS_YARD; }, setBarracksNeedsYard, prereqOk, missingReq, spawnPoint, dropCargo, get ZOOM() { return ZOOM; }, ZOOMS, setZoom, zoomStep, zoomMin, get view() { return { SW, SH, VW, VH, DPR, ZOOM, KS, ZS, lowRes, tier: TIER, merged, short: SHORT, mini: { box: MBOX, px: MP, ox: MOX, oy: MOY } }; }, autoZoom, zoomMax, get userZoom() { return userZoom; }, set userZoom(v) { userZoom = !!v; }, get mouse() { return mouse; }, placeCheck, remoteCheck, buildHalf, reachOf, aiRemoteSpot, aiFindSpot, aiSpotNear, aiServedLow, get expl() { return expl; }, get vis() { return vis; }, REMOTE: { REMOTE_STRIP, REMOTE_ENEMY_UNIT, REMOTE_ENEMY_BLD, REMOTE_SALVAGE_GAP, REMOTE_EXTENDS_RADIUS, REMOTE_SETUP_S, REMOTE_SETUP_HP0, AI_PIT_CAP, AI_REMOTE_EASY_FROM }, get MW() { return MW; }, get MH() { return MH; }, TILE, T, get terr() { return terr; }, get bgrid() { return bgrid; }, get decos() { return decos; }, findPath, walk, applyDesignMap, setMapSize, envSourceMap, envPrepare, get designMap() { return designMap; }, set designMap(m) { designMap = m; }, get envStats() { return G && G.env ? G.env.stats : null; }, get blockedTiles() { let n = 0; for (let i = 0; i < N; i++) if (BLOCK[terr[i]]) n++; return n; }, get plague() { return plague; }, get res() { return res; }, newArena, Combat, findEnemy, kill, damage, issueMove, orderAttack, separate, makeUnit, makeBld, get G() { return G; }, get SAL() { return SAL; }, Salvage, storageCapOf, powerOf, bldBusy, bldOverlayOn, hqShotPhase, burnScaleOf, L4_OVERLAY, dockPoint, command, step, newGame, UDEF, BDEF, ART_PENDING, QCATS, queueResearch, cancelResearch, researchState, updResearch, applyResearch, inPlague, holyGround, atLimit, aliveOf, valuableGroup, dropOffs, maxHpOf, dmgOf, rangeOf, speedOf, updAI, aiNextBuild, queueItem, cancelItem, updProduction, placeBld, canPlace, launchNuke, cam, centerOn, EDGE_SCROLL_PX };
