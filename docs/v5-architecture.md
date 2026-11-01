# Astra Coach v5 — "the coach actually coaches"

Architect: Opus. Implementers: Sonnet agents. This file is the contract between them.

## Why v5

v4.8 is a careful logbook with a fixed programme. Paid apps earn $13–35/month on four things v4.8 does not do:

| Paid-app value | Who does it | v4.8 | v5 |
|---|---|---|---|
| Tells you the exact weight × reps for every set, and moves it | Alpha Progression, RP, JuggernautAI | Text hint inside the guide; inputs prefill last time | Per-set prescription with a one-line reason |
| Adjusts calories from your real weight trend + intake | MacroFactor | Fixed 2,500 kcal + a text tip | Adaptive maintenance estimate, weekly suggestion, one-tap apply |
| Adapts to feedback (pain, missed days, time) | RP, Fitbod | Readiness check only lowers sets | Pain flags per exercise, persisted swaps, catch-up sessions, 45-min mode |
| Weekly review with decisions | MacroFactor check-in, human coaches | None | "Last 7 days" review with ≤5 actions, each appliable |

Tailoring to RV (55 → 65 kg, lower-back discomfort, clicky left scapula, left/right imbalance, Tue/Wed/Fri/Sat upper/lower + Sunday light day, iPhone PWA, local-first):

- The bottleneck for a 55 kg gainer is eating enough → adaptive calories, recent-meal one-tap logging, "close the gap" top-ups from calorie-dense foods.
- Back/shoulder → every exercise has a stress `zone`; per-exercise "this hurt" flags hold load and recommend the joint-friendly swap.
- Imbalance → L/R rep logging on unilateral lifts and a weaker-side readout.

Not in v5 (named honestly, not faked): Apple Health/Watch sync (needs a native app), background rest alarms (iOS suspends PWAs), food database/barcode (Open Food Facts later), cloud sync, an in-app AI chat (v5 ships "Copy for Claude" instead — no API key, nothing leaves the device unless you paste it).

## Files

| File | Owner | Status |
|---|---|---|
| `data-v5.js` | Agent A (engine) | new — exercise metadata + new foods; loads after `coach-overrides.js` |
| `engine.js` | Agent A | new — pure logic, no DOM/storage; `window.AstraEngine` in the browser, `module.exports` in Node |
| `tests/engine.test.js`, `tests/fixture.js` | Agent A | new — `node --test` (repo root) |
| `app.js`, `styles.css`, `index.html`, `sw.js`, `README.md` | Agent B (UI) | modified |

Load order in `index.html`: `data.js` → `coach-overrides.js` → `data-v5.js` → `engine.js` → `app.js`, all `?v=5.0.0`, all `defer`. `sw.js` SHELL adds `data-v5.js?v=5.0.0` and `engine.js?v=5.0.0`; cache name `astra-coach-shell-5.0.0`. Tests are never cached.

## Data contract (`data-v5.js`)

```js
D.muscleGroups = {chest:'Chest',back:'Back',shoulders:'Shoulders',biceps:'Biceps',triceps:'Triceps',quads:'Quads',hamstrings:'Hamstrings',glutes:'Glutes',calves:'Calves',core:'Core'};
D.volumeTargets = {chest:[8,16],back:[10,18],shoulders:[8,16],biceps:[4,10],triceps:[4,10],quads:[8,16],hamstrings:[6,12],glutes:[6,12],calves:[4,10],core:[4,10]}; // weekly sets band
```

Every exercise in `D.exercises` (all 43 ids) gains:

- `mg`: `{muscle: fraction}` — 1 = primary, 0.5 = secondary. `{}` for `fixed` mobility drills.
- `inc`: smallest sensible load step in kg. Dumbbell (per hand) 2, barbell total 2.5, machine/plate-loaded 5, cable stack 2.5, bodyweight/fixed 0.
- `swaps`: array of existing exercise ids, same movement pattern, most joint-friendly first. May be `[]`.
- `uni`: `true` only for `sarow, salatpull, bss, slrdl, lunge, sideplank, pallof, suitcase`.
- `zone`: `'back' | 'shoulder' | null` — which of RV's sensitive regions it loads.
- `bar`: `20` for barbell lifts (`bench`, `squat`) so the plate calculator works; absent otherwise.

