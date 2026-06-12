/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { IPositronNotebookInstance } from '../../browser/IPositronNotebookInstance.js';
import { RemoveAllCellTagsAction, ToggleCellTagsAction } from '../../browser/contrib/cellTags/actions.js';
import { createLabelledTestNotebook, createTestPositronNotebookInstance } from './testPositronNotebookInstance.js';

/**
 * Notebook-wide tag commands operate on the whole notebook rather than a single
 * cell. Their bodies live in `runNotebookAction`, so test-only subclasses expose
 * them without standing up an active editor pane.
 */
describe('ToggleCellTagsAction', () => {
	const ctx = createTestContainer().withNotebookEditorServices().build();

	class TestableToggleCellTagsAction extends ToggleCellTagsAction {
		public testRun(notebook: IPositronNotebookInstance) {
			return this.runNotebookAction(notebook);
		}
	}

	it('toggles notebook-wide cell tag visibility', () => {
		const notebook = createLabelledTestNotebook(1, ctx);
		const action = new TestableToggleCellTagsAction();

		expect(notebook.cellTagsHidden.get()).toBe(false);
		action.testRun(notebook);
		expect(notebook.cellTagsHidden.get()).toBe(true);
		action.testRun(notebook);
		expect(notebook.cellTagsHidden.get()).toBe(false);
	});
});

describe('RemoveAllCellTagsAction', () => {
	const ctx = createTestContainer().withNotebookEditorServices().build();

	class TestableRemoveAllCellTagsAction extends RemoveAllCellTagsAction {
		public testRun(notebook: IPositronNotebookInstance) {
			return this.runNotebookAction(notebook);
		}
	}

	it('clears tags from every cell in the notebook', () => {
		const notebook = createTestPositronNotebookInstance([
			['a', 'python', CellKind.Code, [], { metadata: { tags: ['keep', 'drop'] } }],
			['b', 'python', CellKind.Code, [], { metadata: { tags: ['x'] } }],
			['c', 'python', CellKind.Code],
		], ctx);

		new TestableRemoveAllCellTagsAction().testRun(notebook);

		expect(notebook.cells.get().map(c => c.tags.get())).toEqual([[], [], []]);
	});

	it('is a no-op on a read-only notebook', () => {
		// Tag edits are document mutations; a read-only notebook keeps its tags.
		const notebook = createTestPositronNotebookInstance([
			['a', 'python', CellKind.Code, [], { metadata: { tags: ['kept'] } }],
		], ctx);
		vi.spyOn(notebook, 'isReadOnly', 'get').mockReturnValue(true);

		new TestableRemoveAllCellTagsAction().testRun(notebook);

		expect(notebook.cells.get()[0].tags.get()).toEqual(['kept']);
	});
});
