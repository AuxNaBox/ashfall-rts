// L5 §18 tech wallet: AI_L5_SHARE of AI income pays for Loop 5 items. Starting
// credits stay in the main wallet. Storage cap and the 7123578 stall fix apply to main only.
'use strict';
const test = require('node:test'), assert = require('node:assert');
const { load } = require('./harness.js');

const TILE = 32;
const SHARE = { easy: 0.20, normal: 0.25, hard: 0.35 };

function boot(diff) {
  const L = load(); L.seed(1);
  const { RTS } = L;
  RTS.newGame(diff);
  const G = RTS.G;
  if (G.ai) { G.ai.t = 0; G.ai.nextWave = 1e9; }
  return { RTS, G };
}

test('AI_L5_SHARE is 0.20 / 0.25 / 0.35', () => {
  const { RTS } = load();
  for (const k of Object.keys(SHARE)) {
    assert.strictEqual(RTS.Loop5.D.AI_L5_SHARE[k], SHARE[k]);
    assert.strictEqual(RTS.Loop5.l5Share(k), SHARE[k]);
  }
});

test('starting AI credits go entirely to the main wallet', () => {
  for (const [diff, start] of [['hard', 2000], ['normal', 2500], ['easy', 2500]]) {
    const { RTS, G } = boot(diff);
    assert.strictEqual(G.credits[1], start, diff + ' main start');
    assert.strictEqual(G.techCredits, 0, diff + ' tech starts empty');
    assert.strictEqual(RTS.aiL5Share(), SHARE[diff]);
  }
});

test('addIncome splits by difficulty share and leaves player income unsplit', () => {
  for (const diff of ['easy', 'normal', 'hard']) {
    const { RTS, G } = boot(diff);
    G.credits[1] = 1000; // under the 2,000 Hive cap so the incoming main share is not clamped
    G.techCredits = 0;
    RTS.addIncome(1, 1000);
    const share = SHARE[diff];
    assert.strictEqual(G.techCredits, 1000 * share, diff + ' tech share');
    assert.strictEqual(G.credits[1], 1000 + 1000 * (1 - share), diff + ' main share');
  }
  const { RTS, G } = boot('hard');
  const p0 = G.credits[0];
  RTS.addIncome(0, 400);
  assert.strictEqual(G.credits[0], p0 + 400);
  assert.strictEqual(G.techCredits, 0);
});

test('addIncome does not slash starting credits that already sit over the Hive cap', () => {
  const { RTS, G } = boot('normal'); // start 2,500, Hive cap 2,000
  assert.ok(G.credits[1] > RTS.storageCapOf(1));
  const main0 = G.credits[1];
  RTS.addIncome(1, 100);
  assert.strictEqual(G.credits[1], main0, 'main stays at the over-cap start');
  assert.strictEqual(G.techCredits, 100 * SHARE.normal, 'tech still receives its share');
});

test('storage cap applies to the main wallet only; the stall fix still reaches the cap', () => {
  const { RTS, G } = boot('hard');
  const cap = RTS.storageCapOf(1);
  assert.ok(cap >= 2000);
  G.credits[1] = cap - 100;
  G.techCredits = 50;
  RTS.addIncome(1, 400); // 0.35 * 400 = 140 tech, 260 main before clamp
  assert.strictEqual(G.credits[1], cap, 'main is clamped to the cap');
  assert.ok(G.techCredits > 50, 'tech still received its share');
  // getCredits (salvage host) is the main wallet, so free space is 0 when main is full
  G.credits[1] = cap;
  const free = RTS.storageCapOf(1) - G.credits[1];
  assert.strictEqual(free, 0);
});

test('Loop 5 units, the Bone Forge, Spires, Cannons, walls and Forge research debit the tech wallet', () => {
  const { RTS, G } = boot('hard');
  const hive = G.blds.find(b => b.side === 1 && b.type === 'hq');
  // Prereqs: factory, barracks, refinery, power already exist or we force them
  const typesNeed = ['power', 'refinery', 'barracks', 'factory', 'depot'];
  for (const t of typesNeed) {
    if (!G.blds.some(b => b.side === 1 && b.type === t && !b.dead)) {
      const b = RTS.makeBld(t, 1, hive.tx + 4, hive.ty + 4);
      if (b) b.bornT = -1e9;
    }
  }
  const main0 = G.credits[1];
  G.techCredits = 20000;
  assert.ok(RTS.usesTechWallet(1, 'crawler'));
  assert.ok(RTS.usesTechWallet(1, 'forge'));
  assert.ok(RTS.usesTechWallet(1, 'flametower'));
  assert.ok(RTS.usesTechWallet(1, 'rockettower'));
  assert.ok(RTS.usesTechWallet(1, 'wall'));
  assert.ok(RTS.usesTechWallet(1, 'acid'));
  assert.ok(!RTS.usesTechWallet(1, 'zombie'));
  assert.ok(!RTS.usesTechWallet(1, 'silo'));
  assert.ok(!RTS.usesTechWallet(0, 'crawler'), 'the player has no tech wallet');

  assert.ok(RTS.queueItem(1, 'crawler'));
  assert.strictEqual(G.credits[1], main0, 'crawler does not touch main');
  assert.strictEqual(G.techCredits, 20000 - RTS.UDEF.crawler.cost);

  const tech1 = G.techCredits;
  assert.ok(RTS.queueItem(1, 'zombie'));
  assert.strictEqual(G.credits[1], main0 - RTS.UDEF.zombie.cost);
  assert.strictEqual(G.techCredits, tech1, 'zombie does not touch tech');

  RTS.cancelItem(1, 'crawler');
  assert.strictEqual(G.techCredits, tech1 + RTS.UDEF.crawler.cost, 'crawler refund returns to tech');
  assert.strictEqual(G.credits[1], main0 - RTS.UDEF.zombie.cost);

  // Flesh Wall: paid from tech at placement
  const tech2 = G.techCredits;
  const walls = RTS.placeWallLine(1, [[hive.tx, hive.ty + 6]]);
  assert.ok(walls.length >= 1);
  assert.strictEqual(G.techCredits, tech2 - RTS.Loop5.D.WALL_COST);
  assert.strictEqual(G.credits[1], main0 - RTS.UDEF.zombie.cost);
});

test('classic buildings, Silos and the nuke stay on the main wallet', () => {
  const { RTS, G } = boot('hard');
  assert.ok(!RTS.usesTechWallet(1, 'power'));
  assert.ok(!RTS.usesTechWallet(1, 'refinery'));
  assert.ok(!RTS.usesTechWallet(1, 'silo'));
  assert.ok(!RTS.usesTechWallet(1, 'altar'));
  assert.ok(!RTS.usesTechWallet(1, 'demon'));
  assert.ok(RTS.canAiAfford('zombie', 0) || G.credits[1] >= RTS.UDEF.zombie.cost);
  G.credits[1] = 0;
  G.techCredits = 10000;
  assert.strictEqual(RTS.canAiAfford('zombie'), false);
  assert.strictEqual(RTS.canAiAfford('crawler'), true);
  assert.strictEqual(RTS.canAiAfford('silo'), false);
});

test('snapMainWallet lifts a split remainder so the 2,000 Grinder Pit stays affordable', () => {
  const { RTS, G } = boot('normal');
  G.credits[1] = 2000 - 1e-7;
  assert.strictEqual(RTS.canAiAfford('refinery', 0), true);
  assert.strictEqual(G.credits[1], 2000);
});
