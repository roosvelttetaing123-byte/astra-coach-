'use strict';
/* Astra Coach v5 engine: pure coaching logic.
   Never reads window.ASTRA_DATA, localStorage, the DOM or Date.now(). State S, data D and `today`
   ('YYYY-MM-DD') are always passed in. Sessions in S.sessions are history; S.active is never history.
   Every optional field (swaps, painFlags, repsL, foodDone, gainRate...) may be missing: old v4.8 data works. */
(function () {
const E = {};

/* ---------- numbers, text ---------- */
const fin = v => typeof v === 'number' && Number.isFinite(v);
const num = (v, d = 0) => { const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN); return Number.isFinite(n) ? n : d; };
const r1 = x => Math.round(x * 10) / 10;
const r2 = x => Math.round(x * 100) / 100;
const roundInc = (x, inc) => (inc > 0 ? r2(Math.round(x / inc) * inc) : r2(x));
const floorInc = (x, inc) => (inc > 0 ? r2(Math.floor(x / inc + 1e-9) * inc) : r2(x));
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const fmt = n => String(r2(n));
const fmtN = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n);

/* ---------- local-date helpers (local noon, like app.js) ---------- */
const pad = n => String(n).padStart(2, '0');
const isKey = k => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k);
function dayKey(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function dayDate(k) { const [y, m, d] = String(k).split('-').map(Number); return new Date(y, m - 1, d, 12); }
function shiftDay(k, n) { const d = dayDate(k); d.setDate(d.getDate() + n); return dayKey(d); }
function diffDays(a, b) { return Math.round((dayDate(b) - dayDate(a)) / 864e5); }
function weekStartKey(k) { const d = dayDate(k); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return dayKey(d); }
const dow = k => dayDate(k).getDay();
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* ---------- data / history helpers ---------- */
const exOf = (D, id) => (D && D.exercises && D.exercises[id]) || null;
const nameOf = (D, id) => (exOf(D, id) && exOf(D, id).name) || String(id);
const workoutName = (D, k) => (D && D.workouts && D.workouts[k] && (D.workouts[k].short || D.workouts[k].name)) || String(k);
const sessionsOf = S => (S && Array.isArray(S.sessions) ? S.sessions.filter(s => s && typeof s === 'object') : []);
const skey = s => String(s.startedAt || s.date || '');
const doneSets = (s, id) => { const a = s && s.sets && s.sets[id]; return Array.isArray(a) ? a.filter(x => x && x.done) : []; };
const norm = x => ({ kg: Math.max(0, num(x.kg, 0)), reps: Math.max(0, num(x.reps, 0)), rpe: num(x.rpe, null) });
/* sessions with at least one done set for `id`, oldest first (nothing after `today`) */
function hist(S, id, today) {
  return sessionsOf(S).filter(s => (!today || !isKey(s.date) || s.date <= today) && doneSets(s, id).length)
    .sort((a, b) => (skey(a) < skey(b) ? -1 : skey(a) > skey(b) ? 1 : 0));
}
/* plan that applied to `id` in session s: its own entry, else the slot it was swapped into */
function planIn(s, id) {
  if (s && s.plan && s.plan[id]) return s.plan[id];
  if (s && s.swaps && s.plan) for (const slot of Object.keys(s.swaps)) if (s.swaps[slot] === id && s.plan[slot]) return s.plan[slot];
  return null;
}
const bestE1 = sets => sets.reduce((b, x) => Math.max(b, E.e1rm(x)), 0);
function modeOf(e, unit, lastKg) {
  if (/second/i.test(String(unit || ''))) return 'time';
  if (e.load === 'Bodyweight' || !(lastKg > 0) || !e.inc) return 'reps';
  return 'load';
}
/* stall: no e1RM gain in 3 sessions and the newest was grindy or missed the rep floor */
function isStalled(h, id, bottom) {
  if (h.length < 3) return false;
  const a = doneSets(h[h.length - 1], id), b = doneSets(h[h.length - 3], id);
  const ea = bestE1(a), eb = bestE1(b);
  return ea <= 1.01 * eb && (a.some(x => num(x.rpe, 0) >= 9.5) || a.some(x => num(x.reps, 0) < bottom));
}

/* ---------- prescribe ---------- */
E.e1rm = function (set) {
  const kg = num(set && set.kg, 0), reps = num(set && set.reps, 0);
  return kg > 0 ? kg * (1 + reps / 30) : 0;
};

E.prescribe = function (S, D, id, opts) {
  const o = opts || {}, e = exOf(D, id) || {};
  const plan = o.plan || { sets: e.fixed || e.core ? 2 : 3, min: e.min, max: e.max, rest: e.rest, unit: e.unit };
  const nSets = Math.max(1, Math.round(num(plan.sets, 1)));
  const bottom = num(plan.min, num(e.min, 1));
  const top = Math.max(bottom, num(plan.max, num(e.max, bottom)));
  const unit = String(plan.unit || e.unit || '');
  const inc = num(e.inc, 0);
  const h = hist(S, id, o.today), newest = h[h.length - 1] || null;
  const last = newest ? doneSets(newest, id).map(norm) : [];
  const lastDate = newest && isKey(newest.date) ? newest.date : null;
  const build = (mode, action, kg, reps, reason, x) => {
    const per = Array.isArray(reps) ? reps : Array.from({ length: nSets }, () => reps);
    const arrow = x && 'arrow' in x ? x.arrow : action === 'increase' ? 'up' : action === 'reduce' ? 'down' : action === 'start' ? null : 'same';
    return { id, mode, action, kg, reps: per[0], sets: per.map(r => ({ kg, reps: r })), reason, last, lastDate, arrow, swapTo: (x && x.swapTo) || null };
  };

  // 1. mobility drills are never progressed
  if (e.fixed) return build('fixed', 'fixed', null, bottom, 'Mobility: quality over numbers.');
  // 2. first time
  if (!newest) {
    const loaded = e.load !== 'Bodyweight' && !/second/i.test(unit);
    return build('new', 'start', null, bottom, loaded
      ? 'First time: choose a weight you could lift about 4 more times (effort 6).'
      : 'First time: keep it easy and stop about 4 reps (or 10 seconds) short of your limit.');
  }

  // 3. mode and step
  const lastKg = last.reduce((m, x) => Math.max(m, x.kg), 0);
  const maxRpe = last.reduce((m, x) => Math.max(m, x.rpe || 0), 0);
  const mode = modeOf(e, unit, lastKg);
  const step = mode === 'time' ? 5 : 1;
  const u = mode === 'time' ? ' s' : '';
  const kgTxt = kg => (kg > 0 ? `${fmt(kg)} kg` : 'this load');
  const lastReps = last.map(x => x.reps);

  // 4. pain
  const flags = h.slice(-3).filter(s => s.painFlags && s.painFlags[id]).length;
  const flag = newest.painFlags && newest.painFlags[id];
  const rise = e.zone === 'back' && fin(newest.afterPain) && fin(newest.pain) && newest.afterPain - newest.pain >= 2;
  if (flag || rise) {
    if (flags >= 2) {
      const swapTo = (e.swaps && e.swaps[0]) || null;
      const kg = mode === 'load' ? Math.max(inc, roundInc(lastKg - inc, inc)) : lastKg;
      const lead = `Flagged in ${flags} of your last ${Math.min(3, h.length)} sessions`;
      const reason = swapTo
        ? `${lead} — ${mode === 'load' ? `drop to ${fmt(kg)} kg or ` : ''}swap to ${nameOf(D, swapTo)}.`
        : `${lead} — ${mode === 'load' ? `drop to ${fmt(kg)} kg and ` : ''}keep it pain-free, or skip it for now.`;
      return build(mode, 'pain-hold', kg, bottom, reason, { arrow: 'down', swapTo });
    }
    const region = flag === 'back' || flag === 'shoulder' ? `${flag} ` : '';
    const reason = flag
      ? `You flagged ${region}pain on this last time — hold ${kgTxt(lastKg)} and keep it pain-free.`
      : `Discomfort rose from ${newest.pain} to ${newest.afterPain} after this last time — hold ${kgTxt(lastKg)} and keep it comfortable.`;
    return build(mode, 'pain-hold', lastKg, bottom, reason);
  }

  // 5. reduced day
  if (o.easy) return build(mode, 'easy', lastKg, bottom, 'Reduced day: hold the weight, stop at effort 6–7.');

  // 6. top of the range at a manageable effort
  const prior = planIn(newest, id);
  const allTop = last.length >= num(prior && prior.sets, nSets) && last.every(x => x.reps >= top);
  if (allTop && maxRpe <= 8.5) {
    const eff = maxRpe > 0 ? ` at effort ≤${maxRpe}` : '';
    if (mode === 'load') {
      const kg = roundInc(lastKg + inc, inc);
      return build(mode, 'increase', kg, bottom, `You hit ${lastReps.join(', ')}${eff} — add ${fmt(kg - lastKg)} kg.`);
    }
    return build(mode, 'increase', lastKg, top, mode === 'time'
      ? `You held ${lastReps.join(', ')} s${eff} — add load or make the variation harder.`
      : `You hit ${lastReps.join(', ')}${eff} — make the variation harder or add load.`);
  }

  // 7. stall
  if (mode === 'load' && isStalled(h, id, bottom)) {
    const kg = Math.max(inc, Math.min(roundInc(lastKg * 0.9, inc), r2(lastKg - inc)));
    const swapTo = (e.swaps && e.swaps[0]) || null;
    const eff = maxRpe >= 9.5 ? ` at effort ${maxRpe}` : '';
    return build(mode, 'reduce', kg, bottom,
      `No progress in 3 sessions${eff} — drop to ${fmt(kg)} kg and rebuild${swapTo ? `, or try ${nameOf(D, swapTo)}` : ''}.`, { swapTo });
  }

  // 8. a set missed the floor, or it was a grind
  const low = last.some(x => x.reps < bottom);
  if (low || maxRpe >= 9.5) {
    return build(mode, 'hold', lastKg, bottom, low
      ? `A set fell short of ${bottom}${u} — repeat ${kgTxt(lastKg)} and get every set to ${bottom}+${u}.`
      : `Effort hit ${maxRpe} — repeat ${kgTxt(lastKg)} and leave a rep or two in reserve.`);
  }

  // 9. add reps inside the range
  const per = Array.from({ length: nSets }, (_, i) => Math.min(top, Math.max(bottom, (last[i] || last[last.length - 1]).reps + step)));
  return build(mode, 'add-reps', lastKg, per, mode === 'load'
    ? `Same ${fmt(lastKg)} kg — aim for ${per.join(', ')}.`
    : `Aim for ${per.join(', ')}${u} — ${mode === 'time' ? '5 s more' : 'one more rep'} per set.`);
};

/* ---------- plates ---------- */
E.plates = function (totalKg, bar = 20, sizes = [25, 20, 15, 10, 5, 2.5, 1.25]) {
  const total = Number(totalKg), b = Number(bar);
  if (!Number.isFinite(total) || !Number.isFinite(b) || total < b) return null;
  let rest = Math.round(((total - b) / 2) * 1000);
  const out = [];
  for (const p of [...sizes].map(Number).filter(x => x > 0).sort((x, y) => y - x)) {
    const g = Math.round(p * 1000);
    while (rest >= g) { out.push(p); rest -= g; }
  }
  return rest === 0 ? out : null;
};

/* ---------- weekly volume per muscle ---------- */
E.weekVolume = function (S, D, startKey, endKey) {
  const groups = (D && D.muscleGroups) || {}, acc = {};
  for (const m of Object.keys(groups)) acc[m] = 0;
  for (const s of sessionsOf(S)) {
    if (!isKey(s.date) || s.date < startKey || s.date > endKey || !s.sets) continue;
    for (const id of Object.keys(s.sets)) {
      const e = exOf(D, id);
      if (!e || e.fixed || !e.mg) continue;
      const n = doneSets(s, id).length;
      if (!n) continue;
      for (const m of Object.keys(e.mg)) if (m in acc) acc[m] += n * num(e.mg[m], 0);
    }
  }
  const out = {};
  for (const m of Object.keys(groups)) {
    const sets = Math.round(acc[m] * 2) / 2, t = (D.volumeTargets && D.volumeTargets[m]) || [0, 99];
    out[m] = { sets, target: [t[0], t[1]], status: sets < t[0] ? 'low' : sets > t[1] ? 'high' : 'ok' };
  }
  return out;
};

/* ---------- body-weight trend ---------- */
function series(S, upTo) {
  const m = new Map();
  for (const w of (S && S.weights) || []) {
    if (!w || !isKey(w.date) || (upTo && w.date > upTo)) continue;
    const kg = num(w.kg, 0);
    if (kg <= 0) continue;
    const waist = num(w.waist, 0);
    m.set(w.date, { date: w.date, kg, waist: waist > 0 ? waist : null });
  }
  const pts = [...m.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  let t = null;
  for (const p of pts) { t = t === null ? p.kg : t + 0.1 * (p.kg - t); p.t = t; }
  return pts;
}
function trendAt(pts, d) { let v = null; for (const p of pts) { if (p.date > d) break; v = p.t; } return v; }

E.trend = function (S, today) {
  const pts = series(S, today), n = pts.length;
  const out = { points: pts.map(p => ({ date: p.date, kg: p.kg, trend: r2(p.t) })), latest: n ? r1(pts[n - 1].kg) : null, rate: null, n };
  out.trendKg = n ? r2(pts[n - 1].t) : null;
  if (n >= 2) {
    const span = diffDays(pts[0].date, today), now = trendAt(pts, today);
    if (span >= 14) out.rate = r2((now - trendAt(pts, shiftDay(today, -14))) / 2);
    else if (span >= 7) out.rate = r2(((now - pts[0].t) / span) * 7);
  }
  return out;
};

/* ---------- adaptive calories ---------- */
const TIERS = [{ c: 'low', d: 7, w: 4 }, { c: 'medium', d: 10, w: 6 }, { c: 'high', d: 16, w: 10 }];
function totalsByDate(S) {
  const m = new Map();
  for (const x of (S && S.meals) || []) {
    if (!x || !isKey(x.date)) continue;
    const t = m.get(x.date) || { k: 0, p: 0, c: 0, f: 0 };
    t.k += num(x.k); t.p += num(x.p); t.c += num(x.c); t.f += num(x.f);
    m.set(x.date, t);
  }
  return m;
}
/* a day counts as "fully logged": explicit toggle, else at least 60% of the calorie target */
function fullDay(S, byDate, d) {
  const t = byDate.get(d), k = t ? t.k : 0, fd = S.foodDone ? S.foodDone[d] : undefined;
  if (fd === true) return k > 0;
  if (fd === false) return false;
  return k >= 0.6 * num(S.profile && S.profile.calories, 2500);
}

E.energy = function (S, D, today) {
  const P = (S && S.profile) || {};
  const cal = num(P.calories, 2500), target = num(P.gainRate, 0.25);
  const winStart = shiftDay(today, -21), end = shiftDay(today, -1);
  const byDate = totalsByDate(S);
  let logged = 0, kSum = 0;
  for (let i = 21; i >= 1; i--) {
    const d = shiftDay(today, -i);
    if (fullDay(S, byDate, d)) { logged++; kSum += byDate.get(d).k; }
  }
  const avgIntake = logged ? Math.round(kSum / logged) : null;
  const pts = series(S, end);
  const weighIns = pts.filter(p => p.date >= winStart).length;
  const nowTrend = E.trend(S, today);
  const rate = nowTrend.rate;

  // trend change across the window (seeded by the first weigh-in when none came before it)
  let startDay = shiftDay(winStart, -1), startT = trendAt(pts, startDay);
  if (startT === null && pts.length) { startDay = pts[0].date; startT = pts[0].t; }
  const endT = trendAt(pts, end);
  const span = startT === null || endT === null ? 0 : diffDays(startDay, end);

  let ti = -1;
  TIERS.forEach((t, i) => { if (logged >= t.d && weighIns >= t.w) ti = i; });
  let confidence = ti < 0 ? 'none' : TIERS[ti].c;
  if (span < 7) confidence = 'none';

  const nxt = TIERS[ti + 1];
  let needs = '';
  if (nxt) {
    const parts = [];
    if (logged < nxt.d) parts.push(`Log ${plural(nxt.d - logged, 'more full food day')}`);
    if (weighIns < nxt.w) parts.push(`${parts.length ? '' : 'Log '}${plural(nxt.w - weighIns, 'more weigh-in')}`);
    needs = parts.join(' and ');
  }
  if (!needs && confidence === 'none') needs = 'Keep weighing in for a few more days';

  const out = { ready: false, confidence, tdee: null, avgIntake, loggedDays: logged, weighIns, windowDays: 21, rate, targetRate: target, suggested: null, change: 0, next: cal, reason: '', needs };
  const rateTxt = rate === null ? '' : `${fmt(Math.abs(rate))} kg/week`;
  const finish = change => {
    out.change = Math.abs(change) < 50 ? 0 : change;
    out.next = cal + out.change;
    out.ready = true;
  };

  if (confidence !== 'none' && avgIntake !== null) {
    const tdee = avgIntake - ((endT - startT) * 7700) / span;
    if (Number.isFinite(tdee)) {
      out.tdee = Math.round(tdee / 10) * 10;
      out.suggested = Math.round((tdee + target * 1100) / 50) * 50;
      finish(clamp(out.suggested - cal, -250, 250));
      const dir = rate !== null && rate < 0 ? 'Losing' : 'Gaining';
      const lead = rate === null ? '' : `${dir} ${rateTxt} against a ${fmt(target)} target. `;
      out.reason = out.change > 0
        ? `${lead}Maintenance is about ${fmtN(out.tdee)} kcal, so ${fmtN(out.next)} kcal (${signed(out.change)}) gets you to ${fmt(target)} kg/week.`
        : out.change < 0
          ? `${lead}Maintenance is about ${fmtN(out.tdee)} kcal, so ${fmtN(out.next)} kcal (${signed(out.change)}) slows you to ${fmt(target)} kg/week.`
          : `${lead}Maintenance is about ${fmtN(out.tdee)} kcal — ${fmtN(cal)} kcal is right for ${fmt(target)} kg/week.`;
      return out;
    }
    out.confidence = confidence = 'none';
  }

  // rate-only fallback: thin food logs, but a long enough weight history
  const lastW = pts.length ? pts[pts.length - 1].date : null;
  if (pts.length >= 6 && rate !== null && diffDays(pts[0].date, today) >= 14 && diffDays(lastW, today) <= 7) {
    const change = rate < target - 0.1 ? 150 : rate > target + 0.2 ? -100 : 0;
    out.confidence = 'low';
    out.tdee = null;
    out.suggested = cal + change;
    finish(change);
    out.reason = change > 0
      ? `Gaining ${rateTxt} against a ${fmt(target)} target. Food logs are thin, so ${signed(change)} kcal is a safe nudge.`
      : change < 0
        ? `Gaining ${rateTxt}, faster than the ${fmt(target)} target. Food logs are thin, so ${signed(change)} kcal is a safe nudge.`
        : `Gaining ${rateTxt} against a ${fmt(target)} target — keep ${fmtN(cal)} kcal.`;
    return out;
  }

  out.reason = `Not enough data yet to estimate your maintenance.${needs ? ` ${needs}.` : ''}`;
  return out;
};

/* ---------- left / right balance, pain links ---------- */
E.asymmetry = function (S, D, id, n = 3) {
  const rows = hist(S, id).map(s => {
    let l = 0, r = 0, c = 0;
    for (const x of doneSets(s, id)) {
      const a = num(x.repsL, 0), b = num(x.repsR, 0);
      if (a > 0 && b > 0) { l += a; r += b; c++; }
    }
    return c ? { l, r } : null;
  }).filter(Boolean).slice(-Math.max(1, Math.round(num(n, 3))));
  if (!rows.length) return { weak: null, gapPct: 0, sessions: 0 };
  const L = rows.reduce((s, x) => s + x.l, 0), R = rows.reduce((s, x) => s + x.r, 0);
  const gapPct = Math.round((Math.abs(L - R) / Math.max(L, R)) * 100);
  return { weak: gapPct >= 8 && rows.length >= 2 ? (L < R ? 'left' : 'right') : null, gapPct, sessions: rows.length };
};

E.painLinks = function (S, D, today) {
  const ids = new Set();
  for (const s of sessionsOf(S)) if (s.painFlags) for (const id of Object.keys(s.painFlags)) ids.add(id);
  const out = [];
  for (const id of ids) {
    const h = hist(S, id, today).slice(-3), flagged = h.filter(s => s.painFlags && s.painFlags[id]);
    if (flagged.length < 2) continue;
    const v = flagged[flagged.length - 1].painFlags[id], e = exOf(D, id);
    out.push({ id, count: flagged.length, of: h.length, zone: typeof v === 'string' ? v : (e && e.zone) || 'other' });
  }
  return out.sort((a, b) => b.count - a.count || (a.id < b.id ? -1 : 1));
};

/* ---------- the week ---------- */
E.planWeek = function (S, D, today) {
  const week = (D.split && D.split.week) || {}, lift = (D.split && D.split.lift) || [];
  const ws = weekStartKey(today), days = Array.from({ length: 7 }, (_, i) => shiftDay(ws, i));
  const planned = week[dow(today)] || null;
  const inWeek = sessionsOf(S).filter(s => isKey(s.date) && s.date >= ws && s.date <= days[6]);
  const done = [];
  for (const s of inWeek) if (s.workout && !done.includes(s.workout)) done.push(s.workout);
  const missed = [];
  for (const d of days) {
    if (d >= today) break;
    const k = week[dow(d)];
    if (k && lift.includes(k) && !done.includes(k)) missed.push({ key: k, date: d });
  }
  const loggedToday = inWeek.some(s => s.date === today);
  const catchUp = (!planned || planned === 'SUN') && !loggedToday && missed.length ? { key: missed[0].key, date: missed[0].date } : null;
  return { planned, done, missed, catchUp };
};

E.shortPlan = function (D, workoutKey) {
  const w = D && D.workouts && D.workouts[workoutKey], ids = (w && w.ids) || [];
  const isMain = id => !!(exOf(D, id) && exOf(D, id).main), isCore = id => !!(exOf(D, id) && exOf(D, id).core);
  const keep = ids.filter(isMain).slice(0, 4), core = ids.find(isCore);
  if (core && !keep.includes(core)) keep.push(core);
  if (!keep.length && ids.length) keep.push(ids[0]);
  const ordered = ids.filter(id => keep.includes(id));
  return { keep: ordered, drop: ids.filter(id => !keep.includes(id)), minutes: '40–50' };
};

/* ---------- food ---------- */
E.recentMeals = function (S, today, limit = 8) {
  const from = shiftDay(today, -30), map = new Map();
  for (const m of (S && S.meals) || []) {
    if (!m || !isKey(m.date) || m.date < from || m.date > today) continue;
    const name = String(m.name || '').trim();
    if (!name || !(num(m.k) > 0 || num(m.p) > 0)) continue;
    const key = name.toLowerCase(), g = map.get(key) || { count: 0, last: null };
    g.count++;
    if (!g.last || m.date >= g.last.date) g.last = m;
    map.set(key, g);
  }
  return [...map.values()].map(g => {
    const m = g.last;
    return { name: String(m.name).trim(), meal: m.meal || 'Snacks', emoji: m.emoji || '🍽️', p: r1(num(m.p)), c: r1(num(m.c)), f: r1(num(m.f)), k: Math.round(num(m.k)), count: g.count, lastDate: m.date };
  }).sort((a, b) => b.count - a.count || (a.lastDate < b.lastDate ? 1 : a.lastDate > b.lastDate ? -1 : 0) || (a.name < b.name ? -1 : 1))
    .slice(0, Math.max(0, Math.round(num(limit, 8))));
};

E.closeGap = function (S, D, date, hour) {
  const P = (S && S.profile) || {}, t = totalsByDate(S).get(date) || { k: 0, p: 0 };
  const kcal = Math.max(0, Math.round(num(P.calories, 0) - t.k)), protein = Math.max(0, Math.round(num(P.protein, 0) - t.p));
  const out = { kcal, protein, picks: [] };
  // before 3 pm, nearly done, or barely logged (that is an unlogged day, not a shortfall) → no suggestions
  if (num(hour, 0) < 15 || (kcal < 150 && protein < 10) || t.k < 0.3 * num(P.calories, 0)) return out;

  const cands = [];
  for (const f of (D && D.foods) || []) {
    if (!f.gap) continue;
    for (const m of (f.k < 400 ? [1, 2] : [1])) cands.push({ key: 'food:' + f.id, foodId: f.id, name: f.name, emoji: f.emoji, amount: r2(f.base * m), unit: f.unit, k: Math.round(f.k * m), p: r1(f.p * m), c: r1(f.c * m), f: r1(f.f * m) });
  }
  for (const r of E.recentMeals(S, date, 20)) {
    if (r.count < 2 || r.k < 80) continue;
    cands.push({ key: 'meal:' + r.name.toLowerCase(), foodId: 'meal:' + r.name.toLowerCase(), name: r.name, emoji: r.emoji, amount: 1, unit: 'meal', k: r.k, p: r.p, c: r.c, f: r.f });
  }
  let G = kcal, Pr = protein;
  const used = new Set(), usedNames = new Set();
  while (out.picks.length < 3 && (G >= 100 || Pr >= 8)) {
    let best = null, bestScore = 0;
    for (const c of cands) {
      if (used.has(c.key) || usedNames.has(c.name.toLowerCase()) || c.k > G + 150) continue;
      const score = Math.min(c.k, Math.max(0, G)) + 8 * Math.min(c.p, Math.max(0, Pr));
      if (score > bestScore + 1e-9) { best = c; bestScore = score; }
    }
    if (!best) break;
    used.add(best.key); usedNames.add(best.name.toLowerCase());
    out.picks.push({ foodId: best.foodId, name: best.name, emoji: best.emoji, amount: best.amount, unit: best.unit, k: best.k, p: best.p, c: best.c, f: best.f });
    G -= best.k; Pr -= best.p;
  }
  return out;
};

/* ---------- weekly review ---------- */
function liftStats(S, D, start, end) {
  const ids = new Set();
  for (const s of sessionsOf(S)) {
    if (!isKey(s.date) || s.date < start || s.date > end || !s.sets) continue;
    for (const id of Object.keys(s.sets)) if (doneSets(s, id).length) ids.add(id);
  }
  const prs = [], progressed = [], stalled = [];
  const level = sets => { const e = bestE1(sets); return e > 0 ? { kind: 'load', v: e } : { kind: 'reps', v: sets.reduce((m, x) => Math.max(m, num(x.reps, 0)), 0) }; };
  for (const id of ids) {
    const e = exOf(D, id);
    if (!e || e.fixed) continue;
    const h = hist(S, id, end), inW = h.filter(s => s.date >= start), prior = h.filter(s => s.date < start);
    const winSets = inW.flatMap(s => doneSets(s, id).map(norm)), priorSets = prior.flatMap(s => doneSets(s, id).map(norm));
    const topSet = winSets.reduce((b, x) => (!b || E.e1rm(x) > E.e1rm(b) || (E.e1rm(x) === E.e1rm(b) && x.reps > b.reps) ? x : b), null);
    if (topSet && priorSets.length) {
      if (topSet.kg > 0) { const pb = bestE1(priorSets); if (pb > 0 && E.e1rm(topSet) > pb + 0.01) prs.push({ id, name: e.name, kg: topSet.kg, reps: topSet.reps }); }
      else if (priorSets.every(x => x.kg <= 0) && topSet.reps > Math.max(...priorSets.map(x => x.reps))) prs.push({ id, name: e.name, kg: 0, reps: topSet.reps });
    }
    if (h.length >= 2) {
      const a = level(doneSets(h[h.length - 1], id)), b = level(doneSets(h[h.length - 2], id));
      if (a.kind === b.kind && a.v > b.v + 0.01) progressed.push(id);
    }
    const newest = h[h.length - 1], plan = planIn(newest, id) || {}, lastKg = doneSets(newest, id).reduce((m, x) => Math.max(m, num(x.kg, 0)), 0);
    if (modeOf(e, plan.unit || e.unit, lastKg) === 'load' && isStalled(h, id, num(plan.min, num(e.min, 1)))) stalled.push(id);
  }
  return { ids: [...ids], prs, progressed, stalled };
}

E.weeklyReview = function (S, D, today) {
  const P = (S && S.profile) || {}, start = shiftDay(today, -6), end = today;
  const week = (D.split && D.split.week) || {}, liftKeys = (D.split && D.split.lift) || [];
  const win = sessionsOf(S).filter(s => isKey(s.date) && s.date >= start && s.date <= end);
  const liftWin = win.filter(s => liftKeys.includes(s.workout));
  const stats = liftStats(S, D, start, end);

  // training
  let planned = 0;
  const plannedKeys = [], since = isKey(P.startDate) ? P.startDate : start; // nothing is "missed" before the profile began
  for (let i = 0; i < 7; i++) {
    const d = shiftDay(start, i), k = week[dow(d)];
    if (k && liftKeys.includes(k) && d >= since && (d < today || win.some(s => s.date === d))) { planned++; plannedKeys.push({ key: k, date: d }); }
  }
  let sets = 0;
  for (const s of win) for (const id of Object.keys(s.sets || {})) { const e = exOf(D, id); if (e && !e.fixed) sets += doneSets(s, id).length; }
  const training = {
    planned, done: liftWin.filter(s => s.status === 'complete').length, partial: liftWin.filter(s => s.status !== 'complete').length,
    sets, prs: stats.prs, progressed: stats.progressed, stalled: stats.stalled
  };

  // body
  const tr = E.trend(S, today), target = num(P.gainRate, 0.25);
  const waists = series(S, today).filter(p => p.waist !== null && p.date >= shiftDay(today, -28));
  const waistChange = waists.length >= 2 && diffDays(waists[0].date, waists[waists.length - 1].date) >= 7
    ? r1(waists[waists.length - 1].waist - waists[0].waist) : null;
  const body = { latest: tr.latest, rate: tr.rate, targetRate: target, waistChange };

  // nutrition (today counts only when marked as fully logged)
  const byDate = totalsByDate(S), proteinGoal = num(P.protein, 0);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = shiftDay(start, i);
    const ok = d === today ? !!(S.foodDone && S.foodDone[d] === true && byDate.has(d) && byDate.get(d).k > 0) : fullDay(S, byDate, d);
    if (ok) days.push(byDate.get(d));
  }
  const avgP = days.length ? mean(days.map(x => x.p)) : null;
  const nutrition = {
    loggedDays: days.length,
    avgKcal: days.length ? Math.round(mean(days.map(x => x.k))) : null,
    avgProtein: avgP === null ? null : Math.round(avgP),
    proteinDays: proteinGoal > 0 ? days.filter(x => x.p >= 0.9 * proteinGoal).length : 0
  };

  // recovery
  const cks = [];
  for (let i = 0; i < 7; i++) { const c = S.checkins && S.checkins[shiftDay(start, i)]; if (c && typeof c === 'object') cks.push(c); }
  const sleeps = cks.map(c => num(c.sleep, null)).filter(v => v !== null), pains = cks.map(c => num(c.pain, null)).filter(v => v !== null);
  const recovery = {
    avgSleep: sleeps.length ? r1(mean(sleeps)) : null,
    avgPain: pains.length ? r1(mean(pains)) : null,
    worseNextDay: cks.filter(c => c.vsYesterday === 'worse').length,
    painUpSessions: win.filter(s => fin(s.afterPain) && fin(s.pain) && s.afterPain - s.pain >= 2).length
  };

  const volume = E.weekVolume(S, D, start, end), energy = E.energy(S, D, today);
  const review = { start, end, training, volume, body, nutrition, recovery, energy, actions: [] };

  /* ----- actions, in rank order ----- */
  const calAct = [], swapAct = [], deloadAct = [], proteinAct = [], asymAct = [], volAct = [], consAct = [], backupAct = [];

  if (energy.ready && energy.change !== 0) {
    calAct.push({
      type: 'calories',
      title: `${energy.change > 0 ? 'Raise' : 'Lower'} calories to ${fmtN(energy.next)}`,
      detail: energy.reason,
      apply: { kind: 'calories', value: energy.next }
    });
  }

  for (const link of E.painLinks(S, D, today).slice(0, 2)) {
    const e = exOf(D, link.id) || {}, to = (e.swaps || []).find(x => exOf(D, x)) || null;
    if (S.prefSwaps && S.prefSwaps[link.id]) continue;
    const where = link.zone === 'back' || link.zone === 'shoulder' ? `${link.zone} ` : '';
    const lead = `You flagged ${where}pain on ${nameOf(D, link.id)} in ${link.count} of your last ${link.of} sessions.`;
    swapAct.push(to
      ? { type: 'swap', title: `Swap ${nameOf(D, link.id)} for ${nameOf(D, to)}`, detail: `${lead} ${nameOf(D, to)} trains the same pattern with less strain.`, apply: { kind: 'swap', from: link.id, to } }
      : { type: 'swap', title: `Rest ${nameOf(D, link.id)} for now`, detail: `${lead} There is no same-pattern swap, so skip it until it settles.` });
  }

  if (stats.stalled.length) {
    const lines = stats.stalled.slice(0, 3).map(id => {
      const h = hist(S, id, today), n = h[h.length - 1];
      const rx = E.prescribe(S, D, id, { plan: planIn(n, id) || undefined, today });
      return rx.action === 'reduce' ? `${nameOf(D, id)}: ${fmt(rx.kg)} kg × ${rx.reps}` : nameOf(D, id);
    });
    deloadAct.push({
      type: 'deload',
      title: stats.stalled.length === 1 ? `Reset ${nameOf(D, stats.stalled[0])}` : `Reset ${stats.stalled.length} stalled lifts`,
      detail: `No progress in 3 sessions. Next time take 10% off, then rebuild a rep at a time: ${lines.join('; ')}.`
    });
  } else if (recovery.painUpSessions >= 2 || (recovery.avgSleep !== null && cks.length >= 3 && recovery.avgSleep < 6)) {
    deloadAct.push({
      type: 'deload',
      title: 'Take an easy week',
      detail: recovery.painUpSessions >= 2
        ? `Back pain rose 2+ points after ${recovery.painUpSessions} sessions. Hold the weights and stop at effort 6–7 this week.`
        : `Sleep averaged ${recovery.avgSleep} h. Hold the weights and stop at effort 6–7 this week.`
    });
  }

  if (nutrition.loggedDays >= 3 && proteinGoal > 0 && nutrition.avgProtein !== null && nutrition.avgProtein < 0.85 * proteinGoal) {
    const whey = (D.foods || []).find(f => f.id === 'whey');
    proteinAct.push({
      type: 'protein',
      title: `Add ${proteinGoal - nutrition.avgProtein} g protein a day`,
      detail: `You averaged ${nutrition.avgProtein} g against a ${proteinGoal} g target, on target ${nutrition.proteinDays} of ${nutrition.loggedDays} days.${whey ? ` One scoop of whey adds about ${whey.p} g.` : ''}`
    });
  }

  const weak = stats.ids.filter(id => exOf(D, id) && exOf(D, id).uni).map(id => ({ id, a: E.asymmetry(S, D, id) })).filter(x => x.a.weak).sort((a, b) => b.a.gapPct - a.a.gapPct);
  if (weak.length) {
    const w = weak[0], side = w.a.weak, other = weak.slice(1).map(x => `${nameOf(D, x.id)} (${x.a.weak} ${x.a.gapPct}%)`);
    asymAct.push({
      type: 'asymmetry',
      title: `Start your ${side} side on ${nameOf(D, w.id)}`,
      detail: `${side[0].toUpperCase()}${side.slice(1)} is about ${w.a.gapPct}% behind over ${w.a.sessions} sessions. Do it first and match its reps on the other side.${other.length ? ` Also behind: ${other.join(', ')}.` : ''}`
    });
  }

  const liftCount = training.done + training.partial;
  if (liftCount >= 3) {
    const low = Object.keys(volume).filter(m => volume[m].status === 'low').sort((a, b) => volume[a].sets / (volume[a].target[0] || 1) - volume[b].sets / (volume[b].target[0] || 1)).slice(0, 3);
    if (low.length) {
      volAct.push({
        type: 'volume',
        title: `Low volume: ${low.map(m => D.muscleGroups[m]).join(', ')}`,
        detail: `${low.map(m => `${D.muscleGroups[m]} ${fmt(volume[m].sets)} of ${volume[m].target[0]}–${volume[m].target[1]} sets`).join(' · ')} this week. Add a set or two where you have energy.`
      });
    }
  }

  if (planned > 0 && liftCount < planned) {
    const keys = new Set(liftWin.map(s => s.workout)), miss = plannedKeys.filter(x => !keys.has(x.key));
    consAct.push({
      type: 'consistency',
      title: `Trained ${liftCount} of ${planned} planned days`,
      detail: `${miss.length ? `Missed: ${miss.map(x => `${workoutName(D, x.key)} (${DOW[dow(x.date)]})`).join(', ')}. ` : ''}Don't double up. Use a rest day for a missed session, or the 45-minute version.`
    });
  }

  const records = ['meals', 'weights', 'sessions', 'cardio'].reduce((n, k) => n + (Array.isArray(S[k]) ? S[k].length : 0), 0);
  const le = typeof S.lastExport === 'string' && isKey(S.lastExport.slice(0, 10)) ? S.lastExport.slice(0, 10) : null;
  const ago = le ? diffDays(le, today) : null;
  if (records >= 10 && (le === null || ago > 14)) {
    backupAct.push({
      type: 'backup',
      title: 'Export a backup',
      detail: le === null ? 'You have never exported. Your history lives only on this phone.' : `Your last export was ${plural(ago, 'day')} ago. Your history lives only on this phone.`
    });
  }

  review.actions = [...calAct, ...swapAct, ...deloadAct, ...proteinAct, ...asymAct, ...volAct, ...consAct, ...backupAct].slice(0, 5);
  return review;
};

/* ---------- plain-text brief to paste into Claude ---------- */
E.coachText = function (S, D, review) {
  const P = (S && S.profile) || {}, r = review || null, L = [];
  const today = r && isKey(r.end) ? r.end : null;
  const tr = today ? E.trend(S, today) : { latest: null, rate: null, n: 0 };
  const val = (v, suffix = '') => (v === null || v === undefined ? 'n/a' : `${v}${suffix}`);
  L.push(`ASTRA COACH BRIEF${today ? ` (${today})` : ''}`, '');
  L.push('PROFILE');
  L.push(`- ${P.name || 'Athlete'}: started ${val(P.startWeight, ' kg')}, now ${val(tr.latest, ' kg')}, goal ${val(P.goal, ' kg')}.`);
  L.push(`- Weight trend: ${val(tr.rate, ' kg/week')} against a ${val(num(P.gainRate, 0.25), ' kg/week')} target.`);
  L.push(`- Targets: ${val(P.calories, ' kcal')}, ${val(P.protein, ' g')} protein, ${val(P.fat, ' g')} fat.`);
  L.push(`- Notes: ${String(P.notes || '').trim() || 'none'}`);
  if (r) {
    const t = r.training, n = r.nutrition, rc = r.recovery, en = r.energy;
    L.push('', `LAST 7 DAYS (${r.start} to ${r.end})`);
    L.push(`- Training: ${t.done} of ${t.planned} planned lift days complete, ${t.partial} partial, ${t.sets} working sets.`);
    if (t.prs.length) L.push(`- PRs: ${t.prs.slice(0, 6).map(p => `${p.name} ${p.kg > 0 ? `${fmt(p.kg)} kg × ` : ''}${p.reps}`).join('; ')}${t.prs.length > 6 ? ` (+${t.prs.length - 6} more)` : ''}.`);
    if (t.progressed.length) L.push(`- Progressing: ${t.progressed.slice(0, 8).map(id => nameOf(D, id)).join(', ')}${t.progressed.length > 8 ? ` (+${t.progressed.length - 8} more)` : ''}.`);
    if (t.stalled.length) L.push(`- Stalled: ${t.stalled.map(id => nameOf(D, id)).join(', ')}.`);
    L.push(`- Nutrition: ${n.loggedDays} fully logged days, average ${val(n.avgKcal, ' kcal')} and ${val(n.avgProtein, ' g')} protein (protein target hit on ${n.proteinDays} of them).`);
    L.push(`- Recovery: sleep ${val(rc.avgSleep, ' h')}, pre-session back pain ${val(rc.avgPain, '/10')}, ${plural(rc.painUpSessions, 'session')} ended 2+ points worse, ${plural(rc.worseNextDay, 'check-in')} said "worse than yesterday".`);
    if (r.body && r.body.waistChange !== null && r.body.waistChange !== undefined) L.push(`- Waist: ${signed(r.body.waistChange)} cm over the last 4 weeks.`);
    L.push(`- Calories: ${en.ready ? `${en.reason} (${en.confidence} confidence)` : en.reason}`);
    const vol = Object.keys(r.volume || {}).map(m => `${D.muscleGroups[m]} ${fmt(r.volume[m].sets)}`).join(', ');
    if (vol) L.push(`- Weekly sets: ${vol}.`);
  }
  const links = today ? E.painLinks(S, D, today) : [];
  if (links.length) L.push(`- Pain flags: ${links.map(x => `${nameOf(D, x.id)} (${x.zone}, ${x.count} of last ${x.of})`).join('; ')}.`);

  const order = [];
  for (const k of (D && D.split && D.split.lift) || []) for (const id of (D.workouts[k] && D.workouts[k].ids) || []) if (exOf(D, id) && exOf(D, id).main && !order.includes(id)) order.push(id);
  const lifts = order.map(id => ({ id, h: hist(S, id, today || undefined) })).filter(x => x.h.length).slice(0, 8);
  if (lifts.length) {
    L.push('', 'MAIN LIFTS (recent top sets, newest first)');
    for (const x of lifts) {
      const tops = x.h.slice(-3).reverse().map(s => {
        const t = doneSets(s, x.id).map(norm).reduce((b, y) => (!b || E.e1rm(y) > E.e1rm(b) || (E.e1rm(y) === E.e1rm(b) && y.reps > b.reps) ? y : b), null);
        return `${t.kg > 0 ? `${fmt(t.kg)} kg × ` : ''}${t.reps}${t.rpe ? ` @${t.rpe}` : ''} (${String(s.date || '').slice(5)})`;
      });
      L.push(`- ${nameOf(D, x.id)}: ${tops.join('; ')}`);
    }
  }
  if (r && r.actions && r.actions.length) {
    L.push('', 'APP SUGGESTIONS');
    for (const a of r.actions) L.push(`- ${a.title}: ${a.detail}`);
  }
  L.push('', 'Questions for my coach:');
  return L.join('\n');
};

if (typeof module === 'object' && module.exports) module.exports = E; else window.AstraEngine = E;
})();
