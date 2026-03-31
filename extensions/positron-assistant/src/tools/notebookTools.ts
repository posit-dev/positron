/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { PositronAssistantToolName } from '../types.js';
import { log } from '../log.js';
import { convertOutputsToLanguageModelParts, formatCells, validateCellIndices, validatePermutation, MAX_CELL_CONTENT_LENGTH, isErrorMime, isTextMime } from './notebookUtils.js';
import { getChatRequestData } from '../tools.js';
import type { ParticipantService } from '../participants.js';
import { resolveShowDiff } from '../notebookAssistantMetadata.js';

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
 * Maximum number of cells for which runAll returns full outputs.
 * Beyond this threshold, runAll returns per-cell summaries instead.
 */
const MAX_CELLS_FOR_FULL_RUN_ALL_OUTPUT = 10;

/**
 * Input type for the ExecuteNotebook tool.
 */
interface ExecuteNotebookInput {
	operation: 'run' | 'runAll' | 'interrupt' | 'restartKernel';
	cellIndices?: number[];
	runAll?: boolean;
}

/**
 * Tool: Execute Notebook
 *
 * Manages the notebook execution lifecycle: run specific cells, run all cells,
 * interrupt execution, or restart the kernel.
 */
export const ExecuteNotebookTool = vscode.lm.registerTool<ExecuteNotebookInput>(PositronAssistantToolName.ExecuteNotebook, {
	prepareInvocation: async (options, _token) => {
		const { operation, cellIndices } = options.input;

		switch (operation) {
			case 'run': {
				if (!cellIndices || cellIndices.length === 0) {
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
			}

			case 'runAll': {
				const context = await positron.notebooks.getContext();
				const cellCount = context?.cellCount ?? 0;
				return {
					invocationMessage: vscode.l10n.t('Running all notebook cells'),
					confirmationMessages: {
						title: vscode.l10n.t('Run All Cells'),
						message: vscode.l10n.t('Execute all {0} cells in the notebook?', cellCount)
					},
					pastTenseMessage: vscode.l10n.t('Ran all notebook cells'),
				};
			}

			case 'interrupt':
				return {
					invocationMessage: vscode.l10n.t('Interrupting notebook execution'),
					pastTenseMessage: vscode.l10n.t('Interrupted notebook execution'),
				};

			case 'restartKernel': {
				const willRunAll = options.input.runAll === true;
				const message = willRunAll
					? vscode.l10n.t('Restart the kernel and run all cells?')
					: vscode.l10n.t('Restart the kernel?');
				return {
					invocationMessage: willRunAll
						? vscode.l10n.t('Restarting kernel and running all cells')
						: vscode.l10n.t('Restarting kernel'),
					confirmationMessages: {
						title: vscode.l10n.t('Restart Kernel'),
						message: message
					},
					pastTenseMessage: willRunAll
						? vscode.l10n.t('Restarted kernel and ran all cells')
						: vscode.l10n.t('Restarted kernel'),
				};
			}

			default:
				return {
					invocationMessage: vscode.l10n.t('Executing notebook operation'),
					pastTenseMessage: vscode.l10n.t('Executed notebook operation'),
				};
		}
	},
	invoke: async (options, token) => {
		const { operation } = options.input;

		try {
			const context = await positron.notebooks.getContext();
			if (!context) {
				return createNoActiveNotebookErrorResult();
			}

			switch (operation) {
				case 'run': {
					const cellIndices = options.input.cellIndices;
					if (!cellIndices || cellIndices.length === 0) {
						return new vscode.LanguageModelToolResult([
							new vscode.LanguageModelTextPart('Missing required parameter: cellIndices (required for run operation)')
						]);
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
							const outputParts = convertOutputsToLanguageModelParts(cellOutputs);
							resultParts.push(...outputParts);
						}
					}

					return new vscode.LanguageModelToolResult2(resultParts);
				}

				case 'runAll': {
					return await runAllCells(context);
				}

				case 'interrupt': {
					const notebookUri = vscode.Uri.parse(context.uri);
					const session = await positron.runtime.getNotebookSession(notebookUri);
					if (!session) {
						return new vscode.LanguageModelToolResult([
							new vscode.LanguageModelTextPart('No active kernel session found for this notebook. The kernel may not be started.')
						]);
					}

					await positron.runtime.interruptSession(session.metadata.sessionId);
					return new vscode.LanguageModelToolResult([
						new vscode.LanguageModelTextPart('Successfully interrupted notebook execution.')
					]);
				}

				case 'restartKernel': {
					const notebookUri = vscode.Uri.parse(context.uri);
					const session = await positron.runtime.getNotebookSession(notebookUri);
					if (!session) {
						return new vscode.LanguageModelToolResult([
							new vscode.LanguageModelTextPart('No active kernel session found for this notebook. The kernel may not be started.')
						]);
					}

					await positron.runtime.restartSession(session.metadata.sessionId);

					if (options.input.runAll === true) {
						// Re-fetch context after restart to get fresh state
						const freshContext = await positron.notebooks.getContext();
						if (!freshContext) {
							return new vscode.LanguageModelToolResult([
								new vscode.LanguageModelTextPart('Kernel restarted successfully, but notebook context became unavailable. Could not run all cells.')
							]);
						}
						// Verify the active notebook hasn't changed during restart
						if (freshContext.uri !== context.uri) {
							return new vscode.LanguageModelToolResult([
								new vscode.LanguageModelTextPart('Kernel restarted successfully, but the active notebook changed. Run all cells skipped to avoid executing the wrong notebook.')
							]);
						}
						return await runAllCells(freshContext);
					}

					return new vscode.LanguageModelToolResult([
						new vscode.LanguageModelTextPart('Successfully restarted the kernel.')
					]);
				}

				default:
					return new vscode.LanguageModelToolResult([
						new vscode.LanguageModelTextPart(
							`Unknown operation: ${operation}. Must be "run", "runAll", "interrupt", or "restartKernel".`
						)
					]);
			}
		} catch (error: unknown) {
			return createNotebookToolErrorResult(error, PositronAssistantToolName.ExecuteNotebook, `${operation}`);
		}
	}
});

