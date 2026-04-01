/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { CellEditType, CellKind, NotebookCellsChangeType } from '../../../notebook/common/notebookCommon.js';
import { createTestPositronNotebookInstance, TestPositronNotebookInstance } from './testPositronNotebookInstance.js';
import { PositronNotebookCodeCell } from '../../browser/PositronNotebookCells/PositronNotebookCodeCell.js';

suite('PositronNotebookCell', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	let notebook: TestPositronNotebookInstance;
	let cell: PositronNotebookCodeCell;

	setup(() => {
		notebook = createTestPositronNotebookInstance(
			[['print("hello")', 'python', CellKind.Code]], disposables
		);
		cell = notebook.cells.get()[0] as PositronNotebookCodeCell;
		assert.ok(cell.isCodeCell(), 'Expected cell to be a code cell');
	});

	suite('Output scrolling state', () => {
		test('outputScrolling defaults to undefined', () => {
			assert.strictEqual(cell.outputScrolling.get(), undefined);
		});

		test('truncateOutput sets outputScrolling to false', () => {
			cell.truncateOutput();
			assert.strictEqual(cell.outputScrolling.get(), false);
		});

		test('showFullOutput sets outputScrolling to true', () => {
			cell.showFullOutput();
			assert.strictEqual(cell.outputScrolling.get(), true);
		});

		test('collapse and expand does not affect scrolling state', () => {
			// Verify with scrolling = true (showing full output)
			cell.showFullOutput();
			cell.collapseOutput();
			assert.strictEqual(cell.outputScrolling.get(), true);
			cell.expandOutput();
			assert.strictEqual(cell.outputScrolling.get(), true);

			// Verify with scrolling = false (truncated)
			cell.truncateOutput();
			cell.collapseOutput();
			assert.strictEqual(cell.outputScrolling.get(), false);
			cell.expandOutput();
			assert.strictEqual(cell.outputScrolling.get(), false);
		});

		test('new output resets scrolling state to undefined', () => {
			const textModel = notebook.textModel;
			assert.ok(textModel);

			const applyNewOutput = () => textModel.applyEdits([{
				editType: CellEditType.Output,
				index: 0,
				outputs: [{
					outputId: `output-${Math.random()}`,
					outputs: [{ mime: 'application/vnd.code.notebook.stdout', data: VSBuffer.fromString('new output') }],
				}],
				append: false,
			}], true, undefined, () => undefined, undefined, false);

			// Reset from showing full output (true -> undefined)
			cell.showFullOutput();
			assert.strictEqual(cell.outputScrolling.get(), true);
			applyNewOutput();
			assert.strictEqual(cell.outputScrolling.get(), undefined);

			// Reset from truncated (false -> undefined)
			cell.truncateOutput();
			assert.strictEqual(cell.outputScrolling.get(), false);
			applyNewOutput();
			assert.strictEqual(cell.outputScrolling.get(), undefined);
		});
	});

});

/** Tests to ensure that the test harness is correctly setup, useful for debugging the test harness */
suite('PositronNotebookCell Test Harness', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('cells have editors auto-attached', () => {
		const notebook = createTestPositronNotebookInstance(
			[['print("hello")', 'python', CellKind.Code]], disposables
		);

		const cell = notebook.cells.get()[0];
		assert.ok(cell.currentEditor, 'Cell should have an auto-attached editor');

		const editorModel = cell.currentEditor.getModel();
		assert.ok(editorModel, 'Cell editor should have a model');

		assert.strictEqual(cell.getContent(), editorModel.getValue(), 'Cell content should match editor model value');
		assert.strictEqual(cell.model.textModel, editorModel, 'Cell model should be the editor model');
	});

	test('setValue propagates through the content change event chain', () => {
		const notebook = createTestPositronNotebookInstance(
			[['original content', 'python', CellKind.Code]], disposables
		);

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
