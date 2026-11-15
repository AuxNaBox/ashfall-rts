// Hard-only CRAWLER_RAID_AFTER_WAVE = 4: Crawlers may load passengers but cannot
// leave on a raid until wave 4 has been sent. Normal and Easy raids are ungated.
'use strict';
const test = require('node:test'), assert = require('node:assert');
const { load } = require('./harness.js');

const TILE = 32, GATE = 4;

function scene(diff, waveN) {
  const L = load(); L.seed(1);
  const { RTS } = L;
  RTS.newGame(diff);
  const G = RTS.G;
  if (G.ai) { G.ai.t = 0; G.ai.nextWave = 1e9; G.ai.waveN = waveN; }
  // Park starting units so they are not a nearer auto-target or an "intruder" near the Hive.
  for (const u of G.units) { u.x = 16; u.y = 16; u.path = null; u.target = null; u.order = 'idle'; }
  const hive = G.blds.find(b => b.side === 1 && b.type === 'hq');
  const hq = G.blds.find(b => b.side === 0 && b.type === 'hq');
  const crw = RTS.makeUnit('crawler', 1, hive.x, hive.y + 2 * TILE);
  crw.target = null; crw.order = 'idle'; crw.path = null;
  const pax = [];
  for (let i = 0; i < 3; i++) {
    const z = RTS.makeUnit('zombie', 1, crw.x, crw.y);
    z.target = null; z.order = 'idle'; z.path = null;
    assert.ok(RTS.loadUnit(crw, z), 'load passenger ' + i);
    pax.push(z);
  }
  return { RTS, G, hive, hq, crw, pax };
}

test('constant CRAWLER_RAID_AFTER_WAVE is 4', () => {
  const { RTS } = load();
  assert.strictEqual(RTS.Loop5.D.CRAWLER_RAID_AFTER_WAVE, GATE);
});

test('Hard: a loaded Crawler does not leave on a raid before wave 4', () => {
  for (const waveN of [0, 3]) {
    const { RTS, G, crw, hq } = scene('hard', waveN);
    assert.strictEqual(RTS.crawlerRaidGated(), true, 'gated at waveN=' + waveN);
    assert.strictEqual((crw.cargo || []).length, 3);
    assert.ok(hq && !hq.dead, 'player HQ is a legal raid target');
    RTS.updAI(0.5);
    assert.strictEqual(crw.raid, undefined, 'must not start a raid at waveN=' + waveN);
    assert.notStrictEqual(crw.order, 'move', 'must not march at waveN=' + waveN);
    assert.strictEqual((crw.cargo || []).length, 3, 'passengers stay loaded');
    assert.ok(G.ai.waveN === waveN, 'wave counter unchanged');
  }
});

test('Normal and Easy: a loaded Crawler can raid before wave 4', () => {
  for (const diff of ['easy', 'normal']) {
    const { RTS, crw } = scene(diff, 0);
    assert.strictEqual(RTS.crawlerRaidGated(), false, diff + ' is ungated');
    RTS.updAI(0.5);
    assert.strictEqual(crw.raid, true, diff + ' starts a raid with 3 cargo at waveN=0');
    assert.ok(crw.unloadAfter, diff + ' will unload at the target');
  }
});

test('Hard: the raid is released on the same tick that wave 4 is sent', () => {
  const { RTS, G, hive, crw } = scene('hard', 3);
  G.ai.nextWave = G.time;
  // Extra idle Zombies so the 14-idle wave-4 trigger fires. Created first-to-last so
  // the send slice prefers them over the Crawler (which stays parked at the Hive).
  const extra = [];
  for (let i = 0; i < 16; i++) {
    const z = RTS.makeUnit('zombie', 1, hive.x + ((i % 4) - 1.5) * TILE, hive.y + Math.floor(i / 4) * TILE);
    z.target = null; z.order = 'idle'; z.path = null;
    extra.push(z);
  }
  assert.strictEqual(RTS.crawlerRaidGated(), true, 'still gated before the tick');
  RTS.updAI(0.5);
  assert.strictEqual(G.ai.waveN, 4, 'wave 4 is sent');
  assert.ok((G.ai.waveLog || []).length >= 1, 'wave log records the send');
  assert.strictEqual(RTS.crawlerRaidGated(), false, 'gate lifts once waveN is 4');
  assert.strictEqual(crw.raid, true, 'raid starts on the same AI tick, after the send');
  assert.ok(crw.unloadAfter);
  assert.ok(!extra.some(z => z === crw), 'sanity');
});
