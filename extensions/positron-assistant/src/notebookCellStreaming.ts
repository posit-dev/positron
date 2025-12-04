/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { StreamingTagLexer } from './streamingTagLexer.js';
import { validateCellIndices, MAX_CELL_CONTENT_LENGTH } from './tools/notebookUtils.js';
import { log } from './extension.js';

/**
 * Valid XML tag names for parsing cell operations
 */
type CellTag = 'cell';

/**
 * Cell operation type
 */
type CellOperation = 'add' | 'update';

/**
 * Cell type
 */
type CellType = 'code' | 'markdown';

/**
 * Interface for a cell operation parsed from XML
 */
interface ParsedCellOperation {
	operation: CellOperation;
	type?: CellType;
	index: number;
	content: string;
}

/**
 * Callback function type for cell operations
 */
export type CellOperationCallback = (operation: ParsedCellOperation) => Promise<void>;

/**
 * Callback function type for progress updates
 */
export type ProgressCallback = (message: string) => void;

/**
 * Parse streaming XML response and execute cell operations progressively
 *
 * @param textStream The streaming text response from the model
 * @param notebookUri URI of the notebook to modify
 * @param progressCallback Optional callback for progress messages
 * @param token Cancellation token
 * @returns Promise that resolves when parsing is complete
 */
export async function parseStreamingCellOperations(
	textStream: AsyncIterable<string>,
	notebookUri: vscode.Uri,
	progressCallback?: ProgressCallback,
	token?: vscode.CancellationToken
): Promise<void> {
	let currentCell: Partial<ParsedCellOperation> | null = null;
	let currentFieldContent = '';
	let cellCount = 0;

	// Get notebook context to validate indices
	const context = await positron.notebooks.getContext();
	if (!context) {
		const errorMsg = 'No active notebook found';
		log.warn(`[notebook-cell-streaming] ${errorMsg}`);
		if (progressCallback) {
			progressCallback(`⚠️ ${errorMsg}`);
		}
		return;
	}

	const cellCountForValidation = context.cellCount;

	// Create streaming tag lexer
	const lexer = new StreamingTagLexer<CellTag>({
		tagNames: ['cell'],
		contentHandler: async (chunk) => {
			if (chunk.type === 'tag') {
				if (chunk.name === 'cell') {
					if (chunk.kind === 'open') {
						// Start a new cell operation
						// Reset any open field state from previous cell (handles malformed XML)
						if (currentFieldContent) {
							log.warn(`[notebook-cell-streaming] New cell opened while content was still being collected, resetting`);
							currentFieldContent = '';
						}

						// Parse attributes
						const operation = chunk.attributes['operation'] as CellOperation | undefined;
						const type = chunk.attributes['type'] as CellType | undefined;
						const indexStr = chunk.attributes['index'];

						if (!operation || (operation !== 'add' && operation !== 'update')) {
							log.warn(`[notebook-cell-streaming] Invalid or missing operation attribute: ${operation}`);
							currentCell = null;
							return;
						}

						if (operation === 'add' && !type) {
							log.warn(`[notebook-cell-streaming] Missing type attribute for add operation`);
							currentCell = null;
							return;
						}

						if (!indexStr) {
							log.warn(`[notebook-cell-streaming] Missing index attribute`);
							currentCell = null;
							return;
						}

						const index = parseInt(indexStr, 10);
						if (isNaN(index) || index < 0) {
							log.warn(`[notebook-cell-streaming] Invalid index: ${indexStr}`);
							currentCell = null;
							return;
						}

						currentCell = {
							operation,
							type: type as CellType | undefined,
							index,
							content: ''
						};

						cellCount++;
						const operationLabel = operation === 'add' ? 'Creating' : 'Updating';
						const cellLabel = operation === 'add' ? `cell ${index}` : `cell ${index}`;
						if (progressCallback) {
							progressCallback(`${operationLabel} ${cellLabel}...`);
						}
					} else if (chunk.kind === 'close' && currentCell) {
						// Complete the cell operation
						const content = currentFieldContent.trim();
						currentFieldContent = '';

						// Validate content length
						if (content.length > MAX_CELL_CONTENT_LENGTH) {
							const errorMsg = `Cell content too large: ${content.length} bytes exceeds maximum of ${MAX_CELL_CONTENT_LENGTH} bytes`;
							log.warn(`[notebook-cell-streaming] ${errorMsg}`);
							if (progressCallback) {
								progressCallback(`⚠️ ${errorMsg}`);
							}
							currentCell = null;
							return;
						}

						// Validate cell index
						if (currentCell.operation === 'update') {
							const validation = validateCellIndices([currentCell.index!], cellCountForValidation);
							if (!validation.valid) {
								log.warn(`[notebook-cell-streaming] ${validation.error}`);
								if (progressCallback) {
									progressCallback(`⚠️ ${validation.error}`);
								}
								currentCell = null;
								return;
							}
						}

						// Execute the cell operation
						try {
							await executeCellOperation(currentCell as ParsedCellOperation, content, notebookUri, progressCallback);
							const operationLabel = currentCell.operation === 'add' ? 'Created' : 'Updated';
							if (progressCallback) {
								progressCallback(`${operationLabel} cell ${currentCell.index} ✓`);
							}
						} catch (error) {
							const errorMessage = error instanceof Error ? error.message : String(error);
							log.error(`[notebook-cell-streaming] Failed to ${currentCell.operation} cell ${currentCell.index}: ${errorMessage}`);
							if (progressCallback) {
								progressCallback(`⚠️ Failed to ${currentCell.operation} cell ${currentCell.index}: ${errorMessage}`);
							}
						}

						currentCell = null;
					}
				}
			} else {
				// Accumulate text content for the current cell
				if (currentCell) {
					currentFieldContent += chunk.text;
				}
			}
		}
	});

	// Stream the response through the lexer
	try {
		for await (const delta of textStream) {
			if (token?.isCancellationRequested) {
				// If interrupted mid-cell, discard incomplete content
				if (currentCell) {
					log.warn(`[notebook-cell-streaming] Stream interrupted while processing cell ${currentCell.index}, discarding incomplete content`);
					if (progressCallback) {
						progressCallback(`⚠️ Stream interrupted, incomplete cell discarded`);
					}
				}
				break;
			}
			await lexer.process(delta);
		}

		// Flush any remaining content
		await lexer.flush();

		// If we have an incomplete cell at the end, discard it
		if (currentCell) {
			log.warn(`[notebook-cell-streaming] Stream ended with incomplete cell ${currentCell.index}, discarding`);
			if (progressCallback) {
				progressCallback(`⚠️ Stream ended with incomplete cell, discarded`);
			}
		}
	} catch (error) {
		log.error(`[notebook-cell-streaming] Error during XML streaming: ${error}`);
		// If we have an incomplete cell, discard it
		if (currentCell) {
			log.warn(`[notebook-cell-streaming] Error occurred while processing cell ${currentCell.index}, discarding incomplete content`);
			if (progressCallback) {
				progressCallback(`⚠️ Error occurred, incomplete cell discarded`);
			}
		}
		throw error;
	}
}

