/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICellDto2 } from '../../notebook/common/notebookCommon.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { CellKind, IPositronNotebookCell } from './PositronNotebookCells/IPositronNotebookCell.js';

/**
 * Converts a Positron notebook cell to ICellDto2 format for clipboard storage.
 * This preserves all cell data without creating standalone text models.
 */
export function cellToCellDto2(cell: IPositronNotebookCell): ICellDto2 {
	const cellModel = cell.cellModel;

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

/**
 * Serializes cells to a JSON string for system clipboard storage.
 * This enables pasting cells into other applications or notebooks.
 */
export function serializeCellsToClipboard(cells: IPositronNotebookCell[]): string {
	const cellsData = cells.map(cell => {
		const cellModel = cell.cellModel;

		// Create a serializable representation of the cell
		const cellData = {
			cell_type: cellModel.cellKind === CellKind.Code ? 'code' : 'markdown',
			source: splitIntoLines(cell.getContent()),
			metadata: {},
			// For code cells, include outputs
			...(cellModel.cellKind === CellKind.Code ? {
				outputs: cellModel.outputs.map(output => ({
					output_type: 'display_data',
					data: output.outputs.reduce((acc, item) => {
						// Convert output items to a format compatible with Jupyter
						acc[item.mime] = item.data.toString();
						return acc;
						// eslint-disable-next-line local/code-no-dangerous-type-assertions
					}, {} as Record<string, string>),
					metadata: {}
				})),
				execution_count: null
			} : {})
		};

		return cellData;
	});

	// Wrap in a notebook-like structure for compatibility
	const notebookData = {
		cells: cellsData,
		metadata: {
			kernelspec: {},
			language_info: {}
		},
		nbformat: 4,
		nbformat_minor: 2
	};

	return JSON.stringify(notebookData, null, 2);
}

/**
 * Deserializes cells from a clipboard string to ICellDto2 format.
 * Handles both Positron and standard Jupyter notebook formats.
 */
export function deserializeCellsFromClipboard(clipboardData: string): ICellDto2[] | null {
	try {
		const data = JSON.parse(clipboardData);

		// Check if it's a notebook format (has cells array)
		const cells = data.cells || (Array.isArray(data) ? data : null);

		if (!cells) {
			return null;
		}

		return cells.map((cellData: any) => {
			// Determine cell kind
			const cellKind = cellData.cell_type === 'code' ? CellKind.Code : CellKind.Markup;

			// Handle source - could be array of strings or single string
			const source = Array.isArray(cellData.source)
				? cellData.source.join('')
				: (cellData.source || '');

			// Handle outputs for code cells
			const outputs = [];
			if (cellKind === CellKind.Code && cellData.outputs) {
				for (const output of cellData.outputs) {
					const outputItems = [];

					// Handle different output formats
					if (output.data) {
						for (const [mime, content] of Object.entries(output.data)) {
							outputItems.push({
								mime,
								data: VSBuffer.fromString(content as string)
							});
						}
					} else if (output.text) {
						// Handle stream outputs
						outputItems.push({
							mime: 'text/plain',
							data: VSBuffer.fromString(Array.isArray(output.text) ? output.text.join('') : output.text)
						});
					}

					if (outputItems.length > 0) {
						outputs.push({
							outputId: output.output_id || crypto.randomUUID(),
							outputs: outputItems
						});
					}
				}
			}

			// Return ICellDto2 format
			return {
				source,
				language: cellData.language || (cellKind === CellKind.Code ? 'python' : 'markdown'),
				mime: cellData.mime,
				cellKind,
				outputs,
				metadata: cellData.metadata || {},
				internalMetadata: {
					executionOrder: cellData.execution_count || undefined,
					lastRunSuccess: undefined,
					runStartTime: undefined,
					runEndTime: undefined
				},
				collapseState: undefined
			};
		});
	} catch (error) {
		// Failed to parse clipboard data
		return null;
	}
}

/**
 * Helper function to split content into lines for Jupyter format
 */
function splitIntoLines(content: string): string[] {
	if (!content) {
		return [];
	}

	// Split by newlines but preserve the newline characters
	const lines = content.split(/(\r?\n)/);
	const result: string[] = [];

	for (let i = 0; i < lines.length; i += 2) {
		if (i + 1 < lines.length) {
			result.push(lines[i] + lines[i + 1]);
		} else if (lines[i]) {
			result.push(lines[i]);
		}
	}

	return result;
}
