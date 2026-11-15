// Loop 5 §10 tests 1–12 and §13 tests 13–15. Headless, exact spec values. No self-tuning.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./harness');

const TILE = 32;
let H, R, G;
function boot(seed = 1) {
  if (!H) H = load();
  H.seed(seed);
  R = H.RTS;
  R.newArena(seed);
  G = R.G;
  return R;
}
const step = (s) => { const n = Math.round(s * 30); for (let i = 0; i < n; i++) R.step(1 / 30); };
const alive = (side, type) => G.units.filter(u => u.side === side && !u.dead && (!type || u.type === type) && !u.carried);
const at = (tx, ty) => ({ x: tx * TILE + 16, y: ty * TILE + 16 });

test('L5-1 wall blocks ground units and air passes over it', () => {
  boot(1);
  for (let y = 0; y < R.MH; y++) R.makeBld('wall', 0, 20, y);
  const z = R.makeUnit('zombie', 1, at(18, 40).x, at(18, 40).y);
  const a = R.makeUnit('seraph', 0, at(18, 38).x, at(18, 38).y);
  R.issueMove([z], at(24, 40).x, at(24, 40).y, false);
  R.issueMove([a], at(24, 40).x, at(24, 40).y, false);
  step(8);
  assert.ok(Math.floor(z.x / TILE) < 20, 'zombie does not cross the wall, ended at tile ' + Math.floor(z.x / TILE));
  assert.ok(Math.floor(a.x / TILE) > 20, 'angel crosses the wall, ended at tile ' + Math.floor(a.x / TILE));
});

test('L5-2 gate opens for own units, stays a wall to the enemy, lock and unpowered hold', () => {
  boot(2);
  // horizontal wall with a 2-wide gate in the middle, side 0
  for (let x = 16; x <= 19; x++) R.makeBld('wall', 0, x, 20);
  const gate = R.makeBld('gate', 0, 20, 20, 0); // 2x1
  for (let x = 22; x <= 25; x++) R.makeBld('wall', 0, x, 20);
  assert.equal(gate.gate, 'closed');
  const rifle = R.makeUnit('survivor', 0, at(21, 18).x, at(21, 18).y);
  R.issueMove([rifle], at(21, 24).x, at(21, 24).y, false);
  step(6);
  assert.ok(Loop5Open(gate) || rifle.y > 20 * TILE, 'own unit opens or passes the gate; gate=' + gate.gate + ' y=' + rifle.y);
  // enemy pathing treats an open gate as a wall
  gate.gate = 'open';
  const z = R.makeUnit('zombie', 1, at(21, 18).x, at(21, 16).y);
  const p = R.findPath(21, 16, 21, 24, { side: 1 });
  const crosses = p && p.some(s => s[0] >= gate.tx && s[0] < gate.tx + gate.w && s[1] >= gate.ty && s[1] < gate.ty + gate.h);
  assert.ok(!crosses, 'enemy path does not go through an open gate');
  // locked gate blocks own pathing
  const gate2 = R.makeBld('gate', 0, 30, 20, 0);
  gate2.locked = true; gate2.gate = 'closed';
  const p2 = R.findPath(31, 18, 31, 24, { side: 0 });
  const ownCross = p2 && p2.some(s => s[0] >= gate2.tx && s[0] < gate2.tx + gate2.w && s[1] >= gate2.ty && s[1] < gate2.ty + gate2.h);
  assert.ok(!ownCross, 'locked gate is not pathable for own units');
  // unpowered holds state
  const gate3 = R.makeBld('gate', 0, 40, 20, 0);
  gate3.gate = 'open';
  // no power plant + a gate uses 5 power => net < 0
  const u = R.makeUnit('survivor', 0, at(41, 18).x, at(41, 18).y);
  R.issueMove([u], at(41, 12).x, at(41, 12).y, false);
  step(4);
  assert.equal(gate3.gate, 'open', 'unpowered gate holds open');
});
function Loop5Open(g) { return R.Loop5.gateOpen(g); }

