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
    // Loop 4 (L4 = rts-loops/loop4/1-tech-spec.md): the Templar's "Holy melee" uses the Holy beam row; melee cannot reach air
    holy: { light: 1.25, heavy: 1.0, air: null, structure: 0.6 },
  };
  // per-unit-type overrides of the matrix (weapon -> unit type -> multiplier). Tuning pass 1 (Dezi, after f12dd60):
  // Imps are hellfire demons and take 50% Fire damage (was 1.25x as light). Flamer stats unchanged.
  const TYPE_MULT = { fire: { imp: 0.625 } };
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
    // Loop 4 (L4 "New units" + "The Horde in this loop"). Archangel "60 Holy" = Holy beam (Angel weapon type).
    flamer: { armor: 'light', dmgType: 'fire', splash: 0.6, cost: 250, time: 7, hp: 150, dmg: 18, rof: 0.6, range: 2.5, speed: 1.6, sight: 5 },
    rocket: { armor: 'light', dmgType: 'shell', cost: 300, time: 8, hp: 150, dmg: 60, rof: 1.8, range: 6, /* tuning pass 1: 45/2.0/5.5 -> 60/1.8/6; pass 2: hp 110 -> 150 */ speed: 1.5, sight: 6 },
    medic: { armor: 'light', dmgType: null, cost: 200, time: 6, hp: 90, heal: 10, range: 3, speed: 1.8, sight: 6 },
    archangel: { armor: 'air', dmgType: 'beam', splash: 0.5, cost: 2500, time: 35, hp: 1300, dmg: 50, /* tuning pass 1: dmg 60 -> 50, splash 1.0 -> 0.5; pass 2: hp 1400 -> 1300 */ rof: 1.5, range: 6, speed: 1.8, sight: 9, limit: 1 },
    templar: { armor: 'heavy', dmgType: 'holy', splash: 0.3, /* tuning pass 1: 0.8 -> 0.3 */ cost: 1400, time: 25, hp: 1400, /* pass 2: 1500 -> 1400 */ dmg: 70, rof: 1.4, range: 1.1, speed: 1.3, sight: 6, limit: 2 },
    demon: { armor: 'heavy', dmgType: 'fire', splash: 1.2, cost: 2500, time: 35, hp: 2100, /* tuning pass 1 step 2 (#11 still missed after 1-4): 2400 -> 2100 */ dmg: 50, rof: 1.5, range: 5, speed: 1.0, sight: 8, limit: 1 },
  };
  // Loop 4 research (L4 "Armory research", "Church research and units"). Effects are modifiers read at use time;
  // base stats (UDEF / BDEF / UNITS) are never changed. at = building that researches it.
  // effect keys: dmgMult / hpMult / speedMult { units, blds, v }, rangeAdd { units, blds, v }, unlock [unit types], noRise [victim types], holyGround tiles
  const RESEARCH = {
    hollow: { name: 'Hollow Points', at: 'armory', cost: 600, time: 30, desc: 'Riflemen and Turrets deal +20% damage', effect: { dmgMult: { units: ['survivor'], blds: ['turret'], v: 1.2 } } },
    plating: { name: 'Armor Plating', at: 'armory', cost: 800, time: 40, desc: 'Tanks, Scrap Trucks and Rocket Soldiers get +20% HP', effect: { hpMult: { units: ['ark', 'gleaner', 'rocket'], v: 1.2 } } },
    rockets: { name: 'Rocket Launchers', at: 'armory', cost: 600, time: 30, reqBld: ['factory'], desc: 'Unlocks the Rocket Soldier at the Barracks (needs a Factory)', effect: { unlock: ['rocket'] } },
    barrels: { name: 'Long Barrels', at: 'armory', cost: 1000, time: 45, reqRes: ['hollow'], desc: 'Tanks and Turrets get +1 range (needs Hollow Points)', effect: { rangeAdd: { units: ['ark'], blds: ['turret'], v: 1 } } },
    blessed: { name: 'Blessed Rounds', at: 'church', cost: 800, time: 40, desc: 'Riflemen killed by Zombies or plague no longer rise', effect: { noRise: ['survivor'] } },
    halo: { name: 'Halo Wings', at: 'church', cost: 900, time: 40, desc: 'Angels and the Archangel get +25% HP and +15% speed', effect: { hpMult: { units: ['seraph', 'archangel'], v: 1.25 }, speedMult: { units: ['seraph', 'archangel'], v: 1.15 } } },
    holyground: { name: 'Holy Ground', at: 'church', cost: 1000, time: 45, desc: 'Within 7 tiles of the Church, plague does not hurt Survivors or heal the Horde', effect: { holyGround: 7 } },
  };
  const RORDER = { armory: ['hollow', 'plating', 'rockets', 'barrels'], church: ['blessed', 'halo', 'holyground'] };
  // combined modifier for one stat from a side's finished research. done: { id: true }. kind 'units' | 'blds'
  const modifier = (done, stat, kind, type) => {
    let mult = 1, add = 0;
    for (const id in RESEARCH) { if (!done || !done[id]) continue; const e = RESEARCH[id].effect[stat]; if (!e || !(e[kind] || []).includes(type)) continue; if (stat === 'rangeAdd') add += e.v; else mult *= e.v; }
    return stat === 'rangeAdd' ? add : mult;
  };
  const unlockedBy = type => Object.keys(RESEARCH).filter(id => (RESEARCH[id].effect.unlock || []).includes(type));
  const noRiseBy = (done, victimType) => Object.keys(RESEARCH).some(id => done && done[id] && (RESEARCH[id].effect.noRise || []).includes(victimType));
  // towers: [player, Horde]
  // Job F (user decision via the Director, Oct 28): the HQ / Hive built-in turret reaches 6 tiles (was 5)
  const HQ_TURRET_RANGE = 6;
  const TOWERS = { turret: { dmgType: ['bullet', 'fire'], cost: 600, time: 9, hp: 650, dmg: 28, rof: 0.9, range: 6.5, sight: 7, power: 20 },
    // Loop 4 opening addendum: built-in HQ / Hive turret. Hits air (bullet / fire), no power, fires during low power
    hq: { dmgType: ['bullet', 'fire'], dmg: 20, rof: 1.0, range: HQ_TURRET_RANGE, power: 0, hitsAir: true } }; // HQ and Hive share this turret
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
    // Loop 4 (L4)
    medicHealDps: { v: 10, src: 'L4 Medic: heals 10 HP/s, one target, infantry only' },
    archangelHealDps: { v: 5, src: 'L4 Archangel: allies within 4 tiles heal 5 HP/s' },
    archangelHealTiles: { v: 4, src: 'L4 Archangel aura' },
    archangelNoRiseTiles: { v: 6, src: 'L4 Archangel: bodies within 6 tiles do not rise' },
    demonAuraTiles: { v: 3, src: 'L4 Demon Lord plague aura: every tile within 3 tiles counts as plague' },
    holyGroundTiles: { v: 7, src: 'L4 Holy Ground radius around the Church' },
    demonRebuildS: { v: 60, src: 'L4 AI waits 60 s after the Demon Lord dies before building another' },
    waveBonusImps: { v: 2, src: 'L4 wave bonus once the player has a Church' },
    waveBonusBrutes: { v: 1, src: 'L4 wave bonus until the Dark Altar exists' },
    truckDropSearchTiles: { v: 2, src: 'approved by Dezi, Loop 3: Dezi option B: nearest Salvage Field tile within 2 tiles with room (cleared tiles included), up to 500; overflow or no field tile in range is lost' },
  };
  const D = {}; for (const k in TABLE) D[k] = TABLE[k].v;
  const RISE_WEAPONS = ['claw', 'plague'];          // crush, shell, fire, cleave never rise
  const LIGHT = 'light';

  const mult = (w, armor, type) => { const o = type && TYPE_MULT[w]; if (o && o[type] != null) return o[type]; const row = MATRIX[w]; if (!row) return 1; const m = row[armor]; return m == null ? 0 : m; };
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

  const Combat = { HQ_TURRET_RANGE, MATRIX, TYPE_MULT, UNITS, TOWERS, TABLE, D, RESEARCH, RORDER, modifier, unlockedBy, noRiseBy, mult, canHit, hitsAir, targetTier, riseEligible, purified, canCrush, plagueTick };
  if (typeof module !== 'undefined' && module.exports) module.exports = Combat;
  root.Combat = Combat;
})(typeof window !== 'undefined' ? window : globalThis);
