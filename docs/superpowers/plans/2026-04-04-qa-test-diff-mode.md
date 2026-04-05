# QA Test `--branch` Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `--branch` flag to the `/qa-test` skill that generates test plans from branch diffs with transparent reasoning.

**Architecture:** Modify the existing SKILL.md to add a `--branch` path in Step 1. The diff analysis runs as inline Claude reasoning (no new code files). All downstream steps (runner launch, execution, reporting) are unchanged.

**Tech Stack:** Git CLI, `gh` CLI, existing explore runner infrastructure.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `.claude/skills/qa-test/SKILL.md` | Modify | Add `--branch` input format, diff analysis instructions in Step 1 |
| `test/e2e/tests/explore/BACKLOG.md` | Modify | Add future work items from spec |

No new files needed. The diff analysis is Claude reasoning guided by skill instructions, not executable code.

---

### Task 1: Add `--branch` to Input Formats section

**Files:**
- Modify: `.claude/skills/qa-test/SKILL.md` (Input Formats section, ~lines 14-26)

- [ ] **Step 1: Add diff invocations to the Input Formats block**

In the `## Input Formats` section, add the `--branch` examples after the existing ones:

```markdown
## Input Formats

```
/qa-test "Verify that the Variables pane updates after running x = 42 in the Python console"
/qa-test #12345
/qa-test #12345 --deep
/qa-test --browser firefox #11593
/qa-test --build "Verify plots render correctly"
/qa-test --save #12345
/qa-test --no-save --build "Quick smoke test"
/qa-test --branch
/qa-test --branch --build
/qa-test --branch feature/my-branch
/qa-test --branch --save
```

- `--save`: Always save a `.test.ts` file after a successful run (no prompt)
- `--no-save`: Never save, never prompt
- No flag: Prompt the user to save after a successful run
- `--branch`: Generate test plan from branch diff vs main (see Step 1)
```

- [ ] **Step 2: Verify the edit is correct**

Read the modified section and confirm the new lines are in the right place and the markdown code fence is intact.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/qa-test/SKILL.md
git commit -m "feat(qa-test): add --branch invocations to input formats"
```

---

### Task 2: Add diff analysis path to Step 1

**Files:**
- Modify: `.claude/skills/qa-test/SKILL.md` (Step 1 section, after the "If issue number (default):" block, before "Generate POM reference if missing:")

- [ ] **Step 1: Add the `--branch` conditional block**

Insert a new `**If --branch flag:**` block in Step 1, after the existing issue-number blocks and before the POM reference generation. This is the core of the feature -- it tells Claude how to analyze the diff and generate a test plan.

Add this block right before the `**Generate POM reference if missing:**` line:

````markdown
**If --branch flag:**

Analyze the current branch's changes vs main to generate a test plan. The diff is the
primary signal -- PR context is enrichment only.

1. **Extract the diff:**
```bash
# Get branch name and commit count
BRANCH=$(git rev-parse --abbrev-ref HEAD)
COMMITS_AHEAD=$(git rev-list --count main..HEAD)

# File list for area mapping
git diff main...HEAD --name-only