test('L5-3 breach targets the cheap wall, then the army reaches the HQ', () => {
  boot(3);
  const hq = R.makeBld('hq', 0, 40, 40);
  // a full horizontal wall so the only way in is to breach a 1-tile "front" identified by cost
  for (let x = 0; x < R.MW; x++) if (x !== 41) R.makeBld('wall', 0, x, 36);
  const w = R.makeBld('wall', 0, 41, 36); // the remaining 1-segment
  const army = [];
  for (let i = 0; i < 6; i++) army.push(R.makeUnit('zombie', 1, at(40, 30).x + (i - 2) * 18, at(30, 30).y));
  R.issueMove(army, hq.x, hq.y, true);
  let hit = 0;
  for (let i = 0; i < 90; i++) {
    R.step(1 / 30);
    hit += army.filter(u => u.target && (u.target.type === "wall" || u.target.type === "gate" || u.tmode === "breach")).length;
  }
  assert.ok(hit >= 1, 'army breaches the wall at some point, last targets=' + army.map(u => u.target && u.target.type).join(',') + ' hitTicks=' + hit);
  // second case: wall + gate, target the wall (cost 8 < 12)
  R.newArena(31); G = R.G;
  const hq2 = R.makeBld('hq', 0, 40, 40);
  for (let x = 0; x < R.MW; x++) if (x !== 40 && x !== 41 && x !== 42) R.makeBld('wall', 0, x, 36);
  const wall = R.makeBld('wall', 0, 40, 36);
  const gate = R.makeBld('gate', 0, 41, 36, 0);
  const path = R.findPath(40, 28, 41, 41, { side: 1, breach: true });
  assert.ok(path && path.breach, 'breach path finds a defense');
  assert.equal(path.breach.type, 'wall', 'wall (8) is cheaper than the gate (12), got ' + (path.breach && path.breach.type));
  // after the wall falls the army can reach
  R.kill(wall, null, 'shell');
  step(0.1);
  const p3 = R.findPath(40, 28, 41, 41, { side: 1 });
  // may still be blocked by the gate; breach then the gate
  const p4 = R.findPath(40, 28, 41, 41, { side: 1, breach: true });
  assert.ok(p3 || (p4 && p4.breach === gate) || p4, 'after the wall falls a path or the next breach exists');
});

test('L5-4 a plain move to a walled-in spot stops at the nearest reachable tile and does not attack the wall', () => {
  boot(4);
  const wall = R.makeBld('wall', 0, 20, 20);
  const u = R.makeUnit('survivor', 0, at(16, 20).x, at(16, 20).y);
  R.issueMove([u], at(20, 20).x, at(20, 20).y, false); // plain move, not attack-move
  step(5);
  assert.ok(!u.target, 'plain move does not set a wall as the target');
  assert.ok(!(Math.floor(u.x / TILE) === 20 && Math.floor(u.y / TILE) === 20), 'stops short of the wall tile, at ' + Math.floor(u.x / TILE) + ',' + Math.floor(u.y / TILE));
});

test('L5-5 wall cap 80, AI shield cap 30, no radius, no salvage, no dock gap', () => {
  boot(5);
  const hq = R.makeBld('hq', 0, 8, 60);
  // cap 80
  for (let i = 0; i < 80; i++) R.makeBld('wall', 0, 12 + (i % 20), 58 - Math.floor(i / 20));
  assert.equal(R.wallCount(0), 80);
  const cap = R.placeCheck(0, 'wall', 15, 50, 0);
  assert.equal(cap.ok, false);
  assert.match(cap.reason, /cap/i);
  assert.equal(R.Loop5.AI.hard.wallCap, 30);
  // walls do not extend the build radius: a tile 7 steps from the HQ, next only to a wall, is too far
  const far = R.placeCheck(0, 'wall', hq.tx + 8, hq.ty, 0);
  assert.equal(far.ok, false, 'walls do not extend the build radius: ' + (far.reason || 'ok'));
  // salvage
  const tx = hq.tx + 2, ty = hq.ty - 2;
  R.res[ty * R.MW + tx] = 50;
  const sal = R.placeCheck(0, 'wall', tx, ty, 0);
  assert.equal(sal.ok, false);
  // dock gap: a refinery has a pad under it
  const yard = R.makeBld('refinery', 0, hq.tx + 4, hq.ty);
  const pad = yard.pad;
  const py = (pad / R.MW) | 0, px = pad % R.MW;
  const near = R.placeCheck(0, 'wall', px, py + 1, 0); // 1-tile gap required, so the adjacent tile fails
  assert.equal(near.ok, false, 'no wall next to a dock pad: ' + (near.reason || 'ok'));
});

test('L5-6 self-seal warning appears and placement is still allowed', () => {
  boot(6);
  const hq = R.makeBld('hq', 0, 10, 50);
  const yard = R.makeBld('refinery', 0, 10, 45);
  // a nearly closed box around the yard that one more wall would seal
  // simpler: ask cutOffWarning for a wall that sits on the spawn-path
  // Place walls around the yard's south edge leaving one gap, then warn on the gap.
  const row = 48;
  for (let x = 0; x < R.MW; x++) if (x !== 11) R.makeBld('wall', 0, x, row);
  const warn = R.cutOffWarning(0, 'wall', 11, row, 0);
  assert.ok(warn, 'warning fires when a yard would be cut off: ' + warn);
  assert.match(warn, /Scrap Yard|Factory|cut off/i);
  const allowed = R.placeCheck(0, 'wall', 11, row, 0);
  assert.ok(!String(allowed.reason || '').toLowerCase().includes('cut'), 'self-seal does not block placement, reason=' + allowed.reason);
  // and we can actually place it
  const b = R.makeBld('wall', 0, 11, row);
  assert.ok(b && !b.dead);
});

