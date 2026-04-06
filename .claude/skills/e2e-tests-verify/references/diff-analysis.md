# Diff Analysis Workflow

## Extract the diff

The diff source depends on what argument was passed to `--branch`:

**If no argument or a branch name:**
```bash
# Determine the target branch (default: current branch)
BRANCH=$(git rev-parse --abbrev-ref HEAD)  # or the specified branch name
COMMITS_AHEAD=$(git rev-list --count main..$BRANCH)

# File list for area mapping
git diff main...$BRANCH --name-only

# Full diff for semantic analysis (cap at 2000 lines to stay focused)
git diff main...$BRANCH | head -2000
```

**If an issue number (e.g., `--branch #9638`):**
```bash
# Find the PR that closed this issue
gh pr list --search "9638" --state all --repo posit-dev/positron --json number,title,headRefName --limit 5

# Get the diff from the most relevant PR
gh pr diff <pr-number> --repo posit-dev/positron | head -2000

# Get file list
gh pr diff <pr-number> --repo posit-dev/positron --name-only
```

## Fetch enrichment context (secondary signals, if available)

```bash
# PR context (auto-detected from branch, or already known from issue resolution)
gh pr view --json title,body,number,comments 2>/dev/null

# Issue context (if issue number was passed with --branch)
gh issue view <number> --repo posit-dev/positron --json title,body,labels 2>/dev/null
```
If no PR exists and no issue number was passed, skip -- the diff alone is sufficient.

## Classify changed files

Group each changed file into one of these categories:
- **User-facing**: `src/vs/workbench/**`, `extensions/**` -- behavioral code, test these
- **Shared component**: `src/vs/base/**`, `src/vs/platform/**`, shared dialogs/modals -- note blast radius
- **Test infrastructure**: `test/e2e/pages/**`, `test/e2e/tests/explore/**` -- skip testing
- **Build/CI**: `build/**`, `scripts/**`, `.github/**` -- skip testing
- **Docs only**: `*.md`, `*.txt` -- skip testing

## Analyze diff hunks for user-facing files

For each user-facing file, read the actual diff hunks and determine:
- What methods, components, or behaviors were added, changed, or removed
- Whether the change is behavioral (logic) vs cosmetic (CSS, labels, strings)
- Whether it touches error handling, timeouts, or state management
- Blast radius: does this file affect shared components used by other features?

## Show transparent analysis to the user

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

### Issue context (if provided)
- Issue #<number>: "<title>"
- <summary of expected behavior from issue body>
```

If the branch has NO user-facing changes (only infrastructure/docs), tell the user:
```
No user-facing changes detected on this branch. All changes are in test
infrastructure, build scripts, or documentation. Nothing to test with the
explore runner.
```

## Generate test plan priorities

Based on the analysis, generate 5-10 test steps (or 10-15+ if `--deep` was passed).
Apply these priorities:
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

## Check existing tests for setup patterns

Before generating the test, look for existing test files in the same feature area
to discover required setup (feature flags, settings, fixtures, beforeAll hooks).

```bash
# Find existing tests in the area. Map the changed component to a test directory:
#   notebooks/positron -> test/e2e/tests/notebooks-positron/
#   dataExplorer       -> test/e2e/tests/data-explorer/
#   variables          -> test/e2e/tests/variables/
#   console            -> test/e2e/tests/console/
#   plots              -> test/e2e/tests/plots/
ls test/e2e/tests/<area>/*.test.ts 2>/dev/null | head -3
```

Read one or two of those files (just the imports and beforeAll/beforeEach hooks, not
the full test bodies) to identify setup patterns. Common patterns to look for:
- `enablePositronNotebooks(settings)` -- Positron notebooks behind feature flag
- `settings.set({...})` -- feature flags or configuration
- `assistant.loginModelProvider(...)` -- AI provider setup

## $pom references in args

When a POM method takes another POM as a parameter (e.g.,
`enablePositronNotebooks(settings)`), use `{"$pom": "<name>"}` in the args array.
The runner resolves it to the actual POM instance at runtime:
```json
{"type": "pom", "pom": "notebooksPositron", "method": "enablePositronNotebooks", "args": [{"$pom": "settings"}]}
```
This works for any POM name available on the workbench (settings, sessions, console, etc.).
- Custom fixtures (`python`, `r`, `sessions`) in the test signature

Apply the same setup patterns in the generated test. If an existing test uses
`enablePositronNotebooks` in `beforeAll`, the generated test needs it too.
