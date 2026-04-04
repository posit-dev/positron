/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { CellEditType, CellKind, NotebookCellsChangeType } from '../../../notebook/common/notebookCommon.js';
import { createTestPositronNotebookInstance, TestPositronNotebookInstance } from './testPositronNotebookInstance.js';
import { createTestContainer } from '../../../../test/browser/positronTestContainer.js';
import { PositronNotebookCodeCell } from '../../browser/PositronNotebookCells/PositronNotebookCodeCell.js';

// testPositronNotebookInstance creates its own instantiation service internally;
// we only need the disposables from the container for cleanup.
const ctx = createTestContainer().build();
const disposables = ctx.disposables;

describe('PositronNotebookCell', () => {

	let notebook: TestPositronNotebookInstance;
	let cell: PositronNotebookCodeCell;

	beforeEach(() => {
		notebook = createTestPositronNotebookInstance(
			[['print("hello")', 'python', CellKind.Code]], disposables
		);
		cell = notebook.cells.get()[0] as PositronNotebookCodeCell;
		expect(cell.isCodeCell()).toBeTruthy();
	});

	describe('Output scrolling state', () => {
		it('outputScrolling defaults to undefined', () => {
			expect(cell.outputScrolling.get()).toBe(undefined);
		});

		it('truncateOutput sets outputScrolling to false', () => {
			cell.truncateOutput();
			expect(cell.outputScrolling.get()).toBe(false);
		});

		it('showFullOutput sets outputScrolling to true', () => {
			cell.showFullOutput();
			expect(cell.outputScrolling.get()).toBe(true);
		});

		it('collapse and expand does not affect scrolling state', () => {
			// Verify with scrolling = true (showing full output)
			cell.showFullOutput();
			cell.collapseOutput();
			expect(cell.outputScrolling.get()).toBe(true);
			cell.expandOutput();
			expect(cell.outputScrolling.get()).toBe(true);

			// Verify with scrolling = false (truncated)
			cell.truncateOutput();
			cell.collapseOutput();
			expect(cell.outputScrolling.get()).toBe(false);
			cell.expandOutput();
			expect(cell.outputScrolling.get()).toBe(false);
		});

		it('new output resets scrolling state to undefined', () => {
			const textModel = notebook.textModel;
			expect(textModel).toBeTruthy();

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
			expect(cell.outputScrolling.get()).toBe(true);
			applyNewOutput();
			expect(cell.outputScrolling.get()).toBe(undefined);

			// Reset from truncated (false -> undefined)
			cell.truncateOutput();
			expect(cell.outputScrolling.get()).toBe(false);
			applyNewOutput();
			expect(cell.outputScrolling.get()).toBe(undefined);
		});
	});

});

/** Tests to ensure that the test harness is correctly setup, useful for debugging the test harness */
describe('PositronNotebookCell Test Harness', () => {

	it('cells have editors auto-attached', () => {
		const notebook = createTestPositronNotebookInstance(
			[['print("hello")', 'python', CellKind.Code]], disposables
		);

		const cell = notebook.cells.get()[0];
		expect(cell.currentEditor, 'Cell should have an auto-attached editor').toBeTruthy();

		const editorModel = cell.currentEditor.getModel();
		expect(editorModel, 'Cell editor should have a model').toBeTruthy();

		expect(cell.getContent()).toBe(editorModel.getValue(), 'Cell content should match editor model value');
		expect(cell.model.textModel).toBe(editorModel);
	});

	it('setValue propagates through the content change event chain', () => {
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

		expect(cellContentFired, 'NotebookCellTextModel.onDidChangeContent should fire when textModel.setValue().toBeTruthy() is called');
		expect(notebookModelFired, 'NotebookTextModel.onDidChangeContent should fire when textModel.setValue().toBeTruthy() is called');
	});
});
