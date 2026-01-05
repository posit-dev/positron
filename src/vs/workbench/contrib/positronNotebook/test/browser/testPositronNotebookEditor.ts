/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { NotebookTextModel } from '../../../notebook/common/model/notebookTextModel.js';
import { ICellDto2 } from '../../../notebook/common/notebookCommon.js';
import { MockNotebookCell } from '../../../notebook/test/browser/testNotebookEditor.js';
import { IPositronNotebookInstance } from '../../browser/IPositronNotebookInstance.js';
import { PositronNotebookInstance } from '../../browser/PositronNotebookInstance.js';
import { positronWorkbenchInstantiationService } from '../../../../test/browser/positronWorkbenchTestServices.js';

/**
 * Converts a MockNotebookCell tuple to ICellDto2 format for NotebookTextModel.
 */
function cellToDto(cell: MockNotebookCell): ICellDto2 {
	const [source, language, cellKind, outputs, metadata] = cell;
	return {
		source,
		mime: undefined,
		language,
		cellKind,
		outputs: outputs || [],
		metadata: metadata || {},
		internalMetadata: {},
	};
}

/**
 * Test utility for creating a PositronNotebookInstance with test infrastructure.
 *
 * @param cells Array of cell data in shorthand format
 * @param callback Test function that receives the notebook instance
 * @returns Result from the callback
 *
 * @example
 * ```typescript
 * await withTestPositronNotebook(
 *   [
 *     ['print("hello")', 'python', CellKind.Code],
 *     ['# Markdown', 'markdown', CellKind.Markup],
 *   ],
 *   async (notebook) => {
 *     const controller = PositronNotebookFindController.get(notebook);
 *     assert.ok(controller);
 *   }
 * );
 * ```
 */
export async function withTestPositronNotebook<R = unknown>(
	cells: MockNotebookCell[],
	callback: (
		notebook: IPositronNotebookInstance,
		instantiationService: TestInstantiationService,
	) => Promise<R> | R,
): Promise<R> {
	const disposables = new DisposableStore();

	try {
		// Setup services
		const instantiationService = positronWorkbenchInstantiationService(disposables);

		// Create the notebook instance
		const viewType = 'jupyter-notebook';
		const uri = URI.parse('test:///test/notebook.ipynb');
		const notebook = disposables.add(PositronNotebookInstance.getOrCreate(
			'test-unique-id',
			uri,
			viewType,
			undefined, // creationOptions
			instantiationService
		));

		// Set the notebook's text model
		const cellDtos = cells.map((cell) => cellToDto(cell));
		const model = disposables.add(instantiationService.createInstance(
			NotebookTextModel,
			notebook.viewType,
			notebook.uri,
			cellDtos,
			{}, // metadata
			{
				transientCellMetadata: {},
				transientDocumentMetadata: {},
				cellContentMetadata: {},
				transientOutputs: false
			}
		));
		notebook.setModel(model);

		// Run the test callback
		const result = await callback(notebook, instantiationService);

		return result;
	} finally {
		disposables.dispose();
	}
}
