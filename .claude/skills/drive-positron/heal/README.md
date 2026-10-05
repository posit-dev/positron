# heal/: the nightly self-heal

`.github/workflows/drive-positron-heal.yml` runs these, in order, sharing one build:

1. `test/smoke.ts --results` (the full suite)
2. `rerun.ts`: reruns smoke once up to the last failed case; a case that failed both times becomes
   a finding in `findings/`, one that passed is a flake
3. `finder.ts` on explore nights: one agent session explores one area (`areas.json`) and writes findings
4. `fix-loop.ts`: one fixer session per finding (at most 5); each fix is committed, then `check.ts`
   and a full smoke run decide whether it stays; a fix also resolves the findings it cascades to
5. `report.ts`: the step summary, the PR body and the Slack message

The workflow's `publish` job pushes a candidate branch (burn-in) or updates the rolling PR (live);
nothing is ever merged. `vars.DRIVE_POSITRON_HEAL_PHASE` picks the phase.

Each stage reads and writes JSON in one directory (`--dir`, `/tmp/heal` by default), so any stage can
be run alone from the repo root against a copy of a night's artifact. The agent stages need
`ANTHROPIC_API_KEY` and `--runner .github/actions/pr-exploratory-test/session-cli.mjs` (run
`npm ci` in that directory first).
