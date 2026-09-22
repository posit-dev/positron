---
name: exploratory-testing
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

Running it in a subagent keeps screenshots, snapshots, and dead ends out of the
session you are working in.

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

Capture screenshots freely, since writing a file is free. Reading one back is
the most expensive thing you can do: an image costs about 2,500 tokens at 1600x1100,
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
`~/.claude/skills/exploratory-testing/output/<YYYYMMDDTHHMMSS>/report.md`, with
evidence under `shots/` beside it. Cite a shot as a real link,
`[shots/<file>](shots/<file>)`, every time you name one, here and in Verified
working: a backticked path renders as code the reader cannot open. Never
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

The report, in this order:

1. Title, then a triage table with one line per finding.
2. The findings, worst first.
3. "Verified working": what you exercised and found correct. It is what stops
   the next session re-litigating it. A line reporting that something did
   *not* happen must say which surface you checked and when, and each such
   claim stands alone: do not combine several into a rate.
4. "Dropped": threads you abandoned, and why.
5. "Run setup": branch under test, how the app was launched, scaffolding you
   created and removed, local noise you ignored. It goes last because nobody
   needs it until they try to reproduce something.

Return a two or three line summary and nothing else; the report is the
deliverable. Lead with how many findings the change under test caused. Any such
count, in the summary or in the report, counts `Caused by change: yes` only and
must agree with the blocks.

```
| # | Finding | Type | Impact | Caused by change |
|---|---------|------|--------|------------------|
| 1 | <short claim> | regression | <how often, how bad, in a phrase> | yes |
```

Impact is a phrase, not a scale: "1 in 3 accepts silently do nothing" tells a
reader something, "High" does not.

`Type` is `regression`, `bug`, or `papercut`. A `regression` is behavior that
used to work and is now broken. A `bug` is new or changed behavior that never
worked correctly. A `papercut` is a pre-existing rough edge the change neither
introduced nor worsened. It is a different axis from `Caused by change`: a bug
the change caused is not necessarily a regression.

Append every action to `actions.log` in the run directory as you take it, with
a timestamp, including the ones that feel incidental: a window reload, a
setting toggle, a wait. Have your scripts append it themselves. `Repro` is a
transcription of that file, not a recollection at report time, and a
precondition that only ever existed in your head is how a finding stops
reproducing on the reader's machine. Write the steps as a person using the app
would, not as you drove it: launch flags and scratch paths belong in Run
setup. Keep the claim under about twelve words.

Use this block for every finding; do not substitute a schema of your own.

```
## Finding N: <one-line claim>

<confirmed | unproven> | reproduced <N> of <M> attempts | Caused by change: <yes | no | unclear>

<Two sentences a reader can follow without knowing the code: what they hit,
and why it matters. Symbol names belong under Cause, not here.>

**Repro** -- starting state: <what exists before step 1>

1. <step>
2. <step>

**Observed:** <what happened>

**Expected:** <what should have happened>

**Only under:** <any non-default configuration this needs, and what happened
under the shipped default: reproduces, does not reproduce, or not checked.
Write "shipped defaults" when it needs none.>

**Evidence**

- [shots/<file>](shots/<file>) -- <what it shows>
- `<log path>` -- <quoted line with its timestamp>

**Cause (hypothesis):** <one sentence naming the suspect, then the detail and
the code pointers>
```

Always give the rate, even when it is 5 of 5. "Every time" and "one time in
three" are different bugs to whoever picks this up, and `confirmed` alone does
not separate them. `unproven` means you saw it but could not reproduce it, which
is 0 of M. Whether the change caused it is a separate axis and sits beside the
tag; do not fold the two together.

Keep the blank lines; they are part of the format. Labels packed together with
no blank line between them render as one run-on paragraph, and a step indented
under a label is swallowed by that paragraph too. Steps go at the left margin as
a real numbered list. Embed every image a finding cites with
`![](shots/<file>)`, clearest first, so the reader sees them without opening
anything.

Evidence holds only what proves the behavior happened. A path to the code you
suspect is not evidence, it is where to look, so it goes in Cause.

Report genuine problems only. A finding a human cannot verify from its artifacts
is wasted work, so prefer one finding with a timestamped log excerpt over three
without. A proven bug belongs in the report even if the change under test did
not cause it; that is what `Caused by change: no` is for.

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
it lands on the "Only under" line. Re-check it under the shipped default; if
you cannot, write that you did not rather than leaving the axis unstated.
Desktop and web differ this way by construction, so a finding from one is not
yet a finding about the other.

Abandon dead ends and say you did. But tell a dead end from a door: a reload,
a moved binary, or a blocked host is often the only way into the state under
test, and dropping it means the feature ships untested. What is genuinely the
test environment showing is a mechanism reachable only in a dev build or an
admin deployment. Note that as dropped and move on; do not grind on one broken
interaction.
