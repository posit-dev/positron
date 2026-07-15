/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, tags } from '../_test.setup';
import { test } from './_test.setup.js';

test.use({
	suiteId: __filename
});

// Regression coverage for cursor placement on click in Positron Notebooks.
//
// After exiting edit mode (by clicking away from the cell), clicking a specific
// line can drop the cursor on a *different* line when the embedded Monaco
// editor's internal layout is out of sync with what is rendered (a hit-test
// miscalculation).
//
// We can't read Monaco's cursor position directly from Playwright, so we assert
// the user-visible consequence: click a known line, type a unique marker, and
// verify the marker landed on the line we clicked. The assertion is keyed off
// the line's own text (not its DOM/array index), so it does not depend on the
// order Monaco renders .view-line elements in.
test.describe('Notebook Click-to-Cursor Position', {
	tag: [tags.WIN, tags.WEB, tags.POSITRON_NOTEBOOKS]
}, () => {

	test.beforeAll(async function ({ hotKeys }) {
		await hotKeys.minimizeBottomPanel();
		await hotKeys.closeSecondarySidebar();
	});

	test('Clicking a line after exiting edit mode places the cursor on that line', async function ({ app }) {
		const { notebooksPositron } = app.workbench;
		const keyboard = app.code.driver.currentPage.keyboard;

		// Distinct, non-overlapping tokens so the target token matches exactly one
		// line and is never a substring of another line. The target line is a
		// function call rather than an assignment to exercise a different line type.
		const lines = [
			'alpha = 1',
			'bravo = 2',
			'charlie = 3',
			'delta = 4',
			'print("clicked")',
			'echo = 6',
			'foxtrot = 7',
			'golf = 8',
		];
		const TARGET = 'print';
		const MARKER = 'ZZZ';

		await notebooksPositron.newNotebook({ codeCells: 1 });
		await notebooksPositron.addCodeToCell(0, lines.join('\n'), { fast: true });

		// Repro step: click away from the cell to defocus it (exit edit mode).
		// Using a click rather than Esc avoids CI flake where Esc dismisses a
		// transient toast instead of exiting the cell.
		await notebooksPositron.clickAwayFromCell(0);
		await notebooksPositron.expectCellIndexToBeSelected(0, { inEditMode: false });

		// Repro step: click directly on the target line (the function call).
		const targetLine = notebooksPositron
			.editorWidgetAtIndex(0)
			.locator('.view-line', { hasText: TARGET });
		await targetLine.click();

		// Wait until the click has put us back in edit mode (editor focused, cursor
		// placed) before typing, so the marker isn't dropped during the transition.
		await notebooksPositron.expectCellIndexToBeSelected(0, { inEditMode: true });

		// Normalize to the start of whatever line the cursor actually landed on,
		// then insert a unique marker there.
		await keyboard.press('Home');
		await keyboard.type(MARKER);

		// The marker must be on the line we clicked. If the cursor landed on the
		// wrong line, the target line will not contain the marker.
		const content = await notebooksPositron.getCellContent(0);
		const targetLineText = content.find(l => l.includes(TARGET));
		expect(
			targetLineText,
			`expected the "${TARGET}" line to contain "${MARKER}". Cell lines: ${JSON.stringify(content)}`
		).toContain(MARKER);
	});

	// Regression test for https://github.com/posit-dev/positron/issues/14085.
	//
	// The long-cell variant of the scenario above, following the repro from the
	// issue: a cell taller than the viewport, exit edit mode with Esc, scroll
	// within the cell, then click a line. The cursor must land on the clicked
	// line.
	//
	// The scroll step matters: after typing, Monaco leaves the cursor (and its
	// hidden input element) on the LAST line of the cell. Scrolling back to the
	// top puts that hidden input far outside the notebook's scroll viewport,
	// which is the state in which clicking a visible line placed the cursor on
	// the wrong line.
	test('Clicking a line in a long scrolled cell places the cursor on that line', async function ({ app }) {
		const { notebooksPositron, toasts } = app.workbench;
		const keyboard = app.code.driver.currentPage.keyboard;

		// 60 unique filler lines make the cell taller than the viewport. The
		// target token appears on exactly one line, near the top of the cell.
		const lines = Array.from({ length: 60 }, (_, i) => `filler_${String(i + 1).padStart(2, '0')} = ${i + 1}`);
		lines[4] = 'print("clicked")';
		const TARGET = 'print';
		const MARKER = 'ZZZ';

		await notebooksPositron.newNotebook({ codeCells: 1 });
		await notebooksPositron.addCodeToCell(0, lines.join('\n'), { fast: true });

		// Repro step: press Esc to exit edit mode. Close any toasts first so a
		// transient notification cannot swallow the keypress (see #14139), and
		// retry the keypress in case a late toast or editor widget consumes it.
		await toasts.closeAll();
		await expect(async () => {
			await keyboard.press('Escape');
			await notebooksPositron.expectCellIndexToBeSelected(0, { inEditMode: false, timeout: 2000 });
		}).toPass({ timeout: 15000 });

		// Repro step: scroll back to the top of the cell so the target line is
		// visible and the editor's hidden input (left on the last line) is not.
		const targetLine = notebooksPositron
			.editorWidgetAtIndex(0)
			.locator('.view-line', { hasText: TARGET });
		await targetLine.scrollIntoViewIfNeeded();

		// Precondition: the hidden editor input must be outside the notebook's
		// scroll viewport, otherwise this test degenerates into the short-cell
		// case above and cannot catch the bug.
		const containerBox = await notebooksPositron.cellsContainer.boundingBox();
		const inputBox = await notebooksPositron.editorAtIndex(0).boundingBox();
		expect(containerBox, 'notebook scroll container should be visible').toBeTruthy();
		expect(inputBox, 'cell editor hidden input should be rendered').toBeTruthy();
		// Require a clear margin (several text lines) so the geometry cannot be
		// borderline: the focus-driven reveal must produce a scroll shift much
		// larger than one line for the misplacement to be unambiguous.
		expect(
			inputBox!.y,
			'hidden editor input must be well below the scroll viewport for this repro'
		).toBeGreaterThan(containerBox!.y + containerBox!.height + 100);

		// Repro step: click directly ON THE TEXT of the target line (near its
		// start, like a user clicking the beginning of a line). This is
		// load-bearing: a click past the end of the text resolves through a
		// geometry-only code path in Monaco that is immune to the bug, while a
		// click on the text resolves via a client-coordinate hit test that is
		// not.
		await targetLine.click({ position: { x: 5, y: 5 } });

		// Wait until the click has put us back in edit mode before typing.
		await notebooksPositron.expectCellIndexToBeSelected(0, { inEditMode: true });

		// Normalize to the start of whatever line the cursor actually landed on,
		// then insert a unique marker there.
		await keyboard.press('Home');
		await keyboard.type(MARKER);

		// The marker must be on the line we clicked.
		const content = await notebooksPositron.getCellContent(0);
		const targetLineText = content.find(l => l.includes(TARGET));
		expect(
			targetLineText,
			`expected the "${TARGET}" line to contain "${MARKER}". Cell lines: ${JSON.stringify(content)}`
		).toContain(MARKER);
	});
});
