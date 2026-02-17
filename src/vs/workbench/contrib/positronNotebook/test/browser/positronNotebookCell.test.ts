/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { createTestPositronNotebookEditor } from './testPositronNotebookEditor.js';

suite('PositronNotebookCell', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('attach test editor to test notebook cell', () => {
		const editor = disposables.add(createTestPositronNotebookEditor(
			[['print("hello")', 'python', CellKind.Code]],
		));
		const { notebook } = editor;

		const cell = notebook.cells.get()[0];

		const cellEditor = editor.attachTestEditorToCell(cell);
		const editorModel = cellEditor.getModel();

		assert.strictEqual(cell.currentEditor, cellEditor, 'Cell should have the attached editor');
		assert.strictEqual(cell.getContent(), editorModel.getValue(), 'Cell content should match editor model value');
		assert.strictEqual(cell.model.textModel, editorModel, 'Cell model should be the editor model');
		// eslint-disable-next-line local/code-no-any-casts
		assert.strictEqual(cell.model.textBuffer, (editorModel as any)._buffer, 'Cell model should share text buffer with editor model');
	});
});
