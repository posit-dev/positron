/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { createTestPositronNotebookEditor } from './testPositronNotebookEditor.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';

suite('PositronNotebookInstance', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('notebook has cells from notebook text model', () => {
		const { notebook } = disposables.add(createTestPositronNotebookEditor(
			[
				['print("hello")', 'python', CellKind.Code],
				['print("world")', 'python', CellKind.Code],
			],
		));

		const cells = notebook.cells.get();
		assert.strictEqual(cells.length, 2, 'Unexpected number of cells in notebook');
		assert.strictEqual(cells[0].model.getValue(), 'print("hello")', 'Unexpected content for notebook cell 0');
		assert.strictEqual(cells[1].model.getValue(), 'print("world")', 'Unexpected content for notebook cell 1');

		const { textModel } = notebook;
		assert.ok(textModel, 'Notebook should have a text model');
		assert.strictEqual(textModel.cells[0].getValue(), 'print("hello")', 'Unexpected content for text model cell 0');
		assert.strictEqual(textModel.cells[1].getValue(), 'print("world")', 'Unexpected content for text model cell 1');
	});
});