New foods appended to `D.foods` (same shape as existing; `gap:true` = suitable as a top-up suggestion). Values are rounded label/USDA-style examples:

| id | name | unit | base | p | c | f | k | gap |
|---|---|---|---|---|---|---|---|---|
| oats | Oats (dry) | g | 40 | 5 | 27 | 2.8 | 150 | ✓ |
| pb | Peanut butter | tbsp | 2 | 7 | 7 | 16 | 190 | ✓ |
| banana | Banana | banana | 1 | 1.3 | 27 | 0.4 | 105 | ✓ |
| nuts | Mixed nuts | g | 30 | 5 | 6 | 16 | 180 | ✓ |
| bread | Wholemeal bread | slice | 2 | 8 | 26 | 2 | 160 | |
| cheese | Cheddar | g | 30 | 7 | 0.4 | 10 | 120 | ✓ |
| beef | Beef mince 85% (cooked) | g | 100 | 26 | 0 | 15 | 250 | |
| oil | Olive oil | tbsp | 1 | 0 | 0 | 14 | 120 | |
| shake | Homemade gainer shake | shake | 1 | 50 | 85 | 29 | 770 | ✓ (portion: "500 ml whole milk + whey + banana + 40 g oats + 1 tbsp peanut butter") |

Also mark existing `whey`, `milk`, `yogurt` with `gap:true`.

## Engine contract (`engine.js`)

Pure functions. Never read `window.ASTRA_DATA`, `localStorage`, `Date.now()` or the DOM — state `S`, data `D` and `today` (`'YYYY-MM-DD'`) are always passed in. Sessions in `S.sessions` are history; `S.active` is never history.

Set objects: `{kg, reps, rpe, done, at, repsL?, repsR?}`. Session objects: `{id, date, startedAt, workout, phase, easy, pain, plan:{[exId]:{sets,min,max,rest,unit}}, sets:{[exId]:[set]}, skipped:[], status, afterPain, note, swaps?:{[slotId]:exId}, painFlags?:{[exId]:'back'|'shoulder'|'other'}, short?:bool, dropped?:[slotId]}`.

### `E.prescribe(S, D, id, {plan, easy=false, today}) → Rx`

```
{ id, mode:'load'|'reps'|'time'|'fixed'|'new',
  action:'start'|'increase'|'add-reps'|'hold'|'reduce'|'easy'|'pain-hold'|'fixed',
  kg:number|null, reps:number, sets:[{kg:number|null, reps:number}],   // sets.length === plan.sets
  reason:string,            // one short plain-English sentence
  last:[{kg,reps,rpe}], lastDate:string|null, arrow:'up'|'same'|'down'|null, swapTo:string|null }
```

Double progression with effort autoregulation. `history` = `S.sessions` with ≥1 done set for `id`, oldest first. `last` = done sets of the newest. `top=plan.max`, `bottom=plan.min`, `lastKg` = heaviest kg in `last`, `maxRpe` = max rpe in `last`, `allTop` = `last.length >= (prior.plan[id]?.sets ?? plan.sets)` and every reps ≥ top.

Evaluate in order — first match wins:

