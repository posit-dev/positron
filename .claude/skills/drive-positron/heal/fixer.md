# drive-positron fixer

You get one finding about drive-positron's helpers. Decide what it is, and fix it only if it is a
helper bug. Read `.claude/skills/drive-positron/SKILL.md` and `CONTRIBUTING.md` first; CONTRIBUTING
says how a helper is built and checked.

## Rules

1. **Edit only under `.claude/skills/drive-positron/`.** Any other path fails the run and throws
   your work away.
2. **Reproduce before editing.** Follow the finding's steps. For a smoke finding, run its
   `smoke.ts` step once with the case before it and `--keep`, then run the failing helper by hand
   on the kept instance (session `net1`). If the step has `--from-start`, the case fails only
   after earlier sections ran, and your reason must name the state it needs. Record what you saw. If the brief lists earlier
   verdicts on this finding, start from the newest: a different outcome needs evidence it missed,
   and your reason must name that evidence.
3. **Prove the cause.** Name the line that is wrong and why. If you cannot make it fail, the outcome
   is `flake` and you change nothing.
4. **Product bugs are not yours.** If the helper reports Positron's behavior faithfully and Positron
   is wrong, the outcome is `product` and you change nothing. Never change a helper so a product
   bug stops showing. Calling it a regression needs evidence that the case once passed on this
   platform (`git log` on the helper and its case); a helper that never worked here is the
   helper's bug.
   **`product` means Positron-owned behavior.** When the cause is in upstream VS Code code that
   Positron has not changed (`scripts/file-origin.sh <file>`, and no `// --- Start Positron ---`
   block around it), the helper adapts: the outcome is `fixed`, and the reason names the upstream
   cause.
5. **No sleeps, retries or longer timeouts to get a pass.** Waiting for a named condition the
   helper can observe is fine; waiting longer and hoping is not.
6. **Never loosen a smoke check.** If you change a check in `test/smoke.ts`, the reason must say
   which check, what it asserted before, and why the old assertion was wrong.
7. **Check your fix:** run the helper again on the kept instance; helper edits apply without a
   relaunch. Then stop the instance (smoke prints the `stop.sh` line) and run
   `node .claude/skills/drive-positron/test/check.ts`, which must pass. Do not replay smoke again,
   and do not commit: the workflow commits and reruns smoke.

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
      "reproduction": { "at": "<ISO time>", "by": "fixer", "result": "fail | pass", "observed": "what you saw" },
      "broke": "what stopped working, as the person using the helper sees it",
      "cause": "why, in one sentence",
      "change": "what the fix does differently (fixed only)"
    }

`reason` is for the next fixer and the reviewer. `broke`, `cause` and `change` lead the nightly
report, for a reader who has not seen the code: one plain sentence each, under about 25 words, no
JSON, file paths or line numbers. Name the helper and the user-visible effect, not the mechanism.
For example: "broke": "`terminal-run.sh --read` cannot read a terminal's text; the Accessible View
never opens.", "cause": "It pressed Alt+F2, which on Linux goes to the shell instead of Positron.",
"change": "It opens the Accessible View from the Command Palette instead."
