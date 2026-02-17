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
	getFindMatchDecorations,
	getCellSelection,
	createTestPositronNotebookEditor,
} from '../../testPositronNotebookInstance.js';

suite('PositronNotebookFindController', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('controller is instantiated with notebook instance', () => {
		const notebook = disposables.add(createTestPositronNotebookEditor(
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

	test('finds matches across cells with correct decorations', async () => {
		const notebook = disposables.add(createTestPositronNotebookEditor(
			[
				['match here', 'typescript', CellKind.Code],
				['no hit', 'typescript', CellKind.Code],
				['another match', 'typescript', CellKind.Code],
			],
		));

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
