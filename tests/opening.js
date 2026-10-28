// node tests/opening.js [seed] [startCredits]  -> Loop 4 opening addendum 12-minute Normal regression (headless, seeded)
'use strict';
const { load } = require('./harness.js');
const { openingSim } = require('./opening-sim.js');
// options: --map <crossroads|fallen-city|ash-ring> (assets/maps/<name>.json), --diff <easy|normal|hard>
const argv = process.argv.slice(2), opt = k => { const i = argv.indexOf(k); if (i < 0) return undefined; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const mapName = opt('--map'), diff = opt('--diff');
const map = mapName ? JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'assets', 'maps', mapName + '.json'), 'utf8')) : undefined;
const seed = +(argv[0] || 1), start = argv[1] ? +argv[1] : undefined;
const { RTS, seed: setSeed } = load(); setSeed(seed);
const r = openingSim(RTS, { startCredits: start, map, diff });
console.log(r.log.join('\n'));
console.log(JSON.stringify(r.numbers));
let ok = true; for (const [k, v] of Object.entries(r.checks)) { console.log((v ? 'PASS ' : 'FAIL ') + k); ok = ok && v; }
for (const [k, v] of Object.entries(r.aggregate || {})) console.log((v ? 'SEED-OK ' : 'SEED-MISS ') + k + ' (counted across seeds by tests/opening-hard.js)');
process.exit(ok ? 0 : 1);
