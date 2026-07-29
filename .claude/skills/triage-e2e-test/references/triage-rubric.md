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

**A mechanism is not a diagnosis on its own.** Race, contention, and isolation
say *how* it failed, not *whose* it is -- so state both: **product**, **test
code**, **shared test environment**, or **infrastructure**. Write "product
race", "test isolation failure", "test-environment contention". A bare "race"
doesn't route the fix, and the same interleaving can be a product bug or a test
that assumed an ordering it never guaranteed. Product regression, locator drift,
and test logic bug already carry their owner.

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
| flaky test | race, contention, or isolation -- say which, and whose |
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
  regression* -- not "flaky." This is a safety-biased default, not a finding:
  an unexplained failure is more costly to wave through than to over-report, so
  the residual lands here rather than in a dismissive category. It is the
  leading hypothesis, not proof of a defect.

  Record it as: **suspected product regression**, low or medium confidence, the
  competing hypotheses still open, and the specific evidence that would separate
  them. Naming one confirming artifact is not enough when two mechanisms are
  still live -- say what each would show.

This raises the bar for a dismissal. It does **not** lower the bar for a
confident product-bug call: `NEVER present` on its own still earns only
*suspected*, awaiting the confirmation you named.

## What each evidence type establishes

Say which you mean, and don't upgrade one without saying what licensed it:
**proves** · **rules out** · **strongly supports** (leading hypothesis,
alternatives named) · **ambiguous** (two or more mechanisms still fit). Most e2e
evidence rules something out; little of it proves a mechanism.

- **Error-context snapshot** -- the accessibility tree at the moment of failure,
  including same-origin webview iframes. The evidence that separates "never
  rendered" (product) from "rendered as different markup" (stale selector); a
  screenshot cannot make that call.
- **Aria-live / status regions in that snapshot** are the component's own report
  of what it decided ("dropped over droppable area 11") -- strong evidence of
  internal state, and it outranks the *test's interpretation* of the same event,
  since the assertion is one possibly-wrong way of checking what the product
  already reported. Not infallible: check it belongs to the surface under test,
  wasn't superseded later in the trace, and describes the state being asserted
  rather than an earlier or narrower transition.
- **Trace timeline** -- the full action sequence. The final error often points
  away from where the run diverged; don't stop at the last action.
- **DOM presence** -- whether the selector's structural token ever matched a
  frame. It is a strong negative filter and a weak positive one.
  - `present in N/M` **rules out** "never rendered at all" for that token, and
    nothing more. A timing or dismiss race is only one survivor; so are a
    permanently hidden or disabled state, an overlay intercepting the
    interaction, a broad selector matching the wrong surface, and a node that
    mounts before the state it needs is ready. Separate them with the trace
    (when it appeared, what was attempted against it) and by confirming which
    surface owns the matched node.
  - `NEVER present` **rules out** render-then-dismiss for that token (a single
    moment-of-failure snapshot cannot), but is **ambiguous alone**: the
    structural token is exactly what drifts, so it fits both a never-rendered
    element and locator drift. Disambiguate with the console digest and the
    stable label.
- **Console digest** -- `CommandService#executeCommand <id>` **proves dispatch**
  and nothing further: not that the handler was registered as expected, that its
  preconditions held, that it ran to completion, or that it didn't no-op,
  reject, cancel, or delegate. Dispatch plus a missing UI localizes the failure
  to *somewhere after dispatch*; which step is a further question. A startup
  `Phase changed to 'complete'` just before the failing action is a timing-race
  tell: a handler that behaves differently depending on whether discovery
  finished.
- **A screenshot** cannot distinguish never-rendered from different-markup and
  cannot show sequence. Visual questions only.