test('L5-7 Rocket Tower minimum range: 1.5 tiles not targeted, 2.5 is; heavies are hittable at any range', () => {
  boot(7);
  const tw = R.makeBld('rockettower', 0, 20, 20);
  const close = R.makeUnit('zombie', 1, tw.x, tw.y + 1.5 * TILE);
  const mid = R.makeUnit('zombie', 1, tw.x, tw.y + 2.5 * TILE);
  const tClose = R.findEnemy(tw, 7.5 * TILE, 0);
  // only the 2.5-tile unit should be considered
  assert.notEqual(tClose, close, 'unit at 1.5 tiles is inside min range and is not targeted');
  assert.equal(tClose, mid, 'unit at 2.5 tiles is targeted');
  // §15: heavies (Hellbrute) can be hit inside the 2-tile blind spot
  close.dead = true; mid.dead = true;
  const brute = R.makeUnit('brute', 1, tw.x, tw.y + 1.5 * TILE);
  assert.equal(R.findEnemy(tw, 7.5 * TILE, 0), brute, 'a Hellbrute at 1.5 tiles is targeted');
});

test('L5-8 Artillery lands on the fire-time tile, misses a unit that moved, does not fire while moving', () => {
  boot(8);
  const art = R.makeUnit('artillery', 0, at(20, 20).x, at(20, 20).y);
  const dummy = R.makeUnit('zombie', 1, at(20, 26).x, at(20, 26).y); // 6 tiles: outside the §15 min range of 5, still in sight
  dummy.scan = 1e9; dummy.order = 'idle';
  art.target = dummy; art.tmode = 'forced'; art.order = 'attack'; art.cd = 0; art.moving = false; art.path = null;
  // fire once
  const fireX = dummy.x, fireY = dummy.y;
  R.step(1 / 30);
  // if it hasn't fired yet, give it a moment stopped
  for (let i = 0; i < 15 && !G.proj.length; i++) { art.moving = false; art.path = null; art.cd = 0; art.target = dummy; R.step(1 / 30); }
  assert.ok(G.proj.length, 'artillery fired a projectile');
  const p = G.proj[0];
  assert.ok(p.travel, 'shot uses travel time');
  assert.ok(Math.hypot(p.tx - fireX, (p.ty + (p.air || 0)) - fireY) < 8, 'locked to the fire-time tile');
  // move the dummy 2 tiles during flight
  dummy.x += 2 * TILE;
  dummy.y += 0;
  const hp0 = dummy.hp;
  step(1.6);
  assert.equal(dummy.hp, hp0, 'unit that left the fire-time tile takes no damage (hp ' + dummy.hp + '/' + hp0 + ')');
  // does not fire while moving
  const art2 = R.makeUnit('artillery', 0, at(30, 20).x, at(30, 20).y);
  const d2 = R.makeUnit('zombie', 1, at(30, 25).x, at(30, 25).y);
  d2.scan = 1e9;
  R.issueMove([art2], at(34, 20).x, at(34, 20).y, false);
  art2.target = d2; art2.tmode = 'forced'; art2.cd = 0;
  const n0 = G.proj.length;
  // one tick while a path is active
  art2.moving = true;
  R.step(1 / 30);
  assert.equal(G.proj.length, n0, 'artillery does not fire on the tick it is still moving');
});

test('L5-9 transport load/unload and death at 50% current HP', () => {
  boot(9);
  const apc = R.makeUnit('apc', 0, at(20, 20).x, at(20, 20).y);
  const men = [];
  for (let i = 0; i < 6; i++) men.push(R.makeUnit('survivor', 0, apc.x + 20, apc.y + (i - 2) * 12));
  const templar = R.makeUnit('templar', 0, apc.x + 30, apc.y);
  const angel = R.makeUnit('seraph', 0, apc.x + 30, apc.y + 20);
  let loaded = 0;
  for (const u of men) if (R.loadUnit(apc, u)) loaded++;
  assert.equal(loaded, 5, 'loads 5');
  assert.equal(R.loadUnit(apc, men[5]), false, 'rejects a 6th');
  assert.equal(R.canLoadUnit(apc, templar), false, 'rejects a Templar');
  assert.equal(R.canLoadUnit(apc, angel), false, 'rejects an Angel');
  const hp0 = men[0].hp;
  const z = R.makeUnit('zombie', 1, apc.x, apc.y);
  R.damage(apc, 50, z, 'claw');
  assert.equal(men[0].hp, hp0, 'passengers take no damage');
  assert.ok(men[0].carried);
  const n = R.finishUnload(apc).length;
  assert.equal(n, 5, 'unload places all 5');
  assert.ok(men.slice(0, 5).every(u => !u.carried && !u.dead));
  // reload and kill the APC
  for (const u of men.slice(0, 5)) R.loadUnit(apc, u);
  men[0].hp = 80;
  R.kill(apc, z, 'claw');
  assert.equal(men[0].carried, null);
  assert.equal(men[0].hp, 40, 'death exits at 50% of current HP');
  assert.ok(!men[0].dead);
});

