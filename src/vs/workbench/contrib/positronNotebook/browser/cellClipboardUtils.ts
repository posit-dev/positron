/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICellDto2 } from '../../notebook/common/notebookCommon.js';
import { IPositronNotebookCell } from './PositronNotebookCells/IPositronNotebookCell.js';

/**
 * Options for controlling what cell data is preserved during conversion.
 */
interface CellDtoOptions {
	/** Include cell outputs (images, plots, etc.) - can be large */
	includeOutputs?: boolean;
	/** Include cell metadata (mime, tags, execution info, collapse state) */
	includeMetadata?: boolean;
}

/**
 * Base function for converting a Positron notebook cell to ICellDto2 format.
 * Use the specialized functions `cellToCellDto2` or `cellToCellDtoForRestore` instead.
 */
function cellToCellDtoBase(cell: IPositronNotebookCell, options: CellDtoOptions): ICellDto2 {
	const cellModel = cell.model;

	return {
		source: cell.getContent(),
		language: cellModel.language,
		mime: options.includeMetadata ? cellModel.mime : undefined,
		cellKind: cellModel.cellKind,
		outputs: options.includeOutputs
			? cellModel.outputs.map(output => ({
				outputId: output.outputId,
				outputs: output.outputs.map(item => ({
					mime: item.mime,
					data: item.data
				}))
			}))
			: [],
		metadata: options.includeMetadata ? cellModel.metadata : {},
		internalMetadata: options.includeMetadata ? cellModel.internalMetadata : {},
		collapseState: options.includeMetadata ? cellModel.collapseState : undefined
	};
}

/**
 * Converts a Positron notebook cell to ICellDto2 format for clipboard storage.
 * Preserves outputs for pasting but omits metadata.
 */
export function cellToCellDto2(cell: IPositronNotebookCell): ICellDto2 {
	return cellToCellDtoBase(cell, { includeOutputs: true, includeMetadata: false });
}

/**
 * Converts a Positron notebook cell to ICellDto2 format for restoration.
 * Preserves metadata for faithful restoration but omits outputs to save memory.
 *
 * Note: Outputs are intentionally omitted to avoid memory concerns with large outputs
 * (images, plots, DataFrames). To add output restoration later, change the options to:
 * { includeOutputs: true, includeMetadata: true }
 */
export function cellToCellDtoForRestore(cell: IPositronNotebookCell): ICellDto2 {
	return cellToCellDtoBase(cell, { includeOutputs: false, includeMetadata: true });
}