# Full diff for semantic analysis (cap at 2000 lines to stay focused)
git diff main...HEAD | head -2000
```

2. **Fetch PR context (secondary signal, if available):**
```bash
gh pr view --json title,body,number,comments 2>/dev/null
```
If no PR exists, skip -- the diff alone is sufficient.

3. **Classify changed files:**

Group each changed file into one of these categories:
- **User-facing**: `src/vs/workbench/**`, `extensions/**` -- behavioral code, test these
- **Shared component**: `src/vs/base/**`, `src/vs/platform/**`, shared dialogs/modals -- note blast radius
- **Test infrastructure**: `test/e2e/pages/**`, `test/e2e/tests/explore/**` -- skip testing
- **Build/CI**: `build/**`, `scripts/**`, `.github/**` -- skip testing
- **Docs only**: `*.md`, `*.txt` -- skip testing

4. **Analyze diff hunks for user-facing files:**

For each user-facing file, read the actual diff hunks and determine:
- What methods, components, or behaviors were added, changed, or removed
- Whether the change is behavioral (logic) vs cosmetic (CSS, labels, strings)
- Whether it touches error handling, timeouts, or state management
- Blast radius: does this file affect shared components used by other features?

5. **Show transparent analysis to the user:**

Print this analysis BEFORE generating the test plan so the user sees exactly what
drove the plan. Use this format:

```
## Diff Analysis: <branch-name> (<N> commits ahead of main)

### Changes detected (user-facing)
- `src/.../file.ts`: <what changed -- e.g., "Added timeout parameter to show() method">
- `src/.../other.ts`: <what changed>

### Infrastructure changes (not testing)
- `test/e2e/pages/variables.ts`: POM update
- `build/gulpfile.js`: Build config

### Blast radius
- <area> (<reason> -- e.g., "shared modal component used by 4 dialogs")
- <area> (<reason>)

### PR context (secondary signal)
- PR #<number>: "<title>"
- <summary of body if relevant>
- Comments: <count> (<brief note if any mention blast radius or related areas>)
```

If the branch has NO user-facing changes (only infrastructure/docs), tell the user:
```
No user-facing changes detected on this branch. All changes are in test
infrastructure, build scripts, or documentation. Nothing to test with the
explore runner.
```

6. **Generate test plan:**

Based on the analysis, generate 3-8 test steps using the same format as the
free-text path. Apply these priorities:
- **Deep tests first**: Exercise the specific new/modified behavior and edge cases
- **Smoke tests second**: Quick happy-path checks for blast radius areas
- **Suggest existing tests**: If you spot existing test files that cover the changed
  areas (e.g., `test/e2e/tests/variables/variables-filter.test.ts`), mention them:
  ```
  Existing tests that cover this area (run separately):
  - test/e2e/tests/variables/variables-filter.test.ts
  - test/e2e/tests/data-explorer/data-explorer-summary.test.ts
  ```

Then continue to Step 2 (Start the Explore Runner) as normal. The diff analysis
replaces the free-text/issue parsing -- everything downstream is identical.
````

- [ ] **Step 2: Verify the edit integrates correctly**

Read the full Step 1 section and confirm:
- The `--branch` block appears after the issue-number blocks
- The `**Generate POM reference if missing:**` block still follows after
- No existing blocks were accidentally removed
- The markdown nesting and code fences are correct

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/qa-test/SKILL.md
git commit -m "feat(qa-test): add --branch analysis path to Step 1"
```

---

### Task 3: Handle `--branch` in ARGUMENTS parsing

**Files:**
- Modify: `.claude/skills/qa-test/SKILL.md` (the ARGUMENTS line at the very end, and the Step 0 section)

- [ ] **Step 1: Update ARGUMENTS documentation**

The skill receives arguments via the `ARGUMENTS:` line at the top of the loaded skill. The `--branch` flag needs to be recognized in the same way `--build`, `--save`, `--browser` are. No code change needed -- the skill is a prompt, and Claude parses the arguments naturally. But we should update Step 0 to handle `--branch` properly.

Add to Step 0 ("Choose Target"), right after the `--build` handling:

```markdown
If `--branch` flag is present, this is a diff-based test. The branch to analyze defaults
to the current branch. If a branch name follows `--branch` (e.g., `--branch feature/my-branch`),
use that branch instead. The `--branch` flag composes with all other flags:
- `--branch --build`: Analyze diff, run tests against built app
- `--branch --save`: Analyze diff, auto-save test file
- `--branch --browser firefox`: Analyze diff, run in Firefox

If `--branch` is used without `--build`, ask the user which target to run against
(same as the default flow).
```

- [ ] **Step 2: Verify the edit is in the right place**

Read Step 0 and confirm the `--branch` handling appears logically after the `--build` handling and before Step 1.

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/qa-test/SKILL.md
git commit -m "feat(qa-test): handle --branch flag in Step 0 target selection"
```

---

### Task 4: Add future work items to backlog

**Files:**
- Modify: `test/e2e/tests/explore/BACKLOG.md`

- [ ] **Step 1: Add a new section for diff-mode future work**

Add a `## Diff Mode (Future)` section at the end of the backlog file:

```markdown
## Diff Mode (Future)

- [ ] **File-to-area mapping file for CI automation.**
  A structured JSON mapping from path patterns to test areas (e.g.,
  `src/vs/workbench/contrib/positronVariables/**` -> `variables`).
  Enables deterministic file classification without AI reasoning.
  Required for GitHub Action integration where there is no AI in the loop.

- [ ] **Existing test discovery.**
  Automatically grep test files for changed method/component names and suggest
  re-running those existing e2e tests before generating new exploratory ones.
  Fastest signal for regressions.

- [ ] **GitHub Action integration.**
  Run `--branch` mode automatically on PRs and post results as an advisory PR comment.
  Depends on the file-to-area mapping file for deterministic behavior.

- [ ] **Cross-PR release testing.**
  Analyze all PRs merged since the last release tag to generate a comprehensive
  regression test plan covering all changed areas.
```

- [ ] **Step 2: Commit**

```bash
git add test/e2e/tests/explore/BACKLOG.md
git commit -m "docs(explore-runner): add diff-mode future work to backlog"
```

---

### Task 5: Smoke test the `--branch` flag

This is a manual verification that the skill works end-to-end.

- [ ] **Step 1: Run the skill with `--branch`**

Invoke: `/qa-test --branch --build`

This should:
1. Show the diff analysis for the current branch (`feature/explore-runner-qa`)
2. Identify user-facing changes vs infrastructure changes
3. Generate a test plan from the analysis
4. Launch the explore runner and execute the plan
5. Report results

- [ ] **Step 2: Verify the transparency output**

Confirm the analysis output shows:
- Changed files grouped by category
- Infrastructure files marked as "not testing"
- Blast radius notes if applicable
- PR context if the branch has an open PR

- [ ] **Step 3: Verify test execution**

Confirm the generated test plan:
- Has 3-8 concrete steps
- Targets the actual changes on the branch
- Runs successfully through the explore runner

- [ ] **Step 4: Commit any final adjustments**

If the smoke test reveals issues with the skill instructions (wrong wording, missing edge case), fix them and commit:

```bash
git add .claude/skills/qa-test/SKILL.md
git commit -m "fix(qa-test): adjust --branch instructions based on smoke test"
```
