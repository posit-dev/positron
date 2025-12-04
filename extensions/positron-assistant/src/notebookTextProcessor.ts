/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { StreamingTagLexer } from './streamingTagLexer.js';
import { DefaultTextProcessor } from './defaultTextProcessor.js';
import { validateCellIndices, MAX_CELL_CONTENT_LENGTH } from './tools/notebookUtils.js';
import { log } from './extension.js';

/**
 * Text processor for notebook contexts that handles cell operations via XML streaming.
 *
 * This processor:
 * 1. Detects `<cell>` tags and routes them to the cell streaming parser
 * 2. Passes all other text (including markdown) to the default text processor
 */
export class NotebookTextProcessor {
	private readonly _defaultProcessor: DefaultTextProcessor;
	private readonly _lexer: StreamingTagLexer<'cell'>;
	private _insideCell = false;
	private _cellContent = '';
	private _textBuffer = '';
	private _currentCellAttributes: Record<string, string> = {};
	private _notebookUri: vscode.Uri | null = null;
	private _progressCallback: ((message: string) => void) | undefined;
	private _token: vscode.CancellationToken | undefined;

	constructor(
		private readonly _response: vscode.ChatResponseStream,
	) {
		this._defaultProcessor = new DefaultTextProcessor(_response);

		this._lexer = new StreamingTagLexer({
			tagNames: ['cell'],
			contentHandler: async (chunk) => {
				await this.processChunk(chunk);
			}
		});
	}

	/**
	 * Set the notebook URI for cell operations
	 */
	setNotebookUri(uri: vscode.Uri): void {
		this._notebookUri = uri;
	}

	/**
	 * Set progress callback for cell operations
	 */
	setProgressCallback(callback: (message: string) => void): void {
		this._progressCallback = callback;
	}

	/**
	 * Set cancellation token
	 */
	setCancellationToken(token: vscode.CancellationToken): void {
		this._token = token;
	}

	async process(text: string): Promise<void> {
		await this._lexer.process(text);
	}

	async flush(): Promise<void> {
		await this._lexer.flush();

		// If we have buffered text, send it to default processor
		if (this._textBuffer.trim()) {
			await this._defaultProcessor.process(this._textBuffer);
			this._textBuffer = '';
		}

		// If we're still inside a cell tag, discard incomplete content
		if (this._insideCell) {
			if (this._progressCallback) {
				this._progressCallback('⚠️ Incomplete cell tag detected, discarding');
			}
		}

		await this._defaultProcessor.flush();
	}

	private async processChunk(chunk: any): Promise<void> {
		if (chunk.type === 'tag' && chunk.name === 'cell') {
			if (chunk.kind === 'open') {
				// Start of a cell tag - flush any pending text first
				if (this._textBuffer.trim()) {
					await this._defaultProcessor.process(this._textBuffer);
					this._textBuffer = '';
				}

				this._insideCell = true;
				this._cellContent = '';
				this._currentCellAttributes = chunk.attributes;

				// Show progress immediately when cell tag opens
				const operation = chunk.attributes['operation'] as 'add' | 'update' | undefined;
				const indexStr = chunk.attributes['index'];
				if (operation && indexStr && this._progressCallback) {
					const index = parseInt(indexStr, 10);
					if (!isNaN(index) && index >= 0) {
						const operationLabel = operation === 'add' ? 'Creating' : 'Updating';
						const progressMessage = `${operationLabel} cell ${index}...`;
						log.debug(`[notebook-text-processor] Showing progress: ${progressMessage}`);
						this._progressCallback(progressMessage);
					}
				} else {
					log.warn(`[notebook-text-processor] Cannot show progress: operation=${operation}, indexStr=${indexStr}, callback=${!!this._progressCallback}`);
				}
			} else if (chunk.kind === 'close') {
				// End of cell tag - execute the operation
				this._insideCell = false;

				if (this._notebookUri) {
					await this.executeCellOperation(this._currentCellAttributes, this._cellContent.trim());
				} else {
					if (this._progressCallback) {
						this._progressCallback('⚠️ No notebook URI set, cannot execute cell operation');
					}
				}

				this._cellContent = '';
				this._currentCellAttributes = {};
			}
		} else if (chunk.type === 'text') {
			if (this._insideCell) {
				// Accumulate cell content
				this._cellContent += chunk.text;
			} else {
				// Accumulate regular text to send to default processor
				this._textBuffer += chunk.text;
			}
		}
	}

	private async executeCellOperation(attributes: Record<string, string>, content: string): Promise<void> {
		const operation = attributes['operation'] as 'add' | 'update' | undefined;
		const type = attributes['type'] as 'code' | 'markdown' | undefined;
		const indexStr = attributes['index'];

		if (!operation || (operation !== 'add' && operation !== 'update')) {
			if (this._progressCallback) {
				this._progressCallback(`⚠️ Invalid or missing operation attribute: ${operation}`);
			}
			return;
		}

		if (operation === 'add' && !type) {
			if (this._progressCallback) {
				this._progressCallback('⚠️ Missing type attribute for add operation');
			}
			return;
		}

		if (!indexStr) {
			if (this._progressCallback) {
				this._progressCallback('⚠️ Missing index attribute');
			}
			return;
		}

		const index = parseInt(indexStr, 10);
		if (isNaN(index) || index < 0) {
			if (this._progressCallback) {
				this._progressCallback(`⚠️ Invalid index: ${indexStr}`);
			}
			return;
		}

		// Validate content length
		if (content.length > MAX_CELL_CONTENT_LENGTH) {
			const errorMsg = `Cell content too large: ${content.length} bytes exceeds maximum of ${MAX_CELL_CONTENT_LENGTH} bytes`;
			if (this._progressCallback) {
				this._progressCallback(`⚠️ ${errorMsg}`);
			}
			return;
		}

		// Progress message was already shown when the cell tag opened
		// Now execute the operation
		try {
			if (operation === 'add') {
				// Get notebook context
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

				// Map cell type to enum
				const cellTypeEnum = type === 'code'
					? positron.notebooks.NotebookCellType.Code
					: positron.notebooks.NotebookCellType.Markdown;

				await positron.notebooks.addCell(this._notebookUri!.toString(), cellTypeEnum, insertIndex, content);

				if (this._progressCallback) {
					this._progressCallback(`Created cell ${insertIndex} ✓`);
				}
			} else if (operation === 'update') {
				// Validate cell index
				const context = await positron.notebooks.getContext();
				if (!context) {
					throw new Error('No active notebook found');
				}

				const validation = validateCellIndices([index], context.cellCount);
				if (!validation.valid) {
					throw new Error(validation.error!);
				}

				await positron.notebooks.updateCellContent(this._notebookUri!.toString(), index, content);

				if (this._progressCallback) {
					this._progressCallback(`Updated cell ${index} ✓`);
				}
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			if (this._progressCallback) {
				this._progressCallback(`⚠️ Failed to ${operation} cell ${index}: ${errorMessage}`);
			}
			throw error;
		}
	}
}