/**
 * Runs all cells in a notebook and returns results.
 * For small notebooks (<= MAX_CELLS_FOR_FULL_RUN_ALL_OUTPUT cells),
 * returns full outputs. For larger notebooks, returns per-cell summaries.
 */
async function runAllCells(
	context: positron.notebooks.NotebookContext
): Promise<vscode.LanguageModelToolResult | vscode.LanguageModelToolResult2> {
	const allCells = await positron.notebooks.getCells(context.uri);
	// Run all cell indices (the execution service handles skipping non-executable cells)
	const allIndices = allCells.map(c => c.index);
	// Track code cells separately for accurate reporting
	const codeCells = allCells.filter(c => c.type === positron.notebooks.NotebookCellType.Code);

	if (allIndices.length === 0) {
		return new vscode.LanguageModelToolResult([
			new vscode.LanguageModelTextPart('The notebook has no cells to execute.')
		]);
	}

	await positron.notebooks.runCells(context.uri, allIndices);

	const resultParts: (vscode.LanguageModelTextPart | vscode.LanguageModelDataPart)[] = [];

	if (codeCells.length <= MAX_CELLS_FOR_FULL_RUN_ALL_OUTPUT) {
		// Small notebook: return full outputs for code cells
		resultParts.push(
			new vscode.LanguageModelTextPart(
				`Successfully executed all ${allIndices.length} cell(s) (${codeCells.length} code cell(s)).\n\nOutputs:\n`
			)
		);

		for (const cell of codeCells) {
			const cellOutputs = await positron.notebooks.getCellOutputs(context.uri, cell.index);
			if (cellOutputs.length > 0) {
				resultParts.push(new vscode.LanguageModelTextPart(`\nCell ${cell.index}:\n`));
				const outputParts = convertOutputsToLanguageModelParts(cellOutputs);
				resultParts.push(...outputParts);
			}
		}
	} else {
		// Large notebook: return per-cell summaries for code cells
		resultParts.push(
			new vscode.LanguageModelTextPart(
				`Successfully executed all ${allIndices.length} cell(s) (${codeCells.length} code cell(s)). Per-cell summary:\n\n`
			)
		);

		for (const cell of codeCells) {
			const cellOutputs = await positron.notebooks.getCellOutputs(context.uri, cell.index);
			if (cellOutputs.length === 0) {
				resultParts.push(
					new vscode.LanguageModelTextPart(`Cell ${cell.index}: No output\n`)
				);
			} else {
				// Determine error status from all outputs, not just the first
				const hasError = cellOutputs.some(o => isErrorMime(o.mimeType));
				const status = hasError ? 'Error' : 'OK';
				// Show first line of first text output or indicator for non-text types
				const firstOutput = cellOutputs[0];
				// SVG (image/svg+xml) classification is inconsistent -- isTextMime
				// treats it as text, but we want it as an image here. Uses
				// startsWith as a workaround; proper fix deferred to #12096.
				if (firstOutput.mimeType.startsWith('image/')) {
					resultParts.push(
						new vscode.LanguageModelTextPart(`Cell ${cell.index}: [${status}] [Image output]\n`)
					);
				} else if (isTextMime(firstOutput.mimeType)) {
					const firstLine = (firstOutput.data?.split('\n')[0] ?? '').slice(0, 200);
					resultParts.push(
						new vscode.LanguageModelTextPart(`Cell ${cell.index}: [${status}] ${firstLine}\n`)
					);
				} else {
					resultParts.push(
						new vscode.LanguageModelTextPart(`Cell ${cell.index}: [${status}] [${firstOutput.mimeType} output]\n`)
					);
				}
			}
		}
	}

	return new vscode.LanguageModelToolResult2(resultParts);
}

