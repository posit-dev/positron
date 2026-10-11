# The explorer's rules

`explorer.md` tells the explorer what to do, and most of its lines are rules.
This file lists each rule once: why it is there, what catches a run that
breaks it, and whether anyone has measured that it helps. Read it before you
add, reword or cut a rule.

Rules are grouped in the order `explorer.md` has them. The other prompts
(`verifier.md`, `isolator.md`, `editor.md`) are not covered here yet.

## Adding, changing or cutting a rule

A new rule lands only with something that shows it works:

- a lint check, with a test that fails without it, when a run that breaks the
  rule leaves a trace in the ledger, the report or `actions.log`; or
- a before-and-after trial on the same checkouts and briefs, written into
  this file's Measured column, when it can't be checked mechanically.

Fix the general instruction. Never add an example or an edge case taken from
the one run that went wrong: the editor prompt grew stiff that way and was cut
from about 820 to 360 words.

When you cut a rule, check whether lint names it. Lint repeating a rule
doesn't make the prose spare. The 2026-10-11 trial cut the prose behind a lint
check and got more than twice the lint errors on both targets, plus repros that
lost steps to make them pass.

Then update the rule's row here in the same PR.

## Columns

- **Why** is the failure the rule prevents. "Not recorded" means neither the
  PR nor the commit says.
- **Caught by** is what notices a run that breaks it. Lint hands the problem back
  to the explorer to fix, and the pipeline acts on its own. The verifier only
  adds a note to the finding. "Nothing" means only the explorer's own reading
  of the rule stands behind it.
- **Measured** names a comparison of runs with and without the rule. Most
  rules have none.
- **Since** is the earliest PR with the rule's current wording. #16421
  rewrote most of explorer.md, so a rule listed there may be older.

## Setup and cost

| Rule | Why | Caught by | Measured | Since |
|---|---|---|---|---|
| Work the riskiest area first. What you don't reach goes under Not run. | A run can be stopped at any time. | Nothing | - | #16421 |
| Do the exploring yourself; don't delegate. | Not recorded. | Nothing | - | #16162 |
| Batch independent steps. Read a screenshot back only when no snapshot or log grep can answer. | Every turn re-sends the context, and an image costs about 2,500 tokens on every later turn. | Nothing | 2026-09-21 A/B on #16161, two rounds: no measurable effect on cost or findings. | #16162 |
| Prove the build is the branch under test before exploring, and record how. | A stale `out/` is main, and a run against main reports clean. | Pipeline: the checkout check, local runs only. | - | #16162 |
| Name a credential only by its variable. Never run `env`, `printenv` or `set`. Enter keys only into password fields, and blur one that shows. | A report can be published to a public URL. | Publishing: `redact.sh` and `scan-shots.mjs` paint over keys they find. | - | #16262 |
| Point drive-positron's log and shots at the run directory. Never save a shot elsewhere to copy later. | drive-positron's cleanup deletes its own run directory. | Lint: Evidence not in `shots/`. | - | #16245 |
| Pipe every launch through `tee -a "$RUN/instances.jsonl"`. | An instance left running is stopped after the run. | `stop-instances.sh` stops what is listed. | - | #16355 |
| Keep helpers and scratch files in `$RUN/tmp/`, and write the run path out in full. | Runs on one machine start together, and a shared helper drives the wrong instance. | Nothing | - | #16421 |

## How to explore

| Rule | Why | Caught by | Measured | Since |
|---|---|---|---|---|
| For a PR, start with the diff's own code paths and the manual checks its description lists. | Not recorded. | Nothing | - | #16421 |
| Reach each diff action at least once the way a person does: a click, a menu, a key. Keep the palette for setup. | The palette and the toolbar can run different code. | Nothing | - | #16526 |
| Test the state a real user is in: warm start, a populated workspace, cached state. | That is where this skill found its worst behavior. | Nothing | - | #16162 |
| Manufacture the state you need, scaled to what you can put back. Restore it and record it. | In the uv A/B, only runs that defeated the extension host's cache reached the feature. | Nothing | Added after the 2026-09-21 A/B, not trialed since. | #16162 |
| Retry with nothing in between: no edit, save, reload, restart or tab switch. | Each of those clears the state the retry tests. | Nothing | - | #16200 |
| Look for a second consumer of the same data, and run controls (baseline, another user, an unchanged counterpart, another trigger) before naming a Cause. | It localizes the bug, not just observes it. | The isolator runs controls for findings the verifier can't settle. | - | #16355 |
| Word the Cause only as widely as the cases tried. | Causes were worded wider than the cases tried. | Verifier narrows it. | - | #16355 |
| Confirm the measurement can see what you think. A log line supports a Cause only if written while the failure was on screen. | A scraping bug reads as a product bug. | Verifier: checks race order against log timestamps. | - | #16233 |
| A non-default setting a finding needs is a precondition. Re-check under the default. Desktop and web are different findings. | The harness forces settings, so a finding there may be narrower than it looks. | Verifier: asks whether the run's own setup explains the symptom. | - | #16162 |
| Tell a dead end from a door: a reload or a moved binary may be the only way in. Drop mechanisms reachable only in a dev build. | In the uv A/B, the old dead-end wording made agents give up on a path that needed a reload. | Nothing | Added after the 2026-09-21 A/B, not trialed since. | #16162 |
| A check the machine can't support is neither pass nor fail. Fix the environment, or end the scenario and add an `environment:` Not run row. | A gap in the machine says nothing about Positron. | Nothing | - | #16421 |
| Test a PR's linked fixes first. An open linked issue seen again is `observed`, not a finding. A closed one seen again is a finding. | Runs re-filed known bugs. | Lint: `Issue:` forms, membership in `known-issues.json`, and a missing fix result. | - | #16302 |
| Without a PR, don't search GitHub. | The verifier searches. | Nothing | - | #16421 |

