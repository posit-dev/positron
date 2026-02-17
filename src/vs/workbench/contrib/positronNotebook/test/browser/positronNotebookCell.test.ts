/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { createTestPositronNotebookEditor } from './testPositronNotebookInstance.js';

suite('PositronNotebookCell', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

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
});
