# Astra Coach — on-device edition

A functional, iPhone-first progressive web app for strength, back-resilient training, endurance, nutrition and progress tracking. Version 4.0.0.

## Use

Serve the repository root over HTTPS (GitHub Pages: main branch, root). Open in Safari, Share → Add to Home Screen → Open as Web App. The application uses relative URLs so it works below `/astra-coach-/`.

No package install or build is required. To preview locally: `python3 -m http.server 8000`.

## Working features

- Five fully wired tabs and responsive desktop navigation.
- Real exercise photographs with two-position guides, written cues and modifications. Bird dog uses a clearly labelled illustration from the approved concept, not a photograph.
- Three full-body sessions, a reviewed rather than automatic four-phase progression, and separate endurance logging.
- Explicit per-set weight, repetitions/time and effort logging. Viewing an exercise does not mark it done. Partial sessions are distinguished from completed sessions.
- Persisted in-progress sessions and timestamp-based rest timers. These do not provide reliable background alarms when iOS suspends a web app.
- Editable meal and portion entries, protein/calorie/macronutrient totals, and water logging by local calendar date.
- Dated weight/waist history, trend chart, two-week averages, workout and cardio journals.
- Conservative readiness checks, source credits, JSON backup export and validated restore.
- Versioned service worker. App-shell offline access after a successful online load; photo-library download available from More.

## Privacy and limitations

There is no backend, subscription, telemetry, Apple Health/Garmin connection or automatic activity recording. Journal data stays in this browser's localStorage. Website-data removal, storage eviction, changing devices or using another browser can lose access; export backups regularly. GitHub receives requests for the site and public exercise images, but no journal entries are uploaded. Public code includes editable example profile/target defaults only, never a user's saved journal.

Older `astra`, `astra2`, `astra3` and `astraState` snapshots are preserved in new backups and left untouched in browser storage. Undated historical totals and exercise views are not fabricated into dated records.

This is a coaching template, not a clinical diagnosis or treatment. Recurring back or shoulder symptoms and asymmetry need an in-person assessment. Exercise dose, return to loading and protein targets may need individual adjustment.

## Images and guidance

Exercise photographs: https://github.com/yuhonas/free-exercise-db (Unlicense). Hero and bird-dog artwork: cropped from the user-approved AI-generated design. Food presets are rounded examples; labels and measured portions take priority.

Sources are linked in-app under More → Sources & image credits.