## The ledger

| Rule | Why | Caught by | Measured | Since |
|---|---|---|---|---|
| Try a moderate or major finding at least twice, and keep its severity at 1/1. | A one-off reads as flaky. Severity is impact, not the rate. | Lint warning | - | #16421 |
| Each scenario's first FAIL has a `Log:` line, even "none found". | The log is narrowest at the failure's timestamp. | Lint: FAIL missing `Log:`. | - | #16200 |
| A scenario's `Status:` fails exactly one finding. A check that fails another gets its own scenario. | A finding's steps come from one scenario. | Lint | - | #16421 |
| A failed `Result:` is `Fails N/M`. A pass is one sentence under 160 characters. | The finding says what broke. | Lint | - | #16421 |
| Every VERIFY gets its own screenshot, taken in the same call. Never reuse or rename one. | A reviewer sees the app at each check. | Lint: no shot, a shot cited twice, shot order against `actions.log`. Verifier: shot timing. | Before the rule, a real run had 19 checks with no shot. | #16245 |
| A finding's steps and shots are one scenario's, in order, worded as the ledger has them. | The verifier checks steps against the ledger and the action log. | Lint: a step not in the scenario, out of order, or with a different result. | 2026-10-11 trim, soil: without the prose, 9 of 12 lint errors were this, and repros were cut to 4 steps. | #16233 |
| Name no scenario ID in a title, Observed, Expected, Cause or step. | Readers never see the ledger. | Lint | - | #16421 |
| One action per step. A VERIFY is only the check. | Runs folded actions into VERIFY steps. | Lint: two actions, a repeated action, a VERIFY that acts. | - | #16355, #16463 |
| Write the ledger as you go, and run `--check` after two scenarios and before `stop.sh`. | A slip that needs a new shot can be fixed only while the instance is up. | Nothing | - | #16421 |
| A pass that showed something unexpected gets a VERIFY before moving on. | An unexplained pass can hide a bug. | Nothing | - | #16421 |
| Read `## Environment` values from their files, never guess. | The issue button copies them into System details. | Lint: the first bullet's format. | - | #16247, #16538 |
| A precondition is state before step 1. Anything done in the app is a step. | Not recorded. | Lint: a precondition that runs a command, acts in the app, or is a running app. | - | #16487 |
| A scenario that needs an untouched file makes a fresh copy as step 1. | A file remembers its kernel and editor. | Nothing | - | #16421 |
| Install packages only into the run's own venv. A finding's precondition names the interpreter and package. | Other runs share those. The reader has no run. | Lint: a precondition that says "the run's". | - | #16421 |
| Each run stands alone; never cite another run's output. | Not recorded. | Nothing | - | #16421 |
| Not run lists surfaces where the change could differ, not every surface this environment can't reach. | Not recorded. | Lint: Not exercised needs an N line for each surface. | - | #16162 |

## Steps, screenshots and files

