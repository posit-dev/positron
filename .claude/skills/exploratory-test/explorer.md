# Exploratory testing: the explorer

You are the tester. Explore a running Positron instance as a real user and find
genuine problems. Test what your brief points at: the change's diff plus any
other features and functions in its blast radius, or the feature it names. Not
the rest of Positron. You decide how: what to look at, what to try, and when to
stop.

Do the exploring yourself. Do not delegate again.


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
evidence under `shots/` beside it. Never write into an existing run directory.
Copy evidence into `shots/` as you capture it, not at the end: drive-positron's
cleanup deletes the directory your screenshots were written to.

Write the report with Bash, as one quoted heredoc:
`cat > "$RUN/report.md" <<'REPORT'`, so backticks and `$` pass through. Do not
use the Write tool: it rejects a subagent's report file outright, and the run
loses its entire output.

Then render it: `node <render.mjs from your brief> "$RUN/report.md"`. It writes
`index.html` beside the report and prints its path; give that path in your
summary. It also prints any `format problems`: fix every line and render again
until there are none. If it fails outright, say so and point at `report.md`.

Outcome first, evidence second, execution detail last. The shape:

```
# Exploratory test: <what you tested>

`<branch>` | `<short sha>`

PR: <owner>/<repo>#<number>

**Result:** <one sentence: what the change now does for a user>
**Tested:** <what you exercised, in a phrase>
**Not exercised:** <surfaces the change touches that you did not reach, or `none`>

## Findings

<the table, then one `### Finding N: <claim>` block per finding, worst first>

<details>
<summary>Run details</summary>

### Change under test
### State manipulation
### Branch verification

</details>
```

The `PR:` line is there only when the run was for a pull request. Take it from
the request, or from `gh pr view --json number,url` on the branch; when neither
gives one, leave the line out.

`Result` says what the change now does for a user, in their terms, as a
statement. Never open with "Yes", "Mostly" or "Partly": the reader cannot see
the question. Where the change falls short, say what it does and where it
stops. One clause is usually enough. Do not name a finding or list what you
verified; the table is directly below. When it runs to two sentences, put `**`
around the one a reader must not miss, usually where the change falls short.
Mark one sentence, never the whole line.

`Tested` is the surfaces you drove, in a phrase. The renderer adds the scenario
count from the ledger.

Write all three lines every time. `**Not exercised:** none` is a claim that you
reached everything the change touches. Each surface named there reappears in
the ledger's `Not run` list with the reason.

## Ledger

The report's Coverage section is built from `ledger.md`, which you write in the
run directory *as you go*, one scenario at a time. It holds every scenario you
ran and every one you did not; the report has no Coverage tables of its own.

````
# Test ledger

PR: <owner>/<repo>#<number> - Branch: <branch> - Commit: <short sha>

## Environment
- <what is true for the whole run: build, launch, workspace, interpreters>

## Logs
- logs/<file> | <what wrote it> | <errors it holds, or "no errors">

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
   Log: logs/<file>:<line> | <Renderer, Console, or Extension host> | <N>x[ (<when>)]
     <the error message>
       at <function> (<repo-relative path>:<line>)

---

## Not run
- N01 - <scenario> - <why it was out of reach, in a phrase>
````

- IDs are stable, in run order: `S01`... for scenarios run, `N01`... for not
  run. Never renumber.
- `Result:` is the outcome for a pass, a short symptom or rate for a fail
  ("Fails 3/3"). A cell reporting that something did *not* happen says which
  surface you checked and when.
- `## Environment` holds only what is true for the whole run: the build, how the
  app was launched, the interpreters. Run details shows it; do not repeat it
  there.
- `## Logs` has one line per file you copied into `logs/`, written at the end,
  with the errors in it ("2 errors, both in Finding 1", "no errors"). An error
  no check is tied to is counted here and nowhere else.
- `Preconditions:` is everything a scenario needs before step 1, one bullet
  each, repeated on every scenario that needs it. Put the creating scenario's ID
  in the middle field when there is one. Leave `Preconditions:` out when there
  is nothing to set up; never write a default-settings line. Steps never start
  with "With X open, ..."; that state belongs here.
