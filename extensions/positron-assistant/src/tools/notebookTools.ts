/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { PositronAssistantToolName } from '../types.js';
import { log } from '../extension.js';
import { convertOutputsToLanguageModelParts, formatCellStatus, formatCells } from './notebookUtils.js';

/**
 * Gets the active notebook context, returning null if no notebook is active.
 *
 * @returns The notebook context, or null if no notebook is active
 */
async function getActiveNotebookContext(): Promise<positron.notebooks.NotebookContext | null> {
	return await positron.notebooks.getContext();
}

/**
 * Creates an error result for when no active notebook is found.
 *
 * @returns A LanguageModelToolResult indicating no active notebook
 */
function createNoActiveNotebookErrorResult(): vscode.LanguageModelToolResult {
	return new vscode.LanguageModelToolResult([
		new vscode.LanguageModelTextPart('No active notebook found')
	]);
}

/**
 * Creates an error result for notebook tool operations, logging the error.
 *
 * @param error The error that occurred
 * @param toolName The name of the tool that failed
 * @param operation A description of the operation that failed (e.g., 'execute cells', 'add cell')
 * @returns A LanguageModelToolResult with the error message
 */
function createNotebookToolErrorResult(
	error: unknown,
	toolName: string,
	operation: string
): vscode.LanguageModelToolResult {
	const errorMessage = error instanceof Error ? error.message : String(error);
	log.error(`[${toolName}] Failed to ${operation}: ${errorMessage}`);
	return new vscode.LanguageModelToolResult([
		new vscode.LanguageModelTextPart(`Failed to ${operation}: ${errorMessage}`)
	]);
}

/**
 * Maps cell type strings (case-insensitive) to their corresponding enum values.
 */
const CELL_TYPE_MAP: Record<string, positron.notebooks.NotebookCellType> = {
	'code': positron.notebooks.NotebookCellType.Code,
	'markdown': positron.notebooks.NotebookCellType.Markdown,
};

/**
 * Tool: Run Notebook Cells
 *
 * Executes one or more cells in the active notebook and returns their outputs.
 * Supports both text and image outputs.
 */
export const RunNotebookCellsTool = vscode.lm.registerTool<{
	cellIndices: number[];
}>(PositronAssistantToolName.RunNotebookCells, {
	prepareInvocation: async (options, _token) => {
		return {
			invocationMessage: vscode.l10n.t('Running notebook cells'),
			pastTenseMessage: vscode.l10n.t('Ran notebook cells'),
		};
	},
	invoke: async (options, token) => {
		const cellIndices = options.input.cellIndices;

		try {
			const context = await getActiveNotebookContext();
			if (!context) {
				return createNoActiveNotebookErrorResult();
			}

			await positron.notebooks.runCells(context.uri, cellIndices);

			// Build mixed content response with support for images
			const resultParts: (vscode.LanguageModelTextPart | vscode.LanguageModelDataPart)[] = [];
			resultParts.push(
				new vscode.LanguageModelTextPart(`Successfully executed ${cellIndices.length} cell(s).\n\nOutputs:\n`)
			);

			for (const cellIndex of cellIndices) {
				const cellOutputs = await positron.notebooks.getCellOutputs(context.uri, cellIndex);

				if (cellOutputs.length > 0) {
					resultParts.push(new vscode.LanguageModelTextPart(`\nCell ${cellIndex}:\n`));
					// Convert outputs to LanguageModel parts using shared helper
					const outputParts = convertOutputsToLanguageModelParts(cellOutputs);
					resultParts.push(...outputParts);
				}
			}

			return new vscode.LanguageModelToolResult2(resultParts);
		} catch (error: unknown) {
			return createNotebookToolErrorResult(error, PositronAssistantToolName.RunNotebookCells, 'execute cells');
		}
	}
});

/**
 * Tool: Edit Notebook Cells
 *
 * Performs edit operations on notebook cells: add, update, or delete.
 * Uses a simple enum-based operation parameter for flexibility.
 */