test('L5-10 patches: catapult 8 s, sprayer 12 s, cap 40, Purifier cleanses and suppresses 30 s', () => {
  boot(10);
  const cata = R.makeUnit('catapult', 1, at(20, 20).x, at(20, 20).y);
  const tgt = R.makeUnit('survivor', 0, at(20, 28).x, at(20, 28).y); // 8 tiles, in range 11; need a spotter
  // catapult sight 6, target at 8 — need a spotter
  const spot = R.makeUnit('imp', 1, at(20, 26).x, at(20, 26).y);
  spot.scan = 1e9; tgt.scan = 1e9;
  cata.target = tgt; cata.tmode = 'forced'; cata.cd = 0; cata.moving = false; cata.path = null;
  for (let i = 0; i < 20 && !G.proj.length; i++) { cata.cd = 0; cata.moving = false; R.step(1 / 30); }
  step(1.6);
  const p8 = (G.patches || []).filter(p => p.side === 1);
  assert.ok(p8.length >= 1, 'catapult left a patch');
  const dur = p8[0].until - p8[0].born;
  assert.ok(Math.abs(dur - 8) < 0.05, 'catapult patch lasts 8 s, got ' + dur);
  // sprayer 12 s
  const spr = R.makeUnit('sprayer', 1, at(30, 20).x, at(30, 20).y);
  const t2 = R.makeUnit('survivor', 0, at(30, 22).x, at(30, 22).y);
  t2.scan = 1e9;
  spr.target = t2; spr.tmode = 'forced'; spr.cd = 0; spr.moving = false;
  for (let i = 0; i < 10 && (G.patches || []).filter(p => p.side === 1).length < 2; i++) { spr.cd = 0; R.step(1 / 30); }
  const sp = (G.patches || []).filter(p => Math.abs((p.until - p.born) - 12) < 0.05);
  assert.ok(sp.length >= 1, 'sprayer patch lasts 12 s');
  // cap 40
  for (let i = 0; i < 45; i++) R.addPatch(10 * TILE, 10 * TILE + i, 1, 20, 0);
  assert.ok((G.patches.filter(p => p.side === 0).length) <= 40, 'patch cap 40 per side, got ' + G.patches.filter(p => p.side === 0).length);
  // purifier cleanse + suppress
  R.plague[25 * R.MW + 25] = 1;
  const pur = R.makeUnit('purifier', 0, at(25, 25).x, at(25, 25).y);
  const z = R.makeUnit('zombie', 1, at(25, 26).x, at(25, 26).y);
  z.scan = 1e9;
  R.addPatch(at(25, 26).x, at(25, 26).y, 1, 12, 1);
  pur.target = z; pur.tmode = 'forced'; pur.cd = 0; pur.moving = false;
  for (let i = 0; i < 10; i++) { pur.cd = 0; R.step(1 / 30); }
  assert.ok(!(G.patches || []).some(p => Math.hypot(p.x - z.x, p.y - z.y) < 2 * TILE && G.time < p.until), 'purifier removes nearby patches');
  const iPl = 25 * R.MW + 25;
  assert.ok(G.suppress && G.suppress[iPl] >= G.time + 29, 'map plague suppressed for 30 s, until=' + (G.suppress && G.suppress[iPl]) + ' time=' + G.time);
});

