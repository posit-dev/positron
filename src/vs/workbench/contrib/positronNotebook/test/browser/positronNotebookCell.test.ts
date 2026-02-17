/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { CellKind, NotebookCellsChangeType } from '../../../notebook/common/notebookCommon.js';
import { createTestPositronNotebookEditor } from './testPositronNotebookInstance.js';

suite('PositronNotebookCell', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	/** Tests to ensure that the test harness is correctly setup, useful for debugging */
	suite('Test Harness', () => {
		test('cells have editors auto-attached', () => {
			const notebook = disposables.add(createTestPositronNotebookEditor(
				[['print("hello")', 'python', CellKind.Code]],
			));

			const cell = notebook.cells.get()[0];
			assert.ok(cell.currentEditor, 'Cell should have an auto-attached editor');

			const editorModel = cell.currentEditor.getModel();
			assert.ok(editorModel, 'Cell editor should have a model');

			assert.strictEqual(cell.getContent(), editorModel.getValue(), 'Cell content should match editor model value');
			assert.strictEqual(cell.model.textModel, editorModel, 'Cell model should be the editor model');
			// eslint-disable-next-line local/code-no-any-casts
			assert.strictEqual(cell.model.textBuffer, (editorModel as any)._buffer, 'Cell model should share text buffer with editor model');
		});

		test('setValue propagates through the content change event chain', () => {
			const notebook = disposables.add(createTestPositronNotebookEditor(
				[['original content', 'python', CellKind.Code]],
			));

			const cell = notebook.cells.get()[0];
			const notebookModel = notebook.textModel!;

			// Link 1: NotebookCellTextModel fires onDidChangeContent when textModel changes
			let cellContentFired = false;
			disposables.add(cell.model.onDidChangeContent((e) => {
				if (e === 'content' || (typeof e === 'object' && e.type === 'model')) {
					cellContentFired = true;
				}
			}));

			// Link 2: NotebookTextModel fires onDidChangeContent with ChangeCellContent
			let notebookModelFired = false;
			disposables.add(notebookModel.onDidChangeContent((e) => {
				if (e.rawEvents.some(
					event => event.kind === NotebookCellsChangeType.ChangeCellContent ||
						event.kind === NotebookCellsChangeType.ModelChange)) {
					notebookModelFired = true;
				}
			}));

			cell.model.textModel!.setValue('new content');

			assert.ok(cellContentFired, 'NotebookCellTextModel.onDidChangeContent should fire when textModel.setValue() is called');
			assert.ok(notebookModelFired, 'NotebookTextModel.onDidChangeContent should fire when textModel.setValue() is called');
		});
	});
});
