'use strict';
/* node --test tests/ */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
function loadData() {
  const ctx = {};
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['data.js', 'coach-overrides.js', 'data-v5.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  return JSON.parse(JSON.stringify(ctx.ASTRA_DATA)); // plain data: drop the vm realm so deepEqual compares cleanly
}
const D = loadData();
const E = require('../engine.js');
const { makeState } = require('./fixture.js');

/* ---------- helpers ---------- */
const TODAY = '2026-11-02'; // a Monday
const pad = n => String(n).padStart(2, '0');
function shift(k, n) { const [y, m, d] = k.split('-').map(Number); const t = new Date(y, m - 1, d + n, 12); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`; }

function blank(over) {
  return Object.assign({
    schema: 4, version: '5.0.0', revision: 1,
    profile: { name: 'RV', startWeight: 55, goal: 65, startDate: shift(TODAY, -60), phase: 1, calories: 2500, protein: 120, fat: 70, gainRate: 0.25, notes: '' },
    meals: [], weights: [], checkins: {}, sessions: [], cardio: [], water: {}, active: null, rest: null, legacy: {}, legacyWeight: null,
    calorieLog: [], foodDone: {}, prefSwaps: {}, lastExport: null, catchUpDismissed: {}
  }, over);
}
const PLAN = { sets: 3, min: 8, max: 12, rest: 90, unit: 'reps' };
/* one session with `rows` for exercise `id`; rows are [kg, reps, rpe] */
function ses(id, date, rows, o = {}) {
  const plan = o.plan || PLAN;
  const s = {
    id: `s-${date}-${id}`, date, startedAt: `${date}T10:00:00.000Z`, workout: o.workout || 'UA', phase: 1, easy: false,
    pain: o.pain ?? 1, plan: { [id]: plan }, sets: { [id]: rows.map(([kg, reps, rpe], i) => ({ kg, reps, rpe, done: true, at: `${date}T10:${pad(i)}:00.000Z` })) },
    skipped: [], status: o.status || 'complete', afterPain: o.afterPain ?? 1, note: ''
  };
  if (o.painFlags) s.painFlags = o.painFlags;
  if (o.swaps) s.swaps = o.swaps;
  return s;
}
const withSessions = (...sessions) => blank({ sessions });
const rx = (S, id, plan, extra) => E.prescribe(S, D, id, Object.assign({ plan, today: TODAY }, extra));
/* fail on NaN / Infinity numbers and on 'undefined' / 'NaN' leaking into text */
function scan(v, where = 'root') {
  if (typeof v === 'number') assert.ok(Number.isFinite(v), `non-finite number at ${where}`);
  else if (typeof v === 'string') assert.ok(!/undefined|NaN|\[object|Infinity/.test(v), `bad text at ${where}: ${v}`);
  else if (Array.isArray(v)) v.forEach((x, i) => scan(x, `${where}[${i}]`));
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) scan(v[k], `${where}.${k}`);
}

/* ======================================================================
   data-v5.js
   ====================================================================== */
test('data: all 43 exercises have mg, inc, swaps, uni, zone', () => {
  const ids = Object.keys(D.exercises);
  assert.equal(ids.length, 43);
  for (const id of ids) {
    const e = D.exercises[id];
    assert.equal(typeof e.mg, 'object', `${id}.mg`);
    assert.ok(Number.isFinite(e.inc) && e.inc >= 0, `${id}.inc`);
    assert.ok(Array.isArray(e.swaps), `${id}.swaps`);
    assert.equal(typeof e.uni, 'boolean', `${id}.uni`);
    assert.ok(['back', 'shoulder', null].includes(e.zone), `${id}.zone`);
  }
});

test('data: swaps reference real, distinct, non-mobility exercises', () => {
  for (const [id, e] of Object.entries(D.exercises)) {
    assert.equal(new Set(e.swaps).size, e.swaps.length, `${id} has duplicate swaps`);
    for (const s of e.swaps) {
      assert.ok(D.exercises[s], `${id} -> ${s} does not exist`);
      assert.notEqual(s, id);
      assert.ok(!D.exercises[s].fixed, `${id} -> ${s} is a mobility drill`);
    }
  }
});

test('data: swaps stay inside one movement pattern', () => {
  const patterns = {
    horizontalPress: ['bench', 'dbpress', 'machinepress'], verticalPress: ['ohp'], horizontalPull: ['row', 'cablerow', 'sarow'], verticalPull: ['latpull', 'salatpull'],
    knee: ['squat', 'hacksquat', 'legpress', 'bss', 'lunge'], hinge: ['rdl', 'slrdl', 'backext', 'hipthrust'], kneeFlexion: ['curlLeg'], biceps: ['curl', 'hammer'],
    triceps: ['triceps', 'ohtri'], core: ['bird', 'dead', 'pallof', 'sideplank', 'kneeraise'], carries: ['carry', 'suitcase']
  };
  const of = id => Object.keys(patterns).find(p => patterns[p].includes(id));
  for (const [id, e] of Object.entries(D.exercises)) for (const s of e.swaps) assert.equal(of(s), of(id), `${id} -> ${s} crosses patterns`);
});

test('data: RV-specific swap order (joint-friendly first)', () => {
  assert.deepEqual(D.exercises.bench.swaps.slice(0, 2), ['dbpress', 'machinepress']);
  assert.deepEqual(D.exercises.squat.swaps.slice(0, 2), ['hacksquat', 'legpress']);
  assert.deepEqual(D.exercises.rdl.swaps.slice(0, 2), ['hipthrust', 'backext']);
});

test('data: mobility drills carry no muscle credit, load or swaps', () => {
  const fixed = Object.entries(D.exercises).filter(([, e]) => e.fixed);
  assert.equal(fixed.length, 9);
  for (const [id, e] of fixed) { assert.deepEqual(e.mg, {}, id); assert.equal(e.inc, 0, id); assert.deepEqual(e.swaps, [], id); assert.equal(e.zone, null, id); }
});

test('data: mg keys are real muscles, credit is 1 or 0.5, every working lift has a primary', () => {
  for (const [id, e] of Object.entries(D.exercises)) {
    for (const [m, f] of Object.entries(e.mg)) { assert.ok(D.muscleGroups[m], `${id}: ${m}`); assert.ok(f === 1 || f === 0.5, `${id}.${m}=${f}`); }
    if (!e.fixed) assert.ok(Object.values(e.mg).includes(1), `${id} has no primary muscle`);
  }
});

test('data: uni, bar and inc follow the contract', () => {
  const uni = Object.keys(D.exercises).filter(id => D.exercises[id].uni).sort();
  assert.deepEqual(uni, ['bss', 'lunge', 'pallof', 'salatpull', 'sarow', 'sideplank', 'slrdl', 'suitcase']);
  assert.deepEqual(Object.keys(D.exercises).filter(id => D.exercises[id].bar !== undefined).sort(), ['bench', 'squat']);
  assert.equal(D.exercises.bench.bar, 20);
  assert.equal(D.exercises.squat.bar, 20);
  assert.equal(D.exercises.bench.inc, 2.5);
  assert.equal(D.exercises.dbpress.inc, 2);   // dumbbell, per hand
  assert.equal(D.exercises.legpress.inc, 5);  // machine
  assert.equal(D.exercises.triceps.inc, 2.5); // cable stack
  assert.equal(D.exercises.dead.inc, 0);      // bodyweight
});

test('data: muscle groups and weekly volume bands', () => {
  assert.deepEqual(Object.keys(D.muscleGroups), ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'calves', 'core']);
  assert.deepEqual(Object.keys(D.volumeTargets), Object.keys(D.muscleGroups));
  for (const [m, t] of Object.entries(D.volumeTargets)) assert.ok(t.length === 2 && t[0] > 0 && t[1] > t[0], m);
  assert.deepEqual(D.volumeTargets.chest, [8, 20]);
});

test('data: new foods appended, gap flags set', () => {
  const byId = Object.fromEntries(D.foods.map(f => [f.id, f]));
  assert.equal(new Set(D.foods.map(f => f.id)).size, D.foods.length);
  for (const id of ['oats', 'pb', 'banana', 'nuts', 'bread', 'cheese', 'beef', 'oil', 'shake']) assert.ok(byId[id], id);
  assert.deepEqual([byId.shake.p, byId.shake.c, byId.shake.f, byId.shake.k, byId.shake.base], [50, 85, 29, 770, 1]);
  assert.match(byId.shake.portion, /500 ml whole milk/);
  assert.deepEqual(D.foods.filter(f => f.gap).map(f => f.id).sort(), ['banana', 'cheese', 'milk', 'nuts', 'oats', 'pb', 'shake', 'whey', 'yogurt']);
  for (const id of ['bread', 'beef', 'oil', 'chicken', 'rice']) assert.ok(!byId[id].gap, id);
  for (const f of D.foods) for (const k of ['id', 'name', 'unit', 'base', 'p', 'c', 'f', 'k']) assert.ok(f[k] !== undefined, `${f.id}.${k}`);
});

/* ======================================================================
   module shape and purity
   ====================================================================== */
test('engine: exports every contract function', () => {
  for (const fn of ['prescribe', 'e1rm', 'plates', 'weekVolume', 'trend', 'energy', 'asymmetry', 'painLinks', 'planWeek', 'shortPlan', 'recentMeals', 'closeGap', 'weeklyReview', 'coachText'])
    assert.equal(typeof E[fn], 'function', fn);
});

test('engine: pure source (no storage, DOM, clock or global data) and exact UMD footer', () => {
  const raw = fs.readFileSync(path.join(ROOT, 'engine.js'), 'utf8');
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/ASTRA_DATA|localStorage|sessionStorage|Date\.now|document\.|new Date\(\)|Math\.random/.test(code));
  assert.ok(raw.includes("if (typeof module==='object' && module.exports) module.exports=E; else window.AstraEngine=E;") || raw.includes("if (typeof module === 'object' && module.exports) module.exports = E; else window.AstraEngine = E;"));
});

test('engine: loads as a browser global when there is no module', () => {
  const ctx = { window: {} };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'engine.js'), 'utf8'), ctx);
  assert.equal(typeof ctx.AstraEngine.prescribe, 'function');
});

/* ======================================================================
   prescribe
   ====================================================================== */
test('prescribe: fixed mobility drill', () => {
  const r = rx(blank(), 'flexhip', { sets: 2, min: 30, max: 45, rest: 15, unit: 'seconds / side' });
  assert.equal(r.mode, 'fixed'); assert.equal(r.action, 'fixed'); assert.equal(r.kg, null); assert.equal(r.reps, 30);
  assert.equal(r.reason, 'Mobility: quality over numbers.');
  assert.equal(r.sets.length, 2);
});

test('prescribe: first time asks for a 4-reps-in-reserve weight', () => {
  const r = rx(blank(), 'dbpress', PLAN);
  assert.equal(r.mode, 'new'); assert.equal(r.action, 'start'); assert.equal(r.kg, null); assert.equal(r.reps, 8);
  assert.equal(r.arrow, null); assert.equal(r.swapTo, null); assert.equal(r.lastDate, null); assert.deepEqual(r.last, []);
  assert.equal(r.reason, 'First time: choose a weight you could lift about 4 more times (effort 6).');
  assert.equal(r.sets.length, 3);
  assert.deepEqual(r.sets[0], { kg: null, reps: 8 });
});

test('prescribe: first time on a bodyweight move does not say "choose a weight"', () => {
  const r = rx(blank(), 'dead', { sets: 2, min: 5, max: 8, rest: 40, unit: 'reps / side' });
  assert.equal(r.action, 'start');
  assert.ok(!/weight/.test(r.reason));
});

test('prescribe: one pain flag holds the load', () => {
  const S = withSessions(ses('bench', '2026-10-27', [[60, 8, 8], [60, 8, 8], [60, 7, 8.5]], { plan: { sets: 3, min: 6, max: 10, rest: 150, unit: 'reps' }, painFlags: { bench: 'shoulder' } }));
  const r = rx(S, 'bench', { sets: 3, min: 6, max: 10, rest: 150, unit: 'reps' });
  assert.equal(r.action, 'pain-hold'); assert.equal(r.kg, 60); assert.equal(r.reps, 6); assert.equal(r.swapTo, null); assert.equal(r.arrow, 'same');
  assert.match(r.reason, /shoulder/); assert.match(r.reason, /60 kg/);
  assert.equal(r.lastDate, '2026-10-27');
});

test('prescribe: pain rising 2+ points on a zone lift holds, on a zone-free lift it does not', () => {
  const hurt = withSessions(ses('squat', '2026-10-28', [[80, 8, 8], [80, 8, 8], [80, 8, 8]], { pain: 1, afterPain: 3 }));
  const a = rx(hurt, 'squat', { sets: 3, min: 6, max: 10, rest: 180, unit: 'reps' });
  assert.equal(a.action, 'pain-hold'); assert.equal(a.kg, 80); assert.match(a.reason, /1 to 3/);
  const fine = withSessions(ses('curl', '2026-10-28', [[12, 10, 8], [12, 10, 8], [12, 10, 8]], { pain: 1, afterPain: 5 }));
  assert.notEqual(rx(fine, 'curl', { sets: 3, min: 10, max: 12, rest: 60, unit: 'reps' }).action, 'pain-hold');
  const barely = withSessions(ses('squat', '2026-10-28', [[80, 8, 8], [80, 8, 8], [80, 8, 8]], { pain: 1, afterPain: 2 }));
  assert.notEqual(rx(barely, 'squat', { sets: 3, min: 6, max: 10, rest: 180, unit: 'reps' }).action, 'pain-hold');
});

test('prescribe: pain flagged in 2 of the last 3 sessions steps down one inc and recommends the swap', () => {
  const p = { sets: 3, min: 8, max: 10, rest: 150, unit: 'reps' };
  const S = withSessions(
    ses('rdl', '2026-10-13', [[20, 9, 8], [20, 9, 8], [20, 9, 8]], { plan: p }),
    ses('rdl', '2026-10-20', [[22, 8, 8.5], [22, 8, 8.5], [22, 8, 8.5]], { plan: p, painFlags: { rdl: 'back' } }),
    ses('rdl', '2026-10-27', [[22, 8, 9], [22, 8, 9], [22, 8, 9]], { plan: p, painFlags: { rdl: 'back' } }));
  const r = rx(S, 'rdl', p);
  assert.equal(r.action, 'pain-hold'); assert.equal(r.kg, 20); assert.equal(r.arrow, 'down'); assert.equal(r.swapTo, 'hipthrust');
  assert.match(r.reason, /2 of your last 3/); assert.match(r.reason, /Hip thrust/);
});

test('prescribe: two flags but only the oldest of three counts as history gap', () => {
  const p = { sets: 3, min: 8, max: 10, rest: 150, unit: 'reps' };
  const S = withSessions(
    ses('rdl', '2026-10-06', [[20, 9, 8], [20, 9, 8], [20, 9, 8]], { plan: p, painFlags: { rdl: 'back' } }),
    ses('rdl', '2026-10-13', [[20, 9, 8], [20, 9, 8], [20, 9, 8]], { plan: p }),
    ses('rdl', '2026-10-20', [[20, 9, 8], [20, 9, 8], [20, 9, 8]], { plan: p }),
    ses('rdl', '2026-10-27', [[20, 9, 8], [20, 9, 8], [20, 9, 8]], { plan: p, painFlags: { rdl: 'back' } }));
  const r = rx(S, 'rdl', p);
  assert.equal(r.action, 'pain-hold'); assert.equal(r.kg, 20); assert.equal(r.swapTo, null); assert.equal(r.arrow, 'same');
});

test('prescribe: pain beats a reduced day', () => {
  const S = withSessions(ses('bench', '2026-10-27', [[60, 8, 8]], { painFlags: { bench: 'other' } }));
  assert.equal(rx(S, 'bench', PLAN, { easy: true }).action, 'pain-hold');
});

test('prescribe: reduced day holds the weight at the bottom of the range', () => {
  const S = withSessions(ses('dbpress', '2026-10-27', [[22, 10, 8], [22, 9, 8], [22, 9, 8.5]]));
  const r = rx(S, 'dbpress', PLAN, { easy: true });
  assert.equal(r.action, 'easy'); assert.equal(r.kg, 22); assert.equal(r.reps, 8); assert.equal(r.arrow, 'same');
  assert.equal(r.reason, 'Reduced day: hold the weight, stop at effort 6–7.');
});

test('prescribe: top of the range at effort <= 8 adds one inc of load', () => {
  const S = withSessions(ses('dbpress', '2026-10-27', [[20, 12, 8], [20, 12, 8], [20, 12, 8]]));
  const r = rx(S, 'dbpress', PLAN);
  assert.equal(r.mode, 'load'); assert.equal(r.action, 'increase'); assert.equal(r.kg, 22); assert.equal(r.reps, 8); assert.equal(r.arrow, 'up');
  assert.equal(r.reason, 'You hit 12, 12, 12 at effort ≤8 — add 2 kg.');
  assert.deepEqual(r.sets, [{ kg: 22, reps: 8 }, { kg: 22, reps: 8 }, { kg: 22, reps: 8 }]);
  assert.deepEqual(r.last, [{ kg: 20, reps: 12, rpe: 8 }, { kg: 20, reps: 12, rpe: 8 }, { kg: 20, reps: 12, rpe: 8 }]);
  const bench = withSessions(ses('bench', '2026-10-27', [[60, 10, 8], [60, 10, 8.5], [60, 10, 8]], { plan: { sets: 3, min: 6, max: 10, rest: 150, unit: 'reps' } }));
  assert.equal(rx(bench, 'bench', { sets: 3, min: 6, max: 10, rest: 150, unit: 'reps' }).kg, 62.5);
});

test('prescribe: no increase when a set is missing, effort is high or a set is short', () => {
  const two = withSessions(ses('dbpress', '2026-10-27', [[20, 12, 8], [20, 12, 8]]));
  assert.notEqual(rx(two, 'dbpress', PLAN).action, 'increase');
  const hard = withSessions(ses('dbpress', '2026-10-27', [[20, 12, 9], [20, 12, 9], [20, 12, 9]]));
  assert.notEqual(rx(hard, 'dbpress', PLAN).action, 'increase');
  const short = withSessions(ses('dbpress', '2026-10-27', [[20, 12, 8], [20, 12, 8], [20, 11, 8]]));
  assert.notEqual(rx(short, 'dbpress', PLAN).action, 'increase');
});

test('prescribe: bodyweight at the top goes to reps mode "make it harder"', () => {
  const p = { sets: 2, min: 5, max: 8, rest: 40, unit: 'reps / side' };
  const S = withSessions(ses('dead', '2026-10-27', [[0, 8, 7], [0, 8, 7]], { plan: p }));
  const r = rx(S, 'dead', p);
  assert.equal(r.mode, 'reps'); assert.equal(r.action, 'increase'); assert.equal(r.kg, 0); assert.equal(r.reps, 8); assert.equal(r.arrow, 'up');
  assert.match(r.reason, /harder/);
});

test('prescribe: time mode adds 5 s per set, and at the top asks for more load', () => {
  const p = { sets: 2, min: 20, max: 30, rest: 45, unit: 'seconds / side' };
  const mid = rx(withSessions(ses('sideplank', '2026-10-27', [[0, 20, 7], [0, 22, 7]], { plan: p })), 'sideplank', p);
  assert.equal(mid.mode, 'time'); assert.equal(mid.action, 'add-reps'); assert.deepEqual(mid.sets.map(s => s.reps), [25, 27]);
  const top = rx(withSessions(ses('sideplank', '2026-10-27', [[0, 30, 7], [0, 30, 7]], { plan: p })), 'sideplank', p);
  assert.equal(top.mode, 'time'); assert.equal(top.action, 'increase'); assert.equal(top.reps, 30); assert.match(top.reason, /30, 30 s/);
});

test('prescribe: stall over 3 sessions steps down 10% and points at the swap', () => {
  const p = { sets: 3, min: 6, max: 10, rest: 150, unit: 'reps' };
  const S = withSessions(
    ses('bench', '2026-10-13', [[52.5, 7, 9], [52.5, 6, 9], [52.5, 6, 9]], { plan: p }),
    ses('bench', '2026-10-20', [[52.5, 6, 9.5], [52.5, 6, 9.5], [52.5, 5, 9.5]], { plan: p }),
    ses('bench', '2026-10-27', [[52.5, 6, 9.5], [52.5, 5, 9.5], [52.5, 5, 9.5]], { plan: p }));
  const r = rx(S, 'bench', p);
  assert.equal(r.action, 'reduce'); assert.equal(r.kg, 47.5); assert.equal(r.reps, 6); assert.equal(r.arrow, 'down'); assert.equal(r.swapTo, 'dbpress');
  assert.match(r.reason, /3 sessions/); assert.match(r.reason, /47.5 kg/);
});

test('prescribe: stall rounds ~10% off to the inc and needs 3 sessions and a flat e1RM', () => {
  const p = { sets: 3, min: 6, max: 10, rest: 150, unit: 'reps' };
  const rows = [[62.5, 6, 9.5], [62.5, 5, 9.5], [62.5, 5, 9.5]];
  const three = withSessions(ses('bench', '2026-10-13', rows, { plan: p }), ses('bench', '2026-10-20', rows, { plan: p }), ses('bench', '2026-10-27', rows, { plan: p }));
  assert.equal(rx(three, 'bench', p).kg, 57.5); // 62.5 * 0.9 = 56.25 -> nearest 2.5 = 57.5
  const two = withSessions(ses('bench', '2026-10-20', rows, { plan: p }), ses('bench', '2026-10-27', rows, { plan: p }));
  assert.equal(rx(two, 'bench', p).action, 'hold');
  const improving = withSessions(ses('bench', '2026-10-13', [[50, 6, 9], [50, 6, 9], [50, 6, 9]], { plan: p }), ses('bench', '2026-10-20', rows, { plan: p }), ses('bench', '2026-10-27', [[65, 6, 9.5], [65, 6, 9.5], [65, 6, 9.5]], { plan: p }));
  assert.equal(rx(improving, 'bench', p).action, 'hold');
});

test('prescribe: a set under the floor or effort 9.5 holds', () => {
  const p = { sets: 3, min: 6, max: 10, rest: 150, unit: 'reps' };
  const low = rx(withSessions(ses('bench', '2026-10-27', [[60, 7, 8], [60, 6, 8.5], [60, 5, 9]], { plan: p })), 'bench', p);
  assert.equal(low.action, 'hold'); assert.equal(low.kg, 60); assert.equal(low.reps, 6); assert.equal(low.arrow, 'same'); assert.match(low.reason, /under|short|fell/i);
  const grind = rx(withSessions(ses('bench', '2026-10-27', [[60, 8, 8], [60, 8, 9], [60, 7, 9.5]], { plan: p })), 'bench', p);
  assert.equal(grind.action, 'hold'); assert.match(grind.reason, /9\.5/);
});

test('prescribe: add-reps goes one rep per set, capped at the top', () => {
  const a = rx(withSessions(ses('cablerow', '2026-10-27', [[40, 9, 8], [40, 8, 8], [40, 8, 8.5]])), 'cablerow', PLAN);
  assert.equal(a.action, 'add-reps'); assert.equal(a.kg, 40); assert.equal(a.reps, 10); assert.equal(a.arrow, 'same');
  assert.deepEqual(a.sets.map(s => s.reps), [10, 9, 9]);
  const capped = rx(withSessions(ses('cablerow', '2026-10-27', [[40, 12, 8], [40, 12, 8], [40, 11, 8]])), 'cablerow', PLAN);
  assert.deepEqual(capped.sets.map(s => s.reps), [12, 12, 12]);
  const fewer = rx(withSessions(ses('cablerow', '2026-10-27', [[40, 9, 8], [40, 8, 8]])), 'cablerow', PLAN);
  assert.deepEqual(fewer.sets.map(s => s.reps), [10, 9, 9]);
  assert.equal(fewer.sets.length, 3);
});

test('prescribe: load stays a multiple of inc and sets.length always equals plan.sets', () => {
  for (const sets of [1, 2, 3, 4]) {
    const p = { sets, min: 8, max: 12, rest: 90, unit: 'reps' };
    const S = withSessions(ses('dbpress', '2026-10-27', [[20, 12, 8], [20, 12, 8], [20, 12, 8]]));
    const r = rx(S, 'dbpress', p);
    assert.equal(r.sets.length, sets);
    assert.equal(r.kg % 2, 0);
  }
});

test('prescribe: old v4.8 sessions (no swaps, painFlags, repsL, afterPain) work', () => {
  const s = ses('dbpress', '2026-10-27', [[20, 10, 8], [20, 9, 8], [20, 9, 8]]);
  delete s.afterPain; delete s.pain; delete s.swaps; delete s.painFlags;
  const S = blank({ sessions: [s] });
  delete S.foodDone; delete S.profile.gainRate;
  const r = rx(S, 'dbpress', PLAN);
  assert.equal(r.action, 'add-reps');
  scan(r);
});

test('prescribe: skips sessions with no done sets and ignores undone ones', () => {
  const empty = ses('dbpress', '2026-10-27', [[20, 12, 8]]);
  empty.sets.dbpress[0].done = false;
  assert.equal(rx(blank({ sessions: [empty] }), 'dbpress', PLAN).action, 'start');
});

test('prescribe: a swapped session falls back to the slot plan when judging "all sets at the top"', () => {
  const s = ses('legpress', '2026-10-27', [], { plan: { sets: 2, min: 8, max: 12, rest: 120, unit: 'reps' }, swaps: { legpress: 'hacksquat' } });
  s.sets.hacksquat = [{ kg: 70, reps: 12, rpe: 8, done: true, at: '2026-10-27T10:00:00.000Z' }, { kg: 70, reps: 12, rpe: 8, done: true, at: '2026-10-27T10:03:00.000Z' }];
  const r = rx(blank({ sessions: [s] }), 'hacksquat', PLAN);
  assert.equal(r.action, 'increase'); assert.equal(r.kg, 75);
});

test('prescribe: unknown exercise id does not throw or return NaN', () => {
  const r = E.prescribe(blank(), D, 'nope', { today: TODAY });
  assert.equal(r.action, 'start');
  scan(r);
});

test('prescribe: handles every exercise with the fixture (no NaN / undefined)', () => {
  const S = makeState(TODAY, D);
  for (const key of D.split.order) {
    for (const id of D.workouts[key].ids) {
      const r = E.prescribe(S, D, id, { plan: S.sessions.find(s => s.workout === key).plan[id], today: TODAY });
      scan(r, id);
      assert.equal(r.sets.length, S.sessions.find(s => s.workout === key).plan[id].sets, id);
      assert.ok(['up', 'same', 'down', null].includes(r.arrow));
    }
  }
});

test('prescribe: fixture scenarios (increase, reduce, pain swap)', () => {
  const S = makeState(TODAY, D), plan = key => id => S.sessions.filter(s => s.workout === key).pop().plan[id];
  const db = E.prescribe(S, D, 'dbpress', { plan: plan('UB')('dbpress'), today: TODAY });
  assert.equal(db.action, 'increase'); assert.equal(db.kg, 22);
  const bench = E.prescribe(S, D, 'bench', { plan: plan('UA')('bench'), today: TODAY });
  assert.equal(bench.action, 'reduce'); assert.equal(bench.kg, 47.5);
  const rdl = E.prescribe(S, D, 'rdl', { plan: plan('LA')('rdl'), today: TODAY });
  assert.equal(rdl.action, 'pain-hold'); assert.equal(rdl.swapTo, 'hipthrust'); assert.equal(rdl.kg, 20);
  const sarow = E.prescribe(S, D, 'sarow', { plan: plan('UA')('sarow'), today: TODAY });
  assert.equal(sarow.action, 'add-reps');
});

/* ======================================================================
   e1rm, plates
   ====================================================================== */
test('e1rm: Epley, 0 when there is no load', () => {
  assert.ok(Math.abs(E.e1rm({ kg: 100, reps: 5 }) - 100 * (1 + 5 / 30)) < 1e-9);
  assert.equal(E.e1rm({ kg: 0, reps: 12 }), 0);
  assert.equal(E.e1rm({ kg: -5, reps: 12 }), 0);
  assert.equal(E.e1rm({}), 0);
  assert.equal(E.e1rm(undefined), 0);
});

test('plates: greedy per side, null when impossible', () => {
  assert.deepEqual(E.plates(60), [20]);
  assert.deepEqual(E.plates(52.5), [15, 1.25]);
  assert.deepEqual(E.plates(20), []);
  assert.deepEqual(E.plates(100), [25, 15]);
  assert.deepEqual(E.plates(102.5), [25, 15, 1.25]);
  assert.deepEqual(E.plates(142.5), [25, 25, 10, 1.25]);
  assert.equal(E.plates(15), null);   // lighter than the bar
  assert.equal(E.plates(21), null);   // 0.5 kg a side
  assert.equal(E.plates(NaN), null);
  assert.deepEqual(E.plates(55, 15), [20]);          // custom bar
  assert.deepEqual(E.plates(60, 20, [10, 5]), [10, 10]); // custom plates
  assert.equal(E.plates(60, 20, [15]), null);
});

/* ======================================================================
   weekVolume
   ====================================================================== */
test('weekVolume: weights sets by mg, ignores mobility, undone sets and out-of-range days', () => {
  const rows = n => Array.from({ length: n }, () => [50, 8, 8]);
  const S = withSessions(
    ses('bench', '2026-10-28', rows(5)),
    ses('dbpress', '2026-10-30', rows(6)),
    ses('flexhip', '2026-10-30', [[0, 30, 3], [0, 30, 3]]),
    ses('bench', '2026-10-15', rows(9)), // outside the range
    ses('ohp', '2026-10-31', [[14, 8, 8], [14, 8, 8], [14, 8, 8]]));
  S.sessions[0].sets.bench.push({ kg: 50, reps: 8, rpe: 8, done: false, at: 'x' });
  const v = E.weekVolume(S, D, '2026-10-27', '2026-11-02');
  assert.deepEqual(Object.keys(v), Object.keys(D.muscleGroups));
  assert.equal(v.chest.sets, 11);
  assert.equal(v.chest.status, 'ok'); assert.deepEqual(v.chest.target, [8, 20]);
  assert.equal(v.triceps.sets, 5.5 + 1.5);       // bench 5 + dbpress 6 at 0.5, ohp 3 at 0.5
  assert.equal(v.shoulders.sets, 5.5 + 3);       // bench/dbpress 0.5, ohp 1
  assert.equal(v.back.sets, 0); assert.equal(v.back.status, 'low');
  assert.equal(v.core.sets, 0);
});

test('weekVolume: status bands and 0.5 rounding', () => {
  const S = withSessions(ses('machinepress', '2026-10-28', Array.from({ length: 22 }, () => [40, 10, 8])));
  const v = E.weekVolume(S, D, '2026-10-27', '2026-11-02');
  assert.equal(v.chest.sets, 22); assert.equal(v.chest.status, 'high');
  const D2 = { muscleGroups: { chest: 'Chest' }, volumeTargets: { chest: [8, 16] }, exercises: { x: { mg: { chest: 0.3 } } } };
  const S2 = withSessions(ses('x', '2026-10-28', [[10, 10, 8], [10, 10, 8], [10, 10, 8], [10, 10, 8]]));
  assert.equal(E.weekVolume(S2, D2, '2026-10-27', '2026-11-02').chest.sets, 1); // 1.2 -> 1
});

/* ======================================================================
   trend
   ====================================================================== */
const W = (offset, kg) => ({ date: shift(TODAY, offset), kg });
function ewma(vals) { let t = null; return vals.map(v => (t = t === null ? v : t + 0.1 * (v - t))); }

test('trend: empty and single weigh-in give null rate', () => {
  assert.deepEqual(E.trend(blank(), TODAY), { points: [], latest: null, rate: null, n: 0, trendKg: null });
  const one = E.trend(blank({ weights: [W(-3, 56.04)] }), TODAY);
  assert.equal(one.n, 1); assert.equal(one.latest, 56); assert.equal(one.rate, null);
});

test('trend: under 7 days of history gives null rate', () => {
  const t = E.trend(blank({ weights: [W(-5, 56), W(-3, 56.2), W(-1, 56.4)] }), TODAY);
  assert.equal(t.n, 3); assert.equal(t.rate, null);
});

test('trend: EWMA alpha 0.1 seeded with the first weigh-in', () => {
  const t = E.trend(blank({ weights: [W(-4, 60), W(-3, 61), W(-1, 62)] }), TODAY);
  const ref = ewma([60, 61, 62]);
  assert.deepEqual(t.points.map(p => p.kg), [60, 61, 62]);
  t.points.forEach((p, i) => assert.ok(Math.abs(p.trend - ref[i]) < 0.006));
  assert.equal(t.latest, 62);
});

test('trend: 7-13 day span scales to a weekly rate', () => {
  const t = E.trend(blank({ weights: [W(-10, 55), W(-5, 56), W(0, 57)] }), TODAY);
  const ref = ewma([55, 56, 57]);
  assert.ok(Math.abs(t.rate - ((ref[2] - ref[0]) / 10) * 7) < 0.011, `rate ${t.rate}`);
});

test('trend: 14+ days uses trend now minus trend 14 days ago, per week', () => {
  const weights = Array.from({ length: 21 }, (_, i) => W(i - 20, 56 + 0.05 * i));
  const t = E.trend(blank({ weights }), TODAY);
  const ref = ewma(weights.map(w => w.kg));
  assert.ok(Math.abs(t.rate - (ref[20] - ref[6]) / 2) < 0.011, `rate ${t.rate}`);
  assert.equal(t.n, 21);
});

test('trend: ignores future weigh-ins, junk values and keeps one per day', () => {
  const t = E.trend(blank({ weights: [W(-2, 56), W(1, 99), { date: 'bad', kg: 70 }, W(-1, 0), W(-2, 57)] }), TODAY);
  assert.equal(t.n, 1); assert.equal(t.latest, 57);
});

/* ======================================================================
   energy
   ====================================================================== */
/* offsets: days before today with a food log at `intake` kcal; flat or ramped weigh-ins */
function foodState({ foodDays = [], intake = 2500, weigh = [], cal = 2500, over = {} } = {}) {
  const S = blank({ profile: { ...blank().profile, calories: cal }, ...over });
  for (const o of foodDays) S.meals.push({ id: `m${o}`, date: shift(TODAY, -o), meal: 'Lunch', name: 'x', p: 100, k: intake, c: 300, f: 80, emoji: 'x' });
  for (const [o, kg] of weigh) S.weights.push(W(-o, kg));
  return S;
}
const range = (a, b) => Array.from({ length: a - b + 1 }, (_, i) => a - i); // a..b descending
const flatWeights = (from, to, kg = 60) => range(from, to).map(o => [o, kg]);

test('energy: no data -> none, not ready, says what is needed', () => {
  const e = E.energy(blank(), D, TODAY);
  assert.equal(e.ready, false); assert.equal(e.confidence, 'none'); assert.equal(e.tdee, null); assert.equal(e.change, 0);
  assert.equal(e.windowDays, 21); assert.equal(e.targetRate, 0.25);
  assert.equal(e.needs, 'Log 7 more full food days and 4 more weigh-ins');
  assert.match(e.reason, /Not enough data/);
  scan(e);
});

test('energy: low confidence at 7 logged days and 4 weigh-ins over a week', () => {
  const S = foodState({ foodDays: range(8, 2), weigh: [[10, 60], [8, 60], [5, 60], [2, 60]] });
  const e = E.energy(S, D, TODAY);
  assert.equal(e.confidence, 'low'); assert.equal(e.ready, true); assert.equal(e.loggedDays, 7); assert.equal(e.weighIns, 4);
  assert.equal(e.tdee, 2500); assert.equal(e.suggested, 2800); assert.equal(e.change, 250); assert.equal(e.next, 2750);
  assert.equal(e.needs, 'Log 3 more full food days and 2 more weigh-ins'); // next tier: medium
});

test('energy: medium at 10 days / 6 weigh-ins, high at 16 / 10', () => {
  const med = E.energy(foodState({ foodDays: range(11, 2), weigh: flatWeights(15, 10) }), D, TODAY);
  assert.equal(med.confidence, 'medium'); assert.equal(med.loggedDays, 10); assert.equal(med.weighIns, 6);
  const high = E.energy(foodState({ foodDays: range(17, 2), weigh: flatWeights(21, 12) }), D, TODAY);
  assert.equal(high.confidence, 'high'); assert.equal(high.needs, '');
});

test('energy: a flat trend at 2,500 kcal means maintenance ~2,500; suggestion adds 275, rounded to 50', () => {
  const S = foodState({ foodDays: range(21, 1), weigh: flatWeights(21, 1), cal: 2700 });
  const e = E.energy(S, D, TODAY);
  assert.equal(e.confidence, 'high'); assert.equal(e.tdee, 2500); assert.equal(e.suggested, 2800); assert.equal(e.change, 100); assert.equal(e.next, 2800);
  assert.equal(e.avgIntake, 2500);
  assert.match(e.reason, /2,500/);
});

test('energy: change is clamped to +/-250 and zeroed under 50', () => {
  const up = E.energy(foodState({ foodDays: range(21, 1), weigh: flatWeights(21, 1), cal: 2000 }), D, TODAY);
  assert.equal(up.suggested, 2800); assert.equal(up.change, 250);
  const down = E.energy(foodState({ foodDays: range(21, 1), intake: 3000, weigh: flatWeights(21, 1), cal: 4000 }), D, TODAY);
  assert.equal(down.suggested, 3300); assert.equal(down.change, -250);
  const small = E.energy(foodState({ foodDays: range(21, 1), weigh: flatWeights(21, 1), cal: 2780 }), D, TODAY);
  assert.equal(small.suggested, 2800); assert.equal(small.change, 0); assert.equal(small.next, 2780);
  assert.match(small.reason, /right for/);
});

test('energy: a fast gain lowers the suggestion', () => {
  const weigh = range(21, 1).map((o, i) => [o, 60 + i * 0.15]);
  const e = E.energy(foodState({ foodDays: range(21, 1), intake: 3000, weigh, cal: 3200 }), D, TODAY);
  assert.ok(e.change < 0 && e.change >= -250);
  assert.ok(e.tdee < 3000);
  assert.ok(e.next < 3200);
});

test('energy: the 21-day window ends yesterday (today and day 22 excluded)', () => {
  const S = foodState({ foodDays: [0, 1, 21, 22], weigh: [[22, 60], [21, 60], [1, 60], [0, 60]] });
  const e = E.energy(S, D, TODAY);
  assert.equal(e.loggedDays, 2);
  assert.equal(e.weighIns, 2);
  const onlyToday = E.energy(foodState({ foodDays: [0], weigh: [[0, 60]] }), D, TODAY);
  assert.equal(onlyToday.loggedDays, 0); assert.equal(onlyToday.weighIns, 0); assert.equal(onlyToday.confidence, 'none');
});

test('energy: foodDone overrides the 60% rule', () => {
  const S = foodState({ foodDays: [2, 3, 4, 5], intake: 2500 });
  S.meals.push({ id: 'low', date: shift(TODAY, -6), meal: 'Lunch', name: 'y', p: 20, k: 900, c: 90, f: 30, emoji: 'y' }); // 900 < 1,500: not a full day
  S.meals.push({ id: 'edge', date: shift(TODAY, -7), meal: 'Lunch', name: 'y', p: 20, k: 1500, c: 90, f: 30, emoji: 'y' }); // exactly 60%: counts
  assert.equal(E.energy(S, D, TODAY).loggedDays, 5);
  S.foodDone[shift(TODAY, -6)] = true;  // marked fully logged
  S.foodDone[shift(TODAY, -2)] = false; // marked incomplete
  const e = E.energy(S, D, TODAY);
  assert.equal(e.loggedDays, 5); // +day 6, -day 2
  S.foodDone[shift(TODAY, -9)] = true;  // "fully logged" with no food at all does not count
  assert.equal(E.energy(S, D, TODAY).loggedDays, 5);
});

test('energy: rate-only fallback when food logs are thin', () => {
  const flat = E.energy(foodState({ weigh: range(20, 0).map(o => [o, 60]) }), D, TODAY);
  assert.equal(flat.confidence, 'low'); assert.equal(flat.tdee, null); assert.equal(flat.ready, true);
  assert.equal(flat.change, 150); assert.equal(flat.next, 2650); assert.equal(flat.suggested, 2650);
  const fast = E.energy(foodState({ weigh: range(20, 0).map((o, i) => [o, 60 + i * 0.1]) }), D, TODAY);
  assert.ok(fast.rate > 0.45); assert.equal(fast.change, -100); assert.equal(fast.tdee, null);
  const onTrack = E.energy(foodState({ weigh: range(20, 0).map((o, i) => [o, 60 + i * 0.0357]) }), D, TODAY);
  assert.ok(onTrack.rate >= 0.15 && onTrack.rate <= 0.45, `rate ${onTrack.rate}`); assert.equal(onTrack.change, 0);
  // needs 6 weigh-ins spanning 14 days, with a recent one
  assert.equal(E.energy(foodState({ weigh: [[6, 60], [5, 60], [4, 60], [3, 60], [2, 60], [1, 60]] }), D, TODAY).confidence, 'none');
  assert.equal(E.energy(foodState({ weigh: [[30, 60], [29, 60], [28, 60], [27, 60], [26, 60], [25, 60]] }), D, TODAY).confidence, 'none');
});

test('energy: missing foodDone / gainRate do not break it', () => {
  const S = foodState({ foodDays: range(21, 1), weigh: flatWeights(21, 1) });
  delete S.foodDone; delete S.profile.gainRate;
  const e = E.energy(S, D, TODAY);
  assert.equal(e.targetRate, 0.25); assert.equal(e.confidence, 'high');
  scan(e);
});

test('energy: fixture suggests a calorie increase', () => {
  const e = E.energy(makeState(TODAY, D), D, TODAY);
  assert.ok(['medium', 'high'].includes(e.confidence));
  assert.ok(e.change > 0 && e.change <= 250, `change ${e.change}`);
  assert.ok(e.rate > 0 && e.rate < 0.15, `rate ${e.rate}`);
  assert.equal(e.next, 2500 + e.change);
  scan(e);
});

/* ======================================================================
   asymmetry, painLinks
   ====================================================================== */
function lr(date, L, R, id = 'sarow') {
  const s = ses(id, date, L.map((l, i) => [20, Math.min(l, R[i]), 8]));
  s.sets[id].forEach((x, i) => { x.repsL = L[i]; x.repsR = R[i]; });
  return s;
}

test('asymmetry: weaker side from the last n sessions', () => {
  const S = withSessions(lr('2026-10-13', [8, 8, 8], [10, 10, 10]), lr('2026-10-20', [8, 8, 8], [10, 10, 10]), lr('2026-10-27', [9, 8, 8], [11, 10, 10]));
  const a = E.asymmetry(S, D, 'sarow');
  assert.deepEqual(a, { weak: 'left', gapPct: 20, sessions: 3 });
  const right = withSessions(lr('2026-10-20', [10, 10, 10], [8, 8, 8]), lr('2026-10-27', [10, 10, 10], [8, 8, 8]));
  assert.deepEqual(E.asymmetry(right, D, 'sarow'), { weak: 'right', gapPct: 20, sessions: 2 });
});

test('asymmetry: needs 8% and 2 sessions; ignores sets and sessions without both sides', () => {
  const small = withSessions(lr('2026-10-20', [10, 10, 10], [10, 10, 11]), lr('2026-10-27', [10, 10, 10], [10, 10, 11]));
  assert.equal(E.asymmetry(small, D, 'sarow').weak, null);
  assert.equal(E.asymmetry(small, D, 'sarow').gapPct, 3);
  const one = withSessions(lr('2026-10-27', [8, 8, 8], [10, 10, 10]));
  assert.deepEqual(E.asymmetry(one, D, 'sarow'), { weak: null, gapPct: 20, sessions: 1 });
  assert.deepEqual(E.asymmetry(blank(), D, 'sarow'), { weak: null, gapPct: 0, sessions: 0 });
  const plain = withSessions(ses('sarow', '2026-10-27', [[20, 10, 8]]));
  assert.deepEqual(E.asymmetry(plain, D, 'sarow'), { weak: null, gapPct: 0, sessions: 0 });
  const mixed = withSessions(plain.sessions[0], lr('2026-10-20', [8, 8, 8], [10, 10, 10]), lr('2026-10-27', [8, 8, 8], [10, 10, 10]));
  assert.equal(E.asymmetry(mixed, D, 'sarow').sessions, 2);
  // n limits how far back we look
  const old = withSessions(lr('2026-10-06', [5, 5, 5], [10, 10, 10]), lr('2026-10-20', [10, 10, 10], [10, 10, 10]), lr('2026-10-27', [10, 10, 10], [10, 10, 10]));
  assert.equal(E.asymmetry(old, D, 'sarow', 2).weak, null);
  assert.equal(E.asymmetry(old, D, 'sarow', 3).weak, 'left');
});

test('asymmetry: fixture says left is weaker on sarow only', () => {
  const S = makeState(TODAY, D);
  const a = E.asymmetry(S, D, 'sarow');
  assert.equal(a.weak, 'left'); assert.ok(a.gapPct >= 15 && a.gapPct <= 25); assert.equal(a.sessions, 3);
  assert.equal(E.asymmetry(S, D, 'salatpull').weak, null);
});

test('painLinks: flagged in at least 2 of the last 3 sessions', () => {
  const rows = [[20, 9, 8]];
  const S = withSessions(
    ses('rdl', '2026-10-13', rows, { painFlags: { rdl: 'back' } }),   // outside the last 3
    ses('rdl', '2026-10-20', rows),
    ses('rdl', '2026-10-27', rows, { painFlags: { rdl: 'back' } }),
    ses('rdl', '2026-11-01', rows, { painFlags: { rdl: 'back' } }),
    ses('bench', '2026-10-27', rows, { painFlags: { bench: 'shoulder' } }));
  assert.deepEqual(E.painLinks(S, D, TODAY), [{ id: 'rdl', count: 2, of: 3, zone: 'back' }]);
  const two = withSessions(ses('bench', '2026-10-20', rows, { painFlags: { bench: 'shoulder' } }), ses('bench', '2026-10-27', rows, { painFlags: { bench: 'other' } }));
  assert.deepEqual(E.painLinks(two, D, TODAY), [{ id: 'bench', count: 2, of: 2, zone: 'other' }]);
  assert.deepEqual(E.painLinks(blank(), D, TODAY), []);
});

test('painLinks: sorts by count, fixture has just the rdl', () => {
  const rows = [[20, 9, 8]];
  const S = withSessions(
    ses('rdl', '2026-10-13', rows, { painFlags: { rdl: 'back' } }), ses('rdl', '2026-10-20', rows, { painFlags: { rdl: 'back' } }),
    ses('squat', '2026-10-13', rows, { painFlags: { squat: 'back' } }), ses('squat', '2026-10-20', rows, { painFlags: { squat: 'back' } }), ses('squat', '2026-10-27', rows, { painFlags: { squat: 'back' } }));
  assert.deepEqual(E.painLinks(S, D, TODAY).map(x => [x.id, x.count]), [['squat', 3], ['rdl', 2]]);
  assert.deepEqual(E.painLinks(makeState(TODAY, D), D, TODAY), [{ id: 'rdl', count: 2, of: 3, zone: 'back' }]);
});

/* ======================================================================
   planWeek, shortPlan
   ====================================================================== */
const workoutOn = (date, workout) => ({ ...ses('bench', date, [[60, 8, 8]]), workout });

test('planWeek: Thursday rest day offers a catch-up for a missed lift day', () => {
  // Mon 2 Nov ... Thu 5 Nov: Upper A (Tue) skipped, Lower A (Wed) done
  const p = E.planWeek(withSessions(workoutOn('2026-11-04', 'LA')), D, '2026-11-05');
  assert.equal(p.planned, null);
  assert.deepEqual(p.done, ['LA']);
  assert.deepEqual(p.missed, [{ key: 'UA', date: '2026-11-03' }]);
  assert.deepEqual(p.catchUp, { key: 'UA', date: '2026-11-03' });
});

test('planWeek: no catch-up on a lift day, or once today is logged, or when nothing was missed', () => {
  const S = withSessions(workoutOn('2026-11-04', 'LA'));
  const fri = E.planWeek(S, D, '2026-11-06');
  assert.equal(fri.planned, 'UB'); assert.equal(fri.catchUp, null); assert.deepEqual(fri.missed, [{ key: 'UA', date: '2026-11-03' }]);
  const tue = E.planWeek(blank(), D, '2026-11-03');
  assert.equal(tue.planned, 'UA'); assert.equal(tue.catchUp, null); assert.deepEqual(tue.missed, []);
  const doneToday = E.planWeek(withSessions(workoutOn('2026-11-04', 'LA'), workoutOn('2026-11-05', 'UA')), D, '2026-11-05');
  assert.equal(doneToday.catchUp, null); assert.deepEqual(doneToday.missed, []); assert.deepEqual(doneToday.done, ['LA', 'UA']);
  const monday = E.planWeek(blank(), D, '2026-11-02');
  assert.deepEqual(monday, { planned: null, done: [], missed: [], catchUp: null });
});

test('planWeek: done is by workout key, so a swapped day is not "missed"', () => {
  const S = withSessions(workoutOn('2026-11-04', 'UA'), workoutOn('2026-11-05', 'LA'), workoutOn('2026-11-06', 'UB')); // UA on Wed, LA on Thu, UB on Fri
  const p = E.planWeek(S, D, '2026-11-07');
  assert.deepEqual(p.missed, []);
});

test('planWeek: Sunday light day can catch up, until the light day is logged; week is Monday to Sunday', () => {
  const S = withSessions(workoutOn('2026-11-04', 'LA'), workoutOn('2026-11-06', 'UB'), workoutOn('2026-11-07', 'LB'));
  const sun = E.planWeek(S, D, '2026-11-08');
  assert.equal(sun.planned, 'SUN'); assert.deepEqual(sun.catchUp, { key: 'UA', date: '2026-11-03' });
  const logged = E.planWeek(withSessions(...S.sessions, workoutOn('2026-11-08', 'SUN')), D, '2026-11-08');
  assert.equal(logged.catchUp, null);
  const next = E.planWeek(S, D, '2026-11-09');
  assert.deepEqual(next, { planned: null, done: [], missed: [], catchUp: null });
});

test('planWeek: fixture on a rest day has nothing to catch up', () => {
  const p = E.planWeek(makeState(TODAY, D), D, TODAY);
  assert.deepEqual(p, { planned: null, done: [], missed: [], catchUp: null });
});

test('shortPlan: first 4 main lifts plus the first core move', () => {
  const ua = E.shortPlan(D, 'UA');
  assert.deepEqual(ua.keep, ['bench', 'sarow', 'ohp', 'latpull']); assert.deepEqual(ua.drop, ['latraise', 'curl', 'triceps']); assert.equal(ua.minutes, '40–50');
  const la = E.shortPlan(D, 'LA');
  assert.deepEqual(la.keep, ['squat', 'rdl', 'bss', 'kneeraise']); assert.deepEqual(la.drop, ['curlLeg', 'calf', 'sideplank']);
  assert.deepEqual(E.shortPlan(D, 'LB').keep, ['legpress', 'slrdl', 'lunge', 'backext']);
  assert.deepEqual(E.shortPlan(D, 'UB').keep, ['dbpress', 'cablerow', 'salatpull', 'machinepress']);
});

test('shortPlan: never drops everything, keep + drop = the whole workout in order', () => {
  for (const key of Object.keys(D.workouts)) {
    const s = E.shortPlan(D, key), ids = D.workouts[key].ids;
    assert.ok(s.keep.length >= 1, key);
    assert.deepEqual([...s.keep, ...s.drop].sort(), [...ids].sort(), key);
    assert.deepEqual(ids.filter(i => s.keep.includes(i)), s.keep, `${key} keeps workout order`);
  }
  assert.deepEqual(E.shortPlan(D, 'nope'), { keep: [], drop: [], minutes: '40–50' });
});

/* ======================================================================
   recentMeals, closeGap
   ====================================================================== */
const meal = (offset, name, k, p, extra = {}) => ({ id: `${offset}-${name}`, date: shift(TODAY, -offset), meal: 'Lunch', name, p, c: 50, f: 10, k, emoji: '🍗', ...extra });

test('recentMeals: unique by lowercase name, count then recency, last 30 days, rounded', () => {
  const S = blank({
    meals: [
      meal(1, 'Chicken Rice', 700.4, 40.26), meal(5, 'chicken rice', 650, 38), meal(9, 'CHICKEN RICE', 600, 35),
      meal(2, 'Oats', 400, 15), meal(3, 'oats', 400, 15),
      meal(0, 'Eggs', 300, 20),
      meal(4, 'Tuna', 250, 30),
      meal(31, 'Old stew', 500, 30),
      meal(-1, 'Tomorrow stew', 500, 30),
      meal(2, '  ', 100, 5)
    ]
  });
  const r = E.recentMeals(S, TODAY);
  assert.deepEqual(r.map(x => x.name), ['Chicken Rice', 'Oats', 'Eggs', 'Tuna']);
  assert.equal(r[0].count, 3); assert.equal(r[0].lastDate, shift(TODAY, -1)); assert.equal(r[0].k, 700); assert.equal(r[0].p, 40.3);
  assert.deepEqual(Object.keys(r[0]).sort(), ['c', 'count', 'emoji', 'f', 'k', 'lastDate', 'meal', 'name', 'p']);
  assert.equal(E.recentMeals(S, TODAY, 2).length, 2);
  assert.equal(E.recentMeals(blank(), TODAY).length, 0);
});

test('recentMeals: fixture returns its staples first', () => {
  const r = E.recentMeals(makeState(TODAY, D), TODAY, 8);
  assert.equal(r.length, 8); assert.ok(r[0].count >= r[7].count);
  scan(r);
});

test('closeGap: nothing before 15:00, nothing when the gap is small', () => {
  const S = blank({ meals: [meal(0, 'Breakfast', 800, 40)] });
  const early = E.closeGap(S, D, TODAY, 14);
  assert.deepEqual(early.picks, []); assert.equal(early.kcal, 1700); assert.equal(early.protein, 80);
  const full = E.closeGap(blank({ meals: [meal(0, 'Big day', 2400, 115)] }), D, TODAY, 20);
  assert.deepEqual(full.picks, []); assert.equal(full.kcal, 100); assert.equal(full.protein, 5);
});

test('closeGap: after 15:00 picks up to 3 unique items, overshooting by at most 150 kcal', () => {
  for (const [k, p] of [[1900, 100], [1400, 60], [900, 40], [2200, 70]]) {
    const S = blank({ meals: [meal(0, 'Day so far', k, p)] });
    const g = E.closeGap(S, D, TODAY, 18);
    assert.ok(g.picks.length >= 1 && g.picks.length <= 3, `${k}: ${g.picks.length} picks`);
    assert.equal(new Set(g.picks.map(x => x.foodId)).size, g.picks.length);
    const total = g.picks.reduce((s, x) => s + x.k, 0);
    assert.ok(total <= g.kcal + 150, `${k}: ${total} vs gap ${g.kcal}`);
    for (const x of g.picks) {
      for (const f of ['foodId', 'name', 'amount', 'unit', 'k', 'p', 'c', 'f']) assert.ok(x[f] !== undefined && x[f] !== null, f);
      if (D.foods.some(f => f.id === x.foodId)) assert.ok(D.foods.find(f => f.id === x.foodId).gap);
    }
    scan(g);
  }
  assert.equal(E.closeGap(blank({ meals: [meal(0, 'Day so far', 1600, 70)] }), D, TODAY, 15).picks.length > 0, true);
});

test('closeGap: a big gap starts with the gainer shake; a protein-only gap picks protein', () => {
  const big = E.closeGap(blank({ meals: [meal(0, 'Day so far', 1700, 60)] }), D, TODAY, 19); // 800 kcal / 60 g to go
  assert.equal(big.picks[0].foodId, 'shake'); assert.equal(big.picks[0].k, 770);
  const protein = E.closeGap(blank({ meals: [meal(0, 'Day', 2400, 80)] }), D, TODAY, 19);
  assert.equal(protein.kcal, 100); assert.equal(protein.protein, 40);
  assert.ok(protein.picks.length >= 1);
  assert.ok(protein.picks[0].p >= 17, JSON.stringify(protein.picks[0]));
});

test('closeGap: frequent recent meals compete with the gap foods', () => {
  const S = blank({ meals: [meal(0, 'Day so far', 2200, 85), meal(3, 'Chicken wrap', 300, 35), meal(4, 'chicken wrap', 300, 35), meal(5, 'Chicken wrap', 300, 35)] });
  const g = E.closeGap(S, D, TODAY, 19);
  assert.equal(g.picks[0].foodId, 'meal:chicken wrap');
  assert.equal(g.picks.filter(x => x.foodId === 'meal:chicken wrap').length, 1);
});

/* ======================================================================
   weeklyReview + coachText
   ====================================================================== */
const ACTION_TYPES = ['calories', 'swap', 'deload', 'asymmetry', 'volume', 'protein', 'consistency', 'backup'];
const RANK = ['calories', 'swap', 'deload', 'protein', 'asymmetry', 'volume', 'consistency', 'backup'];

test('weeklyReview: fixture has the contract shape', () => {
  const S = makeState(TODAY, D), r = E.weeklyReview(S, D, TODAY);
  assert.deepEqual(Object.keys(r).sort(), ['actions', 'body', 'end', 'energy', 'nutrition', 'recovery', 'start', 'training', 'volume']);
  assert.equal(r.start, '2026-10-27'); assert.equal(r.end, TODAY);
  assert.deepEqual(Object.keys(r.training).sort(), ['done', 'partial', 'planned', 'progressed', 'prs', 'sets', 'stalled']);
  assert.deepEqual(Object.keys(r.body).sort(), ['latest', 'rate', 'targetRate', 'waistChange']);
  assert.deepEqual(Object.keys(r.nutrition).sort(), ['avgKcal', 'avgProtein', 'loggedDays', 'proteinDays']);
  assert.deepEqual(Object.keys(r.recovery).sort(), ['avgPain', 'avgSleep', 'painUpSessions', 'worseNextDay']);
  assert.deepEqual(Object.keys(r.volume), Object.keys(D.muscleGroups));
  assert.equal(r.training.planned, 4); assert.equal(r.training.done, 4); assert.equal(r.training.partial, 0); assert.ok(r.training.sets > 50);
  assert.ok(r.training.prs.every(p => p.id && p.name && p.kg >= 0 && p.reps > 0));
  assert.ok(r.training.prs.some(p => p.id === 'dbpress'));
  assert.ok(r.training.progressed.includes('dbpress'));
  assert.deepEqual(r.training.stalled, ['bench']);
  assert.equal(r.body.targetRate, 0.25); assert.ok(r.body.rate > 0 && r.body.rate < 0.2); assert.ok(r.body.latest > 55);
  assert.ok(r.nutrition.loggedDays >= 4 && r.nutrition.avgKcal > 2300 && r.nutrition.avgKcal < 2500);
  assert.ok(r.nutrition.avgProtein > 90 && r.nutrition.avgProtein < 105);
  assert.equal(r.recovery.painUpSessions, 1); assert.equal(r.recovery.worseNextDay, 1);
  assert.ok(r.recovery.avgSleep >= 6 && r.recovery.avgSleep <= 8);
  assert.deepEqual(r.energy, E.energy(S, D, TODAY));
});

test('weeklyReview: fixture actions - calories, swap, deload, protein, asymmetry in rank order', () => {
  const S = makeState(TODAY, D), r = E.weeklyReview(S, D, TODAY);
  assert.ok(r.actions.length >= 4 && r.actions.length <= 5);
  for (const a of r.actions) { assert.ok(ACTION_TYPES.includes(a.type)); assert.ok(a.title && a.detail); }
  const idx = r.actions.map(a => RANK.indexOf(a.type));
  assert.deepEqual(idx, [...idx].sort((a, b) => a - b), 'ranked');
  const by = t => r.actions.find(a => a.type === t);
  assert.deepEqual(by('calories').apply, { kind: 'calories', value: r.energy.next });
  assert.ok(by('calories').apply.value > 2500 && by('calories').apply.value <= 2750);
  assert.match(by('calories').title, /Raise calories/);
  assert.deepEqual(by('swap').apply, { kind: 'swap', from: 'rdl', to: 'hipthrust' });
  assert.match(by('swap').title, /Romanian deadlift/);
  assert.match(by('deload').title + by('deload').detail, /Barbell bench press/);
  assert.match(by('deload').detail, /47.5 kg/);
  assert.match(by('asymmetry').title, /left/); assert.match(by('asymmetry').title, /row/);
  assert.match(by('asymmetry').detail, /20%/);
  assert.equal(by('protein').type, 'protein');
});

test('weeklyReview: applied swaps and an already-raised target stop being suggested', () => {
  const S = makeState(TODAY, D);
  S.prefSwaps = { rdl: 'hipthrust' };
  S.profile.calories = E.energy(S, D, TODAY).next;
  const types = E.weeklyReview(S, D, TODAY).actions.map(a => a.type);
  assert.ok(!types.includes('swap')); assert.ok(!types.includes('calories'));
});

test('weeklyReview: fixture is clean on every weekday (no NaN/undefined, <=5 actions)', () => {
  for (let i = 0; i < 7; i++) {
    const day = shift(TODAY, i), S = makeState(day, D), r = E.weeklyReview(S, D, day);
    scan(r, day);
    assert.ok(r.actions.length <= 5, day);
    for (const a of r.actions) assert.ok(ACTION_TYPES.includes(a.type), `${day} ${a.type}`);
    assert.equal(r.training.done + r.training.partial, r.training.planned, day);
    scan(E.coachText(S, D, r), day);
  }
});

test('weeklyReview: a fresh profile is quiet and clean', () => {
  const r = E.weeklyReview(blank({ profile: { ...blank().profile, startDate: TODAY } }), D, TODAY); // started today: nothing to have missed yet
  scan(r);
  assert.deepEqual(r.actions, []);
  assert.equal(r.training.done, 0); assert.equal(r.training.planned, 0);
  assert.equal(r.body.latest, null); assert.equal(r.body.rate, null); assert.equal(r.nutrition.avgKcal, null); assert.equal(r.recovery.avgSleep, null);
});

test('weeklyReview: volume, consistency and backup actions', () => {
  const S = blank();
  // 3 lift sessions, only chest work -> everything else is low
  for (const [d, w] of [['2026-10-28', 'UA'], ['2026-10-30', 'UB'], ['2026-10-31', 'LB']]) S.sessions.push({ ...ses('machinepress', d, Array.from({ length: 4 }, () => [40, 10, 8])), workout: w });
  for (let i = 0; i < 10; i++) S.meals.push(meal(i + 3, 'Old meal', 300, 10));
  const r = E.weeklyReview(S, D, TODAY);
  const types = r.actions.map(a => a.type);
  assert.deepEqual(types, ['volume', 'consistency', 'backup']);
  assert.match(r.actions[0].title, /Back/);
  assert.match(r.actions[1].title, /3 of 4/); assert.match(r.actions[1].detail, /Lower A/);
  assert.match(r.actions[2].detail, /never exported/);
  S.lastExport = shift(TODAY, -3) + 'T10:00:00.000Z';
  assert.ok(!E.weeklyReview(S, D, TODAY).actions.some(a => a.type === 'backup'));
  S.lastExport = shift(TODAY, -20) + 'T10:00:00.000Z';
  assert.match(E.weeklyReview(S, D, TODAY).actions.find(a => a.type === 'backup').detail, /20 days ago/);
});

test('weeklyReview: pain rising or poor sleep suggests an easy week', () => {
  const S = blank();
  for (const [d, w] of [['2026-10-28', 'UA'], ['2026-10-30', 'UB']]) S.sessions.push({ ...ses('dbpress', d, [[20, 10, 8]], { pain: 1, afterPain: 4 }), workout: w });
  const a = E.weeklyReview(S, D, TODAY).actions.find(x => x.type === 'deload');
  assert.ok(a); assert.match(a.title, /easy week/i); assert.match(a.detail, /2 sessions/);
  const sleepy = blank();
  for (let i = 1; i <= 4; i++) sleepy.checkins[shift(TODAY, -i)] = { pain: 1, sleep: 5, flags: false, at: 'x' };
  assert.match(E.weeklyReview(sleepy, D, TODAY).actions.find(x => x.type === 'deload').detail, /Sleep averaged 5 h/);
});

test('coachText: pasteable brief with goal, notes and the closing prompt', () => {
  const S = makeState(TODAY, D), r = E.weeklyReview(S, D, TODAY), t = E.coachText(S, D, r);
  assert.equal(typeof t, 'string'); assert.ok(t.length > 500);
  assert.match(t, /goal 65 kg/i);
  assert.ok(t.includes(S.profile.notes));
  assert.match(t, /started 55 kg/);
  assert.ok(t.includes('Barbell bench press'));
  assert.ok(t.includes(r.start) && t.includes(r.end));
  assert.ok(t.endsWith('Questions for my coach:'));
  scan(t);
});

test('coachText: works for a fresh profile and without a review', () => {
  const S = blank();
  S.profile.notes = 'Left shoulder clicks.';
  const a = E.coachText(S, D, E.weeklyReview(S, D, TODAY));
  assert.ok(a.length > 0 && a.includes('Left shoulder clicks.') && /goal 65 kg/i.test(a) && a.endsWith('Questions for my coach:'));
  scan(a);
  const b = E.coachText(S, D);
  assert.ok(b.includes('Left shoulder clicks.') && b.endsWith('Questions for my coach:'));
  scan(b);
  S.profile.notes = '';
  assert.match(E.coachText(S, D), /Notes: none/);
});

test('weekVolume: the full programme as prescribed is never flagged high', () => {
  const days = { UA: '2026-10-27', LA: '2026-10-28', UB: '2026-10-30', LB: '2026-10-31', SUN: '2026-11-01' };
  const list = Object.entries(days).flatMap(([w, date]) => Object.entries(D.workouts[w].dose).map(([id, q]) => ses(id, date, Array.from({ length: q.sets }, () => [20, q.min, 8]))));
  const v = E.weekVolume(withSessions(...list), D, '2026-10-26', '2026-11-01');
  for (const [m, x] of Object.entries(v)) assert.notEqual(x.status, 'high', `${m}: ${x.sets} sets vs ${x.target}`);
});

test('closeGap: silent on a barely-logged day and never doubles a big item', () => {
  const S = blank();
  assert.equal(E.closeGap(S, D, TODAY, 19).picks.length, 0); // nothing logged = unlogged day, not a shortfall
  S.meals.push({ id: 'm1', date: TODAY, meal: 'Lunch', name: 'Lunch', p: 40, k: 1200, c: 150, f: 40, emoji: 'x' });
  const g = E.closeGap(S, D, TODAY, 19);
  assert.ok(g.picks.length > 0);
  for (const p of g.picks) { const f = D.foods.find(x => x.id === p.foodId); if (f && f.k >= 400) assert.equal(p.amount, f.base); }
});
