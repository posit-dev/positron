# e2e-verify Parallel Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the e2e-verify skill to launch runner, POM ref generation, and GH API calls in parallel, and switch from issue-first to PR-first input model.

**Architecture:** Reorder skill instructions so Claude fires all independent IO in a single tool-call message. The runner boots (30-60s) while GH calls and POM ref gen complete in the background. Input model changes from issue numbers to PR numbers with optional `--context` for issue enrichment.

**Tech Stack:** Markdown skill files (no code changes -- these are Claude prompts)

**Spec:** `docs/superpowers/specs/2026-04-08-e2e-verify-parallel-pipeline-design.md`

---

### Task 1: Update Input Formats and Flag Documentation

**Files:**
- Modify: `.claude/skills/e2e-tests-verify/SKILL.md:13-36` (Input Formats section + flag docs)

- [ ] **Step 1: Replace the Input Formats section**

Replace the entire `## Input Formats` block (lines 13-36) with the new PR-first input model and updated flags:

````markdown
## Input Formats

```
/e2e-verify 456                            PR diff, prompt for target
/e2e-verify 456 --local                    PR diff, local dev
/e2e-verify 456 --build --no-save          PR diff, built app, CI-friendly
/e2e-verify 456 --context 12345 --deep     PR diff + issue enrichment, exhaustive
/e2e-verify --branch --local               Branch diff, local dev
/e2e-verify --branch feature/my-branch     Named branch diff
/e2e-verify "free text" --build            Description, built app
/e2e-verify --save 456                     PR diff, auto-save test file
/e2e-verify --browser firefox 456          PR diff, Firefox
```

**Target (mutually exclusive):**
- `--local`: Run against local dev instance, skip prompt
- `--build`: Run against `/Applications/Positron.app`, skip prompt
- No flag: Prompt the user to choose

**Save behavior (mutually exclusive):**
- `--save`: Always save a `.test.ts` file after a successful run (no prompt)
- `--no-save`: Never save, never prompt
- No flag: Prompt the user to save after a successful run

**Other flags:**
- `--branch`: Test current branch's changes vs main. Optionally pass a branch name (e.g., `--branch feature/my-branch`)
- `--deep`: Exhaustive mode -- gathers all signals and generates a thorough test plan (10-15+ steps with edge cases). Without this flag, tests are diff-driven and targeted (5-10 steps)
- `--context <issue>`: Pull issue body as enrichment for test planning. Does not resolve the issue to a PR -- use this alongside a PR number for richer context
- `--browser <name>`: Firefox, Chromium, or WebKit instead of Electron

**Input types:**
- **PR number** (e.g., `456`): Primary mode. Gets diff and metadata directly via `gh pr diff` and `gh pr view`. Numbers are always treated as PR numbers. If `gh pr view` fails, error immediately -- no fallback to issue search.
- **Branch diff** (`--branch`): Uses `git diff main...HEAD` (or named branch vs main)
- **Free-text description** (quoted string): No diff, no GH calls. AI plans from description alone.
````

- [ ] **Step 2: Verify the change reads correctly**

Read the modified section back and confirm:
- No mention of issue numbers as primary input
- `--local` flag documented
- `--context` flag documented with clear explanation
- Error behavior for invalid PR number documented

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/e2e-tests-verify/SKILL.md
git commit -m "refactor(e2e-verify): update input formats to PR-first model

Add --local and --context flags. Numbers are now always treated as PR
numbers. Issue enrichment is available via --context but issues are
never used as diff source."
```

---

### Task 2: Rewrite Step 0 (Choose Target)

**Files:**
- Modify: `.claude/skills/e2e-tests-verify/SKILL.md:40-80` (Step 0 section)

- [ ] **Step 1: Replace the Step 0 section**

Replace the entire `### Step 0: Choose Target` block (lines 40-80) with:

````markdown
### Step 0: Choose Target

**If `--build` flag is present:** Skip the prompt and use build mode.
**If `--local` flag is present:** Skip the prompt and use local dev mode.

If neither `--build` nor `--local` is present, **ask the user** which target to run against using `AskUserQuestion`:
- **Local dev instance (Recommended)** -- runs against the local development build (default, no extra setup)
- **Built app** -- runs against an installed Positron build (e.g. `/Applications/Positron.app` on macOS)

**When running in build mode:**

1. Set `BUILD=/Applications/Positron.app` (macOS) in the Playwright launch command in Step 2.

2. Log the version of the built app before starting:
```bash
.claude/skills/e2e-tests-plan/scripts/detect_versions.sh
```
Report to the user: `Target: Built app -- Positron 2026.02.0 (build 10), macOS 26.2`

**When running in local dev mode:**
Report to the user: `Target: Local dev instance`
````

- [ ] **Step 2: Verify the change**

