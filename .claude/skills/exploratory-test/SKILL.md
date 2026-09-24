---
name: exploratory-test
description: "Explore a running Positron instance as a real user to find genuine problems in a change you just made. Use when asked to exploratorily test, QA, manually test, or poke at a branch, PR, or feature through the real UI. This is discovery testing against the live app to find bugs, NOT writing automated tests; use author-e2e-tests or author-vitest-tests for that. Worth its cost for a user-visible behavior change, not for a refactor or a typo fix. Only runs when a person invokes it explicitly."
disable-model-invocation: true
---

# Exploratory testing

Explore a running Positron instance as a real user and find genuine problems.
Test what you were pointed at: the change's diff plus any other features and
functions in its blast radius, or the feature named in the request. Not the
rest of Positron. You decide how: what to look at, what to try, and when to
stop.

## Run it in a subagent

Spawn one fresh agent with `subagent_type: "general-purpose"` and
`model: "opus"`. Do not fork: a fork costs twice the calls for fewer findings,
because it re-sends your whole conversation on every turn. Sonnet is only for a
narrow re-test of one known scenario; it is not good enough for discovery.

The brief is the only context the agent has, so make it self-contained: the
checkout path, the branch and how to see the diff, what the change is meant to
do as a user would describe it, and the blast radius you are nervous about.
State intent and risk; do not state what you expect to work.
Include the absolute path to the report renderer, resolved from this skill's
base directory: `<base>/../../../.github/actions/pr-exploratory-test/render.mjs`.
The branch under test may predate it, so the agent cannot find it from there.

Running it in a subagent keeps screenshots, snapshots, and dead ends out of the
session you are working in.

When the agent finishes, put its run on the report's Run tile, as CI does. The
completion notice carries `duration_ms` and `tool_uses`; re-render with them:
`node <render.mjs> <report.md> --model <model id> --duration-ms <duration_ms> --turns <tool_uses>`.
The agent cannot do this itself, because it does not see its own totals.

If you are that subagent, do the exploring yourself. Do not delegate again.

## Drive the app

Use `.claude/skills/drive-positron` from the Positron checkout. It owns
launching, Playwright, known Positron behaviors, and cleanup. Do not restate
or reimplement any of it.

Pass whatever its launch section says is yours to pass, and put launcher
arguments before the `--`; everything after it goes to the app. Do not opt out
of the arguments the launcher supplies: without `--disable-workspace-trust` the
app starts in restricted mode with extensions disabled, so interpreter
discovery never runs and an empty picker looks like a bug.

Every tool call is a turn, and every turn re-sends the whole context, so turn
count drives cost far more than output size. A run made of single Playwright
commands each returning a line or two is the pattern to avoid. Batch
independent steps into one call -- act, act, then snapshot. Capture
screenshots freely, since writing a file is free. Reading one back is the most
expensive thing you can do: an image costs about 2,500 tokens at 1600x1100,
scales with area, and is paid again on every call after it. So read one only
when no grep of an accessibility snapshot or a log can answer the question,
which is rare. A screenshot you never read is still good evidence for the
report.

Before exploring, prove the branch under test is the code you are driving. A
worktree's `out/` is routinely stale main, and a run against main yields a clean
report indistinguishable from a real one, so nobody catches it. Build if you
need to, then grep the compiled output for a string the diff introduced, and
record that check in Run setup.

Cleanup is not optional; follow its Clean up section, including removing any
scaffolding workspaces you created.

## Report

Write findings to a fresh run directory,
`~/.claude/skills/exploratory-test/output/<YYYYMMDDTHHMMSS>/report.md`, with
evidence under `shots/` beside it. Cite a shot as a real link,
`[shots/<file>](shots/<file>)`, every time you name one in the report: a
backticked path renders as code the reader cannot open. The ledger's
`Evidence:` lines are the exception, bare file names under `shots/`. Never
write into an existing run directory; each run keeps its own so earlier
findings survive.
Copy evidence into `shots/` as you capture it, not at the end: drive-positron's
cleanup deletes the run directory your screenshots were written to, and a report
linking deleted files is not verifiable.

