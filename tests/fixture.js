'use strict';
/* Astra Coach v5 test fixture: a realistic, deterministic 4-week v4-schema state.
   makeState(today, D) covers the 28 days before `today` following D.split.week.
   UMD: module.exports in Node, window.AstraFixture in the browser. No Math.random, no Date.now.

   What it deliberately exercises (all verified in tests/engine.test.js):
   - weight rising only ~0.1 kg/week with 4-5 weigh-ins/week, meals ~2,400 kcal / ~96 g protein  -> raise calories
   - bench: 4 sessions, the last 3 stuck at effort 9.5 with a set under the rep floor            -> reduce
   - sarow: left reps ~2 below right on 3 of 4 sessions (the oldest has no L/R, like v4.8)       -> left weaker
   - rdl: back pain flag in the 2 newest of its last 3 sessions                                  -> swap to hipthrust
   - dbpress: 12, 12, 12 at effort <= 8 last time                                                -> increase
   - one easy session, one session with a swap (legpress -> hacksquat), one short-on-time
     session, one partial session; the 2 oldest weeks lack swaps/painFlags like v4.8 data (bar the one swapped session). */
(function () {
const pad = n => String(n).padStart(2, '0');
const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayDate = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d, 12); };
const shift = (k, n) => { const d = dayDate(k); d.setDate(d.getDate() + n); return dayKey(d); };
const r1 = x => Math.round(x * 10) / 10;
const iso = (day, hhmm, addMin = 0) => new Date(new Date(`${day}T${hhmm}:00.000Z`).getTime() + addMin * 60000).toISOString();

/* same rules as app.js dose() / plans() */
function dose(D, id, p, easy, o) {
  const e = D.exercises[id];
  let sets = o && o.sets !== undefined ? o.sets : (e.fixed || (e.core ? 2 : (D.phases[p].sets - (p === 3 && !e.main ? 1 : 0))));
  if (easy && !e.fixed) sets = Math.max(1, sets - 1);
  return { sets, min: o && o.min !== undefined ? o.min : e.min, max: o && o.max !== undefined ? o.max : e.max, rest: o && o.rest !== undefined ? o.rest : e.rest, unit: o && o.unit !== undefined ? o.unit : e.unit };
}
function plans(D, workout, p, easy) {
  const w = D.workouts[workout], out = {};
  for (const id of w.ids) out[id] = dose(D, id, p, easy, w.dose && w.dose[id]);
  return out;
}

/* hand-written histories: index = appearance of that workout (0 oldest ... 3 newest) */
const SPECIAL = {
  bench: [{ kg: 50, reps: [8, 8, 7], rpe: [8, 8, 8] }, { kg: 52.5, reps: [7, 6, 6], rpe: [8.5, 9, 9] }, { kg: 52.5, reps: [6, 6, 5], rpe: [9, 9.5, 9.5] }, { kg: 52.5, reps: [6, 5, 5], rpe: [9, 9.5, 9.5] }],
  sarow: [{ kg: 18, reps: [10, 10, 9], rpe: [8, 8, 8] }, { kg: 20, L: [8, 8, 7], R: [10, 10, 9], rpe: [8, 8, 8.5] }, { kg: 20, L: [8, 8, 8], R: [10, 10, 10], rpe: [8, 8, 8.5] }, { kg: 20, L: [9, 8, 8], R: [11, 10, 10], rpe: [8, 8, 8.5] }],
  dbpress: [{ kg: 20, reps: [9, 9, 8], rpe: [7.5, 8, 8] }, { kg: 20, reps: [10, 10, 9], rpe: [7.5, 8, 8] }, { kg: 20, reps: [11, 11, 10], rpe: [7.5, 8, 8] }, { kg: 20, reps: [12, 12, 12], rpe: [7.5, 8, 8] }],
  rdl: [{ kg: 20, reps: [9, 8, 8], rpe: [8, 8, 8] }, { kg: 20, reps: [10, 9, 9], rpe: [8, 8, 8.5] }, { kg: 22, reps: [8, 8, 8], rpe: [8, 8.5, 8.5], flag: 'back' }, { kg: 22, reps: [8, 8, 8], rpe: [8.5, 9, 9], flag: 'back' }]
};
const K0 = { ohp: 14, latpull: 40, latraise: 6, curl: 12, triceps: 22.5, squat: 60, bss: 12, curlLeg: 35, calf: 60, cablerow: 40, salatpull: 20, machinepress: 40, facepull: 17.5, hammer: 10, ohtri: 20, legpress: 100, slrdl: 12, lunge: 10, abduction: 35, suitcase: 16, hacksquat: 70 };
const TWICE = new Set(['latraise', 'curlLeg', 'calf', 'sideplank']);
const SLOW = new Set(['ohp', 'curl', 'triceps', 'hammer', 'facepull', 'abduction', 'lunge', 'cablerow']); // add a rep only every other session
const MEALS = {
  Breakfast: [['Oats, banana & milk', 560, 20, 88, 14, '🥣'], ['Eggs on toast', 540, 22, 42, 24, '🥚']],
  Lunch: [['Chicken & rice bowl', 720, 38, 85, 20, '🍗'], ['Tuna rice bowl', 700, 34, 88, 16, '🐟']],
  Dinner: [['Beef mince, rice & veg', 780, 30, 86, 30, '🥩'], ['Tofu stir-fry & rice', 740, 24, 90, 22, '🧈']],
  Snacks: [['Peanut butter toast', 340, 8, 36, 17, '🥜'], ['Greek yogurt & nuts', 380, 16, 14, 16, '🥣']]
};
const SLEEP = [7, 7.5, 6.5, 8, 6.5, 7, 7.5], PAIN = [1, 0, 2, 1, 0, 1, 2], SCALE = [0.99, 1.01, 1.03, 1.02, 1, 1.04, 1.01];