1. `e.fixed` → `fixed`/`fixed`, reps = bottom, "Mobility: quality over numbers."
2. No history → `new`/`start`, kg null, reps bottom, "First time: choose a weight you could lift about 4 more times (effort 6)."
3. Mode = `time` if `plan.unit` contains `second`, `reps` if `e.load==='Bodyweight'` or `lastKg<=0` or `!e.inc`, else `load`. Step = 5 (time) or 1 (reps).
4. **Pain**: newest session has `painFlags[id]`, or `e.zone==='back'` and that session's `afterPain - pain >= 2` (the after-session question measures back discomfort only) → `pain-hold`, kg lastKg, reps bottom. If `painFlags[id]` in ≥2 of the last 3 sessions: kg = one `inc` lower (load mode), arrow `down`, `swapTo = e.swaps[0] ?? null`, reason recommends the swap.
5. `easy` → `easy`, kg lastKg, reps bottom, "Reduced day: hold the weight, stop at effort 6–7."
6. `allTop && maxRpe <= 8.5` → `increase`. Load: kg = lastKg + inc (rounded to inc), reps bottom. Reps/time: reps = top, reason says make the variation harder or add load.
7. **Stall** (load mode, ≥3 sessions): best e1RM of the newest ≤ 1.01 × best e1RM of the 3rd-newest, and (`maxRpe >= 9.5` or any reps < bottom) → `reduce`, kg = floor-to-inc(lastKg × 0.9), reps bottom, arrow `down`, `swapTo = e.swaps[0] ?? null`.
8. Any reps < bottom or `maxRpe >= 9.5` → `hold`, kg lastKg, reps bottom.
9. Else `add-reps`: per set i, reps = min(top, max(bottom, (last[i] ?? last.at(-1)).reps + step)); kg lastKg.

Arrows: increase → up, reduce → down, start → null, else same. Round kg with `Math.round(x/inc)*inc` then to 2 decimals.

### Other functions

- `E.e1rm(set)` — Epley `kg*(1+reps/30)`, 0 when kg ≤ 0.
- `E.plates(totalKg, bar=20, sizes=[25,20,15,10,5,2.5,1.25])` → array of plates per side (greedy), or `null` if not reachable or `totalKg < bar`.
- `E.weekVolume(S, D, startKey, endKey)` → `{[muscle]:{sets, target:[lo,hi], status:'low'|'ok'|'high'}}` for every muscle in `D.muscleGroups`. Counts done sets in `S.sessions` dated within the range, for non-`fixed` exercises, weighted by `mg`, rounded to 0.5.
- `E.trend(S, today)` → `{points:[{date,kg,trend}], latest:number|null, rate:number|null, n}`. Daily EWMA, α = 0.1, seeded with the first weigh-in; days without a weigh-in keep the trend. `rate` (kg/week) = (trend at `today` − trend 14 days earlier)/2 when the span ≥ 14 days; scaled from the available span when it is 7–13 days; `null` below 7 days or < 2 weigh-ins.
- `E.energy(S, D, today)` → `{ready, confidence:'none'|'low'|'medium'|'high', tdee, avgIntake, loggedDays, weighIns, windowDays:21, rate, targetRate, suggested, change, reason, needs}`. The window is the 21 days ending **yesterday**. A day counts when `S.foodDone?.[d]===true`, or when `S.foodDone?.[d]!==false` and logged kcal ≥ 0.6 × `S.profile.calories`. `tdee = avgIntake − (trendΔ over window × 7700 / 21)`. Confidence: high if logged ≥ 16 and weigh-ins ≥ 10; medium if ≥ 10 and ≥ 6; low if ≥ 7 and ≥ 4; else none. `targetRate = S.profile.gainRate ?? 0.25`. `suggested = round-to-50(tdee + targetRate × 1100)`. `change = clamp(suggested − S.profile.calories, −250, 250)`, set to 0 when |change| < 50. When confidence is none but ≥ 6 weigh-ins span ≥ 14 days, use the rate-only fallback: rate < target − 0.1 → +150; rate > target + 0.2 → −100; else 0. Then `confidence:'low'`, `tdee:null`. `needs` says what more data is needed (e.g. "Log 4 more full food days and 2 more weigh-ins").
- `E.asymmetry(S, D, id, n=3)` → `{weak:'left'|'right'|null, gapPct, sessions}` from sets with both `repsL` and `repsR` across the last n sessions. `weak` is set only when gapPct ≥ 8 and sessions ≥ 2.
- `E.painLinks(S, D, today)` → `[{id, count, of, zone}]`, exercises flagged in ≥ 2 of their last 3 sessions.
- `E.planWeek(S, D, today)` → `{planned, done:[keys], missed:[{key,date}], catchUp:{key,date}|null}`. Week runs Monday to Sunday. `planned` is today's key from `D.split.week`. `done` holds this week's session workout keys. `missed` holds lift days (`D.split.lift`) before today whose key is not in `done`. `catchUp` is the first missed day, and only when today is a rest day or the `SUN` light day and today's session isn't logged yet.
- `E.shortPlan(D, workoutKey)` → `{keep, drop, minutes:'40–50'}`. Keep the first 4 `main` exercises plus the first `core` exercise and drop the rest. Never drop everything.
- `E.recentMeals(S, today, limit=8)` → unique meals from the last 30 days by lowercase name with rounded macros, sorted by count then recency: `[{name, meal, emoji, p, c, f, k, count, lastDate}]`.
- `E.closeGap(S, D, date, hour)` → `{kcal, protein, picks:[{foodId, name, amount, unit, k, p, c, f}]}`. Returns empty picks when `hour < 15` or (kcal gap < 150 and protein gap < 10). Otherwise it greedily picks up to 3 items from `gap:true` foods and frequent recent meals, overshooting the kcal gap by no more than 150. Each pick appears at most once.
- `E.weeklyReview(S, D, today)` → covers the rolling 7 days ending today:
  ```
  { start, end,
    training:{planned, done, partial, sets, prs:[{id,name,kg,reps}], progressed:[id], stalled:[id]},
    volume, body:{latest, rate, targetRate, waistChange},
    nutrition:{loggedDays, avgKcal, avgProtein, proteinDays},
    recovery:{avgSleep, avgPain, worseNextDay, painUpSessions},
    energy,
    actions:[{type:'calories'|'swap'|'deload'|'asymmetry'|'volume'|'protein'|'consistency'|'backup', title, detail, apply?}] }
  ```
  `actions` holds at most 5, ranked calories > swap/pain > deload > protein > asymmetry > volume > consistency. `apply` is `{kind:'calories', value}` or `{kind:'swap', from, to}`.
