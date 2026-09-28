---
name: exploratory-test
description: "Explore a running Positron instance as a real user to find genuine problems in a change you just made. Use when asked to exploratorily test, QA, manually test, or poke at a branch, PR, or feature through the real UI. This is discovery testing against the live app to find bugs, NOT writing automated tests; use author-e2e-tests or author-vitest-tests for that. Worth its cost for a user-visible behavior change, not for a refactor or a typo fix. Only runs when a person invokes it explicitly."
disable-model-invocation: true
metadata:
  # Bump when the agent is told something new: this file, explorer.md or
  # verifier.md. Feedback is grouped by it, so a renderer change does not count.
  version: "1.1"
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
checkout path, the branch and how to see the diff, what the change is meant to
do as a user would describe it, and the blast radius you are nervous about.
State intent and risk; do not state what you expect to work.

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

When the agent finishes, have a second agent check its findings, as CI does.
With the diff range you gave the explorer, run:
`node <base>/renderer/finish.mjs prompt <run dir> --repo <checkout> --base <base sha> --head <head sha>`.
If it prints `no findings`, skip to the render. Otherwise it prints the path of
a prompt file. Spawn a fresh agent with `subagent_type: "general-purpose"` and
`model: "sonnet"`, tell it to read that file and do what it says, and save its
reply exactly as returned to `<run dir>/verify-reply.md`. Then run
`node <base>/renderer/finish.mjs apply <run dir> <run dir>/verify-reply.md`.
The verdicts are advisory: do not edit them or drop a finding over them.

Then put the explore run on the report's Run tile, as CI does. The explorer's
completion notice carries `duration_ms` and `tool_uses`; re-render with them:
`node <render.mjs> <report.md> --model <model id> --duration-ms <duration_ms> --turns <tool_uses>`.
The agent cannot do this itself, because it does not see its own totals.

## Present it, then offer to publish

Give the user the result, the findings table, and the `index.html` path. Then
ask, in these words:

> Publish this report to share it?
> (Anyone with the link can view it. Keys found in screenshots are painted over.)

Publish only on a yes:
`bash <base>/renderer/publish.sh <run dir>`. It prints the report URL; give it
to the user. If it says there are no AWS credentials, relay its sign-in hint.
If it stops on a screenshot it could not paint a credential out of, name the
shot and leave the report unpublished.
