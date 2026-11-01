# Astra Coach — on-device edition

A functional, iPhone-first progressive web app for strength, back-resilient training, endurance, nutrition and progress tracking. Version 5.0.0.

## Use

Serve the repository root over HTTPS (GitHub Pages: main branch, root). Open in Safari, Share → Add to Home Screen → Open as Web App. The application uses relative URLs so it works below `/astra-coach-/`.

No package install or build is required. To preview locally: `python3 -m http.server 8000`. Engine tests (Node 18+): `node --test` from the repo root.

## Working features

- Four tabs plus Account behind the avatar, and responsive desktop navigation.
- Real exercise photographs with two-position guides, written cues and modifications. Bird dog uses a clearly labelled illustration from the approved concept, not a photograph.
- A four-day upper/lower split (Upper A Tue, Lower A Wed, Upper B Fri, Lower B Sat) plus a Sunday light day for easy cardio, mobility and core, with single-side work for left/right balance. The original three full-body sessions stay in the code so older journal entries and backups still load. A reviewed rather than automatic four-phase progression and separate endurance logging remain.
- Explicit per-set weight, repetitions/time and effort logging. Viewing an exercise does not mark it done. Partial sessions are distinguished from completed sessions.
- Persisted in-progress sessions and timestamp-based rest timers. These do not provide reliable background alarms when iOS suspends a web app.
- Editable meal and portion entries, protein/calorie/macronutrient totals, and water logging by local calendar date.
- Dated weight/waist history, trend chart, two-week averages, workout and cardio journals.
- Conservative readiness checks, source credits, JSON backup export and validated restore.
- Versioned service worker. App-shell offline access after a successful online load; photo-library download available from More.

### New in v5: the coach actually coaches

- **A target for every set.** Double progression with effort autoregulation: each exercise shows today's weight × reps (for example "22 kg × 10 ↑"), the arrow shows up, same or down, and a one-line reason says why. Pain flags, a stall, or a rough readiness check hold or reduce the load. First-time lifts say "Find your weight" rather than guess.
- **Exercise sheet tools.** Left/right rep boxes on single-side lifts (the weaker side is saved as the set, and a line shows which side is behind), a plate calculator for barbell lifts, "This hurt?" flags (back, shoulder, other), and Swap with a reason (machine busy, hurts, prefer). A swap can be kept for future sessions and undone in Settings.
- **Short on time (~45 min).** Switch before Start to keep the main lifts and one core move; dropped exercises show greyed and can be added back with a tap.
- **Missed-session catch-up.** On a rest or light day, a card offers the first lift day you missed this week; "Not this week" hides it until Monday.
- **Weekly review.** A Last 7 days sheet (training, volume, body weight trend, food, recovery) with up to five decisions you can apply: calorie target, an exercise swap, an easier week, protein, left/right, volume, consistency and a backup reminder.
- **Adaptive calories (estimate).** Nutrition shows a maintenance estimate from your weight trend and fully logged food days, with a confidence label, and suggests a calorie target (one step at a time, never more than 250 kcal). Mark a day as fully logged for it to count. Set your weekly gain rate in Settings.
- **Faster food logging.** A Recent strip adds a meal in one tap with Undo, and Close the gap suggests calorie-dense top-ups late in the day.
- **Progress.** Weight chart with a trend line over your raw weigh-ins, weekly sets per muscle against a target band, left/right balance, and a history of calorie-target changes.
- **Copy for Claude.** The review sheet copies a plain-text brief (profile, last 7 days, main lifts, your notes) to the clipboard. You paste it wherever you like.
- **Rest alert.** When a rest timer ends while the app is open, it beeps and vibrates where the browser allows it, and the rest bar shows the next set's target.
- **Backup nudge.** A reminder appears on Today when you have 10+ records and haven't exported in 14 days.

## Privacy and limitations

There is no backend, subscription, telemetry, Apple Health/Garmin connection or automatic activity recording. Journal data stays in this browser's localStorage (the app asks the browser to keep it persistent, which browsers may ignore). Website-data removal, storage eviction, changing devices or using another browser can lose access; export backups regularly. GitHub receives requests for the site and public exercise images, but no journal entries are uploaded. Public code includes editable example profile/target defaults only, never a user's saved journal.

Older `astra`, `astra2`, `astra3` and `astraState` snapshots are preserved in new backups and left untouched in browser storage. Undated historical totals and exercise views are not fabricated into dated records.

Copy for Claude only shares what you paste: the app has no AI connection and sends nothing itself. Adaptive calories are an estimate: they need roughly 2–3 weeks of weigh-ins and fully logged food days before they mean much, and food logs are only as good as your portions. There is no Apple Health sync, no background alarms (iOS suspends web apps, so rest alerts only fire while the app is open), and no food database or barcode scanner; foods are rounded presets and your own entries.

This is a coaching template, not a clinical diagnosis or treatment. Recurring back or shoulder symptoms and asymmetry need an in-person assessment. Exercise dose, return to loading and protein targets may need individual adjustment.

## Images and guidance

Exercise photographs: https://github.com/yuhonas/free-exercise-db (Unlicense). Hero and bird-dog artwork: cropped from the user-approved AI-generated design. Food presets are rounded examples; labels and measured portions take priority.

Sources are linked in-app under More → Sources & image credits.
