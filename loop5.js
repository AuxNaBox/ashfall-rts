// loop5.js: Loop 5 constants and helpers (rts-loops/loop5/1-spec.md). No DOM.
// Q1 (a) / Q3 (a) confirmed. Q2 (b) Bone Forge + Spitter are in §13.
(function (root) {
  'use strict';

  const TABLE = {
    // walls
    WALL_HP: { v: 400, src: 'L5 §2' },
    WALL_COST: { v: 50, src: 'L5 §1' },
    WALL_TIME: { v: 1, src: 'L5 §1' },
    WALL_POWER: { v: 0, src: 'L5 §1' },
    WALL_CAP: { v: 80, src: 'L5 §2 / §11' },
    AI_WALL_CAP: { v: 30, src: 'L5 §9 / §11' },
    WALL_DRAG_MAX: { v: 12, src: 'L5 §2' },
    WALL_EXTENDS_RADIUS: { v: false, src: 'L5 §2' },
    WALL_PAD_GAP: { v: 1, src: 'L5 §2' },
    WALL_TOUCH: { v: true, src: 'L5 §2' },
    SELL_REFUND: { v: 0.5, src: 'L5 §2' },
    // gates
    GATE_HP: { v: 800, src: 'L5 §3' },
    GATE_COST: { v: 150, src: 'L5 §1' },
    GATE_TIME: { v: 4, src: 'L5 §1' },
    GATE_POWER: { v: 5, src: 'L5 §1 / §3' },
    GATE_W: { v: 2, src: 'L5 §3' },
    GATE_H: { v: 1, src: 'L5 §3' },
    GATE_OPEN_TILES: { v: 1.5, src: 'L5 §3' },
    GATE_CLOSE_S: { v: 1.5, src: 'L5 §3' },
    GATE_ANIM_S: { v: 0.4, src: 'L5 §3' },
    // breach pathing
    BREACH_COST_TILES: { v: 8, src: 'L5 §4 / §11' },
    GATE_BREACH_COST_TILES: { v: 12, src: 'L5 §4 / §11' },
    BREACH_REPATH_S: { v: 0.5, src: 'L5 §4' },
    BREACH_WIDEN_TILES: { v: 2, src: 'L5 §4' },
    AI_BLOCKED_RETARGET_S: { v: 20, src: 'L5 §9' },
    // towers (L5 §5)
    FLAMETOWER_HP: { v: 700, src: 'L5 §5' },
    FLAMETOWER_COST: { v: 700, src: 'L5 §1' },
    FLAMETOWER_TIME: { v: 10, src: 'L5 §1' },
    FLAMETOWER_POWER: { v: 30, src: 'L5 §1' },
    FLAMETOWER_DMG: { v: 22, src: 'L5 §5' },
    FLAMETOWER_ROF: { v: 0.5, src: 'L5 §5' },
    FLAMETOWER_RANGE: { v: 3.5, src: 'L5 §5' },
    FLAMETOWER_SPLASH: { v: 0.8, src: 'L5 §5' },
    FLAMETOWER_SIGHT: { v: 6, src: 'L5 §5' },
    ROCKETTOWER_HP: { v: 900, src: 'L5 §17' },
    ROCKETTOWER_COST: { v: 900, src: 'L5 §1' },
    ROCKETTOWER_TIME: { v: 12, src: 'L5 §1' },
    ROCKETTOWER_POWER: { v: 30, src: 'L5 §1' },
    ROCKETTOWER_DMG: { v: 80, src: 'L5 §5' },
    ROCKETTOWER_ROF: { v: 2.0, src: 'L5 §5' },
    ROCKETTOWER_RANGE: { v: 7.5, src: 'L5 §5' },
    ROCKETTOWER_MIN_RANGE: { v: 2, src: 'L5 §5' },
    ROCKETTOWER_MIN_RANGE_INF_ONLY: { v: true, src: 'L5 §15 infantry only; heavies hittable at any range' },
    ROCKETTOWER_SPLASH: { v: 0.4, src: 'L5 §5' },
    ROCKETTOWER_SIGHT: { v: 8, src: 'L5 §5' },
    ROCKETTOWER_TRAVEL_S: { v: 0.6, src: 'L5 §5' },
    // siege (L5 §6)
    SIEGE_MIN_RANGE: { v: 5, src: 'L5 §15' },
    SIEGE_RANGE: { v: 11, src: 'L5 §6' },
    SIEGE_SPLASH: { v: 1.5, src: 'L5 §6' },
    SIEGE_TRAVEL_S: { v: 1.5, src: 'L5 §6' },
    SIEGE_ROF: { v: 4.0, src: 'L5 §6' },
    SIEGE_NEEDS_SPOTTER: { v: true, src: 'L5 §6' },
    SIEGE_STOP_TO_FIRE: { v: true, src: 'L5 §6' },
    ARTILLERY_DMG: { v: 110, src: 'L5 §6' },
    CATAPULT_DMG: { v: 95, src: 'L5 §6' },
    CATAPULT_HQ_FLOOR_S: { v: 720, src: 'Hard only: Corpse Catapults skip the player HQ until 12:00' },
    CRAWLER_RAID_AFTER_WAVE: { v: 4, src: 'Hard only: Crawlers may load but cannot leave on a raid until wave 4 has been sent' },
    AI_L5_SHARE: { v: { easy: 0.20, normal: 0.25, hard: 0.35 }, src: 'L5 §18 share of every AI credit income that goes to the tech wallet' },
    // transport (L5 §6)
    CARGO_CAP: { v: 5, src: 'L5 §6' },
    LOAD_TILES: { v: 1.0, src: 'L5 §6 (walk to it and enter)' },
    UNLOAD_S: { v: 1, src: 'L5 §6' },
    TRANSPORT_DEATH: { v: 'half', src: 'L5 Q3 (a): passengers exit at 50% of current HP' },
    TRANSPORT_DEATH_HP: { v: 0.5, src: 'L5 Q3 (a)' },
    // plague patches (L5 §6)
    PATCH_R: { v: 1, src: 'L5 §6' },
    PATCH_DUR_CATAPULT: { v: 8, src: 'L5 §6' },
    PATCH_DUR_SPRAYER: { v: 12, src: 'L5 §6 (unit def held Q1; constant is in place)' },
    PATCH_CAP: { v: 40, src: 'L5 §6 / §11' },
    CLEANSE_S: { v: 30, src: 'L5 §6 / §11' },
    CLEANSE_R: { v: 1, src: 'L5 §6' },
    // purifier / sprayer (L5 §6, Q1 (a))
    PURIFIER_HP: { v: 550, src: 'L5 §6' },
    PURIFIER_COST: { v: 1000, src: 'L5 §1' },
    PURIFIER_TIME: { v: 14, src: 'L5 §1' },
    PURIFIER_DMG: { v: 22, src: 'L5 §6' },
    PURIFIER_ROF: { v: 1.0, src: 'L5 §6' },
    PURIFIER_RANGE: { v: 3.5, src: 'L5 §6' },
    PURIFIER_SPLASH: { v: 1.0, src: 'L5 §6' },
    PURIFIER_SPEED: { v: 1.4, src: 'L5 §6' },
    PURIFIER_SIGHT: { v: 6, src: 'L5 §6' },
    PURIFIER_REQ_POWER: { v: 2, src: 'L5 §1 reqCount' },
    PURIFIER_PATCH_IMMUNE: { v: true, src: 'L5 §15 immune to plague patch damage; direct Sprayer hits still land' },
    SPRAYER_HP: { v: 550, src: 'L5 §6' },
    SPRAYER_COST: { v: 1000, src: 'L5 §1' },
    SPRAYER_TIME: { v: 14, src: 'L5 §1' },
    SPRAYER_DMG: { v: 22, src: 'L5 §15' },
    SPRAYER_ROF: { v: 1.0, src: 'L5 §6' },
    SPRAYER_RANGE: { v: 3, src: 'L5 §6' },
    SPRAYER_SPLASH: { v: 1.0, src: 'L5 §6' },
    SPRAYER_SPEED: { v: 1.4, src: 'L5 §6' },
    SPRAYER_SIGHT: { v: 6, src: 'L5 §6' },
    SPRAYER_RETREAT: { v: 0.4, src: 'L5 §9' },
    // Bone Forge / Spitter (L5 §13)
    FORGE_HP: { v: 900, src: 'L5 §13' },
    FORGE_COST: { v: 1200, src: 'L5 §13' },
    FORGE_TIME: { v: 12, src: 'L5 §13' },
    FORGE_POWER: { v: 30, src: 'L5 §13' },
    SPITTER_HP: { v: 160, src: 'L5 §13' },
    SPITTER_COST: { v: 300, src: 'L5 §13' },
    SPITTER_TIME: { v: 8, src: 'L5 §13' },
    SPITTER_DMG: { v: 55, src: 'L5 §13' },
    SPITTER_ROF: { v: 1.8, src: 'L5 §13' },
    SPITTER_RANGE: { v: 5.5, src: 'L5 §13' },
    SPITTER_SPEED: { v: 1.5, src: 'L5 §13' },
    SPITTER_SIGHT: { v: 6, src: 'L5 §13' },
    ACID_TRAVEL_S: { v: 0.5, src: 'L5 §13' },
    IMP_SPINES_RANGE: { v: 0.5, src: 'L5 §13 Long Spines' },
    // Leap / Demo (L5 §14)
    LEAP_TILES: { v: 5, src: 'L5 §14' },
    LEAP_CD_S: { v: 15, src: 'L5 §14' },
    LEAP_AIR_S: { v: 0.8, src: 'L5 §14' },
    LEAP_PATH_MULT: { v: 2, src: 'L5 §14 auto-leap if path > 2x straight' },
    LEAP_KEY: { v: 'KeyQ', src: 'L5 §14 ruling (a): selection action first, else tab' },
    DEMO_DMG: { v: 450, src: 'L5 §14' },
    DEMO_ARM_S: { v: 2.5, src: 'L5 §15' },
    DEMO_LIMIT: { v: 6, src: 'L5 §14' },
    DEMO_UNIT_DMG: { v: 50, src: 'L5 §14 shell splash on units' },
    DEMO_UNIT_R: { v: 1.5, src: 'L5 §14' },
    DEMO_STRUCT_R: { v: 1, src: 'L5 §14' },
    DEMO_HQ_MULT: { v: 0.5, src: 'L5 §15 HQ/Hive take half demo damage' },
    BLOATER_PATCH_S: { v: 8, src: 'L5 §14' },
    SHOCK_HP: { v: 160, src: 'L5 §14' },
    SHOCK_COST: { v: 350, src: 'L5 §14' },
    SHOCK_TIME: { v: 9, src: 'L5 §14' },
    LEAPER_HP: { v: 150, src: 'L5 §14' },
    LEAPER_COST: { v: 300, src: 'L5 §14' },
    LEAPER_TIME: { v: 8, src: 'L5 §14' },
    DEMO_HP: { v: 80, src: 'L5 §14' },
    DEMO_COST: { v: 250, src: 'L5 §14' },
    DEMO_TIME: { v: 7, src: 'L5 §14' },
    BLOATER_HP: { v: 120, src: 'L5 §14' },
    BLOATER_COST: { v: 250, src: 'L5 §14' },
    BLOATER_TIME: { v: 7, src: 'L5 §14' },
    // decal layer (visual; Artie 2-art-notes §4.9 + style guide). Does not touch the sim.
    DECAL_CAP: { v: 400, src: 'L5 engine (existing G.decals cap kept)' },
    DECAL_FADE_SCORCH: { v: 20, src: 'L5 art-notes / style guide explosion scorch ~20 s' },
    DECAL_FADE_BLOOD: { v: 20, src: 'L5 engine visual' },
    DECAL_FADE_TRACK: { v: 8, src: 'L5 engine visual / art-notes track B' },
    DECAL_FADE_CRATER: { v: 20, src: 'L5 art-notes siege crater fades like scorch' },
    TREAD_STEP_PX: { v: 20, src: 'L5 art-notes tread_mark ~20×8; spacing follows heading' },
    TREAD_CAP: { v: 160, src: 'L5 visual pool cap' },
    CRATER_CAP: { v: 80, src: 'L5 visual pool cap' },
    SCORCH_CAP: { v: 80, src: 'L5 visual pool cap' },
    DUST_CAP: { v: 80, src: 'L5 visual pool cap' },
    DMG_FX_CAP: { v: 80, src: 'L5 visual fire/smoke/drip/ooze pool cap' },
    SHADOW_ALPHA: { v: 0.30, src: 'style guide: 30% black ellipse, +3,+3' },
    SHADOW_DX: { v: 3, src: 'style guide / art-notes manifest shadow +3,+3' },
    SHADOW_DY: { v: 3, src: 'style guide / art-notes manifest shadow +3,+3' },
    // damage-state hooks (Don art overhaul / style guide / unitart DAMAGED_BELOW)
    DMG_STATE_DAMAGED: { v: 0.50, src: 'L5 art overhaul: stronger damaged state below 50% HP' },
    DMG_STATE_CRITICAL: { v: 0.25, src: 'L5 art overhaul: critical state at 25% HP' },
  };
  const D = {}; for (const k in TABLE) D[k] = TABLE[k].v;

  const isWallish = b => b && !b.dead && (b.type === 'wall' || b.type === 'gate');
  const isDefense = b => isWallish(b);
  const gateOpen = b => b && b.type === 'gate' && !b.dead && (b.gate === 'open' || b.gate === 'opening' || b.gate === 'closing');
  const gatePathableFor = (b, side) => b && b.type === 'gate' && !b.dead && b.side === side && !b.locked;

  // AI usage caps (L5 §9). sprayer entries exist as data only; unit def is held (Q1) and the AI does not train one.
  const AI = {
    easy: {
      walls: false,
      flametower: { cap: 1, from: 720 },
      rockettower: { cap: 1, from: 840 },
      crawler: null,
      catapult: { cap: 1, from: 900 },
      sprayer: { cap: 1, from: 900 },
      leaper: null,
      bloater: { perWave: 1, from: 900 },
      breachLead: 'rule4',
    },
    normal: {
      walls: false,
      flametower: { cap: 2, whenInf: 6 },
      rockettower: { cap: 2, whenVehicle: ['ark', 'apc', 'artillery', 'purifier'] },
      crawler: { perWave: 1, from: 600 },
      catapult: { cap: 1, whenTowers: 2 },
      sprayer: { cap: 1, from: 720 },
      leaper: { perWave: 3, afterForge: true, whenWallsOrArtillery: true },
      bloater: { perWave: 2, from: 720, whenWallsOrTowers: 2 },
      breachLead: 'brute',
    },
    hard: {
      walls: true,
      wallCap: 30,
      shieldLen: 5,
      shieldFront: 2,
      flametower: { cap: 3, whenInf: 6 },
      rockettower: { cap: 3, whenVehicle: ['ark', 'apc', 'artillery', 'purifier'] },
      crawler: { perWave: 1, from: 480, perWave2: 2, from2: 720 },
      catapult: { cap: 2, whenTowers: 2 },
      sprayer: { cap: 2, from: 540 },
      leaper: { perWave: 5, afterForge: true, whenWallsOrArtillery: true },
      bloater: { perWave: 3, from: 600, whenWallsOrTowers: 2 },
      breachLead: 'catapult',
    },
  };

  const TECH_UNITS = { crawler: 1, catapult: 1, sprayer: 1, bloater: 1, spitter: 1, leaper: 1 };
  const TECH_BLDS = { forge: 1, flametower: 1, rockettower: 1, wall: 1, gate: 1 };
  const TECH_RES = { acid: 1, claws: 1, boneplate: 1, spines: 1 };
  function isTechPaid(type) { return !!(TECH_UNITS[type] || TECH_BLDS[type] || TECH_RES[type]); }
  function l5Share(diffKey) {
    const s = D.AI_L5_SHARE;
    if (s == null) return 0;
    if (typeof s === 'number') return s;
    return s[diffKey] || 0;
  }
  const Loop5 = { TABLE, D, AI, isWallish, isDefense, gateOpen, gatePathableFor,
    isTechPaid, l5Share, TECH_UNITS, TECH_BLDS, TECH_RES,
    // Q1 / Q3 held
    HELD: {},
    onDamageState: null, // atlas / hook: function (bld, prev, next)
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Loop5;
  root.Loop5 = Loop5;
})(typeof window !== 'undefined' ? window : globalThis);