export const EditNotebookCellsTool = vscode.lm.registerTool<{
	operation: 'add' | 'update' | 'delete';
	cellType?: 'code' | 'markdown';
	index?: number;
	content?: string;
	cellIndex?: number;
}>(PositronAssistantToolName.EditNotebookCells, {
	prepareInvocation: async (options, _token) => {
		const { operation } = options.input;
		const messages = {
			add: {
				invocationMessage: vscode.l10n.t('Adding notebook cell'),
				pastTenseMessage: vscode.l10n.t('Added notebook cell'),
			},
			update: {
				invocationMessage: vscode.l10n.t('Updating notebook cell'),
				pastTenseMessage: vscode.l10n.t('Updated notebook cell'),
			},
			delete: {
				invocationMessage: vscode.l10n.t('Deleting notebook cell'),
				pastTenseMessage: vscode.l10n.t('Deleted notebook cell'),
			},
		};
		return messages[operation];
	},
	invoke: async (options, token) => {
		const { operation, cellType, index, content, cellIndex } = options.input;

		try {
			const context = await getActiveNotebookContext();
			if (!context) {
				return createNoActiveNotebookErrorResult();
			}

			switch (operation) {
				case 'add': {
					// Validate required parameters for add operation
					if (!cellType) {
						return new vscode.LanguageModelToolResult([
							new vscode.LanguageModelTextPart('Missing required parameter: cellType (must be "code" or "markdown")')
						]);
					}
					if (index === undefined) {
						return new vscode.LanguageModelToolResult([
							new vscode.LanguageModelTextPart('Missing required parameter: index (position to insert cell)')
						]);
					}
					if (content === undefined) {
						return new vscode.LanguageModelToolResult([
							new vscode.LanguageModelTextPart('Missing required parameter: content (initial cell content)')
						]);
					}

					// Handle append case (-1 means append at end)
					const insertIndex = index === -1 ? context.cellCount : index;

					// Map cell type string to enum (case-insensitive)
					const normalizedCellType = cellType?.toLowerCase();
					const cellTypeEnum = normalizedCellType ? CELL_TYPE_MAP[normalizedCellType] : undefined;
					if (!cellTypeEnum) {
						return new vscode.LanguageModelToolResult([
							new vscode.LanguageModelTextPart(`Unknown cellType: '${cellType}'. Must be 'code' or 'markdown'.`)
						]);
					}

					const newCellIndex = await positron.notebooks.addCell(
						context.uri,
						cellTypeEnum,
						insertIndex,
						content
					);

					return new vscode.LanguageModelToolResult([
						new vscode.LanguageModelTextPart(
							`Successfully added ${cellType} cell at index ${newCellIndex}`
						)
					]);
				}

				case 'update': {
					// Validate required parameters for update operation
					if (cellIndex === undefined) {
						return new vscode.LanguageModelToolResult([
							new vscode.LanguageModelTextPart('Missing required parameter: cellIndex (index of cell to update)')
						]);
					}
					if (content === undefined) {
						return new vscode.LanguageModelToolResult([
							new vscode.LanguageModelTextPart('Missing required parameter: content (new cell content)')
						]);
					}

					await positron.notebooks.updateCellContent(
						context.uri,
						cellIndex,
						content
					);

					return new vscode.LanguageModelToolResult([
						new vscode.LanguageModelTextPart(`Successfully updated cell ${cellIndex}`)
					]);
				}

				case 'delete': {
					// Validate required parameters for delete operation
					if (cellIndex === undefined) {
						return new vscode.LanguageModelToolResult([
							new vscode.LanguageModelTextPart('Missing required parameter: cellIndex (index of cell to delete)')
						]);
					}

					await positron.notebooks.deleteCell(context.uri, cellIndex);

					return new vscode.LanguageModelToolResult([
						new vscode.LanguageModelTextPart(`Successfully deleted cell ${cellIndex}`)
					]);
				}

				default:
					return new vscode.LanguageModelToolResult([
						new vscode.LanguageModelTextPart(
							`Unknown operation: ${operation}. Must be "add", "update", or "delete".`
						)
					]);
			}
		} catch (error: unknown) {
			return createNotebookToolErrorResult(
				error,
				PositronAssistantToolName.EditNotebookCells,
				`${operation} cell`
			);
		}
	}
});

/**
 * Tool: Get Notebook Cells
 *
 * Retrieves information about notebook cells with flexible operation modes.
 * Supports getting specific cells, all cells, selected cells, outputs, or metadata only.
 */
