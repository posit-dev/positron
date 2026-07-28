# Triage rubric -- reference

What the evidence proves, what root cause it supports, and what a claim must
clear before you make it. Read it at the "Determine root cause" step.

This file says what evidence *means*. It does not own retrieval (what to open,
when, at what cost -- [`evidence-escalation.md`](evidence-escalation.md)),
verification ([`reproduction.md`](reproduction.md)), or the diagnosis block's
fields and format ([`diagnosis-block.md`](diagnosis-block.md)).

## Taxonomy

Name the mechanism, not the symptom:

- **product regression** -- the app failed to do the thing. Includes open-path
  bugs (handler ran, UI never rendered) and latent defects predating the run.
- **locator drift / stale selector** -- the element exists; the selector no
  longer matches it.
- **test logic bug** -- the test asserts the wrong thing: an over-broad
  selector, or a check it re-derives instead of reading the product's signal.
- **race** -- ordering or timing inside one test or the app under it.
- **contention** -- load, resource pressure, or concurrent workers pushing
  something past a budget.
- **isolation / state leakage** -- another test, worker, or teardown mutated
  state this test depends on.
- **infrastructure** -- the runner or harness never produced a usable app.

`timeout` is **not** a category. A `timedOut` status is a symptom; work the
sections below and it usually resolves to a race, test logic bug, contention, or
a product regression that never arrived. When the evidence genuinely cannot
resolve the mechanism, don't fall back to a category: record an **unresolved
timeout symptom**, state confidence, and name the missing evidence that would
classify it ("unresolved timeout, low confidence -- needs the console digest to
show whether the command fired").

**Reading an Action report.** The batch analyzer uses a coarser list. Translate,
don't adopt:

| Action / report category | Here |
|---|---|
| product regression | product regression |
| locator drift / stale selector | locator drift |
| test logic bug | test logic bug |
| flaky test | race, contention, or isolation -- say which |
| test environment issue | isolation / state leakage, or contention |
| infrastructure issue | infrastructure |
| timeout | unresolved symptom, not a verdict |

## The dismissal bar

A triage routes attention, and the expensive error is a real regression waved
through as "flaky" -- the retry goes green and nobody looks again. So **race,
contention, isolation, and infrastructure are claims that must be earned**, with
a cited mechanism, not reached because nothing else was proven.

- **To call it a race**, cite the interleaving: an element present-then-gone in
  DOM presence, an ordering visible in the trace or in the two attempts' logs.
  "Passed on retry" is not a mechanism -- a latent product bug also passes on
  retry.
- **To call it contention or infrastructure**, cite the affirmative signal: the
  workbench never came up, an OOM or network error in the logs, a concurrent
  worker's teardown in the timeline.
- **`:soft-fail` is context, not a mechanism.** It says the test is known
  unstable; it earns a flaky verdict no more than "passed on retry" does. Name
  and support the race, contention, or isolation anyway.
- **When no dismissal is supported and the locator-drift decision does not
  resolve to a stale selector**, the residual is a *suspected product
  regression* -- not "flaky." Say so, qualify it with confidence, and name the
  one piece of evidence that would confirm or refute it.

This raises the bar for a dismissal. It does **not** lower the bar for a
confident product-bug call: `NEVER present` on its own still earns only
*suspected*, awaiting the confirmation you named.

## What each evidence type proves

- **Error-context snapshot** -- the accessibility tree at the moment of failure,
  including same-origin webview iframes. The only evidence separating "never
  rendered" (product) from "rendered as different markup" (stale selector).
- **Aria-live / status regions in that snapshot are ground truth** about
  internal state, not just markup. Components narrate what they decided
  ("dropped over droppable area 11"). When the test's error disagrees with a
  status line, believe the status line -- the assertion is one possibly-wrong
  way of checking what the product already reported.
- **Trace timeline** -- the full action sequence. The final error often points
  away from where the run diverged; don't stop at the last action.
- **DOM presence** -- whether the selector's structural token ever matched a
  frame.
  - `present in N/M` ⇒ it **was** in the DOM ⇒ a visibility or timeout error is
    a timing or dismiss race, not a never-render.
  - `NEVER present` ⇒ rules out render-then-dismiss (a single moment-of-failure
    snapshot cannot), but is **ambiguous alone**: the structural token is
    exactly what drifts, so it fits both a never-rendered element and locator
    drift. Disambiguate with the console digest and the stable label.
- **Console digest** -- `CommandService#executeCommand <id>` proves the command
  fired, so the click was received and dispatched. A startup `Phase changed to
  'complete'` just before the failing action is a timing-race tell: a handler
  that behaves differently depending on whether discovery finished.
- **A screenshot** cannot distinguish never-rendered from different-markup and
  cannot show sequence. Visual questions only.
- **A passing sibling** is an inference, not context. Same fixture, sibling
  passed ⇒ setup succeeded and the fixture *was* provisioned ⇒ something mutated
  or removed it mid-run. A shared assertion or page-object method a green
  sibling exercises is not universally broken -- diagnose what the failing case
  did differently. "File not found" with a green sibling is a lifecycle race,
  and a log line naming the resolved path separates never-created from
  deleted-after-creation.
- **The failing test source** says what the test *intends* to verify -- often
  the difference between "the assertion is the bug" and "setup failed before the
  assertion ran."

## Locator drift vs product regression

Decide from the snapshot, using the target's **stable, human-meaningful
identifier** -- visible text, placeholder, aria-label, role name -- never the
structural class or id, which is the part that drifts.

- Identifier **present under a different role or shape** than the selector
  expects ⇒ **locator drift**. The element exists; the selector is stale.
  Confirm against the page object that owns the selector.
- Identifier **absent entirely** ⇒ **product regression**, but only once all
  three hold:
  1. the identifier you checked is the intended stable product signal, not a
     structural or test-invented one;
  2. the triggering action or precondition actually occurred (the trace action
     succeeded, or the console digest shows the command fired);
  3. setup and state-selection failure are ruled out -- the test reached the
     state it meant to assert against, rather than asserting in the wrong editor
     group, session, or dialog.

  With any of the three unconfirmed, absence is an open question, not a verdict,
  and the unconfirmed condition names the evidence to go get.
- Element **present with its expected role**, error is a visibility or
  interactability timeout ⇒ **race**, not drift.
- A **matched** locator is not proof until you confirm it matched the element the
  test *means*. A broad `getByLabel` / `getByText` / `getByRole`, or a container
  selector not scoped to one editor group, tab, or dialog, can resolve to a
  leftover view, duplicate control, or notification. When the call log shows the
  selector resolved but the failure is "not visible" or a wrong count, check
  which surface owns the matched node before concluding the assertion is
  inverted. Another surface ⇒ **test logic bug (over-broad selector)**: scope
  the selector, don't flip the assertion.

**Markup can drift from code outside the head commit** -- an extension
bootstrapped to its latest build at test time, upstream-merged code, remotely
served content. An unrelated-looking commit is not evidence either way; decide
from the snapshot.

## Action fired but nothing rendered

When a click or keypress "does nothing" -- the action succeeds in the trace but
the expected UI never appears -- do not default to an environment flake.

- Console digest shows the command **fired**, DOM presence shows the widget
  **`NEVER present`** ⇒ the handler ran and failed to render its UI. That is a
  **product regression**, even when the head commit is unrelated.
- A frequent shape: the handler awaits something slow -- an extension-host RPC,
  interpreter discovery, a network call -- *before* showing its surface, so on a
  slow or first-load runner the surface never appears inside the budget.
- Distinct from a **blur/dismiss race**, where DOM presence shows the widget did
  appear and then went away.
- **`NEVER present` alone does not earn this call.** Require the command-fired
  line, or confirm via the snapshot's stable label that the affordance is
  genuinely absent. `NEVER present` with no command-fired line and a matching
  stable label in the snapshot is locator drift.

## Duplicated logic drift

Some helpers re-derive a condition the product already computes and exposes --
recomputing "is this in view" from bounding-box math when the component already
tracks that state as a class, attribute, or status region. The helper's criteria
quietly drift from the algorithm they stand in for.

Suspect it when the failure is a condition-never-true on a check the test
invented itself (not a direct assertion against product markup) **and** the
snapshot or an aria-live region shows the product had already reached the state
the test was waiting for. Trace the helper against the equivalent product
function before concluding. The defect is the re-derived check, not the
threshold: the product's real signal is what should be asserted.

## Race, contention, and isolation

- **Startup failures** are usually infrastructure -- but a *specific control*
  that never responds right after startup (command fired, no UI) is a product
  open-path bug. Reserve "infrastructure" for the app as a whole failing to come
  up.
- **Shared-workspace teardown race.** All e2e workers share one workspace
  directory (cloned once in global setup; `playwright.config.ts` runs
  `workers: 3`). `TestTeardown.discardAllChanges()` runs `git clean -fd` there,
  deleting any untracked, non-ignored file -- so a fixture one test downloads at
  runtime can be deleted by a *concurrent* worker's teardown mid-test. Suspect
  it for an intermittent "file missing / cannot open" on a runtime-downloaded
  fixture, especially with a green sibling reading the same file. The fix is
  usually to gitignore the artifact (`git clean -fd` has no `-x`), not to
  re-check provisioning. Never conclude "never provisioned" without ruling this
  out.
- **Same-file preceding-test leakage** (isolation, not concurrency). Tests in
  one spec file share a worker-scoped app and run in file-definition order with
  no intra-file parallelism (see `author-e2e-tests`'s test-structure reference).
  So when the evidence shows disruption another test in the file plausibly
  caused -- a window reload, a session restart or delete, a settings change --
  check the immediately **preceding** test, not just concurrent workers. Confirm
  the timeline: does the disruptive event land right before the failure, and
  does the sibling list place a state-mutating test directly before this one?
  Where to fix is a real choice -- cleaning up in the offending test protects
  one adjacency, hardening the shared path protects every test that hits it.

## History as evidence

- **0% on one platform, 100% on others = a deterministic platform regression,
  not a flake.** Always read the per-environment breakdown, never the aggregate.
- **A pattern that starts across all platforms at once** points to a regression,
  or to code sourced outside the head commit.
- **A rising rate is a regression signal.** A step change from reliably green to
  intermittently red means something changed -- treat the trend break as
  affirmative evidence for a regression. A flat, long-standing low pass rate is
  a standing flake; a step change is not, so don't fold it into "known flaky."
- **Intermittent does not mean provisioning broke.** A never-provisioned fixture
  fails *every* run. If the suite is mostly green, a "file not found" is far
  more likely a mid-run lifecycle race. Reconcile the root cause with the pass
  rate: a high pass rate contradicts a deterministic-missing-fixture verdict.
- **Latent defects surface as flakes.** A bug introduced weeks ago -- a race, an
  unguarded await, a platform timing assumption -- can start failing when a
  slower runner tips it over, and it will look known-flaky in history. An
  unrelated head commit and a flaky-looking history therefore do **not** rule
  out a product bug. A known-flaky test that also shows the product signal
  (command fired, UI never rendered) is an unfixed product bug wearing a flake
  costume: flag it for a fix, not a retry.

## Before you commit to the diagnosis

- **Try to falsify the leading hypothesis, not just confirm it.** When two
  mechanisms would both explain the symptom, find the evidence that separates
  them -- for an ordering question that usually means the raw logs, since a race
  is invisible in an error-line digest by construction.
- **Confidence tracks the evidence, not the story's tidiness.** High needs a
  cited mechanism plus the alternatives ruled out. Medium is a supported
  mechanism with an alternative you could not exclude. Low is a plausible
  mechanism with the confirming evidence still named and unfetched. State the
  uncertainty rather than rounding it away.
- **Sanity-check the fix approach against the same evidence** before agreeing to
  it. It must keep currently-passing siblings passing -- if it changes a shared
  assertion or page object a green sibling relies on, say why that sibling
  survives. And when the assertion is about an element being present or absent,
  check the product's intent (the `when` clause, precondition, or rendering
  source) before concluding the test is wrong: the element may be
  present-by-design under a precondition the failing case did not set up, so
  "flip the assertion" can contradict how the product is meant to behave.
