/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { PositronAssistantToolName } from '../types.js';
import { log } from '../extension.js';
import { convertOutputsToLanguageModelParts, formatCells, validateCellIndices, MAX_CELL_CONTENT_LENGTH } from './notebookUtils.js';

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
		const cellIndices = options.input.cellIndices;

		// Get the active notebook context to fetch cell previews
		const context = await getActiveNotebookContext();
		if (!context) {
			// If no notebook is active, we still need to return a PreparedToolInvocation
			// The actual error will be shown during invoke()
			return {
				invocationMessage: vscode.l10n.t('Running notebook cells'),
				pastTenseMessage: vscode.l10n.t('Ran notebook cells'),
			};
		}

		// Build simple confirmation message
		const cellList = cellIndices.length <= 5
			? cellIndices.join(', ')
			: `${cellIndices.slice(0, 5).join(', ')}, and ${cellIndices.length - 5} more`;

		const message = cellIndices.length === 1
			? vscode.l10n.t('Execute cell {0}?', cellIndices[0])
			: vscode.l10n.t('Execute {0} cells ({1})?', cellIndices.length, cellList);

		return {
			invocationMessage: vscode.l10n.t('Running notebook cells'),
			confirmationMessages: {
				title: vscode.l10n.t('Run Notebook Cells'),
				message: message
			},
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

			// Validate cell indices
			const validation = validateCellIndices(cellIndices, context.cellCount);
			if (!validation.valid) {
				return new vscode.LanguageModelToolResult([
					new vscode.LanguageModelTextPart(validation.error!)
				]);
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
	run?: boolean;
}>(PositronAssistantToolName.EditNotebookCells, {
	prepareInvocation: async (options, _token) => {
		const { operation, cellType, cellIndex, run } = options.input;

		// Get the active notebook context
		const context = await getActiveNotebookContext();
		if (!context) {
			// If no notebook is active, return basic messages
			// The actual error will be shown during invoke()
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
		}

		// Build confirmation messages based on operation type
		switch (operation) {
			case 'add': {
				const willRun = run !== false && cellType === 'code';
				const message = willRun
					? vscode.l10n.t('Add a {0} cell and run it?', cellType || 'new')
					: vscode.l10n.t('Add a {0} cell?', cellType || 'new');
				const invocationMessage = willRun
					? vscode.l10n.t('Adding and running notebook cell')
					: vscode.l10n.t('Adding notebook cell');
				const pastTenseMessage = willRun
					? vscode.l10n.t('Added and ran notebook cell')
					: vscode.l10n.t('Added notebook cell');
				return {
					invocationMessage,
					confirmationMessages: {
						title: vscode.l10n.t('Add Notebook Cell'),
						message: message
					},
					pastTenseMessage,
				};
			}

			case 'update': {
				const message = vscode.l10n.t('Update the content of cell {0}?', cellIndex);
				return {
					invocationMessage: vscode.l10n.t('Updating notebook cell'),
					confirmationMessages: {
						title: vscode.l10n.t('Update Notebook Cell'),
						message: message
					},
					pastTenseMessage: vscode.l10n.t('Updated notebook cell'),
				};
			}

			case 'delete': {
				// Try to fetch cell type for better message
				let cellTypeLabel = 'cell';
				if (cellIndex !== undefined) {
					try {
						const cell = await positron.notebooks.getCell(context.uri, cellIndex);
						if (cell) {
							cellTypeLabel = cell.type === 'code' ? 'code cell' : 'markdown cell';
						}
					} catch (error) {
						// Use default label if fetch fails
					}
				}

				const message = vscode.l10n.t('Delete {0} {1}? This cannot be undone.', cellTypeLabel, cellIndex);
				return {
					invocationMessage: vscode.l10n.t('Deleting notebook cell'),
					confirmationMessages: {
						title: vscode.l10n.t('Delete Notebook Cell'),
						message: message
					},
					pastTenseMessage: vscode.l10n.t('Deleted notebook cell'),
				};
			}

			default:
				return {
					invocationMessage: vscode.l10n.t('Editing notebook cell'),
					pastTenseMessage: vscode.l10n.t('Edited notebook cell'),
				};
		}
	},
	invoke: async (options, token) => {
		const { operation, cellType, index, content, cellIndex, run } = options.input;

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

					// Validate content length
					if (content.length > MAX_CELL_CONTENT_LENGTH) {
						return new vscode.LanguageModelToolResult([
							new vscode.LanguageModelTextPart(
								`Content too large: ${content.length} bytes exceeds maximum of ${MAX_CELL_CONTENT_LENGTH} bytes`
							)
						]);
					}

					// Handle append case (-1 means append at end)
					const insertIndex = index === -1 ? context.cellCount : index;

					// Validate insert index (must be between 0 and cellCount inclusive)
					if (!Number.isInteger(insertIndex) || insertIndex < 0 || insertIndex > context.cellCount) {
						return new vscode.LanguageModelToolResult([
							new vscode.LanguageModelTextPart(
								`Invalid insert index: ${insertIndex}. Must be between 0 and ${context.cellCount} (inclusive)`
							)
						]);
					}

					// Map cell type string to enum (case-insensitive)
					const normalizedCellType = cellType?.toLowerCase();
					const cellTypeEnum = normalizedCellType ? CELL_TYPE_MAP[normalizedCellType] : undefined;
					if (!cellTypeEnum) {
						return new vscode.LanguageModelToolResult([
							new vscode.LanguageModelTextPart(`Unknown cellType: '${cellType}'. Must be 'code' or 'markdown'.`)
						]);
					}

					await positron.notebooks.addCell(
						context.uri,
						cellTypeEnum,
						insertIndex,
						content
					);

					// If run is not false and cellType is code, execute the cell and return outputs
					// Note: insertIndex is the numeric index where the cell was inserted
					if (run !== false && cellTypeEnum === positron.notebooks.NotebookCellType.Code) {
						try {
							await positron.notebooks.runCells(context.uri, [insertIndex]);

							// Build mixed content response with support for images
							const resultParts: (vscode.LanguageModelTextPart | vscode.LanguageModelDataPart)[] = [];
							resultParts.push(
								new vscode.LanguageModelTextPart(
									`Successfully added and executed code cell at index ${insertIndex}.\n\nOutputs:\n`
								)
							);

							const cellOutputs = await positron.notebooks.getCellOutputs(context.uri, insertIndex);
							if (cellOutputs.length > 0) {
								const outputParts = convertOutputsToLanguageModelParts(cellOutputs);
								resultParts.push(...outputParts);
							} else {
								resultParts.push(new vscode.LanguageModelTextPart('No outputs'));
							}

							return new vscode.LanguageModelToolResult2(resultParts);
						} catch (runError: unknown) {
							// If execution fails, still report success for adding the cell, but mention execution failure
							const errorMessage = runError instanceof Error ? runError.message : String(runError);
							return new vscode.LanguageModelToolResult([
								new vscode.LanguageModelTextPart(
									`Successfully added code cell at index ${insertIndex}, but execution failed: ${errorMessage}`
								)
							]);
						}
					}

					return new vscode.LanguageModelToolResult([
						new vscode.LanguageModelTextPart(
							`Successfully added ${cellType} cell at index ${insertIndex}`
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

					// Validate content length
					if (content.length > MAX_CELL_CONTENT_LENGTH) {
						return new vscode.LanguageModelToolResult([
							new vscode.LanguageModelTextPart(
								`Content too large: ${content.length} bytes exceeds maximum of ${MAX_CELL_CONTENT_LENGTH} bytes`
							)
						]);
					}

					// Validate cell index
					const validation = validateCellIndices([cellIndex], context.cellCount);
					if (!validation.valid) {
						return new vscode.LanguageModelToolResult([
							new vscode.LanguageModelTextPart(validation.error!)
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

					// Validate cell index
					const validation = validateCellIndices([cellIndex], context.cellCount);
					if (!validation.valid) {
						return new vscode.LanguageModelToolResult([
							new vscode.LanguageModelTextPart(validation.error!)
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
						// Validate cell indices
						const validation = validateCellIndices(cellIndices, context.cellCount, true);
						if (!validation.valid) {
							return new vscode.LanguageModelToolResult([
								new vscode.LanguageModelTextPart(validation.error!)
							]);
						}

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

					// Validate cell indices
					const validation = validateCellIndices(cellIndices, context.cellCount);
					if (!validation.valid) {
						return new vscode.LanguageModelToolResult([
							new vscode.LanguageModelTextPart(validation.error!)
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
						// Validate cell indices
						const validation = validateCellIndices(cellIndices, context.cellCount, true);
						if (!validation.valid) {
							return new vscode.LanguageModelToolResult([
								new vscode.LanguageModelTextPart(validation.error!)
							]);
						}

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

