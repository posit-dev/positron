/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
// Register the find contribution
import '../../../../browser/contrib/find/positronNotebookFind.contribution.js';

import assert from 'assert';
import { timeout } from '../../../../../../../base/common/async.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../../base/test/common/utils.js';
import { CellKind } from '../../../../../notebook/common/notebookCommon.js';
import { PositronNotebookFindController } from '../../../../browser/contrib/find/controller.js';
import {
	attachTestEditorsToAllCells,
	getFindMatchDecorations,
	getCellSelection,
	createTestPositronNotebookEditor,
} from '../../testPositronNotebookEditor.js';

suite('PositronNotebookFindController', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('controller is instantiated with notebook instance', () => {
		const { notebook } = disposables.add(createTestPositronNotebookEditor(
			[
				['print("hello world")', 'python', CellKind.Code],
				['# Markdown cell', 'markdown', CellKind.Markup],
			],
		));

		const controller = PositronNotebookFindController.get(notebook);

		assert.ok(controller, 'Find controller should be instantiated');
		assert.strictEqual(
			controller.constructor.name,
			'PositronNotebookFindController',
			'Should be the correct controller type'
		);
	});

	test('notebook instance has cells from text model', () => {
		const { notebook } = disposables.add(createTestPositronNotebookEditor(
			[
				['print("hello")', 'python', CellKind.Code],
				['print("world")', 'python', CellKind.Code],
			],
		));

		const cells = notebook.cells.get();
		assert.strictEqual(cells.length, 2, 'Should have 2 cells');
		assert.strictEqual(cells[0].model.getValue(), 'print("hello")');
		assert.strictEqual(cells[1].model.getValue(), 'print("world")');
	});

	test('attach test editor to test notebook cell', () => {
		const { notebook, instantiationService } = disposables.add(createTestPositronNotebookEditor(
			[['print("hello")', 'python', CellKind.Code]],
		));

		const cell = notebook.cells.get()[0];

		const editors = attachTestEditorsToAllCells(notebook, instantiationService);
		disposables.add(editors[0]);
		const editorModel = editors[0].getModel()!;

		assert.strictEqual(cell.currentEditor, editors[0], 'Cell should have the attached editor');
		assert.strictEqual(cell.getContent(), editorModel.getValue(), 'Cell content should match editor model value');
		assert.strictEqual(cell.model.textModel, editorModel, 'Cell model should be the editor model');
		// eslint-disable-next-line local/code-no-any-casts
		assert.strictEqual(cell.model.textBuffer, (editorModel as any)._buffer, 'Cell model should share text buffer with editor model');
	});

	test('attach test editors to cell', () => {
		const { notebook, instantiationService } = disposables.add(createTestPositronNotebookEditor(
			[
				['print("hello")', 'python', CellKind.Code],
				['# Hello', 'markdown', CellKind.Markup],
			],
		));

		// Verify that no editors are attached to begin with
		assert.ok(notebook.cells.get()[0].currentEditor === undefined, 'first cell should not have an editor');
		assert.ok(notebook.cells.get()[1].currentEditor === undefined, 'second cell should not have an editor');

		const editors = attachTestEditorsToAllCells(notebook, instantiationService);
		editors.forEach(editor => disposables.add(editor));

		// Verify that the editors were attached
		assert.strictEqual(notebook.cells.get()[0].currentEditor, editors[0], 'first cell should have an editor');
		assert.strictEqual(notebook.cells.get()[1].currentEditor, editors[1], 'second cell should have an editor');

		// Test some basic interaction between editor, cell, and notebook
		editors[0].executeEdits('test', [{
			range: editors[0].getModel()!.getFullModelRange(),
			text: 'print("hello world")'
		}]);
		assert.strictEqual(editors[0].getValue(), 'print("hello world")', 'editor content should update when editor value changes');
		assert.strictEqual(notebook.cells.get()[0].getContent(), 'print("hello world")', 'cell content should update when editor value changes');
	});

	test('finds matches across cells with correct decorations', async () => {
		const { notebook, instantiationService } = disposables.add(createTestPositronNotebookEditor(
			[
				['match here', 'typescript', CellKind.Code],
				['no hit', 'typescript', CellKind.Code],
				['another match', 'typescript', CellKind.Code],
			],
		));

		// Attach editors to all cells
		const editors = attachTestEditorsToAllCells(notebook, instantiationService);
		editors.forEach(editor => disposables.add(editor));

		// Start find and search
		const controller = PositronNotebookFindController.get(notebook)!;
		controller.start();
		// eslint-disable-next-line local/code-no-any-casts
		(controller as any)._findInstance.searchString.set('match', undefined);
		await timeout(50);

		// Verify decorations via editor model
		const cells = notebook.cells.get();

		const cell0Decs = getFindMatchDecorations(cells[0]);
		assert.strictEqual(cell0Decs.length, 1, 'Cell 0 should have 1 decoration');
		assert.deepStrictEqual(
			[cell0Decs[0].range.startColumn, cell0Decs[0].range.endColumn],
			[1, 6]
		);

		const cell1Decs = getFindMatchDecorations(cells[1]);
		assert.strictEqual(cell1Decs.length, 0, 'Cell 1 should have no decorations');

		const cell2Decs = getFindMatchDecorations(cells[2]);
		assert.strictEqual(cell2Decs.length, 1, 'Cell 2 should have 1 decoration');

		// Navigate and verify selection
		controller.findNext();
		await timeout(10);

		const selection = getCellSelection(cells[0]);
		assert.deepStrictEqual(selection, [1, 1, 1, 6]);
	});
});
