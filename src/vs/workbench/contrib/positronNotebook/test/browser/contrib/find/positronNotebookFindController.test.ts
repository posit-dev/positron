/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
// Register the find contribution
import '../../../../browser/contrib/find/positronNotebookFind.contribution.js';

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../../base/test/common/utils.js';
import { CellKind } from '../../../../../notebook/common/notebookCommon.js';
import { PositronNotebookFindController } from '../../../../browser/contrib/find/controller.js';
import { withTestPositronNotebook } from '../../testPositronNotebookEditor.js';

suite('PositronNotebookFindController', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('controller is instantiated with notebook instance', async () => {
		await withTestPositronNotebook(
			[
				['print("hello world")', 'python', CellKind.Code],
				['# Markdown cell', 'markdown', CellKind.Markup],
			],
			async (notebook) => {
				// Get the find controller contribution
				// The controller is registered in PositronNotebookInstance constructor
				const controller = PositronNotebookFindController.get(notebook);

				// Verify it was instantiated
				assert.ok(controller, 'Find controller should be instantiated');
				assert.strictEqual(
					controller.constructor.name,
					'PositronNotebookFindController',
					'Should be the correct controller type'
				);
			}
		);
	});

	test('notebook instance has cells from text model', async () => {
		await withTestPositronNotebook(
			[
				['print("hello")', 'python', CellKind.Code],
				['print("world")', 'python', CellKind.Code],
			],
			async (notebook) => {
				// Verify the notebook has the expected cells
				const cells = notebook.cells.get();
				assert.strictEqual(cells.length, 2, 'Should have 2 cells');
				assert.strictEqual(cells[0].model.getValue(), 'print("hello")');
				assert.strictEqual(cells[1].model.getValue(), 'print("world")');
			}
		);
	});
});