test('L5-11 plague matrix, Sprayer kills rise, Purifier kills do not', () => {
  boot(11);
  const C = R.Combat;
  assert.equal(C.mult('plague', 'light'), 1.25);
  assert.equal(C.mult('plague', 'heavy'), 0.75);
  assert.equal(C.mult('plague', 'air'), 0);
  assert.equal(C.mult('plague', 'structure'), 0.4);
  const tem = R.makeUnit('templar', 0, at(10, 10).x, at(10, 10).y);
  const arc = R.makeUnit('archangel', 0, at(12, 10).x, at(12, 10).y);
  const hpT = tem.hp, hpA = arc.hp;
  const spr = R.makeUnit('sprayer', 1, at(10, 11).x, at(10, 11).y);
  R.damage(tem, 100, spr, 'plague');
  R.damage(arc, 100, spr, 'plague');
  assert.equal(tem.hp, hpT, 'Templar takes 0 plague');
  assert.equal(arc.hp, hpA, 'Archangel takes 0 plague');
  // sprayer kill rises
  const r1 = R.makeUnit('survivor', 0, at(20, 20).x, at(20, 20).y);
  R.kill(r1, spr, 'plague');
  assert.ok(G.rises.length >= 1, 'sprayer (plague) kills rise');
  G.rises = [];
  const r2 = R.makeUnit('survivor', 0, at(22, 20).x, at(22, 20).y);
  const pur = R.makeUnit('purifier', 0, at(22, 21).x, at(22, 21).y);
  R.kill(r2, pur, 'fire');
  assert.equal(G.rises.length, 0, 'purifier (fire) kills do not rise');
  assert.ok(r2.burned);
});

test('L5-12 requirements: Artillery needs a Depot, sprayers need 2 Power Plants, Flame Tower needs a Turret', () => {
  boot(12);
  R.makeBld('hq', 0, 8, 60);
  R.makeBld('power', 0, 12, 60);
  R.makeBld('refinery', 0, 12, 57);
  R.makeBld('factory', 0, 16, 57);
  assert.equal(R.prereqOk(0, 'artillery'), false, 'artillery locked without a Depot');
  R.makeBld('depot', 0, 16, 55);
  assert.equal(R.prereqOk(0, 'artillery'), true);
  assert.equal(R.prereqOk(0, 'purifier'), false, 'purifier locked with 1 Power Plant');
  R.makeBld('power', 0, 20, 60);
  assert.equal(R.prereqOk(0, 'purifier'), true);
  R.makeBld('hq', 1, 50, 10);
  R.makeBld('power', 1, 54, 10);
  R.makeBld('power', 1, 54, 13);
  R.makeBld('refinery', 1, 58, 10);
  R.makeBld('factory', 1, 58, 13);
  assert.equal(R.prereqOk(1, 'sprayer'), true);
  assert.equal(R.prereqOk(0, 'flametower'), false, 'flame tower locked without a Turret');
  R.makeBld('barracks', 0, 20, 57);
  R.makeBld('turret', 0, 23, 57);
  assert.equal(R.prereqOk(0, 'flametower'), true);
});

test('L5-13 Bone Forge and Spitter tech requirements', () => {
  boot(13);
  R.makeBld('hq', 1, 50, 10);
  assert.equal(R.prereqOk(1, 'forge'), false);
  R.makeBld('barracks', 1, 54, 10);
  assert.equal(R.prereqOk(1, 'forge'), false, 'forge needs a Grinder Pit too');
  R.makeBld('refinery', 1, 54, 13);
  assert.equal(R.prereqOk(1, 'forge'), true);
  const forge = R.makeBld('forge', 1, 58, 10);
  assert.ok(forge);
  // Acid Glands needs a Factory
  assert.ok(R.Combat.RESEARCH.acid.reqBld.includes('factory'));
  G.credits[1] = 99999; G.techCredits = 99999;
  assert.equal(R.queueResearch(1, 'acid'), false, 'Acid Glands is locked without a Factory');
  R.makeBld('factory', 1, 58, 13);
  assert.equal(R.queueResearch(1, 'acid'), true);
  // Long Spines needs Sharpened Claws
  assert.ok(R.Combat.RESEARCH.spines.reqRes.includes('claws'));
  assert.equal(R.prereqOk(1, 'spitter'), false, 'Spitter locked until Acid Glands finishes');
  // finish acid
  G.rq[1].forge.prog = 30;
  for (let i = 0; i < 5; i++) R.updResearch(1);
  assert.ok(G.research[1].acid, 'Acid Glands finished');
  assert.equal(R.prereqOk(1, 'spitter'), true);
  // spines still locked
  assert.equal(R.researchState(1, 'spines'), 'locked');
  R.queueResearch(1, 'claws');
  G.rq[1].forge.prog = 30;
  for (let i = 0; i < 5; i++) R.updResearch(1);
  assert.ok(G.research[1].claws);
  assert.equal(R.researchState(1, 'spines'), 'ready');
});