/**
 * Input type for the EditNotebook tool.
 */
interface EditNotebookInput {
	operation: 'add' | 'update' | 'delete' | 'reorder' | 'clearOutputs';
	cellType?: 'code' | 'markdown';
	index?: number;
	content?: string;
	cellIndex?: number;           // For update operation
	cellIndices?: number[];        // For delete and clearOutputs operations
	run?: boolean;
	fromIndex?: number;
	toIndex?: number;
	newOrder?: number[];
}

/**
 * Creates the Edit Notebook tool.
 *
 * Performs edit operations on notebook cells: add, update, delete, or reorder.
 * Uses a simple enum-based operation parameter for flexibility.
 *
 * @param participantService The participant service for accessing the chat response stream
 * @returns The registered tool disposable
 */
function createEditNotebookTool(participantService: ParticipantService) {
	return vscode.lm.registerTool<EditNotebookInput>(PositronAssistantToolName.EditNotebook, {
		prepareInvocation: async (options, _token) => {
			const { operation, cellType, cellIndex, run } = options.input;

			// Get the active notebook context
			const context = await positron.notebooks.getContext();
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
					reorder: {
						invocationMessage: vscode.l10n.t('Reordering notebook cells'),
						pastTenseMessage: vscode.l10n.t('Reordered notebook cells'),
					},
					clearOutputs: {
						invocationMessage: vscode.l10n.t('Clearing notebook outputs'),
						pastTenseMessage: vscode.l10n.t('Cleared notebook outputs'),
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
					const { cellIndices } = options.input;

					// Build confirmation message for multiple cells
					let message: string;
					if (!cellIndices || cellIndices.length === 0) {
						message = vscode.l10n.t('Delete cells');
					} else if (cellIndices.length === 1) {
						// Try to fetch cell type for single cell
						let cellTypeLabel = 'cell';
						try {
							const cell = await positron.notebooks.getCell(context.uri, cellIndices[0]);
							if (cell) {
								cellTypeLabel = cell.type === 'code' ? 'code cell' : 'markdown cell';
							}
						} catch (error) {
							// Use default label if fetch fails
						}
						message = vscode.l10n.t('Delete {0} {1}? This cannot be undone.', cellTypeLabel, cellIndices[0]);
					} else {
						// Multiple cells
						const cellList = cellIndices.length <= 5
							? cellIndices.join(', ')
							: `${cellIndices.slice(0, 5).join(', ')}, and ${cellIndices.length - 5} more`;
						message = vscode.l10n.t('Delete {0} cells ({1})? This cannot be undone.', cellIndices.length, cellList);
					}

					return {
						invocationMessage: vscode.l10n.t('Deleting notebook cells'),
						confirmationMessages: {
							title: vscode.l10n.t('Delete Notebook Cells'),
							message: message
						},
						pastTenseMessage: vscode.l10n.t('Deleted notebook cells'),
					};
				}

				case 'reorder': {
					const { fromIndex, toIndex, newOrder } = options.input;

					// Determine if this is a single move or full reorder
					if (newOrder !== undefined) {
						// Full permutation reorder
						const message = vscode.l10n.t('Reorder all {0} cells in the notebook?', context.cellCount);
						return {
							invocationMessage: vscode.l10n.t('Reordering notebook cells'),
							confirmationMessages: {
								title: vscode.l10n.t('Reorder Notebook Cells'),
								message: message
							},
							pastTenseMessage: vscode.l10n.t('Reordered notebook cells'),
						};
					} else {
						// Single cell move
						const message = vscode.l10n.t('Move cell {0} to position {1}?', fromIndex, toIndex);
						return {
							invocationMessage: vscode.l10n.t('Moving notebook cell'),
							confirmationMessages: {
								title: vscode.l10n.t('Move Notebook Cell'),
								message: message
							},
							pastTenseMessage: vscode.l10n.t('Moved notebook cell'),
						};
					}
				}

				case 'clearOutputs': {
					const { cellIndices: clearIndices } = options.input;
					if (clearIndices !== undefined) {
						if (clearIndices.length === 0) {
							// Empty array -- invoke will reject; skip confirmation
							return {
								invocationMessage: vscode.l10n.t('Clearing notebook outputs'),
								pastTenseMessage: vscode.l10n.t('Cleared notebook outputs'),
							};
						}
						const message = clearIndices.length === 1
							? vscode.l10n.t('Clear outputs for cell {0}?', clearIndices[0])
							: vscode.l10n.t('Clear outputs for cells {0}?', clearIndices.join(', '));
						return {
							invocationMessage: vscode.l10n.t('Clearing notebook outputs'),
							confirmationMessages: {
								title: vscode.l10n.t('Clear Outputs'),
								message: message,
							},
							pastTenseMessage: vscode.l10n.t('Cleared notebook outputs'),
						};
					}
					return {
						invocationMessage: vscode.l10n.t('Clearing notebook outputs'),
						confirmationMessages: {
							title: vscode.l10n.t('Clear Outputs'),
							message: vscode.l10n.t('Clear all cell outputs?'),
						},
						pastTenseMessage: vscode.l10n.t('Cleared notebook outputs'),
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
			const { operation, cellType, index, content, cellIndex, run, fromIndex, toIndex, newOrder } = options.input;

			try {
				const context = await positron.notebooks.getContext();
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
						const contentByteLength = Buffer.byteLength(content, 'utf8');
						if (contentByteLength > MAX_CELL_CONTENT_LENGTH) {
							return new vscode.LanguageModelToolResult([
								new vscode.LanguageModelTextPart(
									`Content too large: ${contentByteLength} bytes exceeds maximum of ${MAX_CELL_CONTENT_LENGTH} bytes`
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
						const contentByteLength = Buffer.byteLength(content, 'utf8');
						if (contentByteLength > MAX_CELL_CONTENT_LENGTH) {
							return new vscode.LanguageModelToolResult([
								new vscode.LanguageModelTextPart(
									`Content too large: ${contentByteLength} bytes exceeds maximum of ${MAX_CELL_CONTENT_LENGTH} bytes`
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

						// Get the cell to retrieve its URI and editor state
						const cell: positron.notebooks.NotebookCell | undefined = await positron.notebooks.getCell(context.uri, cellIndex);
						if (!cell) {
							return new vscode.LanguageModelToolResult([
								new vscode.LanguageModelTextPart(`Cell not found at index ${cellIndex}`)
							]);
						}

						// Check if this is a markdown cell in preview mode
						// editorShown is true when editor is shown, false when preview is shown
						const isMarkdownInPreview = cell.type === 'markdown' && cell.editorShown === false;

						// Check if diff view is enabled (notebook metadata first, then global config)
						const notebookEditor = vscode.window.activeNotebookEditor;
						const showDiff = notebookEditor
							? resolveShowDiff(notebookEditor.notebook)
							: vscode.workspace.getConfiguration('positron.assistant.notebook').get('showDiff', true);

						// Use direct update for: markdown in preview OR when diff view is disabled
						if (isMarkdownInPreview || !showDiff) {
							// Use API-based approach for direct updates
							// This triggers visual feedback animation via handleAssistantCellModification
							await positron.notebooks.updateCellContent(context.uri, cellIndex, content);

							// The API call handles scrolling via handleAssistantCellModification
							return new vscode.LanguageModelToolResult([
								new vscode.LanguageModelTextPart(`Successfully updated cell ${cellIndex}`)
							]);
						} else {
							// Use native diff view for code cells and markdown cells in edit mode
							const { response } = getChatRequestData(options.chatRequestId, participantService);

							// Apply the edit directly via response.textEdit()
							// cell.id is the cell document URI string
							const cellDocUri = vscode.Uri.parse(cell.id);
							const cellDoc = await vscode.workspace.openTextDocument(cellDocUri);
							const currentContent = cellDoc.getText();

							// Only create edit if content actually changed
							if (currentContent !== content) {
								const edit = new vscode.TextEdit(
									new vscode.Range(0, 0, cellDoc.lineCount, 0),
									content
								);
								response.textEdit(cellDocUri, edit);
							}

							// Trigger scroll-to behavior for native diff edits
							await positron.notebooks.scrollToCellIfNeeded(context.uri, cellIndex);

							return new vscode.LanguageModelToolResult([
								new vscode.LanguageModelTextPart(`Successfully proposed edit to cell ${cellIndex}`)
							]);
						}
					}

					case 'delete': {
						const { cellIndices } = options.input;

						// Validate required parameters
						if (!cellIndices || cellIndices.length === 0) {
							return new vscode.LanguageModelToolResult([
								new vscode.LanguageModelTextPart('Missing required parameter: cellIndices (array of cell indices to delete)')
							]);
						}

						// Validate all cell indices
						const validation = validateCellIndices(cellIndices, context.cellCount);
						if (!validation.valid) {
							return new vscode.LanguageModelToolResult([
								new vscode.LanguageModelTextPart(validation.error!)
							]);
						}

						// Delete all cells
						await positron.notebooks.deleteCells(context.uri, cellIndices);

						const message = cellIndices.length === 1
							? `Successfully deleted cell ${cellIndices[0]}`
							: `Successfully deleted ${cellIndices.length} cells: ${cellIndices.join(', ')}`;

						return new vscode.LanguageModelToolResult([
							new vscode.LanguageModelTextPart(message)
						]);
					}

					case 'reorder': {
						// Determine if this is a single move or full reorder
						if (newOrder !== undefined) {
							// Full permutation reorder
							const permValidation = validatePermutation(newOrder, context.cellCount);
							if (!permValidation.valid) {
								return new vscode.LanguageModelToolResult([
									new vscode.LanguageModelTextPart(permValidation.error!)
								]);
							}

							// Check for identity permutation (no-op)
							if (permValidation.isIdentity) {
								return new vscode.LanguageModelToolResult([
									new vscode.LanguageModelTextPart('No reordering needed - cells are already in the specified order')
								]);
							}

							await positron.notebooks.reorderCells(context.uri, newOrder);

							return new vscode.LanguageModelToolResult([
								new vscode.LanguageModelTextPart(`Successfully reordered ${context.cellCount} cells`)
							]);
						} else {
							// Single cell move - validate required parameters
							if (fromIndex === undefined) {
								return new vscode.LanguageModelToolResult([
									new vscode.LanguageModelTextPart('Missing required parameter: fromIndex (current index of cell to move)')
								]);
							}
							if (toIndex === undefined) {
								return new vscode.LanguageModelToolResult([
									new vscode.LanguageModelTextPart('Missing required parameter: toIndex (target index to move cell to)')
								]);
							}

							// Validate indices
							const fromValidation = validateCellIndices([fromIndex], context.cellCount);
							if (!fromValidation.valid) {
								return new vscode.LanguageModelToolResult([
									new vscode.LanguageModelTextPart(`Invalid fromIndex: ${fromValidation.error}`)
								]);
							}

							const toValidation = validateCellIndices([toIndex], context.cellCount);
							if (!toValidation.valid) {
								return new vscode.LanguageModelToolResult([
									new vscode.LanguageModelTextPart(`Invalid toIndex: ${toValidation.error}`)
								]);
							}

							// Check for no-op
							if (fromIndex === toIndex) {
								return new vscode.LanguageModelToolResult([
									new vscode.LanguageModelTextPart('No move needed - cell is already at the specified position')
								]);
							}

							await positron.notebooks.moveCell(context.uri, fromIndex, toIndex);

							return new vscode.LanguageModelToolResult([
								new vscode.LanguageModelTextPart(`Successfully moved cell from index ${fromIndex} to index ${toIndex}`)
							]);
						}
					}

					case 'clearOutputs': {
						const { cellIndices: clearCellIndices } = options.input;
						if (clearCellIndices !== undefined) {
							if (clearCellIndices.length === 0) {
								return new vscode.LanguageModelToolResult([
									new vscode.LanguageModelTextPart('No cell indices specified. Provide cell indices to clear specific cells, or omit cellIndices to clear all.')
								]);
							}

							// Validate cell indices
							const validation = validateCellIndices(clearCellIndices, context.cellCount);
							if (!validation.valid) {
								return new vscode.LanguageModelToolResult([
									new vscode.LanguageModelTextPart(validation.error!)
								]);
							}

							await positron.notebooks.clearCellOutputs(context.uri, clearCellIndices);
							const message = clearCellIndices.length === 1
								? `Successfully cleared outputs for cell ${clearCellIndices[0]}.`
								: `Successfully cleared outputs for cells ${clearCellIndices.join(', ')}.`;
							return new vscode.LanguageModelToolResult([
								new vscode.LanguageModelTextPart(message)
							]);
						}

						await positron.notebooks.clearCellOutputs(context.uri);
						return new vscode.LanguageModelToolResult([
							new vscode.LanguageModelTextPart('Successfully cleared all cell outputs.')
						]);
					}

					default:
						return new vscode.LanguageModelToolResult([
							new vscode.LanguageModelTextPart(
								`Unknown operation: ${operation}. Must be "add", "update", "delete", "reorder", or "clearOutputs".`
							)
						]);
				}
			} catch (error: unknown) {
				return createNotebookToolErrorResult(
					error,
					PositronAssistantToolName.EditNotebook,
					`${operation}`
				);
			}
		}
	});
}

/**
 * Tool: Get Notebook Info
 *
 * Retrieves information about notebook cells with flexible operation modes.
 * Supports getting specific cells, all cells, selected cells, outputs, or metadata only.
 */
export const GetNotebookInfoTool = vscode.lm.registerTool<{
	operation: 'get' | 'getSelected' | 'getOutputs' | 'getMetadata' | 'getKernelStatus';
	cellIndices?: number[];
}>(PositronAssistantToolName.GetNotebookInfo, {
	prepareInvocation: async (options, _token) => {
		if (options.input.operation === 'getKernelStatus') {
			return {
				invocationMessage: vscode.l10n.t('Getting kernel status'),
				pastTenseMessage: vscode.l10n.t('Retrieved kernel status'),
			};
		}
		return {
			invocationMessage: vscode.l10n.t('Getting notebook info'),
			pastTenseMessage: vscode.l10n.t('Retrieved notebook info'),
		};
	},
	invoke: async (options, token) => {
		const { operation, cellIndices } = options.input;

		try {
			const context = await positron.notebooks.getContext();
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

				case 'getKernelStatus': {
					const statusInfo: Record<string, string | undefined> = {
						kernelLanguage: context.kernelLanguage,
						kernelId: context.kernelId,
						runtimeState: context.runtimeState ?? 'unknown',
					};

					// Try to get additional session metadata
					const notebookUri = vscode.Uri.parse(context.uri);
					const session = await positron.runtime.getNotebookSession(notebookUri);
					if (session) {
						const metadata = session.runtimeMetadata;
						statusInfo.runtimeName = metadata.runtimeName;
						statusInfo.languageVersion = metadata.languageVersion;
						statusInfo.runtimeVersion = metadata.runtimeVersion;
						statusInfo.runtimeSource = metadata.runtimeSource;

						const dynState = await session.getDynState();
						statusInfo.sessionName = dynState.sessionName;
					}

					return new vscode.LanguageModelToolResult([
						new vscode.LanguageModelTextPart(
							`Kernel status:\n${JSON.stringify(statusInfo, null, 2)}`
						)
					]);
				}

				default:
					return new vscode.LanguageModelToolResult([
						new vscode.LanguageModelTextPart(
							`Unknown operation: ${operation}. Must be "get", "getSelected", "getOutputs", "getMetadata", or "getKernelStatus".`
						)
					]);
			}
		} catch (error: unknown) {
			return createNotebookToolErrorResult(
				error,
				PositronAssistantToolName.GetNotebookInfo,
				`${operation}`
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
export function registerNotebookTools(
	context: vscode.ExtensionContext,
	participantService: ParticipantService
): void {
	context.subscriptions.push(
		ExecuteNotebookTool,
		createEditNotebookTool(participantService),
		GetNotebookInfoTool
	);
}
