/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

// Register the find contribution
import '../../../../browser/contrib/find/positronNotebookFind.contribution.js';

import { createTestContainer } from '../../../../../../../test/vitest/positronTestContainer.js';
import { CellKind } from '../../../../../notebook/common/notebookCommon.js';
import { PositronNotebookFindController } from '../../../../browser/contrib/find/controller.js';
import { instantiateTestNotebookInstance, TestPositronNotebookInstance } from '../../testPositronNotebookInstance.js';

/** Get the find controller for a notebook. */
function getController(notebook: TestPositronNotebookInstance): PositronNotebookFindController {
	const controller = PositronNotebookFindController.get(notebook);
	expect(controller, 'Find controller should be registered').toBeDefined();
	return controller!;
}

describe('PositronNotebookFindController seeding from selection', () => {
	const ctx = createTestContainer()
		.withNotebookEditorServices()
		.build();

	function createNotebook(cells: [string, string, CellKind][]) {
		return instantiateTestNotebookInstance(cells, ctx.instantiationService, ctx.disposables);
	}

	/**
	 * Creates a single-cell notebook, enters edit mode on the cell, and
	 * returns its editor along with the find controller.
	 */
	async function editingFixture(content: string) {
		const notebook = createNotebook([[content, 'python', CellKind.Code]]);
		const cell = notebook.cells.get()[0];
		await notebook.selectionStateMachine.enterEditor();
		return { notebook, cell, editor: cell.currentEditor!, controller: getController(notebook) };
	}

	it('seeds the find input from a single-line selection on start', async () => {
		const { editor, controller } = await editingFixture('dframe = load_data()');

		// Select "dframe" (columns 1-7)
		editor.setSelection({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 7 });
		controller.start();

		expect(controller.findInstance!.searchString.get()).toBe('dframe');
	});

	it('seeded search string triggers the search immediately', async () => {
		const { editor, controller } = await editingFixture('dframe = dframe.head()');

		editor.setSelection({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 7 });
		controller.start();

		expect(controller.findInstance!.matchCount.get()).toBe(2);
		expect(controller.matches.get().length).toBe(2);
	});

	it('seeds the word at the cursor when the selection is empty (default "always")', async () => {
		const { editor, controller } = await editingFixture('dframe = load_data()');

		// Collapse the cursor inside "dframe"
		editor.setPosition({ lineNumber: 1, column: 3 });
		controller.start();

		expect(controller.findInstance!.searchString.get()).toBe('dframe');
	});

	it('does not seed from the word at the cursor when set to "selection"', async () => {
		const { editor, controller } = await editingFixture('dframe = load_data()');
		editor.updateOptions({ find: { seedSearchStringFromSelection: 'selection' } });

		editor.setPosition({ lineNumber: 1, column: 3 });
		controller.start();

		expect(controller.findInstance!.searchString.get()).toBe('');
	});

	it('still seeds from a non-empty selection when set to "selection"', async () => {
		const { editor, controller } = await editingFixture('dframe = load_data()');
		editor.updateOptions({ find: { seedSearchStringFromSelection: 'selection' } });

		editor.setSelection({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 7 });
		controller.start();

		expect(controller.findInstance!.searchString.get()).toBe('dframe');
	});

	it('does not seed when set to "never"', async () => {
		const { editor, controller } = await editingFixture('dframe = load_data()');
		editor.updateOptions({ find: { seedSearchStringFromSelection: 'never' } });

		editor.setSelection({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 7 });
		controller.start();

		expect(controller.findInstance!.searchString.get()).toBe('');
	});

	it('does not seed from a multi-line selection', async () => {
		const { editor, controller } = await editingFixture('line one\nline two');

		editor.setSelection({ startLineNumber: 1, startColumn: 1, endLineNumber: 2, endColumn: 5 });
		controller.start();

		expect(controller.findInstance!.searchString.get()).toBe('');
	});

	it('does not seed when the notebook is in command mode', async () => {
		// Mirrors the built-in notebook editor: the selection only seeds the
		// find input while a cell editor is focused (edit mode).
		const notebook = createNotebook([['dframe = load_data()', 'python', CellKind.Code]]);
		const cell = notebook.cells.get()[0];
		const controller = getController(notebook);
		notebook.selectionStateMachine.selectCell(cell);

		// A stale editor selection exists, but the cell is not being edited
		cell.currentEditor!.setSelection({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 7 });
		controller.start();

		expect(controller.findInstance!.searchString.get()).toBe('');
	});

	it('escapes regex characters in the seeded text when regex mode is on', async () => {
		const { editor, controller } = await editingFixture('df.head() and more'); // "df.head()" has regex chars

		// Open once to enable regex mode, then hide
		controller.start();
		controller.findInstance!.isRegex.set(true, undefined);
		controller.hide();

		// Select "df.head()" (columns 1-10) and re-open
		editor.setSelection({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 10 });
		controller.start();

		expect(controller.findInstance!.searchString.get()).toBe('df\\.head\\(\\)');
	});

	it('re-seeds on a subsequent start while the widget is open', async () => {
		const { editor, controller } = await editingFixture('alpha beta');

		editor.setSelection({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 6 });
		controller.start();
		expect(controller.findInstance!.searchString.get()).toBe('alpha');

		editor.setSelection({ startLineNumber: 1, startColumn: 7, endLineNumber: 1, endColumn: 11 });
		controller.start();
		expect(controller.findInstance!.searchString.get()).toBe('beta');
	});

	it('keeps the existing search string when there is nothing to seed', async () => {
		const { editor, controller } = await editingFixture('alpha beta');
		editor.updateOptions({ find: { seedSearchStringFromSelection: 'selection' } });

		controller.start();
		controller.findInstance!.searchString.set('previous query', undefined);

		// Re-open with an empty selection: the previous query survives
		editor.setPosition({ lineNumber: 1, column: 1 });
		controller.start();
		expect(controller.findInstance!.searchString.get()).toBe('previous query');
	});
});
