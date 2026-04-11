# Design: `--edge-cases` flag for QA Agent

## Problem

The QA agent tests the right *actions* but with inputs that only exercise the happy path. PR #12868 (Copy Output Text) was tested with `print('hello world')` -- plain text that can't reveal ANSI escape codes in copied output. The bug (raw escape codes in clipboard) was missed because the input didn't exercise that code path.

This is a general class of problem: the agent verifies *that* a feature works, not *how it handles varied input*. Adding feature-specific rules to the skill file doesn't scale -- every feature area would need its own edge case table, and those tables go stale.

## Solution

Add an `--edge-cases` flag that modifies the planning phase. The flag tells the agent HOW to think (vary inputs to exercise different code paths), not WHAT to think (no hardcoded edge case tables). The model already knows that error output has ANSI codes, that empty datasets are a boundary condition, etc. -- it just needs the directive to reason about it.

## Flag Behavior

- **Mutually exclusive with `--deep`.** If both are passed, error immediately.
- **Does not change data gathering.** Still uses PR title + body + file list. No full diff fetch.
- **Changes planning only.** After generating the normal 5-10 core steps, the agent does a second pass to add 1-2 input variant steps per core scenario, targeting 10-20 total steps.
- **Combinable with all other flags** (`--build`, `--local`, `--save`, `--comment`, `--context`, `--branch`, `--test-patterns`, `--browser`).

## SKILL.md Changes

Three touch points, no new files:

### 1. Input Formats section

Add to usage examples:
```
/qa-agent 456 --edge-cases --build      PR diff, built app, with input diversity
```

Add to "Other flags" list:
```
- `--edge-cases`: After planning core test steps, add 1-2 input variants per scenario
  to exercise different code paths (errors, empty values, special formatting, boundary
  conditions). Targets 10-20 total steps. Mutually exclusive with `--deep`.
```

### 2. Step 1 planning -- new conditional block

Add after the `--deep` block (~line 195), parallel to existing conditional blocks:

```
**If `--edge-cases` flag is set:**

After planning the core 5-10 steps, do a second pass. For each core test step that
involves user-visible output or data transformation, add 1-2 additional steps that
test the same action with inputs designed to exercise different code paths. Vary the
*kind* of input -- errors vs clean output, empty vs populated, special characters vs
plain text, multi-line vs single-line. Target 10-20 total steps. Do not hardcode
specific edge cases -- reason about what inputs would reveal bugs in this specific
feature.
```

### 3. Mutual exclusivity validation

Add to Step 1, before planning begins:

```
If both `--deep` and `--edge-cases` are set, error:
"--deep and --edge-cases are mutually exclusive. Use --deep for exhaustive data
gathering, or --edge-cases for input diversity."
```

## What Does NOT Change

- Runner launch (Step 2) -- unchanged
- POM reference reads -- unchanged
- Execution (Step 3) -- same `/run-plan`, just more steps
- Reporting (Step 4) -- same format. Edge case steps use descriptive titles (e.g., "Copy output text (error traceback)")
- Save (Step 6) -- edge case scenarios included in saved `.test.ts`

## Step count impact

| Mode | Steps | Runner time |
|------|-------|-------------|
| Default | 5-10 | ~30-60s |
| `--edge-cases` | 10-20 | ~1-2min |
| `--deep` | 10-15+ | ~1-2min |
