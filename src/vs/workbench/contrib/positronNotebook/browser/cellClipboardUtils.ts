/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICellDto2 } from '../../notebook/common/notebookCommon.js';
import { IPositronNotebookCell } from './PositronNotebookCells/IPositronNotebookCell.js';

/**
 * Converts a Positron notebook cell to ICellDto2 format for clipboard storage.
 * This preserves all cell data without creating standalone text models.
 */
export function cellToCellDto2(cell: IPositronNotebookCell): ICellDto2 {
	const cellModel = cell.model;

	return {
		source: cell.getContent(),
		language: cellModel.language,
		mime: undefined,
		cellKind: cellModel.cellKind,
		outputs: cellModel.outputs.map(output => ({
			outputId: output.outputId,
			outputs: output.outputs.map(item => ({
				mime: item.mime,
				data: item.data
			}))
		})),
		metadata: {},
		internalMetadata: {},
		collapseState: undefined
	};
}

