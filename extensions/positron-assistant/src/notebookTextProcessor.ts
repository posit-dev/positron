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
	private _streamingCellIndex: number | null = null;  // Index of cell being streamed to
	private _lastUpdateTime: number = 0;                // For throttling
	private _pendingUpdate: NodeJS.Timeout | null = null;

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

		// Cancel any pending throttled update
		if (this._pendingUpdate) {
			clearTimeout(this._pendingUpdate);
			this._pendingUpdate = null;
		}

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
			// If we were streaming to a cell, try to finalize with whatever content we have
			if (this._streamingCellIndex !== null && this._notebookUri && this._cellContent.trim()) {
				try {
					await positron.notebooks.updateCellContent(
						this._notebookUri.toString(),
						this._streamingCellIndex,
						this._cellContent.trim()
					);
				} catch (error) {
					log.warn(`[notebook-text-processor] Failed to finalize incomplete cell on flush: ${error}`);
				}
			}
		}

		// Clear streaming state
		this._streamingCellIndex = null;
		this._cellContent = '';
		this._currentCellAttributes = {};

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

				// Create cell early for streaming if operation is 'add'
				if (operation === 'add' && this._notebookUri) {
					await this.createCellForStreaming(chunk.attributes);
				} else if (operation === 'update') {
					// For update operations, just record the target index
					// Reuse the index parsed above for progress callback
					if (indexStr) {
						const updateIndex = parseInt(indexStr, 10);
						if (!isNaN(updateIndex) && updateIndex >= 0) {
							this._streamingCellIndex = updateIndex;
							this._lastUpdateTime = Date.now();
						}
					}
				}
			} else if (chunk.kind === 'close') {
				// End of cell tag - finalize the operation
				this._insideCell = false;

				// Cancel any pending throttled update
				if (this._pendingUpdate) {
					clearTimeout(this._pendingUpdate);
					this._pendingUpdate = null;
				}

				if (this._notebookUri) {
					// If we're streaming to a cell, perform final update with complete content
					if (this._streamingCellIndex !== null) {
						const finalContent = this._cellContent.trim();

						// Validate content length
						if (finalContent.length > MAX_CELL_CONTENT_LENGTH) {
							const errorMsg = `Cell content too large: ${finalContent.length} bytes exceeds maximum of ${MAX_CELL_CONTENT_LENGTH} bytes`;
							if (this._progressCallback) {
								this._progressCallback(`⚠️ ${errorMsg}`);
							}
							log.warn(`[notebook-text-processor] ${errorMsg}`);
						} else {
							try {
								// Final update with complete content
								await positron.notebooks.updateCellContent(
									this._notebookUri.toString(),
									this._streamingCellIndex,
									finalContent
								);

								const operation = this._currentCellAttributes['operation'] as 'add' | 'update' | undefined;
								if (this._progressCallback) {
									const operationLabel = operation === 'add' ? 'Created' : 'Updated';
									this._progressCallback(`${operationLabel} cell ${this._streamingCellIndex} ✓`);
								}
							} catch (error) {
								const errorMessage = error instanceof Error ? error.message : String(error);
								const operation = this._currentCellAttributes['operation'] as 'add' | 'update' | undefined;
								log.error(`[notebook-text-processor] Failed to finalize ${operation} cell ${this._streamingCellIndex}: ${errorMessage}`);
								if (this._progressCallback) {
									this._progressCallback(`⚠️ Failed to ${operation} cell ${this._streamingCellIndex}: ${errorMessage}`);
								}
							}
						}
					} else {
						// Fallback: execute operation normally (for cases where early creation failed)
						await this.executeCellOperation(this._currentCellAttributes, this._cellContent.trim());
					}
				} else {
					if (this._progressCallback) {
						this._progressCallback('⚠️ No notebook URI set, cannot execute cell operation');
					}
				}

				// Clear streaming state
				this._streamingCellIndex = null;
				this._cellContent = '';
				this._currentCellAttributes = {};
			}
		} else if (chunk.type === 'text') {
			if (this._insideCell) {
				// Accumulate cell content
				this._cellContent += chunk.text;
				// Stream update to cell (throttled)
				await this.streamCellContentUpdate();
			} else {
				// Accumulate regular text to send to default processor
				this._textBuffer += chunk.text;
			}
		}
	}

	/**
	 * Create a cell early for streaming content into it
	 */
	private async createCellForStreaming(attributes: Record<string, string>): Promise<void> {
		const type = attributes['type'] as 'code' | 'markdown' | undefined;
		const indexStr = attributes['index'];

		if (!type) {
			log.warn(`[notebook-text-processor] Missing type attribute for add operation, cannot create cell early`);
			return;
		}

		if (!indexStr) {
			log.warn(`[notebook-text-processor] Missing index attribute, cannot create cell early`);
			return;
		}

		const index = parseInt(indexStr, 10);
		if (isNaN(index) || index < 0) {
			log.warn(`[notebook-text-processor] Invalid index: ${indexStr}, cannot create cell early`);
			return;
		}

		try {
			// Get notebook context
			const context = await positron.notebooks.getContext();
			if (!context) {
				log.warn(`[notebook-text-processor] No active notebook found, cannot create cell early`);
				return;
			}

			// Handle append case (-1 means append at end)
			const insertIndex = index === -1 ? context.cellCount : index;

			// Validate insert index
			if (!Number.isInteger(insertIndex) || insertIndex < 0 || insertIndex > context.cellCount) {
				log.warn(`[notebook-text-processor] Invalid insert index: ${insertIndex}, cannot create cell early`);
				return;
			}

			// Map cell type to enum
			const cellTypeEnum = type === 'code'
				? positron.notebooks.NotebookCellType.Code
				: positron.notebooks.NotebookCellType.Markdown;

			// Create cell with empty content for streaming
			await positron.notebooks.addCell(this._notebookUri!.toString(), cellTypeEnum, insertIndex, '');

			// Store the index for streaming updates
			this._streamingCellIndex = insertIndex;
			this._lastUpdateTime = Date.now();

			log.debug(`[notebook-text-processor] Created cell ${insertIndex} early for streaming`);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			log.warn(`[notebook-text-processor] Failed to create cell early for streaming: ${errorMessage}`);
			// Don't throw - we'll fall back to creating it at the end
			this._streamingCellIndex = null;
		}
	}

	/**
	 * Stream content update to cell with throttling
	 */
	private async streamCellContentUpdate(): Promise<void> {
		// Skip if no cell is being streamed to
		if (this._streamingCellIndex === null || !this._notebookUri) {
			return;
		}

		// Check for cancellation
		if (this._token?.isCancellationRequested) {
			return;
		}

		// Throttle: only update every 50ms
		const now = Date.now();
		if (now - this._lastUpdateTime < 50) {
			// Schedule a pending update if not already scheduled
			if (!this._pendingUpdate) {
				this._pendingUpdate = setTimeout(() => {
					this._pendingUpdate = null;
					this.streamCellContentUpdate().catch(err => {
						log.warn(`[notebook-text-processor] Error in scheduled cell update: ${err}`);
					});
				}, 50);
			}
			return;
		}

		this._lastUpdateTime = now;

		try {
			await positron.notebooks.updateCellContent(
				this._notebookUri.toString(),
				this._streamingCellIndex,
				this._cellContent
			);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			log.warn(`[notebook-text-processor] Failed to stream cell content update: ${errorMessage}`);
			// Don't throw - we'll try again on the next update or finalize at the end
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

