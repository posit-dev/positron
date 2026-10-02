---
name: exploratory-test
description: "Explore a running Positron instance as a real user to find genuine problems in a change you just made. Use when asked to exploratorily test, QA, manually test, or poke at a branch, PR, or feature through the real UI. This is discovery testing against the live app to find bugs, NOT writing automated tests; use author-e2e-tests or author-vitest-tests for that. Worth its cost for a user-visible behavior change, not for a refactor or a typo fix. Only runs when a person invokes it explicitly."
disable-model-invocation: true
metadata:
  # Bump when the agent is told something new: this file, explorer.md,
  # verifier.md, or the prompt CI builds in pr-exploratory-test's run.mjs and
  # lib.mjs. Feedback is grouped by it, so a renderer change does not count.
  version: "1.9"
---

# Exploratory testing

Explore a running Positron instance as a real user and find genuine problems in
what you were pointed at: the change's diff plus any other features and
functions in its blast radius, or the feature named in the request. Not the
rest of Positron.

## Run it in a subagent

Spawn one fresh agent with `subagent_type: "general-purpose"` and
`model: "opus"`. Do not fork: a fork costs twice the calls for fewer findings,
because it re-sends your whole conversation on every turn. Sonnet is only for a
narrow re-test of one known scenario; it is not good enough for discovery.

The brief is the only context the agent has, so make it self-contained: the
checkout path, the branch, the base and head SHAs and the `git diff` that shows
the change between them, what the change is meant to
do as a user would describe it, and the blast radius you are nervous about.
State intent and risk; do not state what you expect to work.

Exploring stops after 30 minutes unless the person names another limit
("spend an hour on it", "no limit"). When you spawn the agent, tell them the
limit and that they can change it at any time. Keep it out of the brief: told
its budget, the agent rushes and wraps up early. Start a timer, `sleep
<seconds>` as a background command. When it ends, if the agent is still
exploring, send it a message to stop exploring, list what it did not reach
under Not run, and write up. If the person changes the limit, stop the timer
and start one for the time left. This is for local runs; CI sets its own limit
and does not read this file.

When the change is a PR, fetch the issues linked to it before spawning the
agent: `node <base>/renderer/known-issues.mjs --pr <number> --out <scratch dir>/known-issues.json`.
Paste what it prints into the brief as it is; it tells the agent to test the
issues the PR fixes first and to copy the file into the run directory. It
prints nothing when there are no linked issues, and a failed fetch only warns.

Resolve two absolute paths from this skill's base directory and put both in the
brief. The branch under test may predate them, so the agent cannot find them
from there.
- `<base>/explorer.md`: tell the agent to read it in full before anything
  else. It is how to drive the app and the report and ledger it must write;
  none of that is in this file.
- `<base>/renderer/render.mjs`: the report renderer.

Running it in a subagent keeps screenshots, snapshots, and dead ends out of the
session you are working in.

## Verify, then render

When the agent finishes, stop any instance it left running:
`bash <base>/renderer/stop-instances.sh <run dir>`. Then have a second agent
check its findings, as CI does.
With the base and head SHAs from the brief, run:
`node <base>/renderer/finish.mjs prompt <run dir> --repo <checkout> --base <base sha> --head <head sha>`.
If it prints `no findings`, skip to the render. Otherwise it prints the path of
a prompt file. Spawn a fresh agent with `subagent_type: "general-purpose"` and
`model: "sonnet"`, tell it to read that file and do what it says, and save its
reply exactly as returned to `<run dir>/verify-reply.md`.

If the reply's VERDICTS line has an UNRESOLVED finding, isolate it before
applying anything. Spawn one fresh agent with `subagent_type: "general-purpose"`
and `model: "sonnet"`, tell it to read `<base>/isolator.md` and do what it says,
and give it the run directory, the checkout, the base and head SHAs, and the
UNRESOLVED findings by name ("Finding 3"). If it is still running after 25
minutes, tell it to write up. When it returns, run `stop-instances.sh` again,
then send the verifier, with SendMessage: "Read `<run dir>/isolation.md`,
revise those findings' verdicts, and name the Cause and Feature it points to,
with a FEATURE line when the Feature changes and a TITLE line when the title names the wrong trigger. If a cause is broader than the
cases in its table, narrow it. Reply again in full, in the same format." Save that reply over `verify-reply.md`.

Then run
`node <base>/renderer/finish.mjs apply <run dir> <run dir>/verify-reply.md`.
The verdicts are advisory: do not edit them or drop a finding over them.

Then put both runs on the report's Run tile, as CI does. Each agent's
completion notice carries `duration_ms` and `tool_uses`; re-render with them,
leaving out the `--verify-*` flags when there was nothing to verify:
`node <render.mjs> <report.md> --model <model id> --duration-ms <duration_ms> --turns <tool_uses> --verify-model <model id> --verify-duration-ms <duration_ms> --verify-turns <tool_uses>`.
The agents cannot do this themselves, because they do not see their own totals.

## Present it, then offer to publish

Give the user the result, the findings table, and the `index.html` path. Then
ask, in these words:

> Publish this report to share it? Feedback on a published report reaches the team with its screenshots and logs.

Publish only on a yes:
`bash <base>/renderer/publish.sh <run dir>`. It prints the report URL; give it
to the user. If it says there are no AWS credentials, relay its sign-in hint.
If it stops on a screenshot it could not paint a credential out of, name the
shot and leave the report unpublished.
