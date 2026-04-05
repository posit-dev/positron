# QA Test Diff Mode (`--diff`)

Add a `--diff` flag to the existing `/qa-test` skill that generates test plans from branch diffs instead of issue descriptions or free text.

## Problem

The current `/qa-test` skill requires either an issue number or a free-text description. When working on a branch:
- Looking up the issue number is friction when you're already on the branch
- The issue-based flow mixes signals (issue body, comments, PR description, diff) with no transparency into what drove the test plan
- Many PRs don't have linked issues (refactors, small fixes, dependency bumps)

The diff is the ground truth of what changed. It should be a first-class entry point.

## Invocation

```
/qa-test --diff                    # current branch vs main, local dev
/qa-test --diff --build            # current branch vs main, built app
/qa-test --diff feature/my-branch  # specific branch vs main
/qa-test --diff --save             # auto-save test file after
```

All existing flags (`--build`, `--save`, `--no-save`, `--browser`) compose with `--diff`.

## Design

### Signal hierarchy

The diff analysis uses a layered signal model with explicit separation:

1. **Primary signal (always used):** The git diff -- changed files, diff hunks, added/removed/modified methods and components.
2. **Secondary signal (enrichment):** PR title and body if the branch has an open PR. Provides intent -- why the change was made. Labeled separately in the output.
3. **Tertiary signal (enrichment):** Issue body if linked from the PR. Provides broader context. Labeled separately.

Comments are included as enrichment context but labeled distinctly so the user can see their influence on the plan.

### Diff analysis (lean v1)

No mapping files or structured classification. Claude reads the diff directly and reasons about what to test.

**Step 1: Extract the diff**
```bash
git diff main...HEAD --name-only    # file list
git diff main...HEAD                # full diff for semantic analysis
```

If the branch has an open PR:
```bash
gh pr view --json title,body,number
```

**Step 2: Analyze and categorize**

Claude reads the diff hunks and determines:
- What files changed, grouped by area (variables, console, data explorer, etc.)
- What specifically changed in each file (new methods, modified logic, CSS-only, etc.)
- Whether changes are user-facing (behavioral) vs infrastructure (test code, build scripts)
- Blast radius -- shared components, base classes, or utilities that affect multiple features

**Step 3: Show transparent analysis**

Before generating the test plan, show the user exactly what was detected:

```
## Diff Analysis: feature/fix-summary-panel (3 commits ahead of main)

### Changes detected
- `src/.../dataExplorer.ts`: Added `show()` position parameter (left|right)
- `src/.../summaryPanel.ts`: New `clearSearch()` method, updated `search()` filter logic
- `test/e2e/pages/dataExplorer.ts`: Updated POM to match (test infra -- not testing)

### Blast radius
- Summary panel positioning (new parameter)
- Summary panel search/filter (logic change)
- No shared components affected

### PR context (secondary signal)
- PR #4567: "Add left/right positioning to summary panel"
- No reviewer comments yet
```

**Step 4: Generate test plan**

Convert the analysis into concrete test steps for the explore runner. Show the plan before running:

```
### Proposed test plan (6 steps)
1. Open Data Explorer with a DataFrame
2. Show summary panel (default position)
3. Show summary panel on right side
4. Search for a column in summary panel
5. Clear search filter
6. Verify column count unchanged after filter operations
```

### Tiered test strategy

The generated plan uses three tiers based on what changed:

- **Deep tests**: For the actual changed code. Exercises the specific new/modified behavior and its edge cases.
- **Smoke tests**: For blast radius areas. Quick happy-path checks that adjacent features still work.
- **Existing test suggestions**: List paths to existing e2e test files that cover the changed areas, so the user can run them separately if desired.

### User confirmation

After showing the analysis and proposed plan, proceed to run immediately (same as free-text mode today). The transparency output is informational -- it shows reasoning, not a gate. If the user wants to adjust, they can re-run with a modified description that steers the plan.

### Skill integration

The `--diff` flag adds a new path in Step 1 of the qa-test skill ("Parse Input and Plan Test Steps"). Everything downstream -- runner launch, `/run-plan` execution, reporting, save prompt -- is unchanged.

```
Step 1 (modified):
  If --diff:
    1. Extract diff (git diff main...HEAD)
    2. Fetch PR context if available (gh pr view)
    3. Analyze diff and show transparent summary
    4. Generate test plan from analysis
    5. Show plan to user before running
  Else if issue number: (existing flow)
  Else if free text: (existing flow)

Steps 2-6: unchanged
```

### What the diff mode skips

Infrastructure-only changes are identified and excluded from the test plan:
- `test/e2e/pages/**` -- POM changes (test infrastructure)
- `test/e2e/tests/explore/**` -- explore runner changes
- `build/**`, `scripts/**` -- build infrastructure
- `.github/**` -- CI configuration
- `*.md` -- documentation only

These are listed in the analysis output as "not testing" so the user sees they were considered.

## Future work (backlog)

- **File-to-area mapping file**: A structured JSON mapping from path patterns to test areas. Enables deterministic classification without AI reasoning. Required for CI automation where there's no AI in the loop.
- **Existing test discovery**: Automatically find and suggest re-running existing e2e tests that cover the changed code (grep test files for changed method/component names).
- **GitHub Action integration**: Run `--diff` mode automatically on PRs and post results as an advisory PR comment. Depends on the mapping file for deterministic behavior.
- **Cross-PR analysis**: For release testing, analyze all PRs merged since the last release to generate a comprehensive regression test plan.
