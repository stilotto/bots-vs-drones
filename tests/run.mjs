// Headless checks for game.html. Run: node tests/run.mjs
// No dependencies. Three parts:
//   1. contracts: static checks of the architecture rules in CLAUDE.md
//   2. logic:     [10]-[50] in a bare vm (no THREE, no DOM, Math.random throws)
//   3. render:    [10]-[80] against a mocked THREE + DOM, renderer must not
//                 throw, must not write NaN into three, must not mutate the world
// Exits non-zero on any failure. Visual check: node tests/screenshot.mjs

import vm from 'node:vm';
import { readSections, stripCode, loadSections, memoryStorage } from './load-game.mjs';

let failures = 0, passes = 0;
function check(name, ok, detail = '') {
  if (ok) { passes++; console.log(`  ok   ${name}`); }
  else { failures++; console.log(`  FAIL ${name}${detail ? `\n       ${detail}` : ''}`); }
}
function section(title) { console.log(`\n${title}`); }

const SEEDS = Array.from({ length: 12 }, (_, i) => 1000 + i * 7919);
const BUDGET = 100;       // mirrors [90]'s placeholder
const MAX_TICKS = 20 * 90; // mirrors [90]'s placeholder cap

// ---------------------------------------------------------------- contracts
section('contracts');
const { sections } = readSections();
const ids = sections.map(s => s.id);
check('sections present in order [10] [20] [25] [30] [40] [50] [70] [80] [90]',
  JSON.stringify(ids) === JSON.stringify([10, 20, 25, 30, 40, 50, 70, 80, 90]), `got ${ids.join(' ')}`);

for (const s of sections.filter(s => s.id <= 60)) {
  const code = stripCode(s.code);
  const bad = ['THREE', 'document', 'window', 'requestAnimationFrame', 'OrbitControls']
    .filter(n => new RegExp(`\\b${n}\\b`).test(code));
  check(`[${s.id}] uses no THREE/DOM`, bad.length === 0, `references ${bad.join(', ')}`);
}
for (const s of sections.filter(s => [30, 40, 50].includes(s.id))) {
  check(`[${s.id}] uses no Math.random`, !/Math\.random/.test(stripCode(s.code)));
}
// Dependency flows downward only: no section names an export of a later one.
for (const s of sections) {
  const code = stripCode(s.code);
  const upward = sections.filter(o => o.id > s.id)
    .flatMap(o => o.exports.map(n => [o.id, n]))
    .filter(([, n]) => new RegExp(`(?<![.\\w$])${n}\\b`).test(code));
  check(`[${s.id}] references no later section`, upward.length === 0,
    upward.map(([id, n]) => `[${id}] ${n}`).join(', '));
}

// ---------------------------------------------------------------- logic
section('logic');
const LOGIC = [10, 20, 25, 30, 40, 50];
function loadLogic() {
  const { api, context } = loadSections(LOGIC, { localStorage: memoryStorage() });
  vm.runInContext(`Math.random = () => { throw new Error('Math.random called in [10]-[50]'); }`, context);
  return api;
}
const L = loadLogic();
for (const s of sections.filter(s => LOGIC.includes(s.id))) {
  const missing = s.exports.filter(n => L[n] === undefined && n !== 'WorldState');
  check(`[${s.id}] declares its EXPORTS`, missing.length === 0, `missing ${missing.join(', ')}`);
}

// Terrain
{
  const w = L.createWorld(1, [], []);
  const t = w.terrain;
  let finite = true, same = true;
  for (let x = -180; x <= 180; x += 15) for (let z = -180; z <= 180; z += 15) {
    const h = L.terrainHeight(t, x, z);
    finite &&= Number.isFinite(h);
    same &&= h === L.terrainHeight(t, x, z);
  }
  check('terrainHeight finite and repeatable across the arena', finite && same);
  const pad = t.flatZones[0];
  const padFlat = [[0, 0], [2, 0], [0, -2], [-1, 1]]
    .every(([dx, dz]) => L.terrainHeight(t, pad.x + dx, pad.z + dz) === 0);
  check('base pads are flat', padFlat);
}

