# Designer Skills Pack (vendored)

Source: https://github.com/Owl-Listener/designer-skills — commit `9a6930cf84a822eb458624bd11c61aac5bbdf224`. MIT licence, © 2026 MC Dean (see `LICENSE`).

The nine design-practice plugins (design-research, design-systems, ux-strategy, ui-design, interaction-design, prototyping-testing, design-ops, designer-toolkit, visual-critique) are copied in as plain project skills and commands so they load in every Claude Code session on this repo, including cloud sessions, which don't install marketplace plugins or load untrusted skills-directory plugins:

- `.claude/skills/<skill>/SKILL.md` — 111 skills, unchanged.
- `.claude/commands/<command>.md` — 34 commands. Plugin prefixes are dropped (`/visual-critique:critique-screen` → `/critique-screen`).

Local changes from upstream:

- `design-research`'s `test-plan` is renamed `/research-test-plan`; `prototyping-testing`'s keeps `/test-plan`.
- Namespaced command references in `start-here.md` and `INDEX.md` are rewritten to the unprefixed names.

`INDEX.md` maps situations to skills. Not sure where to begin? Run `/start-here`.

To update: re-copy `*/skills/*` and `*/commands/*.md` from a newer upstream commit and re-apply the two changes above.
