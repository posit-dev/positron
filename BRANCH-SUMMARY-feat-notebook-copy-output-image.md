# Branch: feat/notebook-copy-output-image

**Base:** origin/main
**Last Updated:** 2026-03-06
**Stats:** 4 commits, +349 -17 across 7 files

---

## PR Status ([#12331](https://github.com/posit-dev/positron/pull/12331))

**State:** Open | **Mergeable:** Yes (UNSTABLE) | **Reviewer:** @dhruvisompura (requested), @seeM (commented)

### Unresolved Review Comments (3) -- all from @seeM

1. **Cmd+C overwrites cell source copy** (contribution.ts:1605)
   > Does this mean if you select a cell that has an image output and press Cmd+C it copies the image? And if so is that what we want vs copying the cell source?

2. **Only copies first image / should use browser default** (contribution.ts:1625)
   > This copies only the first image. I think there's a bug here where output can have multiple images, and right clicking the second copies the first. For right click, can't we pass through to the browser's default behavior for images?

3. **Test should check context keys directly** (positronNotebookCellOutputs.test.ts:140)
   > I think it's possible to actually check context keys. IIRC some of our notebook tests do that already

### CI Status (20/21 passing)

- **FAILED: `e2e / electron`** -- 2 test failures:
  - `Copy Image appears in output context menu for plot output` -- "Copy Image" menu item not found after right-click on cell output. Failed on both retries (39s, 40s). **This is the new test from this branch** and needs to be fixed.
  - `Python - Verify code cell execution and markdown formatting in notebook` -- Timed out waiting for Python console to start (93s). Passed on retry. **Pre-existing flaky test, not related to this branch.**
- All other checks pass (unit, integration, license, security, CLA, etc.)

### Action Items

- [ ] Respond to @seeM's comment about Cmd+C behavior -- is copying the image the right default vs. copying cell source?
- [ ] Fix bug where multi-image outputs always copy the first image; consider passing through to browser default for right-click
- [ ] Update test to check context keys directly instead of indirectly
- [ ] Fix failing e2e test -- "Copy Image" context menu item not found in CI

---

## Overview

Adds the ability to copy plot/image outputs from Positron notebook cells via right-click context menu and Cmd+C keyboard shortcut. Includes unit tests for output parsing and cell output observables, plus an e2e test for the copy image workflow.

## Key Files

- `extensions/positron-notebook-controllers/src/positronNotebook/browser/positronNotebook.contribution.ts` - Registers the "Copy Image" action, keybinding, and menu contributions
- `extensions/positron-notebook-controllers/src/positronNotebook/browser/ContextKeysManager.ts` - Adds `positronNotebookCellHasImageOutput` context key
- `extensions/positron-notebook-controllers/src/positronNotebook/browser/notebookCells/useCellContextKeys.ts` - Updates cell context key tracking for image outputs
- `extensions/positron-notebook-controllers/src/positronNotebook/common/positronNotebookCommon.ts` - Adds shared types/constants for the feature
- `extensions/positron-notebook-controllers/test/browser/notebookOutputUtils.test.ts` - Unit tests for PNG/SVG/text output parsing
- `extensions/positron-notebook-controllers/test/browser/positronNotebookCellOutputs.test.ts` - Unit tests for cell output observables and image detection
- `test/e2e/tests/notebook-copy-output-image.test.ts` - E2E test for context menu and clipboard copy

## What Changed

### Feature
- New context key `positronNotebookCellHasImageOutput` tracks whether the active cell has image outputs
- New "Copy Image" action in the output context menu (ellipsis and right-click), visible only when the cell has image output
- Cmd+C keybinding in command mode copies the image when available
- Uses `IClipboardService.writeImage()` via Electron's native clipboard API

### Tests
- **Unit:** Output parsing for PNG, SVG, text, and stdout mime types; cell outputs observable reports image outputs correctly; dynamic output addition updates observable; image detection with mixed output types
- **E2E:** Right-click context menu shows "Copy Image" for plot output; "Copy Image" writes image data to clipboard; Cmd+C in command mode copies image when cell has plot output

### Cleanup
- Cleared clipboard before e2e assertions to prevent false positives from stale data
- Added full payload validation to PNG parsing unit test

## Commit History

1. `4a938aa` **feat:** add copy image action for Positron notebook cell outputs
2. `b36f78c` **test:** add tests for notebook copy output image
3. `53cddec` **chore:** clean up PR noise
4. `4329f09` **fix:** address review findings in copy image tests

## Current State

**Completed:** Feature implementation, unit tests, e2e tests, initial review feedback addressed
**Blocked on:** 3 unresolved review comments from @seeM (design questions + test improvement) and 1 failing e2e test in CI

---

## Notes

_Space for your notes..._
