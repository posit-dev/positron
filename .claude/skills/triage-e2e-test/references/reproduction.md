# Reproduce and verify -- reference

Read this only once a supported diagnosis exists (SKILL step "Reproduce and
fix"). Save the diagnosis checkpoint first.

## Prefer a unit-level repro when the mechanism lives below the e2e layer

If the root cause traces into a lower-level module with its own unit-test suite
(e.g. an extension's process-spawning helper, not the e2e spec or a POM), write
a deterministic unit test there instead of relying on the flaky e2e repro.
**Invoke `author-vitest-tests` to write it** -- that skill owns the builder /
`stubInterface` conventions and the RED bar, and pairs with `review-vitest-tests`.
Don't hand-roll the test here. Model the exact event ordering that triggers the
bug (e.g. a Node child-process `exit`/`close` race), confirm it fails against
current code (RED), apply the fix, confirm it passes (GREEN).

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

## Pick a project, easiest first

Only three projects run in CI. Start at the top; move down only for a specific
reason (e.g. the pattern's `environment_breakdown` concentrates on one):

1. `e2e-electron` -- desktop app, no extra setup. macOS/Windows/Ubuntu in CI.
   Try this first unless the test is web-only.
2. `e2e-chromium` -- browser against a managed server, no extra setup.
   debian/sles/opensuse/rhel in CI.
3. `e2e-workbench` -- browser against a container running Positron + Workbench.
   Requires `npm run pwb` first (add `-- --credentials=<databricks|snowflake|
   azure>` only if the test exercises a managed data-source connection); see
   `docker/environments/wb-local/README.md`.

(`playwright.config.ts` defines others -- `e2e-server`, `e2e-firefox`,
`e2e-webkit`, `e2e-edge`, `e2e-connect`, `e2e-remote-ssh`, `e2e-remote-wsl`,
`e2e-jupyter`. Only `e2e-remote-ssh`, `e2e-remote-wsl`, and `e2e-jupyter` run in
CI, each for narrowly-tagged tests; `e2e-server` isn't run in CI at all -- don't
default to it.)

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
