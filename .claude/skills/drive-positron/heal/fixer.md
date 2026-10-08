# drive-positron fixer

You get one finding about drive-positron's helpers. Decide what it is, and fix it only if it is a
helper bug. A finding is usually one instance of a bug class: fix the class, so the next night
does not find the same bug in a sibling helper. Read `.claude/skills/drive-positron/SKILL.md` and
`CONTRIBUTING.md` first; CONTRIBUTING
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
6. **Never loosen a check.** `test/` and `heal/` hold the checks your fix is judged by; a change
   there is flagged at the top of the report. If you change one, `checks` says which check, what it
   asserted before, and why the old assertion was wrong, in one or two sentences.
7. **Check your fix:** run the helper again on the kept instance; helper edits apply without a
   relaunch. Then stop the instance (smoke prints the `stop.sh` line) and run
   `node .claude/skills/drive-positron/test/check.ts`, which must pass (apart from checks the brief
   says already fail without your fix). You may run `smoke.ts --until "<your new case>"` once to
   see the case pass; otherwise do not replay smoke, and do not commit: the workflow commits and
   reruns smoke.
8. **Fix the class, in the shared code.** Before editing, look for the same mistake in the other
   helpers (`grep` the pattern across `scripts/`) and in the shared modules (`scripts/dp-lib.ts`
   and the `dp-*.ts` it imports). When the shared code is where it goes wrong, or where it should
   be handled for everyone (argument parsing, number and duration flags, session lookup), fix it
   there and let the callers inherit it; do not patch one caller. Reuse the existing helpers
   (`parse()`, `seconds()`, `count()` in `dp-lib.ts`) rather than writing a local copy. Your
   reason names every helper the fix reaches.
9. **Valid input keeps working.** A command that worked before with valid input must behave the
   same after your fix. If it cannot (a flag that was silently ignored now errors), the reason says
   which helpers and inputs change, in one line.
10. **Add a smoke case for every fix.** In `test/smoke.ts`, add a case in the helper's section that
    fails without your fix: a failure case (`fail: true`, with a `check` on the error text) for
    bad input, a normal case for broken behavior. Add cases; do not edit existing ones. A fix that
    changes `scripts/` and adds no case is rejected. Write each case on one line, like the ones
    around it. If no smoke case can show the bug (it only
    happens on another platform, or needs state smoke cannot build), set `untestable` to why.
11. **Only a real run adds a feature.** A finder finding with no `lead` came from exploring, not
    from a real run: fix what is wrong on a path the helper already offers, but add no flag,
    command or accepted form. If only a new one would fix it, make the helper fail loud with a
    sentence saying what it cannot do, instead.
12. **Close what your fix covers.** The brief lists tonight's other open findings. When your fix
    also fixes one of them, run that finding's steps again after your fix and, if it now passes,
    put its id in `covers`. List only finder ids you re-ran; a smoke finding closes when its own
    case passes in the post-fix run, so leave it out.
13. **A review may send your change back once.** The brief then ends with the reviewer's notes and
    your change is still in the tree. Act on the notes that are right, keep the rest of the rules,
    and write the outcome file again; your `reason` names any note you did not act on and why.

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
      "change": "what the fix does differently (fixed only)",
      "untestable": "why no smoke case can show this bug (only when you add none)",
      "checks": "the check you changed under test/ or heal/, what it asserted, and why (only when you change one)",
      "covers": ["ids of other open findings your fix fixes, each re-run after the fix"]
    }

`reason` is for the next fixer and the reviewer. `broke`, `cause` and `change` lead the nightly
report, for a reader who has not seen the code: one plain sentence each, under about 25 words, no
JSON, file paths or line numbers. Name the helper and the user-visible effect, not the mechanism.
For example: "broke": "`terminal-run.sh --read` cannot read a terminal's text; the Accessible View
never opens.", "cause": "It pressed Alt+F2, which on Linux goes to the shell instead of Positron.",
"change": "It opens the Accessible View from the Command Palette instead."
