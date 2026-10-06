# heal/: the nightly self-heal

`.github/workflows/drive-positron-heal.yml` runs these, in order, sharing one build:

1. `test/smoke.ts --results` (the full suite)
2. `rerun.ts`: reruns smoke once per group with a failure, `--until` its last failed case; a case
   that failed both times becomes a finding in `findings/`. One that passed is replayed once more
   with `--from-start`: failing there makes it a finding that needs earlier sections' state,
   passing makes it a flake
3. `recent.ts`: fetches the past week's findings into `recent/<run id>/`, for the finder's area pick
   and the earlier verdicts in each fixer brief (and the earlier nights that fixed a finding that
   came back, `fixedBefore`)
4. `finder.ts` on explore nights: one agent session explores one area (`areas.json`) and writes findings
5. `fix-loop.ts`: one fixer session per finding (at most 5); each fix is committed, then `check.ts`
   and smoke decide whether it stays: only the sections whose cases run a helper the change can
   reach (`affected.ts`), each on its own launch, or the full suite when the change is shared
   (`dp-lib.ts`, `selectors.ts`, `test/`, ...; a `selectors.ts` change that only adds entries
   reaches the scripts that use them) or the sections would take as long. A fix also
   resolves the findings it cascades to. A regression in a section the check skipped shows up in
   the next night's full run
6. `report.ts`: the step summary, the PR body and the Slack message. Each leads with a headline and
   a "To do" line, then one block per finding: the fixer's plain `broke`, `cause` and `change`
   (falling back to the helper's error), what was checked, and the evidence folded away

The workflow's `publish` job updates one rolling PR and requests review from `REVIEWERS` when it
opens it (live, the default), or pushes a candidate branch per night (burn-in); nothing is ever
merged. `vars.DRIVE_POSITRON_HEAL_PHASE` overrides the phase. The Slack DM goes to
`vars.DRIVE_POSITRON_SLACK_CHANNEL` either way.

Each stage reads and writes JSON in one directory (`--dir`, `/tmp/heal` by default), so any stage can
be run alone from the repo root against a copy of a night's artifact. The agent stages need
`ANTHROPIC_API_KEY` and `--runner .github/actions/pr-exploratory-test/session-cli.mjs` (run
`npm ci` in that directory first).