test('L5-14 Bone Forge research modifiers skip the new towers', () => {
  boot(14);
  const z = R.makeUnit('zombie', 1, at(10, 10).x, at(10, 10).y);
  const spire = R.makeBld('turret', 1, 12, 10);
  const ft = R.makeBld('flametower', 1, 14, 10);
  const rt = R.makeBld('rockettower', 1, 16, 10);
  const dmg0 = R.dmgOf(z), sd0 = R.dmgOf(spire), fd0 = R.dmgOf(ft), rd0 = R.dmgOf(rt);
  const rng0s = R.rangeOf(spire), rng0f = R.rangeOf(ft), rng0r = R.rangeOf(rt);
  const imp = R.makeUnit('imp', 1, at(10, 12).x, at(10, 12).y);
  const ir0 = R.rangeOf(imp);
  const br = R.makeUnit('brute', 1, at(10, 14).x, at(10, 14).y);
  const spit = R.makeUnit('spitter', 1, at(10, 16).x, at(10, 16).y);
  const hpB0 = br.maxhp, hpS0 = spit.maxhp;
  R.applyResearch(1, 'claws');
  R.applyResearch(1, 'boneplate');
  R.applyResearch(1, 'spines');
  assert.ok(Math.abs(R.dmgOf(z) / dmg0 - 1.2) < 1e-6, 'claws +20% zombie dmg');
  assert.ok(Math.abs(R.dmgOf(spire) / sd0 - 1.2) < 1e-6, 'claws +20% bone spire dmg');
  assert.equal(R.dmgOf(ft), fd0, 'claws do not touch the Brimstone Spire');
  assert.equal(R.dmgOf(rt), rd0, 'claws do not touch the Bone Cannon');
  assert.equal(R.rangeOf(spire), rng0s + 1, 'spines +1 Bone Spire range');
  assert.equal(R.rangeOf(imp), ir0 + 0.5, 'spines +0.5 Imp range');
  assert.equal(R.rangeOf(ft), rng0f, 'spines do not touch the Brimstone Spire');
  assert.equal(R.rangeOf(rt), rng0r, 'spines do not touch the Bone Cannon');
  assert.ok(Math.abs(br.maxhp / hpB0 - 1.2) < 1e-6, 'bone plating +20% Hellbrute HP');
  assert.ok(Math.abs(spit.maxhp / hpS0 - 1.2) < 1e-6, 'bone plating +20% Spitter HP');
});

test('L5-15 acid matrix and acid kills do not rise', () => {
  boot(15);
  const C = R.Combat;
  assert.equal(C.mult('acid', 'light'), 0.6);
  assert.equal(C.mult('acid', 'heavy'), 1.3);
  assert.equal(C.canHit('acid', 'air'), false);
  assert.equal(C.mult('acid', 'structure'), 0.8);
  assert.equal(C.riseEligible('survivor', 0, 'acid'), false, 'acid is not a rise weapon');
  assert.equal(C.riseEligible('survivor', 0, 'plague'), true);
  const r = R.makeUnit('survivor', 0, at(10, 10).x, at(10, 10).y);
  const s = R.makeUnit('spitter', 1, at(10, 12).x, at(10, 12).y);
  R.kill(r, s, 'acid');
  assert.equal((G.rises || []).length, 0, 'acid kills do not rise');
});


test('L5-16 leap: 5-tile wall crossing, rejects, cooldown, untargetable window, auto-leap', () => {
  boot(16);
  const wallY = 20;
  for (let x = 0; x < R.MW; x++) R.makeBld('wall', 0, x, wallY);
  const u = R.makeUnit('shock', 0, at(10, 18).x, at(18, 18).y);
  // 5 tiles south of the unit: unit at y=18, wall at 20, dest y=23 (5 tiles from 18)
  assert.equal(R.canLeap(u, 10, 23), true, 'leap 5 tiles over a 1-deep wall');
  assert.equal(R.startLeap(u, 10, 23), true);
  assert.ok(u.leaping);
  // mid-air: untargetable
  R.step(0.4);
  assert.ok(u.leaping);
  assert.equal(R.untargetable(u), true);
  const z = R.makeUnit('zombie', 1, u.x, u.y);
  assert.equal(R.findEnemy(z, 6 * TILE, 1), null, 'leaping unit is not targeted');
  R.step(0.5);
  assert.equal(u.leaping, false);
  assert.equal(Math.floor(u.y / TILE), 23);
  assert.ok(u.leapCd > 14 && u.leapCd <= 15, '15 s cooldown starts on use, left ' + u.leapCd);
  assert.equal(R.canLeap(u, 10, 18), false, 'on cooldown');
  // rejects: blocked tile, 6 tiles, path over a 2x2+ building
  const v = R.makeUnit('shock', 0, at(30, 30).x, at(30, 30).y);
  assert.equal(R.canLeap(v, 30, 36), false, '6 tiles is too far');
R.makeBld('factory', 0, 32, 30); // 3x3 between 30,30 and 36,30? dest 36 is 6 tiles. Use dest at 35 (5 tiles) through factory
  // unit at 30,30, factory at 32,30 3x3 covers 32-34, 30-32. Leap to 35,30 passes over the factory.
  assert.equal(R.canLeap(v, 35, 30), false, 'cannot leap over a 2x2+ building');
  // blocked dest
  assert.equal(R.canLeap(v, 20, 20), false, 'rejects a blocked (wall) tile'); // wall line is y=20, x=20 is a wall - v is at 30,30, dist to 20,20 is ~14 tiles anyway
  const wtile = R.makeBld('wall', 0, 30, 32);
  assert.equal(R.canLeap(v, 30, 32), false, 'rejects a wall as the landing tile');
  // auto-leap: target behind a wall within 5, no ground path
  R.newArena(161); G = R.G;
  for (let x = 0; x < R.MW; x++) R.makeBld('wall', 0, x, 20);
  const sh = R.makeUnit('shock', 0, at(10, 18).x, at(18, 18).y);
  const med = R.makeUnit('medic', 1, at(10, 22).x, at(22, 22).y);
  assert.equal(R.shouldAutoLeap(sh, med), true, 'auto-leap when the ground path is blocked');
  assert.equal(R.autoLeapTo(sh, med), true);
  assert.ok(sh.leaping);
});

