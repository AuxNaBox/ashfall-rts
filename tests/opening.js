// node tests/opening.js [seed] [startCredits]  -> Loop 4 opening addendum 12-minute Normal regression (headless, seeded)
'use strict';
const { load } = require('./harness.js');
const { openingSim } = require('./opening-sim.js');
const seed = +(process.argv[2] || 1), start = process.argv[3] ? +process.argv[3] : undefined;
const { RTS, seed: setSeed } = load(); setSeed(seed);
const r = openingSim(RTS, { startCredits: start });
console.log(r.log.join('\n'));
console.log(JSON.stringify(r.numbers));
let ok = true; for (const [k, v] of Object.entries(r.checks)) { console.log((v ? 'PASS ' : 'FAIL ') + k); ok = ok && v; }
process.exit(ok ? 0 : 1);