Read modified section and confirm:
- `--local` and `--build` both skip prompt
- Neither flag triggers the AskUserQuestion prompt
- `--branch` flag logic is NOT in Step 0 (moved to Step 1)

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/e2e-tests-verify/SKILL.md
git commit -m "refactor(e2e-verify): add --local flag to Step 0 target selection

--local and --build both skip the target prompt. Default (no flag)
still prompts. Branch flag logic moved to Step 1."
```

---

### Task 3: Rewrite Step 1 (Parse Input) -- PR-First

**Files:**
- Modify: `.claude/skills/e2e-tests-verify/SKILL.md:84-143` (Step 1 section)

- [ ] **Step 1: Replace the Step 1 section**

Replace the entire `### Step 1: Parse Input and Plan Test Steps` block (lines 84-143, up to but not including the Testability Check) with:

````markdown
### Step 1: Parse Input and Plan Test Steps

**If free-text description:**
Parse into 5-10 concrete, ordered test steps. Each step becomes one entry in the `/run-plan` steps array. Skip to Step 2 (no GH calls needed).

**If PR number (default -- diff-driven):**

PR context and diff are fetched in Step 2 as part of the parallel launch. After those results land:

1. **Validate the PR exists.** If `gh pr view` failed, error immediately:
   ```
   No PR found for #456. Pass a PR number, or use --branch to test local changes.
   ```
2. **Validate testability** (see below)
3. Analyze the diff and show transparent reasoning (see diff analysis workflow in `references/diff-analysis.md`)
4. Generate 5-10 test steps from the diff analysis

**If PR number with `--context <issue>`:**

Same as above, but the issue body (fetched in parallel during Step 2) is used as
enrichment for test planning. The issue provides the "why" (bug report, expected
behavior) while the PR diff provides the "what" (code changes to exercise).

**If PR number with `--deep`:**
1. Fetch ALL context: PR diff, PR body, PR comments, plus issue body if `--context` provided
2. **Validate testability** (see below)
3. Show transparent analysis with all signals labeled
4. Generate an exhaustive test plan: 10-15+ steps with edge cases, blast radius
   smoke tests, and regression checks

**If `--branch` flag:**

The diff comes from git, not GitHub:
- **No argument** (`--branch`): `git diff main...HEAD` on current branch
- **Branch name** (`--branch feature/my-branch`): `git diff main...<branch>`

For the full diff analysis workflow, see `references/diff-analysis.md`.

**Feature flag detection (always do this):**

After identifying the changed files, check if any require feature flags to be enabled.
These are path-based rules -- if the PR touches files under these paths, add the
corresponding setup step to the test plan:

| Changed file path contains | Required setup |
|---------------------------|----------------|
| `positronNotebook/browser/` | `enablePositronNotebooks({"$pom": "settings"})` |
| `positron.environments` or `positronVariables` | `settings.set({"positron.environments.enable": true}, {"reload": true})` |

Also check existing tests in the same area (see `references/diff-analysis.md` --
"Check existing tests for setup patterns") for any other setup requirements.

**Shared test references:**

When generating tests or choosing POM methods, consult these shared reference docs:
- `../shared-e2e-references/test-conventions.md` -- imports, suiteId, commenting style, test.step() rules
- `../shared-e2e-references/pom-patterns.md` -- POM method selection, confusable methods, POM-first rules
- `../shared-e2e-references/common-mistakes.md` -- 32 gotchas to avoid

**CRITICAL:** Follow all POM method selection rules in `../shared-e2e-references/pom-patterns.md`.
````

- [ ] **Step 2: Verify the change**

Read modified section and confirm:
- No mention of `gh pr list --search` or issue-to-PR resolution
- PR context fetching is deferred to Step 2 (parallel launch)
- `--context` documented as enrichment only
- `--branch #9638` syntax removed (branch only takes branch names, not issue numbers)
- `--deep` works with PR number, not issue number
- Feature flag detection and shared references unchanged

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/e2e-tests-verify/SKILL.md
git commit -m "refactor(e2e-verify): rewrite Step 1 for PR-first input model

Numbers are always PR numbers. Issue resolution removed. Context
fetching deferred to Step 2 parallel launch. --branch only accepts
branch names, not issue numbers."
```

---

### Task 4: Restructure Step 2 (Parallel Launch Pipeline)

**Files:**
- Modify: `.claude/skills/e2e-tests-verify/SKILL.md:199-209` (Step 2 section)

- [ ] **Step 1: Replace the Step 2 section**

Replace the entire `### Step 2: Start the Explore Runner` block (lines 199-209) with:

````markdown
### Step 2: Start the Explore Runner (Parallel Launch)

**All independent IO fires in a single message.** The runner startup (30-60s) is the
longest leg -- GH calls and POM ref gen finish within that window.