Write the report with Bash, as one quoted heredoc:
`cat > "$RUN/report.md" <<'REPORT'`. Quoting the delimiter passes backticks and
`$` through literally. Do not reach for the Write tool. It rejects a subagent's
report file outright ("Subagents should return findings as text, not write
report files"), and because the report is the deliverable, that guard costs the
run its entire output.

Then render it, so the reader gets the same page CI publishes:
`node <render.mjs from your brief> "$RUN/report.md"`. It writes `index.html`
beside the report and prints its path; give that path in your summary. If it
fails, say so and point at `report.md` instead: the markdown is still the
report.

Outcome first, evidence second, execution detail last. A reviewer who reads
only the title block, the findings table, and Coverage should know where the
change stands.

The shape, and only this shape:

```
# Exploratory test: <what you tested>

`<branch>` | `<short sha>`

PR: <owner>/<repo>#<number>

**Result:** <one sentence: what the change now does for a user>
**Tested:** <what you exercised, in a phrase>, <N> scenarios
**Not exercised:** <surfaces the change touches that you did not reach, or `none`>

## Findings

<the table, then one `### Finding N: <claim>` block per finding, worst first>

<details>
<summary>Run details</summary>

### Change under test
### Environment
### State manipulation
### Branch verification

</details>
```

One `#` heading, and it is the report. `Result` and `Not exercised` are bold
labels on their own lines rather than headings, because two lines do not need a
section competing with `## Findings`.

The `PR:` line is there only when the run was for a pull request, and the
report header links it. Take it from the request (a PR number or URL), or from
`gh pr view --json number,url` on the branch under test. When neither gives
one, leave the line out: there is no placeholder for "no PR".

`Result` is one sentence saying what the change now does for a user, in the
terms they would use. Write it as a statement, never as an answer: the reader
cannot see a question, so a line opening with "Yes", "Mostly" or "Partly"
leaves them holding an adverb and nothing else. Where the change falls short,
say what it does and where it stops, still as a statement.

One clause is usually enough. Do not name a finding, retell its mechanism, or
list what you verified: the table sits directly below this line and Coverage is
a screen further down, and a summary of something two lines away is the same
text twice. What no table can say is that the feature works, so say that and
stop.

When `Result` runs to two sentences, put `**` around the one a reader must not
miss -- usually the one saying where the change falls short. It renders as the
emphasised clause of the report's opening paragraph. You are the only one who
watched the run, so you are the only one who can say which clause is the point;
nothing downstream can work it out from the text. Mark one sentence, never the
whole line: emphasis covering everything emphasises nothing, and the renderer
drops it. A single-sentence `Result` needs no mark.

`Tested` is the scope you covered and how much of it: the surfaces you drove,
in a phrase, then the number of scenarios. The count is the number of `S`
scenarios in your ledger, so a reader can check it against Coverage rather
than take it on trust. It is there because nothing else at the top says how much work
stands behind the verdict, and no findings after three scenarios means
something very different from no findings after twenty.

Write all three lines every time. `**Not exercised:** none` is a claim that you
reached everything the change touches, and making you write it is the point: a
reader who sees a low finding count cannot otherwise tell a clean run from one
that never rendered the feature. Each surface named there reappears in the
ledger's `Not run` list with the reason it was out of reach.

## Ledger

The report's Coverage section is built from `ledger.md`, which you write in the
run directory beside `report.md` *as you go*, one scenario at a time, not at the
end. It holds every scenario you ran and every one you did not, and the report
has no Coverage tables of its own: the renderer reads the ledger for the table,
its tab counts and the Scenarios tile.

````
# Test ledger

PR: <owner>/<repo>#<number> - Branch: <branch> - Commit: <short sha>

## Environment
- <what is true for the whole run: build, launch, workspace, interpreters>

---

## S01 - <scenario, in a few words>
Status: pass
Result: <what happened, one line>

Preconditions:
- <short name> | <ID of the scenario that creates it, or empty> | <how to set it up>

Steps:
1. <action>
2. VERIFY <expectation> -> PASS
   Evidence: <file>

## S02 - <scenario>
Status: fail - Finding 1
Result: <what happened, one line>

Steps:
1. <action>
2. VERIFY <expectation> -> FAIL - Finding 1
   Observed: <one line>
   Evidence: <file>[, <file>]

---

## Not run
- N01 - <scenario> - <why it was out of reach, in a phrase>
````

- IDs are stable: `S01`, `S02`, ... for scenarios run, in run order; `N01`, ...
  for scenarios not run. Never renumber.
- `Status:` is `pass`, or `fail - Finding N` for the finding it produced.
  `Result:` is what happened, in one line: the outcome for a pass, a short
  symptom or the rate for a fail ("Fails 3/3"). A cell reporting that
  something did *not* happen says which surface you checked and when.
- `## Environment` holds only what is true for the whole run. Copy it into Run
  details; Coverage never shows it.
- `Preconditions:` is everything else a scenario needs before step 1, one
  `- <short name> | <creating ID> | <how>` bullet each. The short name is a few
  words ("`slow.py` loaded"); the how-to is enough to set it up from scratch.
  When another scenario creates the state, put its ID in the middle field;
  otherwise leave it empty. Repeat a precondition on every scenario that needs
  it. Leave `Preconditions:` out when there is nothing to set up, and never
  write a default-settings line ("Shipped defaults" or similar). Steps never
  start with "With X open, ..."; that state belongs here.
- `Not run` covers both the surfaces you could not reach and the threads you
  abandoned. Every surface on the `**Not exercised:**` line at the top appears
  here. A gap that deserves more than a phrase -- a mechanism you did not test
  that probably shares a fault with one you did, say -- gets it in the reason.
  There is no follow-up list: what a different run might check is neither a
  finding nor coverage.

**Recording steps.** Record every scenario as typed steps, *as you run them*, not reconstructed afterwards.
- An **action** is something you did: "Run `%view df`.", "Click Continue.", "Scroll to the bottom." Merge trivial waits into the action before them ("Run X and wait 15 s").
- A **verify** is a check you made. Write it *before* you look, as the expectation: "Verify the summary loads." Then record the result: `pass` or `fail`.
- Every check you make is a verify step, **including the ones that pass**. A scenario with no verify steps is incomplete.
- On `fail`: name the finding it produced, and add one `observed` line saying what actually happened.
- Attach each screenshot to the verify step it proves.
- Never write an observation as a step ("Loading dots, then the notice appears"). That text belongs in `observed`, or in the next verify step's expectation.

**Finding Reproduce steps** are the minimal sequence from the scenario that found it: its actions plus the verify steps that matter, keeping PASS checks that show what still works just before the failure.

**Screenshots.**
- Every **FAIL** check gets a screenshot.
- Every **passing scenario** gets at least one, on the check that shows its main outcome.
- Add more only when the picture shows something the text can't.
- Don't screenshot things a picture can't show (focus moving, a value staying the same).
- Attach each screenshot to the verify step it proves.

Write steps in this grammar, in the ledger and in a finding's steps; the
report parses it, and a result it cannot find is shown as none rather than
guessed:

```
N. <action text>
N. VERIFY <expectation> -> PASS
N. VERIFY <expectation> -> FAIL - Finding K
   Observed: <one line>
   Evidence: <file>[, <file>]
```

`Observed:` is only for FAIL. `Evidence:` sits under the check it proves.

Run details goes last because nobody needs it until they try to reproduce
something: the branch and how you proved the build matches it, how the app was
launched and which instances you started, the state you manufactured and
restored, and the local noise you ignored.

It is the one section that collapses. Wrap it in `<details>` with a `Run
details` summary, and keep a blank line after `<summary>` and before
`</details>` or the markdown inside renders as literal text. Nothing else
collapses: a finding's body is the evidence its table row is asking you to
believe, and evidence behind a click gets read as an assertion.

Return a two or three line summary and nothing else; the report is the
deliverable. Lead with how many findings the change under test introduced. Any
such count, in the summary or in the report, counts `Introduced? yes` only and
must agree with the blocks.

```
| # | Finding | Severity | Impact | Introduced? | Reproduction |
|---|---------|----------|--------|-------------|--------------|
| 1 | <short claim> | major | <the user consequence, in a phrase> | yes | 3/3 |
```

Each column answers one question and nothing else.

`Severity` is `major`, `moderate`, or `minor`. A `major` finding blocks or
materially breaks an important user workflow. A `moderate` one leaves the
workflow usable but meaningfully wrong or disruptive. A `minor` one is a small
usability, visual, or polish problem. Read it off the impact phrase rather than
picking it alongside: if the phrase does not justify the label to someone who
knows nothing else, the label is wrong.

Anchor the three so the middle does not swallow everything. Telling the user
to take an action that cannot fix their problem is `major`: the advice does not
work and the task never completes. Offering a choice that fails when they take
it is `moderate`, because they can still get there another way. A control that
wraps onto two lines is `minor`. Caught between two, let the impact phrase
decide; caution is not a tiebreaker, and a bug rated down reads as one nobody
has to fix.

`Impact` is the user consequence in a phrase, and only that: "blocks
completion", "silently creates no environment". Not the rate, which
`Reproduction` holds, and not a scale, because "High" tells a reader nothing.

`Introduced?` is `yes`, `no`, or `unclear`: did this change create the problem?
Settle it from the diff, not from how certain you feel. Either the line you
blame is in the diff or it predates the change, and Cause says which. Keep
`unclear` for the cases the diff genuinely cannot settle: the change exposes an
existing defect, or shifts timing so an existing race now fires. It is not a
hedge. You have read the diff by this point, so writing `unclear` over code you
watched arrive hands the author a reason to skip the finding.

`Reproduction` is how often you saw it, `<N>/<M>`, matching the finding block.

There is no tag for a regression any more. When behavior that used to work is
now broken, put it in the claim itself -- "X no longer Y" -- because that is
what decides whether a reader reverts or fixes forward.

Append every action to `actions.log` in the run directory as you take it, with
a timestamp, including the ones that feel incidental: a window reload, a
setting toggle, a wait. Have your scripts append it themselves. `Repro` is a
transcription of that file, not a recollection at report time, and a
precondition that only ever existed in your head is how a finding stops
reproducing on the reader's machine. Write the steps as a person using the app
would, not as you drove it: launch flags and scratch paths belong in Run
setup. Keep the claim under about twelve words, and make it state the symptom and its
consequence -- "A column over 10 s never loads, and Retry cannot help" -- because
Observed follows it directly and nothing in between says why it matters.

Every finding's steps stand on their own. Do not send the reader to another
finding for them -- no "as Finding 1", no "same as above". A reader arrives at
a finding from the table or a link, and steps they have to go hunting for are
steps they will not follow. Repeat the setup line in full each time; two
identical lines cost less than one missing one.

A step that shows source to paste puts it in a fenced block, indented under
that step so it stays part of it. If the source contains a fence of its own,
the outer fence has to be longer than the inner one -- four backticks around
three.

Use this block for every finding; do not substitute a schema of your own. Keep
the heading exactly this shape. `N` is the row number from the table, and it is
what ties the block to that row and to any ledger scenario whose `Status:`
names Finding N, so a heading that renumbers or drops it breaks those links.

````
### Finding N: <concise claim>

> **Confirmed** | Reproduced **<N>/<M>** | **Introduced by this change**

**Repro** -- starting state: <what exists before step 1>

**Preconditions:** <only with X: the non-default configuration or
manufactured state this needs, how you set it up, and what happened without it:
reproduces, does not reproduce, or not checked. Leave the line out when the bug
needs nothing special.>

1. <action>
2. VERIFY <expectation> -> PASS
3. <action>
4. VERIFY <expectation> -> FAIL - Finding N
   Observed: <what happened instead, one line>
   Evidence: <file>

**Observed:** <what happened>

**Expected:** <what should have happened>

**Evidence**

- [shots/<file>](shots/<file>) -- Step <N>: <what it shows>
- `<log path>` -- <quoted line with its timestamp>

**Error output** -- `<log path>` | <Renderer, Console, or Extension host> | Logged <N>x (<when>)

```
<the error message>
    at <function> (<repo-relative path>:<line>)
    at <function> (<repo-relative path>:<line>)
```

**Cause (hypothesis):** <one sentence naming the suspect, then the detail and
the code pointers>

**Regression test**

- <the missing case, as a sentence> -- <Unit, Extension, or E2E> `<repo-relative test file>` (<exists, covers ... | new file>)

**Other tests that touch this code**

- `<repo-relative test file>` -- <Unit, Extension, or E2E>, <what it covers, in a phrase>
````

The heading names the finding and carries a short claim, not the whole defect:
the body is there to explain it. The line under it is a status strip, and a blockquote so it reads
as metadata rather than sinking into the prose. Its third slot is
`**Introduced by this change**`, `**Pre-existing**`, or `**Origin unclear**`,
matching the table's `Introduced?` without repeating its wording.

Always give the rate, even when it is 5/5. "Every time" and "one time in three"
are different bugs to whoever picks this up, and `Confirmed` alone does not
separate them. `Unproven` means you saw it but could not reproduce it, which is
0/M. Whether the change introduced it is a separate axis and sits beside the
tag; do not fold the two together.

Keep the blank lines; they are part of the format. Labels packed together with
no blank line between them render as one run-on paragraph, and a step indented
under a label is swallowed by that paragraph too. Steps go at the left margin as
a real numbered list.

Embed one image with `![](shots/<file>)`: the single shot that shows the failure
best. Cite the rest as links under Evidence. Four screenshots of nearly the same
screen push everything below them off the page, and a reader who wants the
second one will open it.

A shot named on a step's `Evidence:` line takes that step's number. Start
every other screenshot's caption with the step it was taken after, `Step N:`.
The gallery sorts by it, so the shots read in the order of the repro. A shot
that follows no step, a variant of the setup say, takes the nearest step; if
there is none, write `Variant:`. Note the step in `actions.log` when you take
the shot, since you will not remember it at report time.

Evidence holds only what proves the behavior happened. A path to the code you
suspect is not evidence, it is where to look, so it goes in Cause.

Report genuine problems only. A finding a human cannot verify from its artifacts
is wasted work, so prefer one finding with a timestamped log excerpt over three
without. A proven bug belongs in the report even if the change under test did
not introduce it; that is what `Introduced? no` is for.

When an error is logged, write an `**Error output**` block for it: the full
message and stack, from the renderer log, the dev console, or the extension
host log, not the one-line message. Map frames to repo-relative source paths
(`src/vs/...ts:212`) when the log gives compiled ones and the mapping is clear;
the report links those to the source at the commit under test. One block per
distinct error, with how often it was logged. A message with no stack and no
file:line is still written, but the report only shows it to the agent it hands
the finding to: on the card it tells a reader nothing Observed does not.

`**Regression test**` is what a test suite would need to catch this next time,
and splits into a fact and a suggestion. The fact is which tests already touch
the changed code. Find them by convention -- unit tests in a `test/` folder
beside the source as `*.test.ts` or `*.vitest.ts`, extension tests under
`extensions/<name>/src/test`, e2e tests in `test/e2e/tests/` with their feature
tags -- and by searching the test trees for the changed symbols and the UI
strings the finding shows. The suggestion is the case none of them covers: one
sentence each, with the level (Unit, Extension, or E2E) and the file it belongs
in, or `new file` when none fits. Put each test file you found against the case
it would hold; list the rest under `**Other tests that touch this code**`. Do
not write the test and do not measure coverage. Leave both blocks out when
there is nothing a test would catch, such as a spacing bug.

Do not file GitHub issues and do not make a merge call. The person decides what
is real.

## What this run is for

Test the state a real user is in. A fresh disposable profile is the easy thing
to test and the least representative one; warm start, a populated workspace,
and cached state are the common cases and are where this has found its worst
behavior.

Manufacture the state you need. A feature that only appears when something is
missing, stale, or failing cannot be tested on a machine where it is present,
fresh, and working -- so make it missing: move a binary off PATH, reload the
window so a cached probe re-runs, point a host at 0.0.0.0. Scale what you
touch to what you can put back. In a disposable environment -- a CI container,
a VM you own -- machine-wide changes are fine. On someone's real machine, stay
in the profile, the workspace, and the settings; if the state is reachable
only by changing the machine itself, say so and drop it rather than doing it.
Restore what you changed, and record both the change and the restore in Run
setup.

Look for a second code path that consumes the same data. When one consumer is
correct and another is wrong, you have localized the bug instead of just
observing it.

Positron logs are at `~/.local/state/positron/logs`, not in the user-data
directory.

Before believing a finding, confirm your measurement can see what you think it
sees. A UI-scraping bug reads as a product bug, and bug-first instinct will
hold the wrong hypothesis for a long time; check the instrument first.

The harness is part of the configuration, not a neutral window onto the
product. A launcher that forces a setting, a web server standing in for the
desktop app, a seeded profile: each puts the app in a state most users are not
in, and a finding reachable only there is a narrower bug than it looks. So
before you rank a finding, find the configuration axis it sits on and say where
it lands on the `Preconditions` line. Re-check it under the default; if you
cannot, write that you did not rather than leaving the axis unstated. Keep it
to a sentence or two: it renders as a bullet above the steps, beside the
starting state, and a paragraph there buries the one thing a reader needs
before they begin. When the bug needs something, write "only with X"; when it
needs nothing, leave the line out rather than writing a default-settings line.
Desktop and web differ this way by construction, so a finding from one is not
yet a finding about the other.

Abandon dead ends and say you did. But tell a dead end from a door: a reload,
a moved binary, or a blocked host is often the only way into the state under
test, and dropping it means the feature ships untested. What is genuinely the
test environment showing is a mechanism reachable only in a dev build or an
admin deployment. Note that as dropped and move on; do not grind on one broken
interaction.