test('L5-17 Demo Squad: structures only, 2.5 s arm, dud if killed, 450/50 blast, no friendly fire, limit 6', () => {
  boot(17);
  const d = R.makeUnit('demo', 0, at(20, 20).x, at(20, 20).y);
  const z = R.makeUnit('zombie', 1, at(20, 22).x, at(20, 22).y);
  assert.equal(R.canAttack(d, z), false, 'does not target units');
  const wall = R.makeBld('wall', 1, 20, 21);
  assert.equal(R.canAttack(d, wall), true);
  // arm 2.5 s then 450 to the wall (400 HP) — it dies
  d.target = wall; d.tmode = 'forced'; d.order = 'attack'; d.path = null; d.moving = false;
  for (let i = 0; i < 10 && !d.arming; i++) R.step(1 / 30);
  assert.ok(d.arming, 'starts arming next to the wall');
  const t0 = G.time;
  while (d.arming && !d.dead && G.time - t0 < 3) R.step(1 / 30);
  assert.ok(d.dead && d.exploded, 'explodes after 2.5 s');
  assert.ok(G.time - t0 >= 2.4 && G.time - t0 <= 2.7, 'arm duration ~2.5 s, got ' + (G.time - t0));
  assert.ok(wall.dead, '450 flat kills a 400 HP wall');
  // dud: killed while arming
  const d2 = R.makeUnit('demo', 0, at(30, 20).x, at(30, 20).y);
  const tw = R.makeBld('turret', 1, 30, 21);
  const hp0 = tw.hp;
  d2.target = tw; d2.order = 'attack';
  for (let i = 0; i < 20 && !d2.arming; i++) R.step(1 / 30);
  assert.ok(d2.arming);
  R.kill(d2, tw, 'bullet');
  assert.ok(d2.dead && !d2.exploded, 'killed while arming is a dud');
  assert.equal(tw.hp, hp0, 'dud does no structure damage');
  // splash 50 shell to an enemy unit within 1.5, none to own side
  const d3 = R.makeUnit('demo', 0, at(40, 20).x, at(40, 20).y);
  const w3 = R.makeBld('wall', 1, 40, 21);
  const foe = R.makeUnit('zombie', 1, at(41, 20).x, at(41, 20).y);
  const friend = R.makeUnit('survivor', 0, at(39, 20).x, at(39, 20).y);
  const fh0 = foe.hp, fr0 = friend.hp;
  R.boomDemo(d3);
  assert.ok(w3.dead);
  assert.ok(foe.hp < fh0, '50 shell to enemy units in 1.5 tiles, hp ' + foe.hp);
  assert.equal(friend.hp, fr0, 'no friendly fire');
  // limit 6
  for (let i = 0; i < 6; i++) R.makeUnit('demo', 0, at(10, 10).x + i * 12, at(10, 10).y);
  assert.equal(R.atLimit(0, 'demo'), true);
});

