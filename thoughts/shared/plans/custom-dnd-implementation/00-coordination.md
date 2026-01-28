---
type: plan-coordination
title: "Custom Drag-and-Drop Implementation - Coordination Document"
created: 2026-01-28
status: draft
based_on: "thoughts/shared/research/2026-01-28-dnd-kit-replacement-analysis.md"
---

# Custom Drag-and-Drop Implementation - Coordination Document

## Overview

This document coordinates the sequential implementation of a custom drag-and-drop system for Positron Notebooks, replacing the vendored dnd-kit library (~53KB) with a minimal custom implementation (~550 lines).

**Goal**: Eliminate external dependency while maintaining the smooth "items shift during drag" UX.

## Plan Structure

The implementation is broken into four discrete plans, each designed to fit within an AI agent's context window:

| Plan | File | Estimated Scope | Dependencies |
|------|------|-----------------|--------------|
| **01** | `01-basic-drag-infrastructure.md` | ~400 lines code | None |
| **02** | `02-keyboard-and-scroll.md` | ~200 lines code | Plan 01 |
| **03** | `03-animations-and-accessibility.md` | ~300 lines code | Plan 02 |
| **04** | `04-advanced-features.md` | ~100 lines code | Plan 03 (optional) |

## Context Preservation Protocol

Each agent working on these plans MUST follow these context-preserving techniques:

### 1. Running Context Document

Maintain and update the shared context file after each plan:

**File**: `thoughts/shared/plans/custom-dnd-implementation/CONTEXT.md`

```markdown
# Running Implementation Context

## Last Updated
- Plan: [01/02/03/04]
- Date: YYYY-MM-DD
- Commit: [git hash]

## Files Created/Modified
- [list all files touched with brief description]

## Key Decisions Made
- [architectural decisions and rationale]

## Known Issues/TODOs
- [any deferred items or bugs discovered]

## State at Handoff
- [what works, what doesn't]
```

### 2. Handoff Summary

At the END of each plan, the agent must:

1. **Update CONTEXT.md** with all changes made
2. **Commit changes** with message format: `feat(notebooks): [Plan N] - brief description`
3. **Run verification** commands and record results
4. **Document blockers** if any exist

### 3. Context Loading

At the START of each plan, the agent must:

1. **Read CONTEXT.md** to understand current state
2. **Read the specific plan file** for this phase
3. **Verify prerequisites** by running listed checks
4. **Only then** begin implementation

### 4. Scope Boundaries

Each agent must:
- **Stay within plan scope** - don't implement features from later plans
- **Document deferred items** - add to CONTEXT.md if something should be done later
- **Ask for clarification** if plan is ambiguous
- **Stop at verification** - don't proceed to next plan automatically

## Repository Map (Stable Context)

These files are relevant across all plans. Agents should reference but not load entirely:

```
src/vs/workbench/contrib/positronNotebook/browser/
├── PositronNotebookInstance.ts     # Contains moveCell(), moveCells() methods
├── PositronNotebookComponent.tsx   # Main React component to integrate with
├── notebookCells/
│   ├── SortableCellList.tsx       # CURRENT dnd-kit integration (to be replaced)
│   ├── SortableCell.tsx           # CURRENT cell wrapper (to be replaced)
│   └── SortableCell.css           # Styles (mostly reusable)

test/e2e/tests/notebooks-positron/
└── notebook-cell-reordering.test.ts  # E2E tests (MUST pass after each plan)
```

## Verification Commands

Run these after each plan to verify no regressions:

```bash
# TypeScript compilation
npm run compile

# E2E tests for cell reordering (CRITICAL - must pass)
npx playwright test notebook-cell-reordering.test.ts --project e2e-electron --reporter list

# Manual smoke test
./scripts/code.sh &
# Open a notebook, verify drag handle appears, verify cells can be reordered
```

## Risk Mitigation

1. **E2E tests exist** - 8 drag-and-drop specific tests provide safety net
2. **Incremental approach** - Each plan produces working (if partial) functionality
3. **Rollback possible** - Can revert to dnd-kit at any point

## Communication with User

After completing each plan, summarize:
1. What was implemented
2. What tests pass/fail
3. Any blockers for next plan
4. Estimated state of UX (e.g., "basic drag works but animations pending")

## Starting Point

Before Plan 01, create the initial CONTEXT.md:

```bash
cat > thoughts/shared/plans/custom-dnd-implementation/CONTEXT.md << 'EOF'
# Running Implementation Context

## Last Updated
- Plan: 00 (Not started)
- Date: 2026-01-28
- Commit: (current HEAD)

## Files Created/Modified
- None yet

## Key Decisions Made
- Decided to replace dnd-kit with custom implementation
- Will preserve existing moveCell() API
- Will maintain E2E test compatibility

## Known Issues/TODOs
- dnd-kit still vendored (remove after Plan 03 verified)

## State at Handoff
- Current: dnd-kit implementation works
- E2E tests passing
EOF
```

## Plan Execution Order

1. **Plan 01**: Create basic drag infrastructure (pointer events, drop zones)
2. **Plan 02**: Add keyboard support and auto-scroll
3. **Plan 03**: Implement FLIP animations and accessibility
4. **Plan 04**: (Optional) Touch support and multi-selection

Each plan can be executed by a fresh agent with no prior context, as long as:
- They read CONTEXT.md first
- They read their specific plan file
- They follow the handoff protocol

## Success Criteria (Overall)

The implementation is complete when:
- [ ] All 8 E2E drag-and-drop tests pass
- [ ] Custom implementation is ~550 lines (vs 53KB dnd-kit)
- [ ] Items visually shift during drag (FLIP animation)
- [ ] Keyboard navigation works (arrow keys)
- [ ] Auto-scroll works near edges
- [ ] Screen reader announcements present
- [ ] dnd-kit vendor files can be removed
