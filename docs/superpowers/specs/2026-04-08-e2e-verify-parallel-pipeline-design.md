# e2e-verify Parallel Pipeline Design

## Problem

The e2e-verify skill runs all startup work sequentially: parse input, resolve GH context, launch the explore runner, generate the POM reference. On the issue/PR path this takes ~90-140s before the first test action fires. The runner startup alone is 30-60s of dead wait. For a skill targeting CI automation on merge-to-main, this latency is unacceptable.

## Goals

1. **Reduce time-to-first-test-action** from ~90-140s to ~30-60s (bounded by runner startup)
2. **Eliminate ambiguous input resolution** -- PR-first input model, no issue-to-PR guessing
3. **Reduce interactive pauses** -- explicit flags for target selection, prompts only when no flag given
4. **Tighten polling** -- reduce wasted wait after runner is ready
5. **Document CI end goal** -- merge-to-main automation as north star (backlog, not immediate work)

## Input Model (Revised)

Numbers are always treated as PR numbers. Issues are never used as a diff source.

| Input | Behavior |
|-------|----------|
| `456` | PR number. `gh pr view 456` for metadata, `gh pr diff 456` for diff. Error if not a valid PR. |
| `456 --context 12345` | PR diff + issue body as enrichment. Issue is for test plan quality, not diff resolution. |
| `--branch` | `git diff main...HEAD` on current branch. |
| `--branch feature/my-branch` | Diff named branch vs main. |
| `"free text description"` | No diff, no GH calls. AI plans from description alone. |

### Error handling

If `gh pr view <number>` fails (not a valid PR), the skill should error immediately with a clear message:

> "No PR found for #456. Pass a PR number, or use --branch to test local changes."

No fallback to issue search. Fail fast, fail clear.

### Why not issues?

Issues frequently have multiple linked PRs (initial fix, revert, second attempt, follow-up). Resolving which PR to test is ambiguous and fragile. In CI, the PR number is always available. For humans, PR numbers are easy to find. The `--context` flag preserves issue enrichment without the resolution problem.

### Auto-extract in CI

PR bodies often contain `Fixes #12345`, `Closes #12345`, etc. CI workflows can parse this and pass `--context` automatically:

```bash
ISSUE=$(gh pr view $PR --json body -q '.body' \
  | grep -oiP '(?:fixes|closes|resolves)\s+#\K\d+' | head -1)
```

Case-insensitive, handles multiple formats.

## Flags

All flags are composable.

```
Target (mutually exclusive):
  --local            Local dev instance, skip prompt
  --build            Built app (/Applications/Positron.app), skip prompt
  (neither)          Prompt: "Local dev or Built app?"

Save behavior (mutually exclusive):
  --save             Auto-save .test.ts, no prompt
  --no-save          No save, no prompt
  (neither)          Prompt after test completes

Other:
  --deep             Exhaustive mode (10-15+ steps with edge cases)
  --context <issue>  Pull issue body as enrichment for test planning
  --browser <name>   Firefox, Chromium, or WebKit instead of Electron
```

### Examples

```
/e2e-verify 456                            PR diff, prompt for target
/e2e-verify 456 --local                    PR diff, local dev, no prompt
/e2e-verify 456 --build --no-save          PR diff, built app, CI-friendly
/e2e-verify 456 --context 12345 --deep     PR diff + issue enrichment, exhaustive
/e2e-verify --branch --local               Branch diff, local dev
/e2e-verify "free text" --build            Description only, built app
```

## Parallel Pipeline Architecture

### Core Principle

Fire all independent IO in the first tool-call message. The runner startup (30-60s) is the longest leg -- everything else finishes within that window.

### Current Flow (Sequential, ~90-140s)

```
Ask target -> Parse input -> GH calls -> Analyze -> Launch runner -> Gen POM ref -> Poll -> Execute
```

### New Flow (Parallel, ~30-60s)

```
Message 1:  Determine target (flag or prompt)

Message 2 (single message, all parallel tool calls):
  Bash (background): launch runner
  Bash (background): gen POM ref if stale
  Bash: gh pr diff <number>
  Bash: gh pr view <number> --json title,body,labels
  Bash: gh issue view <context> --json title,body (if --context flag)

Message 3:  Read POM ref + plan test steps from diff analysis

Message 4:  Poll runner (likely already ready) + POST /describe + POST /run-plan
```