test('L5-18 Bloater: same charge rules, dud death leaves an 8 s 1-tile plague patch and 0 structure damage', () => {
  boot(18);
  const b = R.makeUnit('bloater', 1, at(20, 20).x, at(20, 20).y);
  const wall = R.makeBld('wall', 0, 20, 21);
  const z = R.makeUnit('survivor', 0, at(20, 22).x, at(20, 22).y);
  assert.equal(R.canAttack(b, z), false);
  assert.equal(R.canAttack(b, wall), true);
  const hp0 = wall.hp;
  b.target = wall; b.order = 'attack';
  for (let i = 0; i < 20 && !b.arming; i++) R.step(1 / 30);
  assert.ok(b.arming);
  R.kill(b, wall, 'bullet');
  assert.ok(b.dead && !b.exploded);
  assert.equal(wall.hp, hp0, 'dud does no structure damage');
  const p = (G.patches || []).filter(x => x.side === 1);
  assert.ok(p.length >= 1, 'bloater dud leaves a patch');
  const dur = p[p.length - 1].until - p[p.length - 1].born;
  assert.ok(Math.abs(dur - 8) < 0.05, 'patch lasts 8 s, got ' + dur);
});


test('L5 §15 tower pairs have identical stats', () => {
  boot(21);
  const keys = ['hp', 'dmg', 'rof', 'range', 'splash', 'sight', 'power', 'minRange', 'travel'];
  const flame0 = R.makeBld('flametower', 0, 10, 10), flame1 = R.makeBld('flametower', 1, 14, 10);
  for (const k of keys) assert.equal(flame0.d[k], flame1.d[k], 'flametower ' + k);
  assert.equal(flame0.maxhp, flame1.maxhp);
  const r0 = R.makeBld('rockettower', 0, 10, 14), r1 = R.makeBld('rockettower', 1, 14, 14);
  for (const k of keys) assert.equal(r0.d[k], r1.d[k], 'rockettower ' + k);
  assert.equal(r0.maxhp, r1.maxhp);
  assert.equal(r0.d.minRange, R.Loop5.D.ROCKETTOWER_MIN_RANGE);
});

test('L5 §15 HQ takes half demo damage; Purifier is immune to patch DPS but not to a Sprayer shot', () => {
  boot(22);
  const hq = R.makeBld('hq', 1, 20, 20);
  const hp0 = hq.hp;
  const d = R.makeUnit('demo', 0, hq.x, hq.y);
  R.boomDemo(d);
  const took = hp0 - hq.hp;
  assert.equal(took, R.Loop5.D.DEMO_DMG * R.Loop5.D.DEMO_HQ_MULT, 'HQ takes 50% demo damage, took ' + took);
  // patch immunity
  const pur = R.makeUnit('purifier', 0, at(40, 20).x, at(40, 20).y);
  const tank = R.makeUnit('ark', 0, at(41, 20).x, at(41, 20).y);
  R.addPatch(pur.x, pur.y, 1, 8, 1);
  const php0 = pur.hp, thp0 = tank.hp;
  for (let i = 0; i < 30 * 4; i++) R.step(1 / 30);
  assert.equal(pur.hp, php0, 'Purifier takes no plague patch damage');
  assert.ok(tank.hp < thp0, 'a Tank on the same patch is damaged');
  // direct Sprayer hit still lands
  const sp = R.makeUnit('sprayer', 1, at(40, 22).x, at(40, 22).y);
  const before = pur.hp;
  R.damage = R.damage; // keep
  // fire via damage path used by sprayer weapon
  const Combat = R.Combat;
  const raw = R.dmgOf(sp);
  // use the unit fire by giving it the purifier as a target at range
  sp.target = pur; sp.tmode = 'forced'; sp.order = 'attack'; sp.cd = 0; sp.moving = false; sp.path = null;
  for (let i = 0; i < 30 && pur.hp === before; i++) R.step(1 / 30);
  assert.ok(pur.hp < before, 'direct Sprayer hits still damage the Purifier, hp ' + pur.hp);
});

test('L5 leap key: mixed selection leaps only leapers; no selection switches tabs; tooltip shown', () => {
  boot(19);
  const sh = R.makeUnit('shock', 0, at(10, 10).x, at(10, 10).y);
  const rf = R.makeUnit('survivor', 0, at(11, 10).x, at(11, 10).y);
  G.sel = [sh, rf];
  const tab0 = R.sbTab;
  assert.equal(R.beginLeapCommand(), true, 'Q with a leap-capable unit selected starts leap mode');
  assert.equal(G.mode, 'leap');
  assert.equal(R.sbTab, tab0, 'tab does not change when a leaper is selected');
  const n = R.issueLeapAt(at(10, 14).x, at(10, 14).y);
  assert.equal(n, 1, 'only the leap-capable unit leaps');
  assert.ok(sh.leaping);
  assert.equal(rf.leaping, undefined, 'the rifleman ignores Q');
  // no selection: Q does not start leap, showTab still works
  G.sel = []; G.mode = null;
  assert.equal(R.beginLeapCommand(), false);
  assert.notEqual(G.mode, 'leap');
  const before = R.sbTab;
  R.showTab(0);
  assert.equal(R.sbTab, 0);
  R.showTab(before);
});