- `Not run` covers surfaces you could not reach and threads you abandoned. A
  gap that deserves more than a phrase, such as an untested mechanism that
  probably shares a fault with a tested one, gets it in the reason. There is no
  follow-up list.

**Steps.** Record them as you run them, not afterwards, in this grammar, in the
ledger and in a finding:

```
N. <action text>
N. VERIFY <expectation> -> PASS
N. VERIFY <expectation> -> FAIL - Finding K
   Observed: <one line>
   Evidence: <file>[, <file>]
   Log: <where> | <process> | <N>x (<when>)
```

- An action is something you did: "Run `%view df`.", "Click Continue." Merge
  trivial waits into it ("Run X and wait 15 s").
- A verify is a check, written as the expectation *before* you look. Every
  check is one, including the ones that pass.
- Never write an observation as a step; it belongs in `Observed:` or the next
  verify's expectation.
- Multi-line code to paste goes in a fenced block indented under its step. A
  short command stays inline.
- Every FAIL gets a `Log:`: look in the logs before moving on, while the
  timestamp still narrows it down. Write the message and its stack indented
  under it, as `map-stack.mjs` prints it. When you found nothing,
  say where you looked: `Log: none found in logs/<a>.log, logs/<b>.log`.

**Screenshots.** Every FAIL check gets one, and every passing scenario gets at
least one on the check that shows its main outcome. Attach each to the verify
step it proves, as a bare file name under `shots/` on the `Evidence:` line.
The check counts only a file that is there: "none" or "DOM read only" does not
satisfy it, so take the shot while the state is on screen. Add more only when
the picture shows something the text can't.

A finding's steps are the minimal sequence from the scenario that found it: its
actions plus the verify steps that matter, keeping PASS checks that show what
still works just before the failure.

Run details goes last: the branch and how you proved the build matches it, the
state you manufactured and restored, and the local noise you ignored. The
renderer adds the ledger's Environment. It is the one section that collapses; keep a blank line after
`<summary>` and before `</details>`.

Return a two or three line summary and nothing else. Lead with how many
findings the change introduced (`Introduced? yes` only).

```
| # | Finding | Severity | Impact | Introduced? | Reproduction |
|---|---------|----------|--------|-------------|--------------|
| 1 | <short claim> | major | <the user consequence, in a phrase> | yes | 3/3 |
```

`Severity` is `major` (blocks or materially breaks an important workflow),
`moderate` (usable but meaningfully wrong or disruptive), or `minor` (small
usability, visual, or polish problem). Read it off the impact phrase: if the
phrase does not justify the label to someone who knows nothing else, the label
is wrong. Anchors: telling the user to take an action that cannot fix their
problem is `major`; offering a choice that fails when taken is `moderate`,
because they can get there another way; a control that wraps onto two lines is
`minor`. Caution is not a tiebreaker.

`Impact` is the user consequence and only that: "blocks completion", "silently
creates no environment". Not the rate, and not a scale like "High".

`Introduced?` is `yes`, `no`, or `exposed`. Settle it from the diff: either the
line you blame is in the diff or it predates the change, and Cause says which.
`exposed` is only for what the diff cannot settle: the change exposes an
existing defect, or shifts timing so an existing race fires. It is not a hedge.

`Reproduction` is `<N>/<M>`, and the table is the only place it goes; the
renderer puts it on the finding. Always give the rate, even 5/5: "every time"
and "one in three" are different bugs. 0/M means you saw it but could not
reproduce it, and renders as Unproven.

When behavior that used to work is now broken, say so in the claim -- "X no
longer Y" -- since that decides whether a reader reverts or fixes forward.

Append every action to `actions.log` in the run directory as you take it, with a
timestamp, including incidental ones: a reload, a setting toggle, a wait. Have
your scripts append it themselves. `Repro` is a transcription of that file, and
a precondition that only existed in your head is how a finding stops
reproducing. Write steps as a person using the app would; launch flags belong
in the ledger's Environment, and scratch paths in Run details. Keep the claim
under about twelve words, stating the symptom and its consequence: "A column
over 10 s never loads, and Retry cannot help".

Every finding's steps stand on their own: no "as Finding 1", no "same as
above". Repeat the setup line in full each time.

A step that shows source to paste puts it in a fenced block indented under the
step. If the source has a fence of its own, the outer one is longer.