See `references/runner-launch.md` for launch commands per mode (local dev, built app, browser).

**Parallel launch message (all tool calls in one message):**

For PR number input:
```
Bash (background): rm -f /tmp/explore-runner-port && <launch command from runner-launch.md> 2>&1 &
Bash (background): <POM ref staleness check + gen if needed, from runner-launch.md>
Bash: gh pr diff <number> --repo posit-dev/positron | head -2000
Bash: gh pr view <number> --repo posit-dev/positron --json title,body,labels
Bash: gh issue view <context-number> --repo posit-dev/positron --json title,body  (only if --context flag)
```

For `--branch` input:
```
Bash (background): rm -f /tmp/explore-runner-port && <launch command> 2>&1 &
Bash (background): <POM ref staleness check + gen if needed>
Bash: git diff main...<branch> | head -2000
Bash: git diff main...<branch> --name-only
```

For free-text input:
```
Bash (background): rm -f /tmp/explore-runner-port && <launch command> 2>&1 &
Bash (background): <POM ref staleness check + gen if needed>
```

**After parallel results land:**

1. Read the POM reference (should be generated by now):
   ```
   Read test/e2e/tests/_generated/pom-reference.md
   ```

2. **Plan test steps** using the diff/PR context from the parallel calls (this is Step 1's analysis, which runs after the data arrives).

3. **Poll for runner readiness** (the runner has had 20-40s of head start by now -- likely already ready):
   ```bash
   for i in $(seq 1 60); do
     if [ -f /tmp/explore-runner-port ]; then
       PORT=$(cat /tmp/explore-runner-port)
       HEALTH=$(curl -s "http://localhost:$PORT/health" 2>/dev/null)
       if echo "$HEALTH" | grep -q ok; then
         echo "Runner ready on port $PORT"
         break
       fi
     fi
     sleep 1
   done
   ```

4. **Send description** so the report shows what is being tested:
   ```bash
   PORT=$(cat /tmp/explore-runner-port)
   jq -n --arg desc $'Verify PR #456: Panel hiding behavior when closing editors:\n- Panel maximizes when visible and last editor closes\n- Panel stays hidden when user hid it (Cmd+J)' \
     '{description: $desc}' \
   | curl -s -X POST "http://localhost:$PORT/describe" -H 'Content-Type: application/json' -d @-
   ```

**Happy-path tool call count:** 5-6 calls total (parallel launch message, read POM ref, poll, POST /describe, POST /run-plan, POST /done).
````

- [ ] **Step 2: Verify the change**

Read modified section and confirm:
- Three parallel launch patterns (PR, branch, free-text) documented
- Poll interval is 1s (not 2s)
- POM ref read happens after parallel results land
- Planning happens after GH data arrives (not before runner starts)
- Happy-path tool call count updated

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/e2e-tests-verify/SKILL.md
git commit -m "refactor(e2e-verify): restructure Step 2 for parallel launch pipeline

Runner, POM ref gen, and GH API calls all fire in a single message.
Runner boots while planning happens. Poll interval reduced to 1s.
Estimated time savings: 40-75s per run."
```

---

### Task 5: Update runner-launch.md

**Files:**
- Modify: `.claude/skills/e2e-tests-verify/references/runner-launch.md`

- [ ] **Step 1: Update the poll loop interval**

In `references/runner-launch.md`, change `sleep 2` to `sleep 1` in the polling loop (line 45):

```
Old: sleep 2
New: sleep 1
```

- [ ] **Step 2: Add parallel launch note**

After the polling loop section (after line 46), add:

````markdown
**Parallel launch pattern:** The runner is launched as a background Bash command
in the same message as GH API calls and POM ref generation. By the time planning
completes and polling starts, the runner typically has a 20-40s head start. The
first poll usually finds it already ready.
````

- [ ] **Step 3: Verify and commit**

Read the file and confirm the poll interval and parallel note are correct.

```bash
git add .claude/skills/e2e-tests-verify/references/runner-launch.md
git commit -m "refactor(e2e-verify): reduce poll interval to 1s, add parallel launch note"
```

---

### Task 6: Update diff-analysis.md -- PR-First

**Files:**
- Modify: `.claude/skills/e2e-tests-verify/references/diff-analysis.md`

- [ ] **Step 1: Replace the "Extract the diff" section**

Replace the `## Extract the diff` section (lines 3-30) with:

````markdown
## Extract the diff

The diff source depends on the input mode:

**If PR number (primary mode):**

The diff is fetched during the parallel launch in Step 2. By the time diff analysis
runs, these results are already available:
```bash
# Fetched in parallel during Step 2:
gh pr diff <pr-number> --repo posit-dev/positron | head -2000
gh pr view <pr-number> --repo posit-dev/positron --json title,body,labels

# File list (extract from diff output or run separately):
gh pr diff <pr-number> --repo posit-dev/positron --name-only
```

**If `--branch` (no argument or a branch name):**
```bash
# Determine the target branch (default: current branch)
BRANCH=$(git rev-parse --abbrev-ref HEAD)  # or the specified branch name
COMMITS_AHEAD=$(git rev-list --count main..$BRANCH)

# File list for area mapping
git diff main...$BRANCH --name-only

# Full diff for semantic analysis (cap at 2000 lines to stay focused)
git diff main...$BRANCH | head -2000
```
````

- [ ] **Step 2: Replace the "Fetch enrichment context" section**

Replace the `## Fetch enrichment context` section (lines 32-41) with:

````markdown
## Fetch enrichment context (secondary signals)

Enrichment is fetched during the parallel launch in Step 2. These are secondary signals
that improve test plan quality but are not required:

```bash
# PR metadata (always fetched in parallel for PR input):
gh pr view <pr-number> --repo posit-dev/positron --json title,body,labels

# Issue context (only if --context <issue> flag was passed):
gh issue view <issue-number> --repo posit-dev/positron --json title,body,labels

# For --deep mode, also fetch PR comments:
gh pr view <pr-number> --repo posit-dev/positron --json comments
```

The `--context` flag provides the "why" (bug report, expected behavior) while
the PR diff provides the "what" (code changes to exercise). Use both signals
when planning test steps.

If `--branch` mode without `--context`, the diff alone is sufficient.
````

- [ ] **Step 3: Verify and commit**

Read the file and confirm:
- No mention of `gh pr list --search` or issue-to-PR resolution
- No `--branch #9638` syntax
- `--context` documented as optional enrichment
- Parallel launch referenced for data availability

```bash
git add .claude/skills/e2e-tests-verify/references/diff-analysis.md
git commit -m "refactor(e2e-verify): update diff-analysis for PR-first input model

Remove issue-to-PR resolution. Diff and PR context are fetched during
parallel launch. --context flag provides optional issue enrichment."
```

---

### Task 7: Update Step 6 Save Test -- PR-based file naming

**Files:**
- Modify: `.claude/skills/e2e-tests-verify/SKILL.md:310-320` (file path section in Step 6)

- [ ] **Step 1: Update file naming convention**

In the Step 6 file path documentation, update `<issue>` references to `<pr>`:

Replace:
```markdown
**File path:** `test/e2e/tests/_generated/MMDD_<issue>-<slug>.test.ts`
- `MMDD` is the current date (e.g., `0405`)
- `<issue>` is the issue number if available, omit if free-text or `--branch` without issue
```

With:
```markdown
**File path:** `test/e2e/tests/_generated/MMDD_<pr>-<slug>.test.ts`
- `MMDD` is the current date (e.g., `0405`)
- `<pr>` is the PR number if available, omit if free-text or `--branch`
```

Also update the examples:
```markdown
- Examples:
  - `test/e2e/tests/_generated/0405_456-notebook-outline.test.ts`
  - `test/e2e/tests/_generated/0405-1_456-notebook-outline.test.ts` (second run same day)
  - `test/e2e/tests/_generated/0404_console-sessions.test.ts` (free-text, no PR)
```

And update the `test.describe` format:
```markdown
Use `test.describe('Verify PR#<number>: <short summary>')` as the parent block.
For free-text tests (no PR number), use `test.describe('Verify: <description>')`.
```

- [ ] **Step 2: Verify and commit**

Read the file and confirm all references to "issue" in Step 6 are updated to "PR".

```bash
git add .claude/skills/e2e-tests-verify/SKILL.md
git commit -m "refactor(e2e-verify): update Step 6 file naming from issue to PR numbers"
```

---

### Task 8: Final Verification

- [ ] **Step 1: Read through the full SKILL.md**

Read the entire file end-to-end and check for:
- No remaining references to issue-to-PR resolution or `gh pr list --search`
- No `--branch #9638` syntax (branch only takes branch names)
- `--local` documented in Step 0 and Input Formats
- `--context` documented in Step 1 and Input Formats
- Step 2 describes the parallel launch pattern
- Poll interval is 1s everywhere
- Step 6 uses PR numbers, not issue numbers
- Steps 3-5 are unchanged (execution, reporting, cleanup)

- [ ] **Step 2: Read diff-analysis.md end-to-end**

Confirm no stale references to issue-to-PR resolution or `--branch #9638`.

- [ ] **Step 3: Read runner-launch.md end-to-end**

Confirm poll interval is 1s and parallel launch note is present.

- [ ] **Step 4: Squash or confirm commits are clean**

```bash
git log --oneline -7
```

Verify all 6 commits are present and messages are clear.
