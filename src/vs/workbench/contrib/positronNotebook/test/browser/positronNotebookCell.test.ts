/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { CellEditType, CellKind, NotebookCellsChangeType } from '../../../notebook/common/notebookCommon.js';
import { createTestPositronNotebookInstance } from './testPositronNotebookInstance.js';

suite('PositronNotebookCell', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	suite('Output truncation state', () => {
		test('outputIsTruncated defaults to undefined', () => {
			const notebook = createTestPositronNotebookInstance(
				[['print("hello")', 'python', CellKind.Code]], disposables
			);
			const cell = notebook.cells.get()[0];
			assert.ok(cell.isCodeCell());
			assert.strictEqual(cell.outputIsTruncated.get(), undefined);
		});

		test('truncateOutput sets outputIsTruncated to true', () => {
			const notebook = createTestPositronNotebookInstance(
				[['print("hello")', 'python', CellKind.Code]], disposables
			);
			const cell = notebook.cells.get()[0];
			assert.ok(cell.isCodeCell());
			cell.truncateOutput();
			assert.strictEqual(cell.outputIsTruncated.get(), true);
		});

		test('showFullOutput sets outputIsTruncated to false', () => {
			const notebook = createTestPositronNotebookInstance(
				[['print("hello")', 'python', CellKind.Code]], disposables
			);
			const cell = notebook.cells.get()[0];
			assert.ok(cell.isCodeCell());
			cell.showFullOutput();
			assert.strictEqual(cell.outputIsTruncated.get(), false);
		});

		test('truncateOutput after showFullOutput toggles back to true', () => {
			const notebook = createTestPositronNotebookInstance(
				[['print("hello")', 'python', CellKind.Code]], disposables
			);
			const cell = notebook.cells.get()[0];
			assert.ok(cell.isCodeCell());
			cell.showFullOutput();
			assert.strictEqual(cell.outputIsTruncated.get(), false);
			cell.truncateOutput();
			assert.strictEqual(cell.outputIsTruncated.get(), true);
		});

		test('collapse and expand does not affect truncation state', () => {
			const notebook = createTestPositronNotebookInstance(
				[['print("hello")', 'python', CellKind.Code]], disposables
			);
			const cell = notebook.cells.get()[0];
			assert.ok(cell.isCodeCell());

			// Verify with truncation = false (showing full output)
			cell.showFullOutput();
			cell.collapseOutput();
			assert.strictEqual(cell.outputIsTruncated.get(), false, 'showing full: unchanged after collapse');
			cell.expandOutput();
			assert.strictEqual(cell.outputIsTruncated.get(), false, 'showing full: unchanged after expand');

			// Verify with truncation = true (truncated)
			cell.truncateOutput();
			cell.collapseOutput();
			assert.strictEqual(cell.outputIsTruncated.get(), true, 'truncated: unchanged after collapse');
			cell.expandOutput();
			assert.strictEqual(cell.outputIsTruncated.get(), true, 'truncated: unchanged after expand');
		});

		test('new output resets truncation state to undefined', () => {
			const notebook = createTestPositronNotebookInstance(
				[['print("hello")', 'python', CellKind.Code]], disposables
			);
			const cell = notebook.cells.get()[0];
			assert.ok(cell.isCodeCell());
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

			// Reset from showing full output (false -> undefined)
			cell.showFullOutput();
			assert.strictEqual(cell.outputIsTruncated.get(), false, 'precondition: showFullOutput sets false');
			applyNewOutput();
			assert.strictEqual(cell.outputIsTruncated.get(), undefined, 'should reset from false');

			// Reset from truncated (true -> undefined)
			cell.truncateOutput();
			assert.strictEqual(cell.outputIsTruncated.get(), true, 'precondition: truncateOutput sets true');
			applyNewOutput();
			assert.strictEqual(cell.outputIsTruncated.get(), undefined, 'should reset from true');
		});
	});

	/** Tests to ensure that the test harness is correctly setup, useful for debugging the test harness */
	suite('Test Harness', () => {
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
});
