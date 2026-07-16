# E2E Failure Analysis Rubric

The single source of truth for how to categorize and reason about an e2e test failure. Three consumers share this file and MUST stay in sync:

- the **e2e-failure-analyzer skill** (`SKILL.md`, Step 7) -- interactive, run-centric triage,
- the **e2e-failure-analyzer GitHub Action** (`analyze.mjs` injects this file verbatim into the model's system prompt), and
- the **triage-e2e-test skill** (`../triage-e2e-test/SKILL.md`, Step 5) -- interactive, test-centric triage across a failure pattern's historical occurrences.

Edit the rubric here and all three pick up the change. Keep it runner-neutral: output format and orchestration (which scripts to run, how to present results, what follow-ups to offer) live in each consumer, not here.

## For each failure (or group of related failures), determine

1. **Root cause category** -- one of: flaky test | infrastructure issue | product regression | locator drift / stale selector (test maintenance) | test environment issue | timeout | test logic bug
2. **Brief explanation** -- 1-2 sentences citing specific evidence from screenshots, the trace timeline, the error-context page snapshot, or logs.
3. **Suggested action** -- what a developer should do next.

`timeout` is a last resort, not a default for anything that timed out. A `timedOut` status is a symptom, not a mechanism -- work through the sections below first; most timeouts resolve to **flaky test** (timing/interleaving), **test logic bug** (duplicated logic drift, over-broad selector), **infrastructure issue** (startup/runner slowness), or **product regression** (the awaited state never arrived). Only land on bare `timeout` when the evidence (trace, error-context snapshot, logs) genuinely gives no further signal to attribute it to one of those.

**`infrastructure issue` vs. `test environment issue`:** infrastructure issue is about the CI runner/harness itself failing to produce a usable app (startup timeouts, resource exhaustion, network flakiness to CI services). Test environment issue is about shared *test-owned* state going bad mid-run in an otherwise-healthy app (the shared workspace directory, a fixture another worker's teardown deleted). If the workbench never came up, it's infrastructure; if the workbench is fine but the file/fixture it's operating on was mutated by something else, it's test environment.

## Read the evidence before concluding

This list is priority order, not just topic grouping -- for a locator/visibility/count/text failure, start at the error-context snapshot, not the bottom.

- **Error-context page snapshot -- read it FIRST for any failure where a locator was not found, an element was "not visible", an element count was wrong, or a text/attribute assertion failed.** This markdown (`errorContextPath` on each attempt) holds Playwright's accessibility-tree snapshot of the page AT THE MOMENT OF FAILURE -- including content inside same-origin webview iframes -- plus the failing selector and the relevant test source. It is the single best evidence for telling a stale test selector apart from a real product bug. A screenshot CANNOT make this distinction: "the element failed to render" (product bug) and "the element rendered as different markup" (the test's selector is stale) look identical in a JPEG.
- **Aria-live / status announcements inside that same snapshot are ground truth about the app's internal state, not just its visible markup.** Frameworks like dnd-kit, and Positron's own components, emit `status`/`alert` regions describing what they just decided (e.g. "Draggable item 0 was dropped over droppable area 11"). When the test's own error message disagrees with what a status line says actually happened, believe the status line -- it is the product narrating its real state, whereas the test's assertion is one specific (and possibly wrong) way of checking it. Don't skim past these as UI noise; grep the snapshot for `status`/`alert` roles whenever the failure is a timeout or "condition never became true" and the mechanism isn't obvious from the DOM structure alone.
- **Screenshots:** read every screenshot for an attempt, in chronological order (the last is the failure-state; earlier frames show the moments leading up to it). Comparing them often reveals the real root cause -- the failure message and the final frame can mislead on their own. When reading them as files, read all of them in parallel in a single message.
- **Trace timeline:** read the full action sequence (selector clicks, navigations, waits) provided with each attempt. It often shows where the test actually went wrong even if the final error points elsewhere -- don't stop at the last action.
- **Failing test source:** read it before drawing conclusions. The source tells you what the test intends to verify, which page objects/helpers it depends on, and the setup steps -- often the difference between "the assertion is the bug" and "setup failed before reaching the assertion." Test source lives at `test/e2e/<file>` (the Action exposes the checkout as `<REPO_ROOT>`; interactively it is your working tree). When the test imports from `../../pages/`, `../../fixtures/`, or `../../infra/`, read those too if the failure involves their behavior. `infra/` (`workbench.ts`, `code.ts`, the Playwright drivers) is especially useful for failures during workbench startup, session creation, or teardown.
- **Sibling tests in the same file ("Other tests in this file: ..." in the input).** Before blaming setup/fixtures, check whether a sibling test PASSED. If the failing test depends on a fixture created in `beforeAll`/global setup and a sibling passed using that same fixture, setup succeeded and the fixture WAS provisioned -- so the failure is something mutating or removing the fixture mid-run, NOT "setup never ran." A "file not found" with a green sibling is a lifecycle/race, not a provisioning failure. The same signal applies beyond fixtures: if a passing sibling -- a parametrized entry in the same loop/`test.each`, or another test -- exercises the SAME assertion or page-object method that failed here, that shared code is not universally broken. Diagnose what the failing case does differently (an extra editor opened first, a different precondition, a different platform) rather than blaming the shared assertion.
- **Log excerpt ("Log excerpt (error lines from attached logs)" in the input).** When present, these are error lines mined from the run's kernel/runtime/runner logs. They carry detail the screenshot and Playwright error cannot -- e.g. a kernel's resolved file path, an expired-credential message, a stack trace. A screenshot of "No such file" looks identical whether the file was never created or was deleted after creation; the log line (and the passing sibling) is what tells them apart. Read it for any environment/fixture/startup failure.

## Locator drift vs product regression

Whenever a locator did not match, decide between **locator drift / stale selector** (test maintenance) and **product regression** using the error-context page snapshot:

- Take the target's STABLE, human-meaningful identifier from the failing selector -- its visible text, placeholder, aria-label, or role name -- NOT the structural class/id, which is the part that drifts.
- Identifier **present but under a different role/shape** than the selector expects (e.g. the selector wants `textarea[placeholder="X"]` but "X" now appears as a generic/div, or a labeled control changed tag or moved) => **locator drift / stale selector**. The element exists; the selector is stale (usually NOT a product bug). Confirm against the page object in `test/e2e/pages/*.ts`: if its selector targets markup that no longer matches the snapshot, it is stale, and the action is to update the selector.
- Identifier **absent entirely** (no equivalent affordance present) => **product regression**: the element genuinely failed to render.
- Element **present with its expected role** but the error is a visibility/interactability timeout => **flaky test** (timing), not locator drift.
- A **matched** locator is not proof until you confirm it matched the element the test MEANS. A broad selector (`getByLabel`/`getByText`/`getByRole`, or a container selector not scoped to one editor group / tab / dialog) can resolve to a leftover view, a duplicate control, a notification, or a second editor group -- an element the test never intended. When the call log shows the selector DID resolve (even repeatedly) but the failure is "not visible" / wrong-count / wrong-state, check WHICH surface owns the matched node before concluding the assertion is inverted. If it belongs to another surface, this is a **test logic bug (over-broad selector)** and the fix is to scope the selector, not to flip the assertion.
- Markup can drift from code that is NOT in the head commit -- a bootstrapped extension floated to its latest build at test time (e.g. Posit Assistant), upstream-merged code, or remotely-served content -- so an unrelated-looking commit does NOT imply product regression. Check the snapshot for changed markup before concluding either way (see "Check the triggering commit").

## Duplicated logic drift (a "test logic bug" sub-case)

Some test helpers re-derive a condition the product already computes and exposes, instead of asserting on the product's own signal directly -- e.g. a helper that recomputes "is this element in view" from raw bounding-box math, when the component being driven already tracks and renders its own notion of that state (a CSS class, a data attribute, a status region). When such a helper's homegrown check disagrees with the product's real state, the helper's criteria have quietly drifted from the algorithm it was standing in for -- often because the product's real logic (e.g. nearest-match collision detection) is looser or differently-shaped than the test's approximation (e.g. a fixed percentage band).

Suspect this when: the failure is a timeout/condition-never-true on a check the test invented itself (not a direct locator/assertion against product markup), AND the error-context snapshot or an aria-live status region shows the product had already reached the state the test was waiting for. The fix is not to loosen the test's thresholds -- it's to delete the re-derived check and assert on the product's real signal instead (the class, attribute, or status the component already maintains). Trace the test helper against the equivalent product source function before concluding this is the cause; the divergence is usually visible by comparing the two side by side.

## Other heuristics

- Multiple tests failing in the same file/suite usually share a root cause -- group them.
- `timedOut` status often indicates flakiness or infrastructure slowness.
- Failures during app startup (e.g. waiting for the workbench) are usually infrastructure.
- Tests tagged `:soft-fail` are known flaky.
- **Shared-workspace / teardown races (a "test environment issue" sub-case).** All e2e workers share ONE workspace directory (`<tmp>/vscsmoke/qa-example-content`, cloned once in global setup; `playwright.config.ts` runs `workers: 3`). `TestTeardown.discardAllChanges()` runs `git clean -fd` in that shared dir, which deletes any untracked, non-ignored file. So a fixture a test downloads at runtime (e.g. an S3 parquet written into the workspace by a `beforeAll`) can be deleted by a *concurrent* worker's teardown mid-test. Suspect this for an INTERMITTENT "file missing / cannot open" error on a runtime-downloaded fixture -- especially when a sibling test passed reading the same file. The fix is usually to gitignore the downloaded artifact (so `git clean -fd`, which has no `-x`, skips it), not to re-check provisioning. Do NOT conclude "fixture never provisioned" without ruling this out.

## Use historical data when available

If historical test-health data is provided, use it to separate regressions from known flakes:

- 0% pass rate on one platform but 100% on others = deterministic platform regression, NOT flaky. Always read the per-environment breakdown, not just the aggregate pass rate.
- A failure pattern that starts on this run across all platforms at once points to a regression (or a change in code sourced outside the head commit, e.g. a bootstrapped extension), not a flake.
- **Intermittent does not mean "provisioning broke," even for "file not found" errors.** A truly missing/never-provisioned fixture fails the test EVERY run (0% on the affected platform). If the suite is mostly green with some flakes (e.g. 153/159 passing, several flaky), a "file not found" is far more likely a mid-run lifecycle/race (something deletes the file) than provisioning that never ran. Reconcile your root cause with the pass rate: a high pass rate contradicts a deterministic-missing-fixture conclusion.

## Check the triggering commit

This section assumes a single run with one head commit to check causality against. If you're instead looking at a failure pattern's occurrences spread across many SHAs over a lookback window, a single occurrence's commit diff is weak evidence either way -- use the historical spread itself: a pattern recurring across many unrelated SHAs over time argues AGAINST a fresh single-commit regression (it's a standing flake or long-lived product/test-logic bug), while a pattern that only appears on SHAs from a narrow recent window is the case where checking that window's commits is worth doing.

