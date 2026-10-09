---
name: exploratory-test
description: "Explore a running Positron instance as a real user to find genuine problems in a change you just made. Use when asked to exploratorily test, QA, manually test, or poke at a branch, PR, or feature through the real UI. This is discovery testing against the live app to find bugs, NOT writing automated tests; use author-e2e-tests or author-vitest-tests for that. Worth its cost for a user-visible behavior change, not for a refactor or a typo fix. Only runs when a person invokes it explicitly."
disable-model-invocation: true
metadata:
  # Bump when a run could find or judge findings differently: what an agent is
  # told or allowed, or what is done with its reply. That is this file,
  # explorer.md, verifier.md, isolator.md, editor.md, renderer/known-issues.mjs,
  # pipeline.mjs, finish.mjs, edit.mjs and claude-cli.mjs, and
  # pr-exploratory-test's run.mjs and lib.mjs. Feedback is grouped by it, so a
  # change to how the page looks does not count.
  version: "1.57"
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
checkout path, the branch, the base branch and the base and head SHAs taken
from it, the `git diff` that shows the change between them, what the change is meant to
do as a user would describe it, and the blast radius you are nervous about,
riskiest first. State intent and risk; do not state what you expect to work.
When the feature has variants a setting chooses, such as the Positron and the
legacy notebook editor, or the Data Connections and the older Connections pane,
check which is the default (`git log` on the feature, its configuration file)
and name in the brief the one to test and the setting that selects it. An agent
on the other variant reports its gaps as bugs.
Fit the blast radius to the time: under 20 minutes, name at most three areas,
since a run reaches about one area every three to five minutes and what it
does not reach is lost.

Exploring stops after 30 minutes unless the person names another limit
("spend an hour on it", "no limit"). When you spawn the agent, tell them the
limit and that they can change it at any time. Keep it out of the brief: told
its budget, the agent rushes and wraps up early. Start a timer, `sleep
<seconds>` as a background command. When it ends, if the agent is still
exploring, send it a message to stop exploring and write up, listing what it
did not reach under Not run (explorer.md says what stopping involves). If the
person changes the limit, stop the timer and start one for the time left. This is for local runs; CI sets its own limit
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

When the agent finishes, a second agent checks its findings and a third
rewrites their openings in plain words, as CI does. Wait for the explorer's
completion notice; its report can arrive first. Then, with the base branch and
the SHAs from the brief and the notice's `duration_ms` and `tool_uses`, run this
as a background command:

`node <base>/renderer/pipeline.mjs run <run dir> --repo <checkout> --base <base sha> --head <head sha> --base-name <base branch> --duration-ms <duration_ms> --turns <tool_uses>`

It runs each of those agents itself and prints the `index.html` path. It takes
a few minutes, or about 20 when a finding needs isolating. The verdicts are
advisory: do not edit them or drop a finding over them.

## Present it, then offer to publish

Give the user the result, the findings table, and the `index.html` path. Then
ask, in these words:

> Publish this report to share it? Feedback on a published report reaches the team with its screenshots and logs.

Publish only on a yes:
`bash <base>/renderer/publish.sh <run dir>`. It prints the report URL; give it
to the user. If it says there are no AWS credentials, relay its sign-in hint.
If it stops on a screenshot it could not paint a credential out of, name the
shot and leave the report unpublished.