### Why This Works

The runner startup (30-60s) dominates. GH API calls (2-3s each), POM ref generation (10-15s), and diff analysis all complete well within the runner boot window. By the time planning is done in Message 3, the runner has had 20-40s of head start. In most cases, the first poll in Message 4 finds it already ready.

### Mode-Specific Fast Paths

| Mode | Phase 1 (parallel) | Phase 2 (sequential) |
|------|-------------------|---------------------|
| PR number | runner + POM ref + `gh pr diff` + `gh pr view` | Read ref, plan from diff |
| PR + context | runner + POM ref + `gh pr diff` + `gh pr view` + `gh issue view` | Read ref, plan from diff + issue |
| Branch diff | runner + POM ref + `git diff main...HEAD` | Read ref, plan from diff |
| Free-text | runner + POM ref | Plan from description |
| Deep mode | runner + POM ref + all GH calls | Read ref, exhaustive plan |

Free-text is the fastest since it has no IO besides runner + POM ref. The AI plans immediately while the runner boots.

## Polling Improvements

Current poll interval is 2s. Reduce to 1s to halve worst-case wait after runner is ready.

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

Combined with the parallel launch giving the runner a 20-40s head start, the polling step should resolve on first or second check in most runs.

## POM Reference Staleness

Skip regeneration if the reference was generated recently and no POM source files changed:

```bash
REF=test/e2e/tests/_generated/pom-reference.md
if [ ! -f "$REF" ] || [ -n "$(find test/e2e/pages -name '*.ts' -newer "$REF" 2>/dev/null | head -1)" ]; then
  npx tsx scripts/generate-pom-reference.ts &
fi
```

This saves 10-15s on repeat runs where POM files haven't changed (common during QA sessions).

## What Changes

### SKILL.md

- **Step 0:** Add `--local` flag handling alongside `--build`. Default to prompt when neither given.
- **Step 1:** Rewrite input parsing to be PR-first. Remove issue-to-PR resolution. Add `--context` flag. Error on invalid PR number instead of falling back to issue search.
- **Step 2:** Restructure to fire runner launch, POM ref gen, and GH API calls as parallel tool calls in a single message. Move planning to after parallel results land.
- **Polling:** Reduce sleep from 2s to 1s.

### references/runner-launch.md

- Update poll loop interval to 1s.
- Add note about parallel launch pattern (runner boots while planning happens).

### references/runner-api.md

- No changes.

### references/reporting.md

- No changes.

### references/diff-analysis.md

- Update to reflect PR-first input (no issue-to-PR resolution step).
- Add `--context` enrichment as optional input to diff analysis.

## What Doesn't Change

- Runner API (HTTP routes, /run-plan format, explore mode)
- Test execution logic (Step 3)
- Failure handling and retries (Step 3b)
- Reporting format and POM Health checks (Step 4)
- Cleanup and save logic (Steps 5-6)
- Shared e2e references (test-conventions, pom-patterns, common-mistakes)
- The saved .test.ts file format

## CI End Goal (Backlog)

The north star is running e2e-verify in CI on merge to main with zero manual intervention.

### Envisioned workflow

1. PR merges to main
2. GitHub Actions triggers with PR number from merge event
3. Auto-extracts linked issue from PR body for `--context`
4. Runs: `claude -p "/e2e-verify <pr> --build --no-save --context <issue>"`
5. Posts verification comment to the PR

### Blockers

- **`--build` in CI:** Requires a Positron build artifact. Nightly builds exist but not per-merge. Someone is actively working on CI builds -- once available, this unblocks.
- **Claude Code in CI:** Needs headless Claude Code CLI in the CI runner. Available but needs auth setup.
- **macOS runners:** Electron tests need macOS. GitHub-hosted macOS runners are available but slower/more expensive.

### Not in scope for this design

CI implementation is backlog work. This spec covers the parallel pipeline and input model changes that make CI possible when the build infrastructure is ready.
