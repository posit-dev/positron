---
name: pete
description: Preview the test-coverage verdict PETE will post, locally, before a PR exists. PETE is Positron's CI "PR Test Checker": it grades whether a PR adds adequate tests for its source changes and posts a verdict comment. This skill replays the same rubric and file classification against your working tree (committed + uncommitted + untracked changes vs the merge-base with the default branch) and renders the verdict in-session -- it posts nothing and needs no network or gh. Use when asked to "run PETE" / "run PETE locally", to preview or check test coverage before opening or pushing a PR, to see whether the current branch has adequate tests, or to anticipate what PETE / the PR Test Checker will say.
---

# PETE (local preview)

You produce a **local preview** of PETE's test-coverage verdict for the current git branch, before a PR exists. You do the grading yourself in this session -- there is no Agent SDK and no separate API key involved.

This preview shares its rubric and file classification with the CI workflow, so the substance should track what PETE eventually posts. It is **not** authoritative and posts nothing: the PR Test Checker workflow remains the official grader.

## Steps

Do these in order.

1. **Gather context** (deterministic, shared with CI). From the repo root, run:

   ```
   node .claude/skills/pr-test-checker/scripts/gather-local-context.mjs "$TMPDIR/pete-context.json"
   ```

   Use any writable temp path for the output (e.g. the OS temp dir); just keep it consistent below. The script reads the working tree (committed + uncommitted + untracked) against the merge-base with the default branch -- no `gh`, no network. It prints a one-line summary ending in `skip=...`.

2. **Handle the skip pre-filter.** If the script reports `skip=<reason>` (anything other than `skip=no`), it also wrote a `comment.md` next to the context file. Read that `comment.md` and present it (it is the same static "Not applicable" verdict CI would post). Its footer is an HTML `<sub>...</sub>` line meant for GitHub; since this renders in Claude Code, present that footer line as plain markdown italic (drop the `<sub>` tag) so it doesn't show up as a literal tag. Then stop -- do not grade further.

3. **Read the rubric.** Otherwise, `Read` the shared rubric at `.claude/skills/pr-test-checker/SKILL.md`. That file is the single source of truth for the taxonomy, cost guidance, deployment coverage, decision rule, investigation steps, verdict table, output template, and constraints. Follow it exactly.

4. **Read the gathered context.** `Read` the `pete-context.json` you wrote in step 1. It contains the change metadata, the pre-classified file list (`files[].category`), and the diff. Treat this as the "Inputs you'll receive" the rubric describes. The repo checkout you Read/Grep/Glob is the current working tree.

5. **Grade.** Carry out the rubric's Investigation steps against the diff and the working tree, then produce the verdict in the rubric's exact Output-format template. Honor every Constraint (cite real files only, one verdict, keep it under ~80 lines, etc.).

6. **Swap the footer for a local-preview note.** The rubric's output template ends with a CI footer (an HTML `<small>...</small>` line that mentions `/recheck-tests`). Neither applies locally, and this report renders in Claude Code -- not on GitHub -- where raw HTML like `<small>` shows up literally instead of rendering. So drop the `<small>` tag and use plain markdown italic. Replace that final footer line with:

   ```
   _PETE local preview -- not posted to any PR. Graded from your working tree (HEAD vs the merge-base with the default branch). CI PETE grades on Opus; on a different model the verdict may differ. Open a PR to get the official PETE check._
   ```

7. **Present, don't post.** Output the rendered report to the user in this session. Do not create a PR comment or run any `gh` command.

## Notes

- This is a working-tree preview: it includes uncommitted and untracked changes, so a brand-new test file you have not committed yet still counts. The eventual PR diff may differ slightly once you commit and push.
- If you are not running on an Opus model, say so briefly when presenting -- the CI grader uses Opus and a borderline verdict can shift between models.
