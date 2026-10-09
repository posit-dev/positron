---
name: exploratory-test
description: "Explore a running Positron instance as a real user to find genuine problems in a change you just made. Use when asked to exploratorily test, QA, manually test, or poke at a branch, PR, or feature through the real UI. This is discovery testing against the live app to find bugs, NOT writing automated tests; use author-e2e-tests or author-vitest-tests for that. Worth its cost for a user-visible behavior change, not for a refactor or a typo fix. Only runs when a person invokes it explicitly."
disable-model-invocation: true
metadata:
  # Bump when a run could find or judge findings differently: what an agent is
  # told or allowed, or what is done with its reply. That is this file,
  # explorer.md, verifier.md, isolator.md, editor.md, renderer/known-issues.mjs,
  # pipeline.mjs, finish.mjs, edit.mjs, claude-cli.mjs and time-up-hook.mjs,
  # and pr-exploratory-test's run.mjs and lib.mjs. Feedback is grouped by it, so a
  # change to how the page looks does not count.
  version: "1.57"
---

# Exploratory testing

Explore a running Positron instance as a real user and find genuine problems in
what you were pointed at: the change's diff plus any other features and
functions in its blast radius, or the feature named in the request. Not the
rest of Positron.

## Write the brief

The brief is the only context the explorer has, so make it self-contained: the
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
does not reach is lost. Keep the time limit out of the brief: told its budget,
the agent rushes and wraps up early.

When the change is a PR, fetch the issues linked to it first:
`node <base>/renderer/known-issues.mjs --pr <number> --out <scratch dir>/known-issues.json`.
Paste what it prints into the brief as it is; it tells the agent to test the
issues the PR fixes first and to copy the file into the run directory. It
prints nothing when there are no linked issues, and a failed fetch only warns.

Write the brief to a file in your scratch directory. The pipeline adds
`explorer.md`, the run directory and the renderer to it.

## Run it

Run this as a background command:

`node <base>/renderer/pipeline.mjs run --brief <brief file> --repo <checkout> --base <base sha> --head <head sha> --base-name <base branch> --time-limit <minutes>`

It makes the run directory and prints it first, then runs each agent as a
`claude -p` session: an Opus explorer, a verifier that checks its findings, an
isolator when one needs controls, and an editor that rewrites their openings
in plain words, as CI does. It prints the `index.html` path last. Keeping the
agents out of your session keeps screenshots, snapshots and dead ends out of
it too. Its output is a live feed of each agent's notes and tool calls; tell
the person they can open the background shell to watch it.

Exploring stops after 30 minutes unless the person names another limit
("spend an hour on it"; `--time-limit none` for "no limit"). Tell them the
limit and that they can change it at any time. To change it, write the new
total minutes to the time-limit file the command prints; write `0` to stop
exploring now. The explorer is then told to write up, which takes a few
minutes. The file is kept out of the run directory, where the explorer would
find its budget; keep it out of the brief too. Verifying adds a
few more, or about 20 when a finding needs isolating. The verdicts are
advisory: do not edit them or drop a finding over them.

If it exits 1 saying the explorer wrote no report, tell the person and give
them the run directory.

## Present it, then offer to publish

Give the user the result, the findings table, and the `index.html` path. Then
ask, in these words:

> Publish this report to share it? Feedback on a published report reaches the team with its screenshots and logs.

Publish only on a yes:
`bash <base>/renderer/publish.sh <run dir>`. It prints the report URL; give it
to the user. If it says there are no AWS credentials, relay its sign-in hint.
If it stops on a screenshot it could not paint a credential out of, name the
shot and leave the report unpublished.