- `E.coachText(S, D, review)` → a compact plain-text brief for pasting into Claude. It covers the profile (weights, goal, rate, targets, `S.profile.notes`), the last 7 days and the main lifts' recent top sets. It ends with "Questions for my coach:".

UMD footer: `if (typeof module==='object' && module.exports) module.exports=E; else window.AstraEngine=E;`

## State changes (`app.js`, backward compatible — `schema` stays 4)

Defaults are filled on load: `profile.gainRate=0.25`, `profile.notes=''`, `calorieLog=[]`, `foodDone={}`, `prefSwaps={}`, `lastExport=null`, `catchUpDismissed={}`. `validateBackup` accepts and range-checks every new field and still accepts v4.8 backups.

The session model with swaps works like this:
- `plan` and `sets` stay keyed by **exercise id actually performed**.
- `swaps:{slotId: exId}` maps a programme slot to its substitute. The slot keeps its `plan` entry and an empty `sets` array, so v4.8 validation shape still holds.
- `effective(slot) = swaps[slot] ?? slot`.
- Planned/done counts iterate the workout slots, skip `dropped`, and use `effective()`. Never use `Object.values(plan)`.
- `status` is `'complete'` when every non-dropped slot has all planned sets done and no manual skips.
- `beginSession` seeds `swaps` from `S.prefSwaps`.

The `checkins[date].vsYesterday` field is optional (`'better'|'same'|'worse'`). It is asked only when a session was logged yesterday. `'worse'` makes today easy.

## UI (`app.js` + `styles.css`)

