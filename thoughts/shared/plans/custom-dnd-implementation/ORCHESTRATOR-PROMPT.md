# Custom DnD Implementation Orchestrator

You are orchestrating the implementation of a custom drag-and-drop system for Positron Notebooks. This replaces the vendored dnd-kit library (~53KB) with a minimal custom implementation (~550 lines).

## Your Role

You are the **orchestrator**. You do NOT implement code directly. Instead, you:

1. Spawn sub-agents to execute each plan
2. Verify success between plans
3. Handle failures and decide whether to proceed
4. Keep the user informed of progress

## Plan Files Location

All plans are in: `thoughts/shared/plans/custom-dnd-implementation/`

- `00-coordination.md` - Overview and protocols
- `01-basic-drag-infrastructure.md` - Plan 01
- `02-keyboard-and-scroll.md` - Plan 02
- `03-animations-and-accessibility.md` - Plan 03
- `04-advanced-features.md` - Plan 04 (optional)
- `CONTEXT.md` - Running state (sub-agents update this)
- `TEST-EXPECTATIONS.md` - **Which tests should pass at each plan stage**

## Execution Protocol

### Before Starting

1. Read `CONTEXT.md` to understand current state
2. Verify E2E tests pass with current implementation:
   ```bash
   npx playwright test notebook-cell-reordering.test.ts --project e2e-electron --reporter list
   ```
3. If tests fail, STOP and report to user

### For Each Plan (01, 02, 03)

Execute this loop:

```
1. READ the plan file (e.g., 01-basic-drag-infrastructure.md)
   READ TEST-EXPECTATIONS.md to know which tests should pass

2. SPAWN a sub-agent using the Task tool:
   - subagent_type: "general-purpose"
   - prompt: See template below
   - Let it run to completion

3. VERIFY after agent completes:
   a. Run: npm run compile
   b. Run the appropriate test command from TEST-EXPECTATIONS.md:
      - Plan 01: npx playwright test notebook-cell-reordering.test.ts --project e2e-electron --grep-invert "auto-scroll"
      - Plan 02+: npx playwright test notebook-cell-reordering.test.ts --project e2e-electron

4. CHECK results against TEST-EXPECTATIONS.md:
   - Plan 01: 13 tests should pass, "auto-scroll" test expected to fail
   - Plan 02+: All 14 tests should pass
   - Non-drag tests (6 tests) must ALWAYS pass - if they fail, something is fundamentally broken

5. REPORT progress to user before continuing
```

### Sub-Agent Prompt Template

Use this template when spawning each sub-agent:

```
You are implementing Plan [N] of the custom drag-and-drop system for Positron Notebooks.

## Instructions

1. FIRST, read these files in order:
   - thoughts/shared/plans/custom-dnd-implementation/CONTEXT.md
   - thoughts/shared/plans/custom-dnd-implementation/[PLAN-FILE].md

2. Follow the implementation steps EXACTLY as written in the plan

3. After completing ALL implementation steps:
   a. Run the verification checklist from the plan
   b. Update CONTEXT.md with:
      - Changed "Last Updated" section
      - Added files to "Files Created/Modified"
      - Any issues discovered
   c. Commit your changes:
      git add -A && git commit -m "feat(notebooks): [Plan N] - [brief description]"

4. Report what was done and verification results

## Important
- Stay within scope of this plan only
- Do not implement features from other plans
- If you encounter blockers, document them in CONTEXT.md and stop
- All E2E tests must pass before considering the plan complete
```

### Plan 04 Decision

After Plan 03 completes successfully:

1. Ask the user: "Plans 01-03 complete. Plan 04 contains optional features (touch support, multi-selection). Should I proceed with Plan 04, or stop here?"

2. If user says stop, proceed to cleanup
3. If user wants Plan 04, execute it same as others

### Cleanup Phase

After all requested plans complete:

1. Spawn a sub-agent to remove dnd-kit:
   - Remove import map entries from workbench HTML files
   - Delete `src/esm-package-dependencies/v135/@dnd-kit/`
   - Delete wrapper files (core.js, sortable.js, utilities.js)
   - Update ThirdPartyNotices.txt

2. Verify E2E tests still pass

3. Commit: `chore(notebooks): Remove vendored dnd-kit library`

## Error Handling

### If TypeScript compilation fails:
- Report the error to user
- Ask if they want to spawn a fix agent or stop

### If E2E tests fail:
Consult TEST-EXPECTATIONS.md to determine if failure is expected:

**Expected failures (proceed anyway):**
- Plan 01: "auto-scroll" test failing is expected

**Unexpected failures (stop and report):**
- Non-drag tests failing (Action Bar, Keyboard, Boundaries, Multi-move, Undo/redo, Multiselect)
  → These indicate core notebook infrastructure is broken
- Drag tests failing when they should pass per TEST-EXPECTATIONS.md
  → Report which specific tests failed and their output

When reporting failures:
1. Identify if failure is expected or unexpected
2. Show the failure output
3. If unexpected, ask user: fix, rollback, or stop?

### If sub-agent times out or fails:
- Report the last known state
- Ask user if they want to resume or restart the plan

## Progress Reporting

After each plan, report to user:

```
## Plan [N] Complete

**Status**: ✅ Success / ❌ Failed

**Changes Made**:
- [list of files created/modified]

**Verification**:
- TypeScript: ✅ Compiles
- E2E Tests:
  - Non-drag tests: ✅ 6/6 passing (always required)
  - Drag tests: ✅ X/8 passing (see TEST-EXPECTATIONS.md for expected count)
  - Expected failures: [list any expected failures for this plan]

**Next**: Proceeding to Plan [N+1] / Awaiting user decision
```

### Example for Plan 01:
```
## Plan 01 Complete

**Status**: ✅ Success

**Changes Made**:
- Created src/vs/workbench/contrib/positronNotebook/browser/dnd/ (8 files)
- Modified SortableCellList.tsx and SortableCell.tsx

**Verification**:
- TypeScript: ✅ Compiles
- E2E Tests:
  - Non-drag tests: ✅ 6/6 passing
  - Drag tests: ✅ 7/8 passing
  - Expected failures: "auto-scroll" test (not implemented until Plan 02)

**Next**: Proceeding to Plan 02
```

## Start Now

Begin by:
1. Reading CONTEXT.md
2. Running initial verification
3. Starting Plan 01

Report your initial findings before spawning the first sub-agent.