/**
 * Execute a cell operation (add or update)
 *
 * @param operation The parsed cell operation
 * @param content The cell content
 * @param notebookUri URI of the notebook
 * @param progressCallback Optional callback for progress messages
 */
async function executeCellOperation(
	operation: ParsedCellOperation,
	content: string,
	notebookUri: vscode.Uri,
	progressCallback?: ProgressCallback
): Promise<void> {
	const { operation: op, type, index } = operation;

	if (op === 'add') {
		if (!type) {
			throw new Error('Missing cell type for add operation');
		}

		// Get notebook context to determine insert position
		const context = await positron.notebooks.getContext();
		if (!context) {
			throw new Error('No active notebook found');
		}

		// Handle append case (-1 means append at end)
		const insertIndex = index === -1 ? context.cellCount : index;

		// Validate insert index
		if (!Number.isInteger(insertIndex) || insertIndex < 0 || insertIndex > context.cellCount) {
			throw new Error(`Invalid insert index: ${insertIndex}. Must be between 0 and ${context.cellCount} (inclusive)`);
		}

		// Map cell type string to enum
		const cellTypeEnum = type === 'code' ? positron.notebooks.NotebookCellType.Code : positron.notebooks.NotebookCellType.Markdown;

		await positron.notebooks.addCell(notebookUri.toString(), cellTypeEnum, insertIndex, content);
	} else if (op === 'update') {
		// Validate cell index
		const context = await positron.notebooks.getContext();
		if (!context) {
			throw new Error('No active notebook found');
		}

		const validation = validateCellIndices([index], context.cellCount);
		if (!validation.valid) {
			throw new Error(validation.error!);
		}

		await positron.notebooks.updateCellContent(notebookUri.toString(), index, content);
	} else {
		throw new Error(`Unknown operation: ${op}`);
	}
}

