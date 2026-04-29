---
name: audit-test-coverage
description: Use to audit test coverage for a Positron change - review whether existing tests are in the right bucket, whether new coverage is needed, and produce an explicit verdict per item. Triggers include "audit coverage for <feature>", "is my test placement right", "quality-check before merge", "are these e2e tests carrying their weight", "what coverage does this PR need", or as part of pre-PR review. Produces a cross-bucket test coverage audit (Core Mocha / Vitest / Extension host / E2E) with explicit verdicts (Keep / Move down / Move up / Split / Add / Delete / Skip) and confidence per item. Optionally orchestrates handoff to author-vitest-tests and author-e2e-tests.
---

# Audit Test Coverage (Positron)

Audit a Positron change - review whether existing tests are in the right bucket, whether new coverage is needed, and produce an explicit verdict per item. The report is the deliverable. Bias hard against E2E: push coverage down the pyramid unless the test genuinely needs the full app. Hand off to the right author-* skill only if the dev opts in.

## Arguments

`$ARGUMENTS` accepts six entry points; the workflow shape varies by what you target.

- **Source file** (e.g., `src/vs/.../myComponent.tsx`) - find existing tests that reference this file and audit each; identify gaps in new coverage. Both halves of the report populated.
- **Test file** (e.g., `test/e2e/tests/console/console-clear.test.ts`, `src/vs/.../foo.vitest.ts`, `extensions/positron-r/src/test/foo.test.ts`) - the test IS the subject. Skip Step 2 (no source changes to enumerate). Step 4 is the whole job: trace assertions, run 4B-verify, produce a verdict for the test. The "New coverage needed" half is empty unless the trace surfaces an underlying gap.
- **Test directory** (e.g., `test/e2e/tests/notebooks-positron/`) - sweep audit; same workflow as test-file repeated across files in the directory.
- **`--branch <branch-name>`** - analyze all changes on a branch vs `main`. Audit tests for every changed source file.
- **PR number** (e.g., `#12242` or `12242`) or **PR URL** - same as `--branch`, resolved via `gh pr diff`.
- **Freeform feature area** (e.g., "console clear handling") - search for anchor files; if ambiguous, ask the dev. Resolves to one of the above. Counts as 1 of 2 allowed clarifying questions.

Test-as-target is a first-class entry point - it codifies the per-test inspection pattern for any test, on demand.

## Starting state

- The dev has one of the inputs above and wants to know where tests should live.
- Adjacent skills exist and MUST be used for the writing step, not re-implemented here: `author-vitest-tests`, `author-e2e-tests`, `review-vitest-tests`.
- CLAUDE.md Testing section (post-#13033) is authoritative for the decision table. Read it at the start of every run.

## Target state

A test coverage audit the dev has reviewed, with each item carrying an explicit verdict (`Keep` / `Move down` / `Move up` / `Split` / `Add` / `Delete` / `Skip`) and confidence (`high` / `medium` / `low`). The dev either (a) approves and hands off to an `author-*` skill, (b) queues a move proposal for human follow-up, or (c) explicitly skips. This skill writes no test files itself.

## Workflow

### Step 1. Resolve input -> concrete subject (silent)

- **Source file** -> read it directly. Subject = the source file.
- **Test file** -> read it directly. Subject = the test file. Workflow shifts: skip Step 2; Step 4 is the deliverable.
- **Test directory** -> list test files in the directory. Subject = the set of test files. Workflow shifts as for test-file, repeated.
- **PR** -> `gh pr view <n> --json files,title,body`, then `gh pr diff <n>`. Subject = changed source files.
- **`--branch <name>`** -> `git fetch origin <name> && git diff main...origin/<name>`. Subject = changed source files.
- **Freeform feature area** -> search for anchor files (Glob/Grep); if ambiguous, ask the dev. Resolves to one of the above. Counts as 1 of 2 clarifying questions.

Report a one-line summary of what was gathered, including which entry-point shape applies, before continuing.

### Step 2. Enumerate testable behaviors

**Skip this step entirely if the input is a test file or test directory** - there are no source changes to enumerate. Go straight to Step 4 (audit), which becomes the deliverable.

For source-file / branch / PR / feature-area inputs: for each changed file/symbol, list discrete behaviors that merit a test. Skip: pure renames, type-only edits, comment-only changes, trivial glue, config, docs, action-only files, files with reverted changes.

### Step 3. Classify each behavior into a bucket

Read the Testing section of `CLAUDE.md` at the start of every run. It is the single source of truth for the decision table. Apply the table in order; stop at the first match.

Tiebreakers beyond the table:
- **Lowest bucket that covers the behavior wins.**
- **If in doubt between two buckets, pick the lower one** and note the reasoning. The dev can override at the gate.
