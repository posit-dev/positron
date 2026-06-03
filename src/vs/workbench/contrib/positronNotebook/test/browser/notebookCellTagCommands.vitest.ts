/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { IPositronNotebookInstance } from '../../browser/IPositronNotebookInstance.js';
import { ToggleCellTagsAction } from '../../browser/positronNotebook.contribution.js';
import { createLabelledTestNotebook } from './testPositronNotebookInstance.js';

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
