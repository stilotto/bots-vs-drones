// Balance report from game.html's [85] harness, headless.
// Run: node tests/balance.mjs [matches] [seed]
// Loads only [10]-[50] + [85] (no renderer, no UI), same loader as run.mjs.

import { loadSections, memoryStorage } from './load-game.mjs';

const matches = parseInt(process.argv[2], 10) || 200;
const seed = parseInt(process.argv[3], 10) || 1;

const { api } = loadSections([10, 20, 25, 30, 40, 50, 85], { localStorage: memoryStorage() });
const t0 = performance.now();
const report = await api.runBalance({ matches, seed });
console.log(api.formatBalanceReport(report));
console.log(`(${((performance.now() - t0) / 1000).toFixed(1)}s)`);