function makeState(today, D) {
  const days = Array.from({ length: 28 }, (_, i) => shift(today, i - 28)); // days[0] = today-28 ... days[27] = yesterday
  const week = D.split.week, dowOf = k => dayDate(k).getDay();

  // which workout falls on which day, and which appearance of it that is
  const occ = {}, plan = [];
  days.forEach((d, i) => { const key = week[dowOf(d)]; if (key) { occ[key] = occ[key] === undefined ? 0 : occ[key] + 1; plan.push({ d, i, key, o: occ[key] }); } });
  const at = (key, o) => plan.find(x => x.key === key && x.o === o);

  // check-ins: sleep / back pain every day; forced values where a session needs them
  const checkins = {}, force = { LB0: 3, LA2: 2, LA3: 2, SUN3: 1 };
  days.forEach((d, i) => { checkins[d] = { pain: PAIN[i % 7], sleep: SLEEP[i % 7], flags: false, at: iso(d, '07:10') }; });
  for (const x of plan) if (force[x.key + x.o] !== undefined) checkins[x.d].pain = force[x.key + x.o];
  const sessionDays = new Set(plan.map(x => x.d));
  const eligible = [];
  days.forEach((d, i) => { if (i >= 1 && sessionDays.has(days[i - 1])) { checkins[d].vsYesterday = ['better', 'same', 'same', 'better'][eligible.length % 4]; eligible.push(i); } });
  const lastWorse = eligible.filter(i => i >= 22).pop();
  if (lastWorse !== undefined) checkins[days[lastWorse]].vsYesterday = 'worse';

  // sessions, oldest first
  const app = {}, sessions = [];
  const sets = (id, p, kg, reps, rpe, base, extra) => reps.slice(0, p.sets).map((r, s) => {
    const x = { kg, reps: r, rpe: rpe[s % rpe.length], done: true, at: iso(base.d, '18:30', 8 + s * 3 + (extra || 0)) };
    return x;
  });
  for (const x of plan) {
    const { d, i, key, o } = x, w = D.workouts[key], easy = key === 'LB' && o === 0;
    const pl = plans(D, key, 1, easy), out = {};
    const session = { id: `s-${d}-${key}`, date: d, startedAt: iso(d, '18:30'), workout: key, phase: 1, easy, pain: checkins[d].pain, plan: pl, sets: out, skipped: [] };
    let flagged = null;
    w.ids.forEach((id, slot) => {
      const e = D.exercises[id], p = pl[id], base = x, off = slot * 6;
      if (e.fixed) { out[id] = Array.from({ length: p.sets }, (_, s) => ({ kg: 0, reps: p.min, rpe: 3, done: true, at: iso(d, '18:30', off + s * 2) })); return; }
      if (key === 'LB' && o === 0 && id === 'legpress') { // swapped for the hack squat: slot keeps its plan entry and an empty sets array
        session.swaps = { legpress: 'hacksquat' };
        out.legpress = [];
        out.hacksquat = sets('hacksquat', p, 70, [9, 8], [8, 8.5], base, off);
        return;
      }
      if (key === 'UB' && o === 1 && (id === 'hammer' || id === 'ohtri')) { out[id] = []; (session.dropped = session.dropped || []).push(id); return; }
      if (key === 'LB' && o === 1 && id === 'backext') { out[id] = []; session.skipped.push(id); return; }
      const sp = SPECIAL[id] && SPECIAL[id][o];
      if (sp) {
        if (sp.flag) { (flagged = flagged || {})[id] = sp.flag; }
        if (sp.L) { out[id] = sets(id, p, sp.kg, sp.L, sp.rpe, base, off).map((s, n) => Object.assign(s, { repsL: sp.L[n], repsR: sp.R[n], reps: Math.min(sp.L[n], sp.R[n]) })); return; }
        out[id] = sets(id, p, sp.kg, sp.reps, sp.rpe, base, off);
        return;
      }
      // generic double progression: +1 rep a session, then +1 load step
      const n = app[id] === undefined ? 0 : app[id] + 1; app[id] = n;
      const a = SLOW.has(id) ? n >> 1 : n;
      const inc = e.inc || 0, BL = TWICE.has(id) ? 4 : 3, blk = inc ? Math.floor(a / BL) : 0, r = inc ? a % BL : a;
      const k0 = K0[id] !== undefined ? K0[id] : 0, kg = k0 > 0 ? k0 + blk * inc : 0, time = /second/.test(p.unit);
      const reps = Array.from({ length: p.sets }, (_, s) => Math.min(p.max - 1, p.min + (time ? 2 : 1) * (r + (s === 0 ? 1 : 0))));
      const rpe = e.load === 'Bodyweight' ? [7] : [7.5, 8, 8.5];
      out[id] = sets(id, p, kg, reps, rpe, base, off);
      if (e.uni && id === 'salatpull' && o >= 1) out[id].forEach((s, n) => { s.repsL = s.reps; s.repsR = s.reps + (n === 0 ? 1 : 0); });
    });
    session.status = session.skipped.length ? 'partial' : 'complete';
    session.afterPain = Math.min(10, session.pain + (key === 'SUN' && o === 3 ? 2 : flagged ? 1 : i % 3 === 0 ? 1 : 0));
    session.note = o === 3 && key === 'UA' ? 'Bench felt heavy and grindy.' : o === 3 && key === 'LA' ? 'Lower back tightened on the Romanian deadlift.' : '';
    session.endedAt = iso(d, '18:30', 70);
    if (o >= 2) { session.swaps = session.swaps || {}; session.painFlags = flagged || {}; }
    if (key === 'UB' && o === 1) session.short = true;
    sessions.push(session);
  }

  // meals: 24 of 28 days logged, one thin day (not a full log), ~2,400 kcal / ~96 g protein
  const meals = [], missing = new Set([3, 11, 22]);
  days.forEach((d, i) => {
    if (missing.has(i)) return;
    Object.keys(MEALS).forEach((slot, si) => {
      if (i === 15 && si >= 2) return; // thin day: breakfast + lunch only
      const m = MEALS[slot][(i + si) % 3 === 0 ? 1 : 0], f = SCALE[i % 7];
      meals.push({ id: `m-${d}-${slot}`, date: d, meal: slot, name: m[0], p: r1(m[2] * f), k: Math.round(m[1] * f), c: r1(m[3] * f), f: r1(m[4] * f), emoji: m[5] });
    });
  });

  // weigh-ins: 4 one week, 5 the next; slow climb (~0.07 kg/week) plus +/-0.2 kg of day-to-day noise
  const weights = [];
  days.forEach((d, i) => {
    if (i % 7 === 2 || (i % 7 === 5 && Math.floor(i / 7) % 2 === 0)) return;
    const kg = r1(55.2 + 0.010 * i + (((i * 37) % 11) - 5) * 0.04);
    weights.push({ date: d, kg, waist: i % 7 === 0 ? r1(74 + 0.3 * (i / 27)) : null });
  });

  const cardio = [2, 9, 13, 16, 23].map(i => ({ id: `c-${days[i]}`, date: days[i], type: i === 13 ? 'Cycling' : 'Walk', minutes: i === 13 ? 30 : 25, distance: i === 13 ? 9 : 2.2, rpe: 4 }));
  const water = {};
  days.forEach((d, i) => { water[d] = 2000 + ((i * 137) % 900); });

  return {
    schema: 4, version: '5.0.0', revision: 100,
    profile: { name: 'RV', startWeight: 55, goal: 65, startDate: days[0], phase: 1, calories: 2500, protein: 120, fat: 70, gainRate: 0.25, notes: 'Lower-back discomfort; left scapula clicks; left side weaker.' },
    meals, weights, checkins, sessions, cardio, water,
    active: null, rest: null, legacy: {}, legacyWeight: null,
    calorieLog: [], foodDone: {}, prefSwaps: {}, lastExport: null, catchUpDismissed: {}
  };
}

const api = { makeState };
if (typeof module === 'object' && module.exports) module.exports = api; else window.AstraFixture = api;
})();