// Loadouts
async function aiPlans(seed, api = L) {
  const a = new api.AICommander(seed + 1), b = new api.AICommander(seed + 2);
  const [la, lb] = await Promise.all([a.chooseLoadout(BUDGET, 'A', {}), b.chooseLoadout(BUDGET, 'B', {})]);
  const [oa, ob] = await Promise.all([a.chooseOrders([], []), b.chooseOrders([], [])]);
  return { la: la.units, lb: lb.units, oa, ob };
}
{
  let ok = true, detail = '';
  const cost = new Map(L.buyableCatalog().map(u => [JSON.stringify(L.resolveUnitSimSpec(u)), u.cost]));
  for (const seed of SEEDS) {
    const { la, lb } = await aiPlans(seed);
    const spend = units => units.reduce((s, u) => s + cost.get(JSON.stringify(u)), 0);
    if (!la.length || !lb.length) { ok = false; detail = `seed ${seed}: empty loadout`; }
    if (spend(la) > BUDGET || spend(lb) > BUDGET) { ok = false; detail = `seed ${seed}: over budget`; }
    if (la.some(u => u.targetCategory !== 'ground') || lb.some(u => u.targetCategory !== 'air')) {
      ok = false; detail = `seed ${seed}: wrong faction chassis`;
    }
  }
  check('AI loadouts non-empty, within budget, faction chassis (A ground, B air)', ok, detail);
  check('buyableCatalog splits by faction',
    L.buyableCatalog('A').every(u => u.chassis === 'bot') && L.buyableCatalog('B').every(u => u.chassis === 'drone') &&
    L.buyableCatalog('A').length + L.buyableCatalog('B').length === L.buyableCatalog().length);
}

// Matches: invariants every tick, determinism, same result in a fresh context
function runMatch(api, seed, plans, onTick) {
  const w = api.createWorld(seed, plans.la, plans.lb, plans.oa, plans.ob);
  onTick?.(w, true);
  while (w.tick < MAX_TICKS) {
    api.stepWorld(w);
    onTick?.(w, false);
    if (api.baseDestruction(w)) break;
  }
  return w;
}
const fingerprint = w => JSON.stringify({ tick: w.tick, units: w.units, projectiles: w.projectiles });
{
  const L2 = loadLogic();
  let inv = true, invDetail = '', det = true, cross = true, deploy = true;
  const tally = { A: 0, B: 0, cap: 0 };
  let threw = null;
  try { for (const seed of SEEDS) {
    const plans = await aiPlans(seed);
    let start = null;
    const deadIds = new Set();
    const w = runMatch(L, seed, plans, (w, first) => {
      if (first) { start = JSON.stringify(w.units.map(u => u.pos)); return; }
      if (w.tick <= w.deployTicks &&
          (JSON.stringify(w.units.map(u => u.pos)) !== start || w.projectiles.length)) deploy = false;
      for (const u of w.units) {
        const p = u.pos;
        if (![p.x, p.y, p.z, u.hp].every(Number.isFinite) || u.hp > u.maxHp) {
          inv = false; invDetail = `seed ${seed} tick ${w.tick}: ${u.id} pos/hp invalid`;
        }
        if (deadIds.has(u.id) && u.alive) { inv = false; invDetail = `seed ${seed}: ${u.id} came back to life`; }
        if (!u.alive) deadIds.add(u.id);
      }
      for (const pr of w.projectiles) {
        if (![pr.pos.x, pr.pos.y, pr.pos.z].every(Number.isFinite)) {
          inv = false; invDetail = `seed ${seed} tick ${w.tick}: projectile ${pr.id} pos invalid`;
        }
      }
    });
    const winner = L.baseDestruction(w);
    tally[winner ?? 'cap']++;
    if (fingerprint(w) !== fingerprint(runMatch(L, seed, plans))) det = false;
    if (fingerprint(w) !== fingerprint(runMatch(L2, seed, await aiPlans(seed, L2)))) cross = false;
  } } catch (e) { threw = e; }
  check('matches run without throwing (no THREE/DOM/Math.random reached at runtime)',
    !threw, threw && (threw.stack || String(threw)).split('\n').slice(0, 3).join('\n       '));
  check(`${SEEDS.length} AI-vs-AI matches keep invariants every tick (finite pos, hp <= max, dead stay dead)`, inv, invDetail);
  check('deploy window: nothing moves or fires before deployTicks', deploy);
  check('determinism: same seed + loadouts -> identical match', det);
  check('determinism: identical in a fresh context (no hidden module state)', cross);
  console.log(`       results: A ${tally.A} · B ${tally.B} · hit ${MAX_TICKS / 20}s cap ${tally.cap}`);
}

