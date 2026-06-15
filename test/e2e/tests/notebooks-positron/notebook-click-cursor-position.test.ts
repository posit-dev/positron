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
});