**Today**
- A coach line under the session meta, e.g. "3 lifts go up · 1 held for your back". It is built from `prescribe` across the workout.
- A catch-up card on rest/light days when `planWeek.catchUp` is set: "You missed Upper A on Tuesday. Do it today?" with [Start] and [Not this week] buttons. The second button is stored in `catchUpDismissed[weekStart]`.
- A "Your week in review" card on Sunday and Monday, or after 7+ days without opening it. It opens the review sheet.
- A backup nudge: once there are ≥ 10 records and no export in the last 14 days, show it with an Export button. `exportBackup` sets `lastExport`.
- The Nutrition row shows protein left as well as kcal.

**Train**
- Each exercise row shows today's target, e.g. "22 kg × 10 ↑", "Find your weight" or "12 reps". The arrow is coloured.
- A "Short on time (~45 min)" switch sits before Start and uses `shortPlan`. Dropped exercises show greyed as "Dropped for time", and tapping one adds it back.
- **Exercise sheet**:
  - A prescription callout sits at the top (big target, reason, arrow). Set inputs prefill from `rx.sets[i]`, and the small "prev" label keeps last time's set.
  - `uni` exercises replace REPS with **L** and **R** inputs. The saved `reps` is min(L, R), and `repsL`/`repsR` are stored too. An asymmetry line appears when `weak` is set ("Left ≈12% behind — start left, match right to it").
  - **Swap** opens the `swaps` options with a reason (Machine busy / Hurts / Prefer). The swap is blocked if sets are already logged for the slot. Reason "Hurts" also offers "Keep this swap for future sessions", which writes `prefSwaps`.
  - **This hurt** chips (Back / Shoulder / Other) write `S.active.painFlags[exId]`.
  - The plate line for `bar` lifts reads "Per side: 20 + 2.5".
- The finish sheet adds a summary: sets done, PRs this session, and "Next time" for up to 3 exercises whose prescription would now be `increase`.
- When rest ends in the foreground, play a short WebAudio beep (the context is unlocked on the first tap) and call `navigator.vibrate?.(200)`. The rest bar shows the next set target. Background alarms are not claimed.

**Nutrition**
- A "Day fully logged" toggle next to the date cycles `foodDone[date]` between unset → true → false.
- A coach row reads "Maintenance ≈ 2,430 kcal · medium confidence", or the `needs` text.
- A horizontal **Recent** strip comes from `recentMeals`. One tap adds the meal to the time-of-day slot (<10:30 Breakfast, <15:00 Lunch, <20:30 Dinner, else Snacks) and shows a toast with **Undo**.
- A **Close the gap** card shows `closeGap` picks and an "Add all" button.

**Progress**
- A "Week in review" button sits at the top.
- The weight chart draws the trend line over the raw points and shows the rate against the target.
- A weekly volume-per-muscle bar list shows each target band.
- A Balance (L/R) card covers `uni` lifts with data.
- A calorie-target history list reads from `calorieLog`.

**Review sheet**
- Sections render from `weeklyReview`.
- Each action carries an Apply button. Calories sets `profile.calories` and pushes `{date, from, to, reason}` to `calorieLog`. Swap sets `prefSwaps[from]=to`.
- A "Copy for Claude" button copies `coachText` to the clipboard.
- Opening the sheet sets `reviewSeen`.

**Settings**: weekly gain-rate select (0.15 lean / 0.25 steady — recommended / 0.35 faster), "Notes for your coach" textarea (stays on device), and the active persisted swaps, each with "Use original".

**Readiness**: the `vsYesterday` select when relevant.

**Boot**: `navigator.storage?.persist?.()`, called silently.

**Copy tone**: short, direct and specific, with numbers. Use "estimate" and confidence labels where they're true. Don't add new walls of disclaimers; the existing safety screens stay.

## Acceptance

- `node --test` (repo root) passes. `node --check` passes on every JS file.
- A fresh profile works with no history: no `NaN`, `undefined` or `null` rendered anywhere.
- A seeded 4-week fixture (`tests/fixture.js`) shows prescriptions, the review, a calorie suggestion, volume, L/R and a catch-up in the browser at 375 px with no console errors.
- A v4.8 backup still restores, and a v5 backup round-trips.
