# Diff Analysis Workflow

## Extract the diff

The diff source depends on the input mode:

**If PR number (primary mode):**

These are fetched in the IMMEDIATE parallel launch (Message 1):
```bash
gh pr view <pr-number> --repo posit-dev/positron --json title,body,labels | head -100
gh pr diff <pr-number> --repo posit-dev/positron --name-only
```
**If `--branch` (no argument or a branch name):**
```bash
# Determine the target branch (default: current branch)
BRANCH=$(git rev-parse --abbrev-ref HEAD)  # or the specified branch name
COMMITS_AHEAD=$(git rev-list --count main..$BRANCH)

# File list for area mapping
git diff main...$BRANCH --name-only
```

## Fetch enrichment context (secondary signals)

Enrichment is fetched during the parallel launch in Step 2. These are secondary signals
that improve test plan quality but are not required:

```bash
# Issue context (only if --context <issue> flag was passed):
gh issue view <issue-number> --repo posit-dev/positron --json title,body,labels
```

PR metadata (`gh pr view`) is already fetched in the IMMEDIATE section -- do not
re-fetch it here.

The `--context` flag provides the "why" (bug report, expected behavior) while
the PR diff provides the "what" (code changes to exercise). Use both signals
when planning test steps.

If `--branch` mode without `--context`, the diff alone is sufficient.

## Classify changed files

Group each changed file into one of these categories:
- **User-facing**: `src/vs/workbench/**`, `extensions/**` -- behavioral code, test these
- **Shared component**: `src/vs/base/**`, `src/vs/platform/**`, shared dialogs/modals -- note blast radius
- **Test infrastructure**: `test/e2e/pages/**`, `test/e2e/tests/_verify/**` -- skip testing
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

Based on the analysis, generate 5-10 test steps. Apply these priorities:
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

## $pom references in args

When a POM method takes another POM as a parameter (e.g.,
`enablePositronNotebooks(settings)`), use `{"$pom": "<name>"}` in the args array.
The runner resolves it to the actual POM instance at runtime:
```json
{"type": "pom", "pom": "notebooksPositron", "method": "enablePositronNotebooks", "args": [{"$pom": "settings"}]}
```
This works for any POM name available on the workbench (settings, sessions, console, etc.).
