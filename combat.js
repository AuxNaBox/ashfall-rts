// combat.js: Loop 3 combat data and rules (no DOM). Source: rts-loops/loop3/1-combat-spec.md (CS).
// Loaded before game.js in the browser; require()-able in node for tests.
(function (root) {
  'use strict';
  // damage multiplier matrix: weapon -> armor. null = cannot target (CS "Armor and damage types")
  const MATRIX = {
    bullet: { light: 1.0, heavy: 0.6, air: 1.0, structure: 0.6 },
    claw: { light: 1.0, heavy: 0.6, air: null, structure: 0.6 },
    fire: { light: 1.25, heavy: 0.75, air: 1.0, structure: 0.6 },
    shell: { light: 0.8, heavy: 1.25, air: null, structure: 1.0 },
    cleave: { light: 1.0, heavy: 1.25, air: null, structure: 1.25 },
    beam: { light: 1.25, heavy: 1.0, air: 1.0, structure: 0.6 },
  };
  // CS balance table + live values. speed in tiles/s, range/sight in tiles, rof = s between shots.
  // Speeds come from the spec table (x32 px; e.g. Zombie 35.2 vs live 36): approved by Dezi, Loop 3. Imp splash 0.35 tiles: approved by Dezi, Loop 3.
  const UNITS = {
    survivor: { armor: 'light', dmgType: 'bullet', cost: 100, time: 4, hp: 100, dmg: 11, rof: 0.75, range: 4.5, speed: 1.8, sight: 6 },
    ark: { armor: 'heavy', dmgType: 'shell', splash: 1.0, cost: 800, time: 13, hp: 700, dmg: 75, rof: 2.2, range: 6, speed: 1.25, sight: 7 },
    seraph: { armor: 'air', dmgType: 'beam', cost: 450, time: 9, hp: 240, dmg: 30, rof: 1.3, range: 5, speed: 2.75, sight: 8 },
    zombie: { armor: 'light', dmgType: 'claw', cost: 60, time: 2.5, hp: 120, dmg: 13, rof: 1.0, range: 0.8, speed: 1.1, sight: 5 },
    imp: { armor: 'light', dmgType: 'fire', splash: 0.35, cost: 200, time: 6, hp: 110, dmg: 20, rof: 1.3, range: 4.5, speed: 2.2, sight: 6 },
    brute: { armor: 'heavy', dmgType: 'cleave', splash: 0.9, cost: 900, time: 14, hp: 1000, dmg: 70, rof: 1.6, range: 1.1, speed: 1.1, sight: 6 },
    gleaner: { armor: 'heavy', dmgType: null },
    reaper: { armor: 'heavy', dmgType: null },
  };
  // towers: [player, Horde]
  const TOWERS = { turret: { dmgType: ['bullet', 'fire'], cost: 600, time: 9, hp: 650, dmg: 28, rof: 0.9, range: 6.5, sight: 7, power: 20 } };
  const TABLE = {
    plagueInfDps: { v: 6, src: 'CS plague (was 8)' },
    plagueVehDps: { v: 4, src: 'CS plague, trucks included (was 6)' },
    plagueHealDps: { v: 4, src: 'CS plague (was 6)' },
    riseDelay: { v: 1.6, src: 'CS the dead rise (existing)' },
    purifyTiles: { v: 4, src: 'CS open call default A' },
    impSplash: { v: 0.35, src: 'approved by Dezi, Loop 3: live value kept (0.35 tiles)' },
    projArcPx: { v: 9, src: 'CS Artie: air lift 9 px (projectiles aim at the lifted sprite)' },
    crushRadiusPx: { v: 12, src: 'approved by Dezi, Loop 3: "drives over the center" = enemy centre within the truck radius (12 px)' },
    truckRetreatPct: { v: 0.5, src: 'approved by Dezi, Loop 3: retreat below 50% HP, once per life (a future repair should reset it)' },
    truckDropPct: { v: 0.5, src: 'Loop 1 spec (50% of cargo drops on death)' },
    truckDropSearchTiles: { v: 2, src: 'approved by Dezi, Loop 3: nearest Scrap Pile within 2 tiles, up to its 500 cap; overflow or no pile in range is lost' },
  };
  const D = {}; for (const k in TABLE) D[k] = TABLE[k].v;
  const RISE_WEAPONS = ['claw', 'plague'];          // crush, shell, fire, cleave never rise
  const LIGHT = 'light';

  const mult = (w, armor) => { const row = MATRIX[w]; if (!row) return 1; const m = row[armor]; return m == null ? 0 : m; };
  const canHit = (w, armor) => { const row = MATRIX[w]; if (!row) return true; return row[armor] != null; };
  const hitsAir = w => canHit(w, 'air');
  // auto-target tier (lower = preferred): armed enemies, then trucks, then other buildings
  const targetTier = (attackerIsBuilding, t) => {
    if (t.kind === 'b') return t.armed ? 0 : 2;
    if (t.harv) return attackerIsBuilding ? 0 : 1;
    return 0;
  };
  const riseEligible = (victimType, victimSide, w) => victimSide === 0 && victimType === 'survivor' && RISE_WEAPONS.includes(w);
  const purified = (x, y, angels, tile) => angels.some(a => !a.dead && Math.hypot(a.x - x, a.y - y) <= D.purifyTiles * (tile || 32));
  const canCrush = (truck, o) => o.side !== truck.side && !o.dead && o.armor === LIGHT && Math.hypot(o.x - truck.x, o.y - truck.y) < D.crushRadiusPx;
  const plagueTick = (side, armor, dt) => side === 0 ? -(armor === LIGHT ? D.plagueInfDps : D.plagueVehDps) * dt : D.plagueHealDps * dt;

  const Combat = { MATRIX, UNITS, TOWERS, TABLE, D, mult, canHit, hitsAir, targetTier, riseEligible, purified, canCrush, plagueTick };
  if (typeof module !== 'undefined' && module.exports) module.exports = Combat;
  root.Combat = Combat;
})(typeof window !== 'undefined' ? window : globalThis);
