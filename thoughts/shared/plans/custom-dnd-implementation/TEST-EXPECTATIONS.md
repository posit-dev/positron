# Test Expectations by Plan

This document maps which E2E tests should pass after each plan. The orchestrator and sub-agents should use this for verification instead of requiring all tests to pass.

## Test Categories

### Non-Drag Tests (Always Pass)
These tests use keyboard shortcuts or action bar - not affected by DnD changes:

| Test Name | Uses |
|-----------|------|
| `Action Bar: swap 1st and 2nd cell` | Action bar button |
| `Keyboard: swap 1st and 2nd cell` | Alt+Arrow keys |
| `Boundaries: first-up and last-down are no-ops` | Alt+Arrow keys |
| `Multi-move: move first to end then one up` | Alt+Arrow keys |
| `Undo/redo cell move operation` | Alt+Arrow + undo |
| `Multiselect: move multiple cells` | Shift+Arrow + Alt+Arrow |

**These 6 tests must ALWAYS pass. If they fail, something is broken in the core notebook infrastructure, not the DnD implementation.**

### Drag-and-Drop Tests

| Test Name | Plan Required |
|-----------|---------------|
| `Drag handle: visible on hover, hidden otherwise` | Plan 01 |
| `Drag-and-drop: swap 1st and 2nd cell` | Plan 01 |
| `Drag-and-drop: move cell to end` | Plan 01 |
| `Drag-and-drop: move cell from end to beginning` | Plan 01 |
| `Drag-and-drop: undo restores original order` | Plan 01 |
| `Drag-and-drop: redo reapplies reorder` | Plan 01 |
| `Drag-and-drop: escape cancels drag operation` | Plan 01 |
| `Drag-and-drop: auto-scroll when dragging in long notebook` | **Plan 02** |

---

## Expected Results by Plan

### After Plan 01: Basic Drag Infrastructure

**Must Pass (13 tests):**
```
✅ Action Bar: swap 1st and 2nd cell
✅ Keyboard: swap 1st and 2nd cell
✅ Boundaries: first-up and last-down are no-ops
✅ Multi-move: move first to end then one up
✅ Undo/redo cell move operation
✅ Multiselect: move multiple cells
✅ Drag handle: visible on hover, hidden otherwise
✅ Drag-and-drop: swap 1st and 2nd cell
✅ Drag-and-drop: move cell to end
✅ Drag-and-drop: move cell from end to beginning
✅ Drag-and-drop: undo restores original order
✅ Drag-and-drop: redo reapplies reorder
✅ Drag-and-drop: escape cancels drag operation
```

**Expected to Fail (1 test):**
```
❌ Drag-and-drop: auto-scroll when dragging in long notebook
   (Auto-scroll not implemented until Plan 02)
```

**Verification Command:**
```bash
# Run all tests, expect 13 pass, 1 fail
npx playwright test notebook-cell-reordering.test.ts --project e2e-electron --reporter list

# Or run only the tests that should pass:
npx playwright test notebook-cell-reordering.test.ts --project e2e-electron --reporter list \
  --grep-invert "auto-scroll"
```

---

### After Plan 02: Keyboard Navigation and Auto-Scroll

**Must Pass (14 tests - ALL):**
```
✅ Action Bar: swap 1st and 2nd cell
✅ Keyboard: swap 1st and 2nd cell
✅ Boundaries: first-up and last-down are no-ops
✅ Multi-move: move first to end then one up
✅ Undo/redo cell move operation
✅ Multiselect: move multiple cells
✅ Drag handle: visible on hover, hidden otherwise
✅ Drag-and-drop: swap 1st and 2nd cell
✅ Drag-and-drop: move cell to end
✅ Drag-and-drop: move cell from end to beginning
✅ Drag-and-drop: undo restores original order
✅ Drag-and-drop: redo reapplies reorder
✅ Drag-and-drop: escape cancels drag operation
✅ Drag-and-drop: auto-scroll when dragging in long notebook  ← NOW PASSES
```

**Verification Command:**
```bash
# All tests should pass
npx playwright test notebook-cell-reordering.test.ts --project e2e-electron --reporter list
```

---

### After Plan 03: Animations and Accessibility

**Must Pass: Same as Plan 02 (14 tests - ALL)**

No new test coverage for animations or screen reader announcements. The existing tests verify functional correctness; animations are visual polish.

**Note:** Consider adding manual verification:
- Items visually shift during drag (not instant snap)
- Screen reader announces drag start/move/end

---

### After Plan 04: Advanced Features (Optional)

**Must Pass: Same as Plan 03 (14 tests - ALL)**

Plan 04 features (touch, multi-select drag) don't have E2E coverage yet. If implemented, new tests should be added.

---

## Quick Reference Commands

```bash
# Full test suite
npx playwright test notebook-cell-reordering.test.ts --project e2e-electron

# Plan 01 verification (exclude auto-scroll)
npx playwright test notebook-cell-reordering.test.ts --project e2e-electron \
  --grep-invert "auto-scroll"

# Only drag-and-drop tests
npx playwright test notebook-cell-reordering.test.ts --project e2e-electron \
  --grep "Drag"

# Only non-drag tests (sanity check)
npx playwright test notebook-cell-reordering.test.ts --project e2e-electron \
  --grep-invert "Drag"
```

## Failure Triage

If a test fails unexpectedly:

| Failed Test Pattern | Likely Cause |
|--------------------|--------------|
| Non-drag tests fail | Core notebook infrastructure broken, not DnD |
| All drag tests fail | DndContext not rendering, imports broken |
| Only basic drag fails | useSortable/useDraggable hook issue |
| Only undo/redo fails | moveCell() not integrating with text model correctly |
| Only escape fails | Keyboard event handler not attached |
| Only auto-scroll fails | AutoScrollController not implemented/integrated |
