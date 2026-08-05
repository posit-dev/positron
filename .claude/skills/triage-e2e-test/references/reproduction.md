# Reproduce and verify -- reference

Read this only once a supported diagnosis exists (SKILL step "Reproduce and
fix"). Save the diagnosis checkpoint first.

## Keep the implementation context small

Implementation, not diagnosis, is where a triage's cost runs away: every turn
re-reads the whole context, so a dead-end exploration keeps billing for the rest
of the session.

- **Offer a clear, don't impose one.** `--set phase=awaiting-clear`, `/clear`,
  `--resume <id>` (then `phase=implementation` again) is worth *proposing* at a
  context warning or right after the engineer redirects you off an approach --
  working-tree edits and the checkpoint both survive, so `git diff` plus
  `diagnosis.fixApproach` is the whole handoff. It is their call: in an
  interactive session the lost thread usually costs more than the context does.
- **Delegate source reading.** Finding a POM method, selector, command id, or
  call chain goes to an `Explore` subagent under the cap in the SKILL's
  root-cause step. Inline `sed`/`grep`/`cat` sweeps and whole-file `Read`s are
  the largest avoidable line item in this phase.
- **Keep verification output off the transcript.** Redirect runs to a file or
  run them in the background and read a summary -- a `--repeat-each` loop is
  noisy, and streaming full Playwright output into context bills it on every
  later turn.

## Prefer a unit-level repro when the mechanism lives below the e2e layer

If the root cause traces into a lower-level module with its own unit-test suite
(e.g. an extension's process-spawning helper, not the e2e spec or a POM), write
a deterministic unit test there instead of relying on the flaky e2e repro. Use
`author-vitest-tests` for the builder / `stubInterface` conventions and its
`review-vitest-tests` pass rather than hand-rolling -- but note that skill drives
toward a passing test and does **not** enforce RED-first, so **the RED bar below
is yours to hold**. Model the exact event ordering that triggers the bug (e.g. a
Node child-process `exit`/`close` race), confirm it fails against current code
(RED), apply the fix, confirm it passes (GREEN).

**A valid RED fails inside the assertion, for the diagnosed mechanism** -- it
reproduces the race/ordering the diagnosis predicts. An import, compile, or
setup error that fails *before* the assertion runs is **not** a RED: it proves
nothing about the mechanism, and a green run afterward only proves the file now
loads. If the test passes the moment it compiles, you never watched it fail for
the right reason -- rework it until it fails on the behavior, then fix.

A lower-level test is faster and more deterministic than a load-dependent e2e
race, and it leaves behind a regression test the e2e repro wouldn't. Reach for
an e2e-project repro when the mechanism is genuinely e2e-layer (a POM race, a
shared fixture, UI timing).

## Pick a project from the pattern's environments

The selected pattern's `environment_breakdown` names the OS/browser combos it
actually failed on. Pick the cheapest project that covers one of them, and move
down only for a reason you can state:

1. `e2e-electron` -- desktop app, no extra setup. Try this first unless the
   pattern occurred only in a browser environment.
2. `e2e-chromium` -- browser against a managed server, no extra setup.
3. `e2e-workbench` -- browser against a container running Positron + Workbench.
   Requires `npm run pwb` first (add `-- --credentials=<databricks|snowflake|
   azure>` only if the test exercises a managed data-source connection); see
   `docker/environments/wb-local/README.md`.

`playwright.config.ts` defines more projects than CI runs, and which ones run
changes over time -- so don't reproduce on a project from that file without
first confirming CI exercises it for this test:

```bash
grep -rnw -- '<project>' .github/workflows/
```

No match means CI never runs it, so it produced none of the history you are
triaging: a result there proves nothing either way. Matches only inside a
narrowly-tagged workflow mean the project runs for that tag set only -- check
the test carries the tag before using it.

```bash
npx playwright test <spec> --project <project> --grep '<test name>'
```

## Deterministic failure

Confirm it fails the same way on the picked project before touching code, then
confirm the fix makes that same run pass.

## Flaky / race-driven failure (the common case)

A single local pass or fail proves little; the failure depends on timing or
worker interleaving you can't force on demand.

1. **Force the mechanism directly if you can.** If the cause is a specific
   concurrent condition (two specs racing on a shared fixture), reproduce it by
   hand -- drop the polluting state into the shared workspace, or run the two
   colliding specs together at the real worker count -- and confirm the
   assertion fails before the fix and passes after.
   - **No shared fixture, but load/timing-sensitive anyway** (a foreground-
     session/focus race, a debounced UI update): a lone spec run on an idle
     machine has none of the contention that surfaces it. Run the failing spec
     alongside a sibling that exercises the same racy path, both with
     `--repeat-each`: `npx playwright test specA.test.ts specB.test.ts
     --project e2e-electron --repeat-each=4`. Recreate the contention, not just
     the repeat count.
2. **Repeated local runs are weak evidence, not proof.** `--repeat-each=N`
   passing N/N locally does not confirm the race is gone, especially when it
   depends on contention `--repeat-each` won't recreate. State it as "didn't
   reproduce locally" / "no trigger in N tries," not "confirmed fixed."

**Never claim a flaky test is "fixed" on one green run**, local or CI -- for a
race, evidence is a trend across enough runs, not one data point. **Never
increase a timeout or add an arbitrary wait as the fix** -- it hides the race,
contention, or isolation problem instead of closing it.

### When verification is done

The stopping condition is an argument, not a run count -- more repeats never
convert a local pass into proof, so don't keep adding them hoping for a stronger
claim. Verification is complete when all three hold:

1. **The fix addresses the diagnosed mechanism.** State which step in
   `diagnosis.signal` it changes. If you can't name one, the fix is unrelated to
   what you diagnosed -- go back, don't run it again.
2. **The forced-mechanism check ran, or you state why it couldn't.** Either the
   assertion failed before the fix and passes after (step 1 above), or you say
   plainly which contention you could not recreate locally.
3. **The local result is reported literally.** "N/N passed locally; the
   contention that surfaces this in CI wasn't recreated" -- never "confirmed
   fixed."

Then set the outcome and record the diagnosis. The real trend evidence arrives
after merge: a later triage of the same test reads it as `fix-holding` or
`recurred-after-fix`, which is why the block records a prediction rather than a
result.

## Environment-specific failures

If the pattern looks environment-specific (`environment_breakdown` shows it only
on certain OS/browser combos, or you suspect the CI image itself), the projects
above still run on your local OS and won't surface a CI-runner-image issue. For
that, reproduce on the real CI image per `.devcontainer/ci-arm/README.md`
(Posit-internal, arm64 access required -- see the gating note in the repo-root
`CLAUDE.md`).

## "Why did it start failing recently?" is a separate, weaker question

Don't conflate "when the bug was introduced" with "when the failure rate
spiked." Check `git log`/`git blame` on the actual fixed code for the bug's age,
then compare against the history's onset date (first date the pattern appears in
the lookback window). If the bug predates the onset by a wide margin, look at
merges just before onset -- but verify each candidate's *actual mechanism*
(does it change runtime versions, parallelism, CI image contents, or load -- not
just a plausibly-related title) before naming it a trigger. If no candidate
holds up, say "bug predates the spike; no confirmed trigger identified" rather
than presenting the most plausible-sounding candidate as proven.