- **A passing sibling** is an inference, not context. Same fixture, sibling
  passed: setup succeeded and the fixture *was* provisioned, which **rules out**
  "setup never ran" and makes mid-run mutation the leading explanation -- check
  that the failing test wanted the same artifact at the same path before
  settling on it. A shared assertion or page-object method a green
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
  interactability timeout ⇒ not drift. The element is there, so the question
  moves to *why it wasn't usable*: a timing race, a permanently hidden or
  disabled state, or something intercepting the interaction. Use the trace and
  DOM presence to pick between them rather than defaulting to race.
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
  **`NEVER present`**: the failure is somewhere **after dispatch** -- handler
  registration, an unmet precondition, the handler no-opping or rejecting, an
  awaited dependency that never resolved, or rendering itself. This strongly
  supports a **product** defect over an environment flake, even when the head
  commit is unrelated. Say which post-dispatch step the evidence points at, or
  say that it doesn't yet narrow past "after dispatch."
- A frequent shape, and the one to check first: the handler awaits something
  slow -- an extension-host RPC, interpreter discovery, a network call --
  *before* showing its surface, so on a slow or first-load runner the surface
  never appears inside the budget.
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
The next two heuristics rest on harness configuration that changes. **Confirm
the premise in the current tree before applying either** -- a one-line check,
and a heuristic built on a stale premise is worse than none.

- **Shared-workspace teardown race.** *Premise to verify:* workers still share
  one workspace directory, and teardown still runs `git clean -fd` (no `-x`)
  against it -- check the worker count in `playwright.config.ts` and the
  discard/teardown helper the fixtures call. When it holds: a fixture a test
  downloads at runtime is untracked and non-ignored, so a *concurrent* worker's
  teardown can delete it mid-test. Suspect it for an intermittent "file missing
  / cannot open" on a runtime-downloaded fixture, especially with a green
  sibling reading the same file. The fix is usually to gitignore the artifact,
  not to re-check provisioning. Never conclude "never provisioned" without
  ruling this out.
- **Same-file preceding-test leakage** (isolation, not concurrency). *Premise to
  verify:* tests in one spec file still share a worker-scoped app and still run
  in file-definition order with no intra-file parallelism -- see
  `author-e2e-tests`'s test-structure reference, and confirm the spec doesn't
  opt out. When it holds: if the evidence shows disruption another test in the
  file plausibly caused -- a window reload, a session restart or delete, a
  settings change -- check the immediately **preceding** test, not just
  concurrent workers. Confirm the timeline: does the disruptive event land right
  before the failure, and does the sibling list place a state-mutating test
  directly before this one? Where to fix is a real choice -- cleaning up in the
  offending test protects one adjacency, hardening the shared path protects
  every test that hits it.

## History as evidence

- **0% on one platform, 100% on others proves the behavior is deterministic and
  platform-specific -- and rules out a flake.** It does not by itself say whose
  it is: a product bug on that platform, a test assumption that only holds
  elsewhere, locator drift against platform-specific markup, a test-environment
  difference, or an infrastructure/dependency gap all produce this shape. Name
  the platform-specific mechanism before picking the owner. Always read the
  per-environment breakdown, never the aggregate.
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
  costume: flag it for a fix, not a retry. "Shows the product signal" means the
  post-dispatch localization above, which supports a product defect without
  naming which step failed -- enough to stop dismissing it, not enough to skip
  the mechanism.

## Before you commit to the diagnosis

- **Try to falsify the leading hypothesis, not just confirm it.** When two
  mechanisms would both explain the symptom, find the evidence that separates
  them -- for an ordering question that usually means the raw logs, since a race
  is invisible in an error-line digest by construction.
- **Confidence tracks the evidence, not the story's tidiness.** High needs a
  cited mechanism *and* an owner, with the alternatives ruled out. Medium is a
  supported mechanism with an alternative you could not exclude -- name it.
  Low is a plausible mechanism with the separating evidence still named and
  unfetched. Below high, the surviving alternatives are part of the diagnosis,
  not a caveat to omit: state the uncertainty rather than rounding it away.
- **Sanity-check the fix approach against the same evidence** before agreeing to
  it. It must keep currently-passing siblings passing -- if it changes a shared
  assertion or page object a green sibling relies on, say why that sibling
  survives. And when the assertion is about an element being present or absent,
  check the product's intent (the `when` clause, precondition, or rendering
  source) before concluding the test is wrong: the element may be
  present-by-design under a precondition the failing case did not set up, so
  "flip the assertion" can contradict how the product is meant to behave.