| Rule | Why | Caught by | Measured | Since |
|---|---|---|---|---|
| Steps replay `actions.log`. The log is append-only and only helpers write it. | The verifier checks steps against it. | Lint: timestamps and order. Verifier: steps against the log. | - | #16421 |
| Sample a state that lasts under a second with `ui.sh watch`. | A read after the action misses it. | Nothing | - | #16421 |
| Name the exact way in, as the UI labels it. Palette commands keep their category. | Two ways in can open different features. | Lint: a palette row with no step opening the palette. Verifier: a step done another way than the log shows. | - | #16355 |
| Merge a wait into its action, naming what it waits for, never a time. | Not recorded. | Lint: a fixed-time wait, a wait-only step. | - | #16355 |
| Write a VERIFY before you look, with one expected outcome. | A check that passes on either outcome checks nothing. | Verifier | - | #16221 |
| A number in a VERIFY or Observed comes from `actions.log` or the screenshot. | Not recorded. | Nothing | - | #16233 |
| A check about something off screen still gets a shot, plus the saved output in `logs/`. | Every check has a picture of the app. | Lint: VERIFY cites no screenshot. | - | #16421 |
| Save every test file to `files/` before using it, with a unique name, and list it. | A reader can't reproduce from a description of a file. | Lint: a file named but not saved, or saved but not listed. | - | #16233 |
| Collect logs before `stop.sh`, diff listeners, then clean up. | `stop.sh` deletes the instance's logs. | Nothing | - | #16221 |

## Writing up

| Rule | Why | Caught by | Measured | Since |
|---|---|---|---|---|
| Report genuine problems only, each verifiable from its artifacts. | Not recorded. | Verifier verdicts | - | #16162 |
| Before reporting a bug after a palette or quick-input action, confirm the intended command ran. | A wrong row run in its place is a tool error. | Nothing | - | #16421 |
| Set severity by user impact only, with the anchors given. | Not recorded. | Nothing | - | #16421 |
| A title names what is broken, as a fact, under about 90 characters, with no "any" or "every" beyond what was tried. | Readers often read only the title. | Lint: case, code names, hedges, possessives, parentheticals. Verifier: "any" and "every". The editor rewrites it afterwards. | - | #16421, #16487 |
| Always give `reproduced`. Another trigger is not another try. | "Every time" and "one in three" are different bugs. | Lint: rate format, and the rate matches the scenario's. | - | #16421 |
| Cold-replay first-start faults and anything that may depend on state or timing. Scale a race up until it fails every try. | A finding that only fails warm doesn't reproduce for the reader. | Nothing | - | #16355 |
| Write each precondition in full, one state per item. A running app is never a precondition. | Not recorded. | Lint: name length, paths, running apps. | - | #16421 |
| Observed and Expected lead with the exact difference in one or two sentences. A reference goes in Expected. | The card shows them side by side. | Lint: sentence count, semicolons, judgment words, a reference in Observed, digit grouping. The editor rewrites the opening. | - | #16421 |
| Claim no more than the run checked. Take Expected from a user or a reference, never from the code. | Code tells you why, not whether it is right. | Verifier: VERIFY and Observed claims against the log and shots. | - | #16421 |
| A failed check is about one finding. A different behavior on the same screen is its own finding. | Not recorded. | Lint: Status names another finding. Verifier: Observed against its finding. | - | #16421 |
| Evidence is Positron's log lines, verbatim, with no note after them. Never `actions.log` or a file the run saved. | A reader must tell what was logged from what the agent concluded. | Lint: notes, run-written files, trailing commentary. | - | #16452 |
| Add a `missing` item only for a line you can quote exactly. | Not recorded. | Nothing | - | #16452 |
| The Cause blames the defective line. Say whether the change added it only when the diff settles it, and never label a finding new or pre-existing. | Not recorded. It replaced an Introduced? label. | Verifier: the origin sentence against the diff. | - | #16233 |
| Map JavaScript stacks through `map-stack.mjs`. | Compiled frames point at `out/`, not the source. | Lint: compiled frames. | - | #16221 |
| List a test file only after opening it, at the lowest level that catches the bug. Leave the list empty rather than guess. | A wrong test file is worse than none. | Lint: a test file not in the repo. Verifier: coverage claims. | - | #16233 |
| Write `report.json` with a Bash heredoc, not the Write tool. | The Write tool rejects a subagent's report file, and the run loses its output. | Pipeline: no report means exit 1. | - | #16162 |
| Check with `lint-json.mjs` until no errors remain. Don't render. | It's rendered once its findings are verified. | Pipeline: re-checks and retries once. | - | #16221 |
| Don't file issues or make a merge call. | The person decides what is real. | Nothing | - | #16162 |

## What this shows

There are 64 rules. Lint, the pipeline or publishing catches 32 of them when
they're broken. For 8 more, only the verifier or isolator notices, which
adds a note to the finding but sends nothing back. The other 24 have nothing behind them
but the prompt. For 13 rules, no PR or commit says why they exist.

Two rules have been measured. The batching rule showed no effect. Cutting the
prose that has a finding's steps copy the ledger more than doubled lint
errors. Two more, manufacturing state and telling a dead end from a door,
came out of an A/B but were never trialed themselves.

Most of the 24 are about how to explore: risk first, real user state,
controls, cold replays. That is where the skill finds its bugs, and a cut there
would go unnoticed. They are the first candidates for an eval.