For tests that **failed all retries** (not just flaky), inspect the head commit's changed files and assess causality against:

- **The failing test file itself** and its page objects/helpers -- changes here could introduce a test logic bug or a stale selector.
- **Product source code exercised by the test** -- changes to the feature under test could be a real product regression the test correctly caught.
- **Shared infrastructure** (startup, layout, rendering) -- changes here could alter timing or behavior enough to surface a latent flaky test.

A commit that modifies notebook cell rendering is a plausible cause for a notebook cell-count assertion failure, even if the test has flaked before. Conversely, a commit that only changes R interpreter code is unlikely to cause a Python plot test failure. When the commit is relevant, say so explicitly, e.g. "modified `notebookCellList.ts` (notebook cell rendering) -- plausible cause" or "no files related to this test's feature area -- unlikely cause".

**Caveat -- code outside the head commit.** Not everything under test comes from the head commit. UI can be produced by extensions bootstrapped to their latest build at test time (e.g. Posit Assistant), upstream-merged code, remotely-served or CDN content, or dynamically-installed dependencies -- none of which appear in the head commit's changed files. So an unrelated-looking changed-files list is NOT evidence for or against a product regression: a failure can have a real cause that simply lives outside the commit. Decide from the page snapshot and the locator-drift decision above, not from the changed-files list.

## Sanity-check the suggested action

Before recommending a fix, confirm it is consistent with the evidence you just used:

- It must keep the currently-passing sibling cases passing. A change to a shared assertion or page-object that would break a green sibling (e.g. inverting an assertion a passing case relies on) is wrong -- say why yours would not.
- When the assertion is about an element's presence or absence, check the product's intent (the feature's `when` clause, precondition, or the source that renders it) before concluding the test is wrong. The element may be present-by-design under a different precondition than the failing case set up, so "flip the assertion" can contradict how the product is meant to behave.
