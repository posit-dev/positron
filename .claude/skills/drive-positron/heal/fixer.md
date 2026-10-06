# drive-positron fixer

You get one finding about drive-positron's helpers. Decide what it is, and fix it only if it is a
helper bug. Read `.claude/skills/drive-positron/SKILL.md` and `CONTRIBUTING.md` first; CONTRIBUTING
says how a helper is built and checked.

## Rules

1. **Edit only under `.claude/skills/drive-positron/`.** Any other path fails the run and throws
   your work away.
2. **Reproduce before editing.** Follow the finding's steps. For a smoke finding the first step is
   `smoke.ts --until "<case>"`, because a smoke case depends on the state the cases before it
   built; that run may be the only faithful repro. Record what you saw.
3. **Prove the cause.** Name the line that is wrong and why. If you cannot make it fail, the outcome
   is `flake` and you change nothing.
4. **Product bugs are not yours.** If the helper reports Positron's behavior faithfully and Positron
   is wrong, the outcome is `product` and you change nothing. Never change a helper so a product
   bug stops showing. Calling it a regression needs evidence that the case once passed on this
   platform (`git log` on the helper and its case); a helper that never worked here is the
   helper's bug.
5. **No sleeps, retries or longer timeouts to get a pass.** Waiting for a named condition the
   helper can observe is fine; waiting longer and hoping is not.
6. **Never loosen a smoke check.** If you change a check in `test/smoke.ts`, the reason must say
   which check, what it asserted before, and why the old assertion was wrong.
7. **Check your fix:** `node .claude/skills/drive-positron/test/check.ts` must pass, and the
   reproduction must now pass. Do not commit; the workflow commits and runs the full suite.

## Driving the app

Launch your own instance when you need one, and stop it when you are done. The brief gives the app
args and the state file path:

    node .claude/skills/drive-positron/test/fixture-app.ts launch --session heal-fix --root /tmp/dp-heal-fix --state <state file from the brief> -- <app args from the brief>
    node .claude/skills/drive-positron/test/fixture-app.ts stop --session heal-fix --root /tmp/dp-heal-fix --state <state file from the brief>

Pass `--session heal-fix` to the helpers. `smoke.ts` launches its own instance, so stop yours before
running it.

## Outcome

Write exactly one JSON file to the outcome path in the brief, then end with a one-line summary:

    {
      "outcome": "fixed | product | flake",
      "reason": "the cause, the line, and why the change is right (or why there is no change)",
      "reproduction": { "at": "<ISO time>", "by": "fixer", "result": "fail | pass", "observed": "what you saw" }
    }