export const GetNotebookCellsTool = vscode.lm.registerTool<{
	operation: 'get' | 'getSelected' | 'getOutputs' | 'getMetadata';
	cellIndices?: number[];
}>(PositronAssistantToolName.GetNotebookCells, {
	prepareInvocation: async (options, _token) => {
		return {
			invocationMessage: vscode.l10n.t('Getting notebook cells'),
			pastTenseMessage: vscode.l10n.t('Retrieved notebook cells'),
		};
	},
	invoke: async (options, token) => {
		const { operation, cellIndices } = options.input;

		try {
			const context = await getActiveNotebookContext();
			if (!context) {
				return createNoActiveNotebookErrorResult();
			}

			switch (operation) {
				case 'get': {
					// If specific cell indices requested, fetch those cells
					if (cellIndices && cellIndices.length > 0) {
						const cells: positron.notebooks.NotebookCell[] = [];
						for (const cellIndex of cellIndices) {
							const cell = await positron.notebooks.getCell(context.uri, cellIndex);
							if (cell) {
								cells.push(cell);
							}
						}

						if (cells.length === 0) {
							return new vscode.LanguageModelToolResult([
								new vscode.LanguageModelTextPart('No cells found with the specified indices')
							]);
						}

						const cellInfo = formatCells({ cells, prefix: 'Cell' });
						return new vscode.LanguageModelToolResult([
							new vscode.LanguageModelTextPart(`Retrieved ${cells.length} cell(s):\n\n${cellInfo}`)
						]);
					}

					// Otherwise, fetch all cells
					const allCells = await positron.notebooks.getCells(context.uri);
					if (allCells.length === 0) {
						return new vscode.LanguageModelToolResult([
							new vscode.LanguageModelTextPart('The notebook has no cells')
						]);
					}

					const cellInfo = formatCells({ cells: allCells, prefix: 'Cell' });
					return new vscode.LanguageModelToolResult([
						new vscode.LanguageModelTextPart(
							`Retrieved all ${allCells.length} cell(s) from notebook:\n\n${cellInfo}`
						)
					]);
				}

				case 'getSelected': {
					// Return only selected cells from context
					if (!context.selectedCells || context.selectedCells.length === 0) {
						return new vscode.LanguageModelToolResult([
							new vscode.LanguageModelTextPart('No cells are currently selected')
						]);
					}

					const cellInfo = formatCells({ cells: context.selectedCells, prefix: 'Cell' });
					return new vscode.LanguageModelToolResult([
						new vscode.LanguageModelTextPart(
							`Retrieved ${context.selectedCells.length} selected cell(s):\n\n${cellInfo}`
						)
					]);
				}

				case 'getOutputs': {
					// Get outputs from specified cells
					if (!cellIndices || cellIndices.length === 0) {
						return new vscode.LanguageModelToolResult([
							new vscode.LanguageModelTextPart(
								'Missing required parameter: cellIndices (required for getOutputs operation)'
							)
						]);
					}

					const resultParts: (vscode.LanguageModelTextPart | vscode.LanguageModelDataPart)[] = [];
					resultParts.push(
						new vscode.LanguageModelTextPart(`Outputs for ${cellIndices.length} cell(s):\n\n`)
					);

					for (const cellIndex of cellIndices) {
						const outputs = await positron.notebooks.getCellOutputs(context.uri, cellIndex);

						if (outputs.length === 0) {
							resultParts.push(
								new vscode.LanguageModelTextPart(`Cell ${cellIndex}: No outputs\n\n`)
							);
						} else {
							resultParts.push(new vscode.LanguageModelTextPart(`Cell ${cellIndex}:\n`));
							const outputParts = convertOutputsToLanguageModelParts(outputs);
							resultParts.push(...outputParts);
							resultParts.push(new vscode.LanguageModelTextPart('\n'));
						}
					}

					return new vscode.LanguageModelToolResult2(resultParts);
				}

				case 'getMetadata': {
					// Get only metadata (status info) without cell content
					let cells: positron.notebooks.NotebookCell[];

					if (cellIndices && cellIndices.length > 0) {
						cells = [];
						for (const cellIndex of cellIndices) {
							const cell = await positron.notebooks.getCell(context.uri, cellIndex);
							if (cell) {
								cells.push(cell);
							}
						}
					} else {
						cells = await positron.notebooks.getCells(context.uri);
					}

					if (cells.length === 0) {
						return new vscode.LanguageModelToolResult([
							new vscode.LanguageModelTextPart('No cells found')
						]);
					}

					// Format metadata only (without content)
					const metadataInfo = formatCells({ cells, prefix: 'Cell', includeContent: false });

					return new vscode.LanguageModelToolResult([
						new vscode.LanguageModelTextPart(
							`Retrieved metadata for ${cells.length} cell(s):\n\n${metadataInfo}`
						)
					]);
				}

				default:
					return new vscode.LanguageModelToolResult([
						new vscode.LanguageModelTextPart(
							`Unknown operation: ${operation}. Must be "get", "getSelected", "getOutputs", or "getMetadata".`
						)
					]);
			}
		} catch (error: unknown) {
			return createNotebookToolErrorResult(
				error,
				PositronAssistantToolName.GetNotebookCells,
				`${operation} cells`
			);
		}
	}
});

/**
 * Register all notebook tools with the extension context.
 *
 * This function should be called during extension activation to register
 * the notebook tools as disposables.
 *
 * @param context The extension context for registering disposables
 */
export function registerNotebookTools(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		RunNotebookCellsTool,
		EditNotebookCellsTool,
		GetNotebookCellsTool
	);
}