Use this block for every finding. `N` is the table's row number; it ties the
block to that row and to ledger scenarios whose `Status:` names Finding N.

````
### Finding N: <concise claim>

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

- <the missing case, as a sentence> -- <Unit, Extension, or E2E> `<repo-relative test file, or leave out when unsure>` (<exists, covers ... | new file>)

**Other tests that touch this code**

- `<repo-relative test file>` -- <Unit, Extension, or E2E>, <what it covers, in a phrase>
````

Keep the blank lines, and keep steps at the left margin.

Embed one image with `![](shots/<file>)`: the shot that shows the failure best.
Cite the rest as links under Evidence, each captioned with the step it was taken
after, `Step N:`, or `Variant:` if it follows none. Note the step in
`actions.log` when you take the shot.

Evidence holds only what proves the behavior happened. A path to suspect code is
where to look, so it goes in Cause.

Report genuine problems only. A finding a human cannot verify from its
artifacts is wasted work, so prefer one finding with a timestamped log excerpt
over three without. A proven bug belongs in the report even if the change did
not introduce it; that is what `Introduced? no` is for.

When an error is logged, write an `**Error output**` block for it: the full
message and stack, not the one-line message, one block per distinct error, with
how often it was logged. Its log path is the copy in `logs/` with the line, as
on the ledger's `Log:` line. Pipe the stack through `map-stack.mjs`, beside
`render.mjs`, from the checkout: it maps compiled frames to repo-relative source
lines, leaves frames with no map, or whose build is no longer on disk, as they
are, and keeps 10 frames. Paste what it prints.

```bash
node <map-stack.mjs> < stack.txt
```

`**Regression test**` is what a suite would need to catch this next time: a
fact and a suggestion. Write only what you checked; a wrong file or a test at
the wrong level is worse than leaving the block out.

The fact is which tests already touch the changed code. Find them by
convention -- `*.test.ts` or `*.vitest.ts` in a `test/` folder beside the
source, extension tests under `extensions/<name>/src/test`, e2e tests in
`test/e2e/tests/` with their feature tags -- and by searching the test trees
for the changed symbols and the UI strings the finding shows. List a file only
after opening it, and say what it covers from what you read.

The suggestion is the case none of them covers: one sentence each, with the
level and the file. Take both from the "Where should I put my test?" table in
`CLAUDE.md` (the lowest level that catches the bug) and the rule file it links
for that runner. Prefer an existing file. For `new file`, match the directory
the nearest tests of that kind use; when you cannot tell, give the level and
leave the path out. Put each test file you found against the case it would
hold; list the rest under `**Other tests that touch this code**`. Do not write
the test or measure coverage. Leave both blocks out when no test would catch
it, such as a spacing bug.

Do not file GitHub issues and do not make a merge call. The person decides what
is real.

## Logs

Keep every log in `logs/` beside the report, errors or not, and copy them
before `stop.sh`, which deletes the instance's run directory and its profile.
Every path you write -- in the ledger, the report, the Logs list -- is relative
to the report folder, never `/tmp/...` or `~/...`: a path outside it is gone by
the time anyone reads the report.

An instance's logs are not in its run directory: every launch writes to its own
folder under `~/.local/state/positron/logs/`, and `code.log` names it on its
`logsPath:` line when the app runs with `--log debug`, so launch with it. For
each instance, from the checkout, run `collect-logs.sh` beside `render.mjs` with
what `launch.sh` printed:

```bash
bash <collect-logs.sh> <logFile> <cdpPort> <session> "$RUN"
```

It copies the tree to `logs/all/<port>/`, the renderer, extension host, app,
browser console, and interpreter logs beside it, and prints a line per file
with its error count to start `## Logs` from.

Search both renderer copies for an error: `renderer.log` has rejections and
errors the workbench caught, with their stacks, but an uncaught `throw` reaches
only `<port>-console.log`, and `code.log` keeps just its message.

A helper you wrote for the run, such as
a script that builds slow data, goes in `logs/` as well so a reader can re-run
it. List `logs/all/<port>/` in `## Logs` as the full tree; the report shows it
without a link, and CI keeps it in the artifact only.

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
directory; see Logs for which folder is yours and what to copy.

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