// Win condition
{
  const w = L.createWorld(1, [], []);
  const base = f => w.units.find(u => u.isBase && u.faction === f);
  const r0 = L.baseDestruction(w);
  base('A').alive = false; const r1 = L.baseDestruction(w);
  base('B').alive = false; const r2 = L.baseDestruction(w);
  base('A').alive = true;  const r3 = L.baseDestruction(w);
  check('baseDestruction: none -> null, A down -> B, both -> B, B down -> A',
    r0 === null && r1 === 'B' && r2 === 'B' && r3 === 'A', `${r0} ${r1} ${r2} ${r3}`);
}

// Custom units
{
  const storage = memoryStorage();
  const { api } = loadSections(LOGIC, { localStorage: storage });
  const saved = api.saveCustomUnit({ name: 'Test Drone', chassis: 'drone', hp: 50, speed: 8, weaponId: 'blaster' });
  const inB = saved && api.buyableCatalog('B').some(u => u.id === saved.id);
  const notInA = saved && !api.buyableCatalog('A').some(u => u.id === saved.id);
  const { api: reloaded } = loadSections(LOGIC, { localStorage: storage });
  reloaded.loadFromStorage();
  check('custom unit saves, joins its faction catalog, survives reload',
    inB && notInA && reloaded.listCustomUnits().some(u => u.id === saved.id));
}

// ---------------------------------------------------------------- render
section('render (mocked three)');
{
  const calls = { nan: [] };
  // A THREE stand-in where every property, call and construction yields another
  // stand-in; used as a number it is 1. Records any NaN/Infinity passed in.
  const mock = (path) => {
    const store = {};
    const fn = function () {};
    return new Proxy(fn, {
      get(_, k) {
        if (k === Symbol.toPrimitive) return () => 1;
        if (k === Symbol.iterator) return function* () {};
        if (k === 'then') return undefined;
        if (k in store) return store[k];
        return (store[k] = mock(`${path}.${String(k)}`));
      },
      set(_, k, v) {
        if (typeof v === 'number' && !Number.isFinite(v)) calls.nan.push(`${path}.${String(k)} = ${v}`);
        store[k] = v; return true;
      },
      apply(_, __, args) {
        args.forEach((a, i) => {
          if (typeof a === 'number' && !Number.isFinite(a)) calls.nan.push(`${path}(arg ${i} = ${a})`);
        });
        return mock(`${path}()`);
      },
      construct(_, args) {
        const inst = mock(`new ${path}`);
        if (path === 'OrbitControls') {
          inst.addEventListener = (type, cb) => { (calls.listeners ??= {})[type] = cb; };
        }
        return inst;
      },
    });
  };
  const el = () => ({ clientWidth: 800, clientHeight: 500, appendChild() {}, addEventListener() {},
    style: {}, classList: { add() {}, remove() {} } });
  const { api: R } = loadSections([10, 20, 25, 30, 40, 50, 70, 80], {
    THREE: mock('THREE'), OrbitControls: mock('OrbitControls'),
    localStorage: memoryStorage(),
    window: { devicePixelRatio: 2, addEventListener() {} },
    document: { getElementById: el, createElement: el },
  });

  const plans = await aiPlans(SEEDS[0], R);
  const w = R.createWorld(SEEDS[0], plans.la, plans.lb, plans.oa, plans.ob);
  const modes = [];
  R.onCameraModeChange(m => modes.push(m));
  let threw = null, mutated = false;
  try {
    R.initRenderer(el(), w);
    const snap = () => ({
      unitsById: new Map(w.units.map(u => [u.id, { pos: { ...u.pos }, alive: u.alive }])),
      projectilesById: new Map(w.projectiles.map(p => [p.id, { pos: { ...p.pos } }])),
    });
    for (let i = 0; i < 400 && !R.baseDestruction(w); i++) {
      const prev = snap();
      R.stepWorld(w);
      if (i === 200) calls.listeners?.start?.(); // user grabs the camera mid-match
      if (i === 300) R.setCameraMode('director');
      const before = fingerprint(w);
      for (const alpha of [0, 0.5, 1]) R.renderFrame(prev, w, alpha);
      if (fingerprint(w) !== before) mutated = true;
    }
    R.resetCommanderView();
  } catch (e) { threw = e; }
  check('initRenderer + 1200 renderFrames across director/manual run without throwing',
    !threw, threw && (threw.stack || String(threw)).split('\n').slice(0, 3).join('\n       '));
  check('renderer never mutates the world', !mutated);
  check('renderer never passes NaN/Infinity to three', calls.nan.length === 0, calls.nan.slice(0, 3).join('; '));
  check('camera: drag hands over to manual, director can be re-selected',
    modes.includes('manual') && modes.lastIndexOf('director') > modes.indexOf('manual'), modes.join(' -> '));
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
