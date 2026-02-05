/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { IEditorContribution } from '../../../../editor/common/editorCommon.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { QuartoOutputViewZone, CopyOutputRequest, SavePlotRequest, PopoutRequest } from './quartoOutputViewZone.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { localize } from '../../../../nls.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { dirname, basename, extname } from '../../../../base/common/resources.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IPositronPreviewService } from '../../positronPreview/browser/positronPreviewSevice.js';
import { IQuartoDocumentModelService } from './quartoDocumentModelService.js';
import { IQuartoExecutionManager, ICellOutput, ICellOutputItem, CellExecutionState, IQuartoOutputCacheService } from '../common/quartoExecutionTypes.js';
import { QUARTO_INLINE_OUTPUT_ENABLED, isQuartoDocument } from '../common/positronQuartoConfig.js';
import { IPositronNotebookOutputWebviewService } from '../../positronOutputWebview/browser/notebookOutputWebviewService.js';
import { IQuartoKernelManager } from './quartoKernelManager.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { ILanguageRuntimeMessageWebOutput, LanguageRuntimeMessageType, RuntimeOutputKind, PositronOutputLocation } from '../../../services/languageRuntime/common/languageRuntimeService.js';

export const IQuartoOutputManager = createDecorator<IQuartoOutputManager>('quartoOutputManager');

/**
 * Event emitted when outputs change for a cell.
 */
export interface OutputChangeEvent {
	/** The cell ID */
	readonly cellId: string;
	/** The document URI */
	readonly documentUri: URI;
	/** Current outputs */
	readonly outputs: readonly ICellOutput[];
}

/**
 * Interface for the Quarto output manager service.
 * Manages inline output display for Quarto documents.
 */
export interface IQuartoOutputManager {
	readonly _serviceBrand: undefined;

	/**
	 * Event fired when outputs change.
	 */
	readonly onDidChangeOutputs: Event<OutputChangeEvent>;

	/**
	 * Event fired when all outputs should be cleared globally.
	 * Used when clearing the entire output cache.
	 */
	readonly onDidRequestClearAll: Event<void>;

	/**
	 * Get outputs for a cell.
	 */
	getOutputsForCell(cellId: string): readonly ICellOutput[];

	/**
	 * Clear outputs for a cell.
	 */
	clearOutputsForCell(documentUri: URI, cellId: string): void;

	/**
	 * Clear all outputs for a document.
	 */
	clearAllOutputs(documentUri: URI): void;

	/**
	 * Clear all outputs for all documents.
	 * Used when clearing the entire output cache.
	 */
	clearAllOutputsGlobally(): void;
}

/**
 * Editor contribution that manages output view zones for a single editor.
 * One instance per editor that displays a Quarto document.
 */
export class QuartoOutputContribution extends Disposable implements IEditorContribution {
	static readonly ID = 'editor.contrib.quartoOutput';

	private readonly _viewZones = new Map<string, QuartoOutputViewZone>();
	private readonly _outputsByCell = new Map<string, ICellOutput[]>();
	// Track content hashes for each cell ID so we can find cells that moved
	// (cell IDs include the index, which changes when cells are inserted/deleted)
	private readonly _contentHashByCellId = new Map<string, string>();
	private _documentUri: URI | undefined;
	private _featureEnabled: boolean;
	private _outputHandlingInitialized = false;

	// Track subscriptions from _initializeOutputHandling() separately so they can be
	// disposed when the model changes, preventing duplicate event handlers
	private readonly _outputHandlingDisposables = this._register(new DisposableStore());

	// Track whether we've attempted to load cached outputs for this document.
	// This prevents infinite loops when listening for model changes.
	private _cachedOutputsLoaded = false;

	private readonly _onDidChangeOutputs = this._register(new Emitter<OutputChangeEvent>());
	readonly onDidChangeOutputs = this._onDidChangeOutputs.event;

	constructor(
		private readonly _editor: ICodeEditor,
		@IQuartoExecutionManager private readonly _executionManager: IQuartoExecutionManager,
		@IQuartoDocumentModelService private readonly _documentModelService: IQuartoDocumentModelService,
		@IQuartoKernelManager private readonly _kernelManager: IQuartoKernelManager,
		@IQuartoOutputCacheService private readonly _cacheService: IQuartoOutputCacheService,
		@IPositronNotebookOutputWebviewService private readonly _webviewService: IPositronNotebookOutputWebviewService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@ILogService private readonly _logService: ILogService,
		@IQuartoOutputManager private readonly _outputManager: IQuartoOutputManager,
		@IClipboardService private readonly _clipboardService: IClipboardService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IFileDialogService private readonly _fileDialogService: IFileDialogService,
		@IFileService private readonly _fileService: IFileService,
		@IEditorService private readonly _editorService: IEditorService,
		@IPositronPreviewService private readonly _previewService: IPositronPreviewService,
	) {
		super();

		// Get document URI from editor model
		const model = this._editor.getModel();
		this._documentUri = model?.uri;

		// Check if feature is enabled (context key checks both setting and extension installation)
		this._featureEnabled = this._contextKeyService.getContextKeyValue<boolean>(QUARTO_INLINE_OUTPUT_ENABLED.key) ?? false;

		// Always listen for context key changes so we can initialize when feature is enabled
		this._register(this._contextKeyService.onDidChangeContext(e => {
			if (e.affectsSome(new Set([QUARTO_INLINE_OUTPUT_ENABLED.key]))) {
				this._handleFeatureToggle();
			}
		}));

		// Handle editor model changes (e.g., file closed and reopened, or untitled saved to file)
		this._register(this._editor.onDidChangeModel(() => {
			// Capture the previous URI before updating
			const previousUri = this._documentUri;

			this._disposeAllViewZones();
			this._outputsByCell.clear();
			this._contentHashByCellId.clear();

			// Clear previous output handling subscriptions to prevent duplicates
			this._outputHandlingDisposables.clear();

			// Update document URI for the new model
			const newModel = this._editor.getModel();
			this._documentUri = newModel?.uri;

			// Handle untitled->saved transition: transfer cache from old URI to new URI
			// This happens when a user saves an untitled Quarto document to a file
			if (previousUri && this._documentUri &&
				previousUri.scheme === 'untitled' &&
				this._documentUri.scheme === 'file' &&
				this._isQuartoDocument()) {
				this._transferCacheFromUntitled(previousUri, this._documentUri);
			}

			// Reset initialization flags so we can re-initialize for the new document
			this._outputHandlingInitialized = false;
			this._cachedOutputsLoaded = false;

			// Re-check if this is a Quarto document and initialize if so
			if (this._featureEnabled && this._isQuartoDocument()) {
				this._initializeOutputHandling();
			}
		}));

		// Only initialize fully if feature is enabled and this is a Quarto document
		if (!this._featureEnabled || !this._isQuartoDocument()) {
			return;
		}

		this._initializeOutputHandling();
	}

	/**
	 * Initialize output handling listeners and load cached outputs.
	 * Called when feature is enabled and this is a Quarto document.
	 */
	private _initializeOutputHandling(): void {
		if (this._outputHandlingInitialized) {
			return;
		}
		this._outputHandlingInitialized = true;
		this._logService.debug('[QuartoOutputContribution] Initializing for', this._documentUri?.toString());

		// Load cached outputs
		this._loadCachedOutputs();

		// Listen for kernel state changes to update session on view zones
		// Use _outputHandlingDisposables so subscriptions are cleared on model change
		this._outputHandlingDisposables.add(this._kernelManager.onDidChangeKernelState(event => {
			if (this._documentUri && event.documentUri.toString() === this._documentUri.toString()) {
				this._updateViewZoneSessions();
			}
		}));

		// Listen for execution outputs
		this._outputHandlingDisposables.add(this._executionManager.onDidReceiveOutput(event => {
			if (this._featureEnabled && this._documentUri && event.documentUri.toString() === this._documentUri.toString()) {
				this._handleOutput(event.cellId, event.output);
			}
		}));

		// Listen for execution state changes to manage recomputing state and update view zone button
		this._outputHandlingDisposables.add(this._executionManager.onDidChangeExecutionState(event => {
			if (this._featureEnabled &&
				this._documentUri &&
				event.execution.documentUri.toString() === this._documentUri.toString()) {

				const cellId = event.execution.cellId;
				const currentState = event.execution.state;
				const isRunning = currentState === CellExecutionState.Running;

				// Update view zone button state
				const viewZone = this._viewZones.get(cellId);
				if (viewZone) {
					viewZone.setExecuting(isRunning);
				}

				// When execution starts, put existing output into recomputing state
				// instead of clearing it immediately
				if (isRunning && event.previousState !== CellExecutionState.Running) {
					if (viewZone && viewZone.outputs.length > 0) {
						// Put the view zone into recomputing state - old output stays visible
						// but faded and with dotted border until new output arrives
						viewZone.setRecomputing(true);
					}
					// Clear our internal output tracking since new outputs will replace
					this._outputsByCell.delete(cellId);
					this._contentHashByCellId.delete(cellId);
					// Clear from cache
					if (this._documentUri) {
						this._cacheService.clearCellOutputs(this._documentUri, cellId);
					}
				}

				// When execution finishes (Idle, Completed, or Error), if still in
				// recomputing state (no new output arrived), clear the old outputs
				const executionFinished = currentState === CellExecutionState.Idle ||
					currentState === CellExecutionState.Completed ||
					currentState === CellExecutionState.Error;

				if (executionFinished && viewZone?.isRecomputing) {
					// No new output was produced - clear the old output and hide
					viewZone.clearOutputs();
					this._viewZones.delete(cellId);
					this._onDidChangeOutputs.fire({
						cellId,
						documentUri: this._documentUri!,
						outputs: [],
					});
				}
			}
		}));

		// Listen for document model re-parsing to update view zone positions.
		// We listen to onDidParse instead of onDidChangeModelContent because onDidParse
		// fires after the document model has re-parsed, ensuring we always have fresh
		// cell line numbers. This fixes the bug where view zone positions would not
		// update correctly when lines were deleted above a cell.
		const model = this._editor.getModel();
		if (model) {
			const quartoModel = this._documentModelService.getModel(model);
			this._outputHandlingDisposables.add(quartoModel.onDidParse(() => {
				if (this._featureEnabled) {
					// No debounce needed - the document model is already parsed
					this._updateViewZonePositionsImmediate();
				}
			}));
		}

		// Listen to output manager service for split editor synchronization
		// When another editor clears outputs, we should also clear
		this._outputHandlingDisposables.add(this._outputManager.onDidChangeOutputs(event => {
			if (this._featureEnabled && this._documentUri && event.documentUri.toString() === this._documentUri.toString()) {
				this._syncOutputsFromService(event);
			}
		}));

		// Listen for global clear all request (e.g., when clearing the entire cache)
		this._outputHandlingDisposables.add(this._outputManager.onDidRequestClearAll(() => {
			if (this._featureEnabled) {
				this.clearAllOutputs();
			}
		}));
	}

	/**
	 * Synchronize outputs from the output manager service.
	 * Used for split editor scenarios where another editor may have cleared outputs.
	 */
	private _syncOutputsFromService(event: OutputChangeEvent): void {
		// If outputs are empty and we have a view zone, another editor cleared it
		if (event.outputs.length === 0) {
			const viewZone = this._viewZones.get(event.cellId);
			if (viewZone) {
				// Don't fire our own clear event, just clean up the view zone
				viewZone.clearOutputs();
				viewZone.dispose();
				this._viewZones.delete(event.cellId);
				this._outputsByCell.delete(event.cellId);
			}
		}
	}

	/**
	 * Get outputs for a cell.
	 */
	getOutputsForCell(cellId: string): readonly ICellOutput[] {
		return this._outputsByCell.get(cellId) ?? [];
	}

	/**
	 * Clear outputs for a specific cell.
	 */
	clearOutputsForCell(cellId: string): void {
		this._clearCellOutputs(cellId);
	}

	/**
	 * Clear all outputs for the document.
	 */
	clearAllOutputs(): void {
		this._disposeAllViewZones();
		this._outputsByCell.clear();
	}

	/**
	 * Copy output for the cell at the given line number.
	 * Returns true if copy was initiated, false if no output exists for the cell.
	 */
	copyOutputForCellAtLine(lineNumber: number): boolean {
		const model = this._editor.getModel();
		if (!model) {
			return false;
		}

		// Get the cell at this line
		const quartoModel = this._documentModelService.getModel(model);
		const cell = quartoModel.getCellAtLine(lineNumber);
		if (!cell) {
			return false;
		}

		// Get the view zone for this cell
		const viewZone = this._viewZones.get(cell.id);
		if (!viewZone || !viewZone.hasCopiableContent()) {
			return false;
		}

		// Get the content to copy and handle it
		const content = this._getContentToCopyFromViewZone(viewZone);
		if (content) {
			this._handleCopyRequest({ cellId: cell.id, content }, viewZone);
			return true;
		}

		return false;
	}

	/**
	 * Get the content to copy from a view zone.
	 * This duplicates the logic in QuartoOutputViewZone._getContentToCopy
	 * since we can't access private methods.
	 */
	private _getContentToCopyFromViewZone(viewZone: QuartoOutputViewZone): CopyOutputRequest['content'] | undefined {
		const outputs = viewZone.outputs;

		// First pass: look for images
		for (const output of outputs) {
			for (const item of output.items) {
				if (item.mime.startsWith('image/')) {
					const dataUrl = item.data.startsWith('data:')
						? item.data
						: `data:${item.mime};base64,${item.data}`;
					return { type: 'image', dataUrl };
				}
			}
		}

		// Second pass: collect all text content
		const textParts: string[] = [];
		for (const output of outputs) {
			for (const item of output.items) {
				const text = this._extractTextFromItem(item);
				if (text) {
					textParts.push(text);
				}
			}
		}

		if (textParts.length > 0) {
			return { type: 'text', text: textParts.join('\n') };
		}

		return undefined;
	}

	/**
	 * Extract text content from an output item.
	 */
	private _extractTextFromItem(item: ICellOutputItem): string | undefined {
		const { mime, data } = item;

		if (mime === 'application/vnd.code.notebook.stdout' ||
			mime === 'text/plain' ||
			mime === 'application/vnd.code.notebook.stderr') {
			return data;
		}

		if (mime === 'application/vnd.code.notebook.error') {
			try {
				const errorData = JSON.parse(data);
				const parts: string[] = [];
				if (errorData.name) {
					parts.push(`${errorData.name}: ${errorData.message || ''}`);
				} else if (errorData.message) {
					parts.push(errorData.message);
				}
				if (errorData.stack) {
					parts.push(errorData.stack);
				}
				return parts.join('\n');
			} catch {
				return data;
			}
		}

		if (mime === 'text/markdown') {
			return data;
		}

		return undefined;
	}

	override dispose(): void {
		this._disposeAllViewZones();
		super.dispose();
	}

	private _isQuartoDocument(): boolean {
		const model = this._editor.getModel();
		return isQuartoDocument(this._documentUri?.path, model?.getLanguageId());
	}

	/**
	 * Transfer cached outputs from an untitled document to a saved file.
	 * This is called when a user saves an untitled Quarto document to a file.
	 * The cached outputs need to be moved to the new file URI so they persist.
	 *
	 * This method also restores the in-memory output state and creates view zones
	 * so that outputs are immediately visible after the save completes.
	 */
	private _transferCacheFromUntitled(fromUri: URI, toUri: URI): void {
		this._logService.debug('[QuartoOutputContribution] Transferring cache from untitled to file:',
			fromUri.toString(), '->', toUri.toString());

		// Get the cached outputs for the old (untitled) document
		const cachedOutputs = this._cacheService.getCachedOutputs(fromUri);
		if (cachedOutputs.size === 0) {
			this._logService.debug('[QuartoOutputContribution] No cached outputs to transfer');
			return;
		}

		// Copy each cell's outputs to the new location
		const model = this._editor.getModel();
		if (!model) {
			return;
		}

		const quartoModel = this._documentModelService.getModel(model);
		this._logService.debug('[QuartoOutputContribution] Transfer: found', cachedOutputs.size, 'cached cells,',
			quartoModel.cells.length, 'cells in new model');

		let transferredCount = 0;
		for (const [cellId, outputs] of cachedOutputs) {
			// Try to find the cell by ID first
			let cell = quartoModel.getCellById(cellId);

			// If not found by ID, try to find by content hash
			// (cell IDs include index which could differ if whitespace/parsing changed)
			if (!cell) {
				// Extract content hash from old cell ID (format: index-hashPrefix-label)
				const parts = cellId.split('-');
				if (parts.length >= 2) {
					const hashPrefix = parts[1];
					// Find cell with matching hash prefix
					cell = quartoModel.cells.find(c => c.contentHash.startsWith(hashPrefix));
				}
			}

			if (cell) {
				// Save outputs to cache under the new file URI
				for (const output of outputs) {
					this._cacheService.saveOutput(toUri, cell.id, cell.contentHash, cell.label, output);
				}

				// Also restore the in-memory output state so view zones can be created
				// This is needed because onDidChangeModel clears _outputsByCell before calling this method
				this._outputsByCell.set(cell.id, [...outputs]);
				this._contentHashByCellId.set(cell.id, cell.contentHash);

				transferredCount++;
				this._logService.debug('[QuartoOutputContribution] Transferred outputs for cell', cellId, '-> new cell', cell.id);
			} else {
				this._logService.debug('[QuartoOutputContribution] Could not find matching cell for', cellId);
			}
		}

		// Clear the old cache
		this._cacheService.clearCache(fromUri);

		this._logService.debug('[QuartoOutputContribution] Successfully transferred', transferredCount, 'cells to', toUri.toString());
	}

	/**
	 * Load cached outputs and restore view zones.
	 */
	private async _loadCachedOutputs(): Promise<void> {
		if (!this._documentUri) {
			return;
		}

		// Prevent duplicate loading
		if (this._cachedOutputsLoaded) {
			return;
		}

		try {
			let cachedDoc = await this._cacheService.loadCache(this._documentUri);

			const model = this._editor.getModel();
			if (!model) {
				return;
			}

			const quartoModel = this._documentModelService.getModel(model);

			// If no cache found, try to find cache by content hash
			// This handles two cases:
			// 1. A file document that was just saved from an untitled document
			// 2. An untitled document that got a different URI after window reload
			if ((!cachedDoc || cachedDoc.cells.length === 0) &&
				quartoModel.cells.length > 0) {

				const contentHashes = quartoModel.cells.map(c => c.contentHash);
				cachedDoc = await this._cacheService.findCacheByContentHash(this._documentUri, contentHashes);

				if (cachedDoc) {
					this._logService.debug('[QuartoOutputContribution] Found cache by content hash match');
				}
			}

			// If no cache found and no cells available yet, subscribe to model parse events.
			// This handles the case where an untitled document is being restored via hot exit
			// and the content hasn't been loaded yet when _loadCachedOutputs is first called.
			if ((!cachedDoc || cachedDoc.cells.length === 0) &&
				quartoModel.cells.length === 0 &&
				this._documentUri.scheme === 'untitled') {

				this._logService.debug('[QuartoOutputContribution] No cells found for untitled document, waiting for content to be restored');

				// Subscribe to parse events - when content is restored and parsed, cells will appear
				this._outputHandlingDisposables.add(quartoModel.onDidParse(() => {
					// Only try once more after cells appear
					if (quartoModel.cells.length > 0 && !this._cachedOutputsLoaded) {
						this._logService.debug('[QuartoOutputContribution] Cells found after parse, retrying cache load');
						this._loadCachedOutputs();
					}
				}));
				return;
			}

			// Mark as loaded to prevent re-entry
			this._cachedOutputsLoaded = true;

			if (!cachedDoc || cachedDoc.cells.length === 0) {
				this._logService.debug('[QuartoOutputContribution] No cached outputs to restore');
				return;
			}
			let restoredCount = 0;

			for (const cachedCell of cachedDoc.cells) {
				// Find the cell by content hash (validates cell hasn't changed)
				const cell = quartoModel.findCellByContentHash(cachedCell.contentHash);
				if (!cell) {
					// Cell content has changed - skip stale output
					this._logService.debug('[QuartoOutputContribution] Skipping stale cached output for cell', cachedCell.cellId);
					continue;
				}

				// Track content hash for this cell so we can find it if it moves
				this._contentHashByCellId.set(cell.id, cell.contentHash);

				// Restore outputs for this cell
				for (const output of cachedCell.outputs) {
					// Store in memory
					const outputs = this._outputsByCell.get(cell.id) ?? [];
					outputs.push(output);
					this._outputsByCell.set(cell.id, outputs);

					// Create or update view zone
					let viewZone = this._viewZones.get(cell.id);
					if (!viewZone) {
						viewZone = this._createViewZone(cell.id);
						if (viewZone) {
							this._viewZones.set(cell.id, viewZone);
						}
					}

					if (viewZone) {
						viewZone.addOutput(output);
					}
				}

				restoredCount++;
			}

			this._logService.debug('[QuartoOutputContribution] Restored cached outputs for', restoredCount, 'cells');

		} catch (error) {
			this._logService.warn('[QuartoOutputContribution] Failed to load cached outputs:', error);
		}
	}

	private _handleOutput(cellId: string, output: ICellOutput): void {
		this._logService.debug('[QuartoOutputContribution] Received output for cell', cellId);

		// Store output
		const outputs = this._outputsByCell.get(cellId) ?? [];
		outputs.push(output);
		this._outputsByCell.set(cellId, outputs);

		// Get or create view zone
		let viewZone = this._viewZones.get(cellId);
		if (!viewZone) {
			viewZone = this._createViewZone(cellId);
			if (!viewZone) {
				return;
			}
			this._viewZones.set(cellId, viewZone);
		}

		// Add output to view zone
		viewZone.addOutput(output);

		// Save to cache and track content hash
		if (this._documentUri) {
			const model = this._editor.getModel();
			if (model) {
				const quartoModel = this._documentModelService.getModel(model);
				const cell = quartoModel.getCellById(cellId);
				if (cell) {
					// Track content hash so we can find this cell if it moves
					this._contentHashByCellId.set(cellId, cell.contentHash);

					this._cacheService.saveOutput(
						this._documentUri,
						cellId,
						cell.contentHash,
						cell.label,
						output
					);
				}
			}
		}

		// Fire event
		this._onDidChangeOutputs.fire({
			cellId,
			documentUri: this._documentUri!,
			outputs: outputs,
		});
	}

	private _createViewZone(cellId: string): QuartoOutputViewZone | undefined {
		const model = this._editor.getModel();
		if (!model) {
			return undefined;
		}

		// Get the document model to find cell info
		const quartoModel = this._documentModelService.getModel(model);
		const cell = quartoModel.getCellById(cellId);
		if (!cell) {
			this._logService.warn('[QuartoOutputContribution] Cell not found:', cellId);
			return undefined;
		}

		// Get current session if available
		const session = this._documentUri
			? this._kernelManager.getSessionForDocument(this._documentUri)
			: undefined;

		// Create view zone after the cell's closing fence with webview support
		const viewZone = new QuartoOutputViewZone(
			this._editor,
			cellId,
			cell.endLine,
			this._webviewService,
			session
		);

		// Set up clear callback
		viewZone.onClear = () => {
			this._outputsByCell.delete(cellId);
			this._viewZones.delete(cellId);
			this._onDidChangeOutputs.fire({
				cellId,
				documentUri: this._documentUri!,
				outputs: [],
			});
		};

		// Set up interrupt callback
		viewZone.onInterrupt = () => {
			if (this._documentUri) {
				this._executionManager.cancelExecution(this._documentUri, cellId);
			}
		};

		// Set up copy handler
		this._outputHandlingDisposables.add(viewZone.onCopyRequested(request => {
			this._handleCopyRequest(request, viewZone);
		}));

		// Set up save handler
		this._outputHandlingDisposables.add(viewZone.onSaveRequested(request => {
			this._handleSaveRequest(request, cellId);
		}));

		// Set up popout handler
		this._outputHandlingDisposables.add(viewZone.onPopoutRequested(request => {
			this._handlePopoutRequest(request);
		}));

		// Set initial execution state
		const executionState = this._executionManager.getExecutionState(cellId);
		viewZone.setExecuting(executionState === CellExecutionState.Running);

		// Show the view zone
		viewZone.show();

		return viewZone;
	}

	/**
	 * Handle a copy request from a view zone.
	 * Copies the content to clipboard and shows visual feedback.
	 */
	private async _handleCopyRequest(request: CopyOutputRequest, viewZone: QuartoOutputViewZone): Promise<void> {
		try {
			if (request.content.type === 'text') {
				await this._clipboardService.writeText(request.content.text);
			} else if (request.content.type === 'image') {
				await this._clipboardService.writeImage(request.content.dataUrl);
			}
			// Show success feedback
			viewZone.showCopySuccess();
		} catch (error) {
			// Show error notification
			this._logService.error('[QuartoOutputContribution] Copy failed:', error);
			this._notificationService.error(localize('copyOutputFailed', 'Failed to copy output to clipboard'));
		}
	}

	/**
	 * Handle a save request from a view zone.
	 * Shows a file save dialog and saves the plot to the selected location.
	 */
	private async _handleSaveRequest(request: SavePlotRequest, cellId: string): Promise<void> {
		await this._savePlot(request.dataUrl, request.mimeType, cellId);
	}

	/**
	 * Handle a popout request from a view zone.
	 * Opens the output in an appropriate location based on type:
	 * - PLOT: Opens image in a new editor tab
	 * - TEXT: Opens in a new untitled editor
	 * - HTML: Opens in the Viewer pane
	 */
	private async _handlePopoutRequest(request: PopoutRequest): Promise<void> {
		const { popout } = request;

		try {
			switch (popout.type) {
				case 'plot':
					await this._openPlotInEditor(popout.dataUrl, popout.mimeType, request.cellId);
					break;
				case 'text':
					await this._openTextInEditor(popout.text);
					break;
				case 'html':
					await this._openHtmlInViewer(popout.html, request.cellId);
					break;
				case 'webview':
					await this._openWebviewInViewer(popout.rawData, popout.outputId);
					break;
			}
		} catch (error) {
			this._logService.error('[QuartoOutputContribution] Popout failed:', error);
			this._notificationService.error(localize('popoutFailed', 'Failed to open output'));
		}
	}

	/**
	 * Open a plot image in a new editor tab.
	 */
	private async _openPlotInEditor(dataUrl: string, mimeType: string, cellId: string): Promise<void> {
		if (!this._documentUri) {
			return;
		}

		// Extract base64 data from data URL
		const base64Data = this._extractBase64FromDataUrl(dataUrl);
		if (!base64Data) {
			throw new Error('Invalid data URL format');
		}

		// Decode base64 to binary
		const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

		// Create a temporary file to open the image
		// Use the document name + cell index for the filename
		const extension = this._getExtensionForMimeType(mimeType);
		const docName = basename(this._documentUri);
		const docNameWithoutExt = docName.substring(0, docName.length - extname(this._documentUri).length);
		const cellIndex = cellId.split('-')[0];
		const filename = `${docNameWithoutExt}_cell${cellIndex}${extension}`;

		// Write to a temp location and open it
		const tempDir = dirname(this._documentUri);
		const tempUri = tempDir.with({ path: `${tempDir.path}/.positron-temp-${filename}` });

		await this._fileService.writeFile(tempUri, VSBuffer.wrap(binaryData));

		// Open the temp file in the editor
		await this._editorService.openEditor({
			resource: tempUri,
			options: {
				pinned: false,
				preserveFocus: false,
			}
		});
	}

	/**
	 * Open text content in a new untitled editor.
	 */
	private async _openTextInEditor(text: string): Promise<void> {
		// Create an untitled document with the text content
		const untitledUri = URI.from({
			scheme: 'untitled',
			path: 'Output',
		});

		await this._editorService.openEditor({
			resource: untitledUri,
			contents: text,
			options: {
				pinned: false,
				preserveFocus: false,
			}
		});
	}

	/**
	 * Open HTML content in the Viewer pane.
	 */
	private async _openHtmlInViewer(html: string, cellId: string): Promise<void> {
		if (!this._documentUri) {
			return;
		}

		// Generate a filename for the temp HTML file
		const docName = basename(this._documentUri);
		const docNameWithoutExt = docName.substring(0, docName.length - extname(this._documentUri).length);
		const cellIndex = cellId.split('-')[0];
		const filename = `.positron-temp-${docNameWithoutExt}_cell${cellIndex}.html`;

		// Write HTML to a temp file in the same directory as the document
		const tempDir = dirname(this._documentUri);
		const tempUri = tempDir.with({ path: `${tempDir.path}/${filename}` });

		await this._fileService.writeFile(tempUri, VSBuffer.fromString(html));

		// Open the temp file in the Viewer pane using openHtml
		// openHtml uses the Positron Proxy extension to serve the file
		// and displays it in the Viewer panel (not an editor tab)
		const previewId = `quartoHtmlOutput.${cellId}`;

		// Create extension description for the preview service
		const extension = { id: new ExtensionIdentifier('positron.quarto') };

		await this._previewService.openHtml(previewId, extension, tempUri.fsPath);
	}

	/**
	 * Open a webview output in the Viewer pane.
	 * Uses the notebook output webview service to render the output using the same
	 * mechanism as inline output display.
	 */
	private async _openWebviewInViewer(rawData: Record<string, unknown>, outputId: string): Promise<void> {
		if (!this._documentUri) {
			return;
		}

		// Get the runtime session for this document
		const session = this._kernelManager.getSessionForDocument(this._documentUri);
		if (!session) {
			throw new Error('No active session for document');
		}

		// Construct a runtime output message from the raw data
		// This format is what createNotebookOutputWebview expects
		const runtimeMessage: ILanguageRuntimeMessageWebOutput = {
			id: `popout-${outputId}`,
			parent_id: '',
			when: new Date().toISOString(),
			event_clock: 0,
			type: LanguageRuntimeMessageType.Output,
			kind: RuntimeOutputKind.ViewerWidget,
			data: rawData,
			output_location: PositronOutputLocation.Viewer,
			resource_roots: undefined,
		};

		// Create a notebook output webview for the output
		const notebookWebview = await this._webviewService.createNotebookOutputWebview({
			id: runtimeMessage.id,
			runtime: session,
			output: runtimeMessage,
		});

		if (!notebookWebview) {
			throw new Error('Failed to create webview for output');
		}

		// Open the webview in the Viewer pane using the preview service
		const previewId = `quartoWebviewOutput.${outputId}`;
		this._previewService.openWebview(previewId, notebookWebview.webview, 'Quarto Output');
	}

	/**
	 * Popout the output for the cell at the given line number.
	 * Returns true if popout was initiated, false if no popout content exists.
	 */
	popoutForCellAtLine(lineNumber: number): boolean {
		const model = this._editor.getModel();
		if (!model) {
			this._logService.debug('[QuartoOutputContribution] popoutForCellAtLine: No editor model');
			return false;
		}

		// Get the cell at this line
		const quartoModel = this._documentModelService.getModel(model);
		const cell = quartoModel.getCellAtLine(lineNumber);
		if (!cell) {
			this._logService.debug(`[QuartoOutputContribution] popoutForCellAtLine: No cell at line ${lineNumber}`);
			return false;
		}

		this._logService.debug(`[QuartoOutputContribution] popoutForCellAtLine: Found cell ${cell.id} at line ${lineNumber}`);

		// Get the view zone for this cell
		const viewZone = this._viewZones.get(cell.id);
		if (!viewZone) {
			this._logService.debug(`[QuartoOutputContribution] popoutForCellAtLine: No view zone for cell ${cell.id}. Available: ${Array.from(this._viewZones.keys()).join(', ')}`);
			return false;
		}

		// Get the content and handle it
		const popout = viewZone.getPopoutContent();
		if (!popout) {
			this._logService.debug(`[QuartoOutputContribution] popoutForCellAtLine: No popout content for cell ${cell.id}`);
			return false;
		}

		this._handlePopoutRequest({ cellId: cell.id, popout });
		return true;
	}

	/**
	 * Save a plot to a file.
	 * @param dataUrl The data URL of the image
	 * @param mimeType The MIME type of the image
	 * @param cellId The cell ID (used for generating default filename)
	 * @param targetPath Optional target path for testing (bypasses dialog)
	 */
	async savePlot(dataUrl: string, mimeType: string, cellId: string, targetPath?: URI): Promise<boolean> {
		return this._savePlot(dataUrl, mimeType, cellId, targetPath);
	}

	private async _savePlot(dataUrl: string, mimeType: string, cellId: string, targetPath?: URI): Promise<boolean> {
		if (!this._documentUri) {
			return false;
		}

		try {
			// Determine file extension from MIME type
			const extension = this._getExtensionForMimeType(mimeType);

			// Generate default filename from document name + cell number
			const docName = basename(this._documentUri);
			const docNameWithoutExt = docName.substring(0, docName.length - extname(this._documentUri).length);

			// Extract cell index from cell ID (format: index-hashPrefix-label or just index-hashPrefix)
			const cellIndex = cellId.split('-')[0];
			const defaultFilename = `${docNameWithoutExt}_cell${cellIndex}${extension}`;

			// Default directory is same as the document
			const defaultDir = dirname(this._documentUri);
			const defaultUri = defaultDir.with({ path: `${defaultDir.path}/${defaultFilename}` });

			let saveUri: URI | undefined;

			if (targetPath) {
				// Use provided path (for testing)
				saveUri = targetPath;
			} else {
				// Show save dialog
				saveUri = await this._fileDialogService.showSaveDialog({
					title: localize('savePlotTitle', 'Save Plot'),
					defaultUri,
					filters: [
						{ name: localize('imageFiles', 'Image Files'), extensions: [extension.substring(1)] }
					]
				});
			}

			if (!saveUri) {
				return false; // User cancelled
			}

			// Extract base64 data from data URL
			const base64Data = this._extractBase64FromDataUrl(dataUrl);
			if (!base64Data) {
				throw new Error('Invalid data URL format');
			}

			// Decode base64 to binary
			const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));

			// Write the file
			await this._fileService.writeFile(saveUri, VSBuffer.wrap(binaryData));

			// Show success toast
			const savedFilename = basename(saveUri);
			this._notificationService.info(localize('plotSaved', '{0} saved', savedFilename));

			return true;
		} catch (error) {
			this._logService.error('[QuartoOutputContribution] Save failed:', error);
			this._notificationService.error(localize('savePlotFailed', 'Failed to save plot'));
			return false;
		}
	}

	/**
	 * Get the plot info for a cell at a given line number.
	 * Returns undefined if no single plot exists.
	 */
	getPlotInfoForCellAtLine(lineNumber: number): { dataUrl: string; mimeType: string; cellId: string } | undefined {
		const model = this._editor.getModel();
		if (!model) {
			return undefined;
		}

		const quartoModel = this._documentModelService.getModel(model);
		const cell = quartoModel.getCellAtLine(lineNumber);
		if (!cell) {
			return undefined;
		}

		const viewZone = this._viewZones.get(cell.id);
		if (!viewZone) {
			return undefined;
		}

		const plotInfo = viewZone.getSinglePlotInfo();
		if (!plotInfo) {
			return undefined;
		}

		return {
			dataUrl: plotInfo.dataUrl,
			mimeType: plotInfo.mimeType,
			cellId: cell.id,
		};
	}

	/**
	 * Get the cell ID for a given line number.
	 * Returns undefined if no cell exists at that line.
	 */
	getCellIdAtLine(lineNumber: number): string | undefined {
		const model = this._editor.getModel();
		if (!model) {
			return undefined;
		}

		const quartoModel = this._documentModelService.getModel(model);
		const cell = quartoModel.getCellAtLine(lineNumber);
		return cell?.id;
	}

	/**
	 * Get file extension for a MIME type.
	 */
	private _getExtensionForMimeType(mimeType: string): string {
		switch (mimeType) {
			case 'image/png':
				return '.png';
			case 'image/jpeg':
			case 'image/jpg':
				return '.jpg';
			case 'image/gif':
				return '.gif';
			case 'image/svg+xml':
				return '.svg';
			case 'image/webp':
				return '.webp';
			default:
				return '.png'; // Default to PNG
		}
	}

	/**
	 * Extract base64 data from a data URL.
	 */
	private _extractBase64FromDataUrl(dataUrl: string): string | undefined {
		const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
		return match ? match[2] : undefined;
	}

	/**
	 * Update session on all view zones when kernel state changes.
	 */
	private _updateViewZoneSessions(): void {
		if (!this._documentUri) {
			return;
		}

		const session = this._kernelManager.getSessionForDocument(this._documentUri);

		for (const viewZone of this._viewZones.values()) {
			viewZone.setSession(session);
		}
	}

	private _clearCellOutputs(cellId: string): void {
		const viewZone = this._viewZones.get(cellId);
		if (viewZone) {
			viewZone.clearOutputs();
			viewZone.dispose();
			this._viewZones.delete(cellId);
		}
		this._outputsByCell.delete(cellId);
		this._contentHashByCellId.delete(cellId);

		// Clear from cache
		if (this._documentUri) {
			this._cacheService.clearCellOutputs(this._documentUri, cellId);

			this._onDidChangeOutputs.fire({
				cellId,
				documentUri: this._documentUri,
				outputs: [],
			});
		}
	}

	/**
	 * Update view zone positions based on current cell positions.
	 * Called after the document model re-parses to ensure we have fresh line numbers.
	 *
	 * When cells move (e.g., a new cell is inserted above), their IDs change because
	 * cell IDs include the index. We use content hashes to find moved cells and remap
	 * the view zones to their new IDs, preserving outputs across position changes.
	 */
	private _updateViewZonePositionsImmediate(): void {
		const model = this._editor.getModel();
		if (!model) {
			return;
		}

		const quartoModel = this._documentModelService.getModel(model);

		// Collect remappings and deletions to apply after iteration
		// (can't modify maps while iterating)
		const remappings: Array<{ oldId: string; newId: string; contentHash: string }> = [];
		const deletions: string[] = [];

		for (const [cellId, viewZone] of this._viewZones) {
			const cell = quartoModel.getCellById(cellId);
			if (cell) {
				// Cell still exists with same ID - just update position
				viewZone.updateAfterLineNumber(cell.endLine);
			} else {
				// Cell ID not found - check if the cell just moved (ID changed due to index shift)
				const contentHash = this._contentHashByCellId.get(cellId);
				if (contentHash) {
					const movedCell = quartoModel.findCellByContentHash(contentHash);
					if (movedCell) {
						// Cell moved! Remap to new ID and update position
						this._logService.debug('[QuartoOutputContribution] Cell moved from', cellId, 'to', movedCell.id);
						viewZone.updateAfterLineNumber(movedCell.endLine);
						remappings.push({ oldId: cellId, newId: movedCell.id, contentHash });
					} else {
						// Cell content hash no longer exists - cell was truly deleted
						deletions.push(cellId);
					}
				} else {
					// No content hash tracked - cell was truly deleted
					deletions.push(cellId);
				}
			}
		}

		// Apply remappings
		for (const { oldId, newId, contentHash } of remappings) {
			const viewZone = this._viewZones.get(oldId);
			const outputs = this._outputsByCell.get(oldId);

			// Remove old entries
			this._viewZones.delete(oldId);
			this._outputsByCell.delete(oldId);
			this._contentHashByCellId.delete(oldId);

			// Add with new ID
			if (viewZone) {
				this._viewZones.set(newId, viewZone);
			}
			if (outputs) {
				this._outputsByCell.set(newId, outputs);
			}
			this._contentHashByCellId.set(newId, contentHash);
		}

		// Apply deletions
		for (const cellId of deletions) {
			const viewZone = this._viewZones.get(cellId);
			if (viewZone) {
				viewZone.dispose();
			}
			this._viewZones.delete(cellId);
			this._outputsByCell.delete(cellId);
			this._contentHashByCellId.delete(cellId);
		}
	}

	private _handleFeatureToggle(): void {
		const enabled = this._contextKeyService.getContextKeyValue<boolean>(QUARTO_INLINE_OUTPUT_ENABLED.key) ?? false;
		this._featureEnabled = enabled;

		if (!enabled) {
			// Hide all view zones and clear subscriptions when feature is disabled
			this._disposeAllViewZones();
			this._outputHandlingDisposables.clear();
			this._outputHandlingInitialized = false;
		} else if (this._isQuartoDocument()) {
			// Initialize output handling when feature is enabled
			// This will also load cached outputs
			this._initializeOutputHandling();
		}
	}

	private _disposeAllViewZones(): void {
		for (const viewZone of this._viewZones.values()) {
			viewZone.dispose();
		}
		this._viewZones.clear();
	}
}

/**
 * Singleton service that coordinates output management across all editors.
 */
export class QuartoOutputManagerService extends Disposable implements IQuartoOutputManager {
	declare readonly _serviceBrand: undefined;

	private readonly _outputsByCell = new Map<string, ICellOutput[]>();
	private _cleanupScheduled = false;

	private readonly _onDidChangeOutputs = this._register(new Emitter<OutputChangeEvent>());
	readonly onDidChangeOutputs = this._onDidChangeOutputs.event;

	private readonly _onDidRequestClearAll = this._register(new Emitter<void>());
	readonly onDidRequestClearAll = this._onDidRequestClearAll.event;

	constructor(
		@IQuartoExecutionManager private readonly _executionManager: IQuartoExecutionManager,
		@IQuartoOutputCacheService private readonly _cacheService: IQuartoOutputCacheService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		// Listen to execution outputs to maintain global output state
		this._register(this._executionManager.onDidReceiveOutput(event => {
			const key = `${event.documentUri.toString()}:${event.cellId}`;
			const outputs = this._outputsByCell.get(key) ?? [];
			outputs.push(event.output);
			this._outputsByCell.set(key, outputs);

			this._onDidChangeOutputs.fire({
				cellId: event.cellId,
				documentUri: event.documentUri,
				outputs: outputs,
			});
		}));

		// Clear outputs when execution starts
		this._register(this._executionManager.onDidChangeExecutionState(event => {
			if (event.execution.state === CellExecutionState.Running &&
				event.previousState !== CellExecutionState.Running) {
				const key = `${event.execution.documentUri.toString()}:${event.execution.cellId}`;
				this._outputsByCell.delete(key);
			}
		}));

		// Schedule cache cleanup after a delay (avoid slowing down startup)
		this._scheduleCleanup();
	}

	/**
	 * Schedule cache cleanup to run after startup.
	 */
	private _scheduleCleanup(): void {
		if (this._cleanupScheduled) {
			return;
		}

		this._cleanupScheduled = true;

		// Run cleanup after 30 seconds to avoid impacting startup
		setTimeout(() => {
			this._cacheService.runCleanup().catch(error => {
				this._logService.warn('[QuartoOutputManagerService] Cache cleanup failed:', error);
			});
		}, 30000);
	}

	getOutputsForCell(cellId: string): readonly ICellOutput[] {
		// This is a simplified implementation
		// In practice, we'd need the document URI to get the right outputs
		for (const [key, outputs] of this._outputsByCell) {
			if (key.endsWith(`:${cellId}`)) {
				return outputs;
			}
		}
		return [];
	}

	clearOutputsForCell(documentUri: URI, cellId: string): void {
		const key = `${documentUri.toString()}:${cellId}`;
		this._outputsByCell.delete(key);

		// Clear from cache
		this._cacheService.clearCellOutputs(documentUri, cellId);

		this._onDidChangeOutputs.fire({
			cellId,
			documentUri,
			outputs: [],
		});
	}

	clearAllOutputs(documentUri: URI): void {
		const prefix = documentUri.toString() + ':';
		const keysToDelete: string[] = [];

		for (const key of this._outputsByCell.keys()) {
			if (key.startsWith(prefix)) {
				keysToDelete.push(key);
			}
		}

		for (const key of keysToDelete) {
			const cellId = key.substring(prefix.length);
			this._outputsByCell.delete(key);

			this._onDidChangeOutputs.fire({
				cellId,
				documentUri,
				outputs: [],
			});
		}

		// Clear entire document cache
		this._cacheService.clearCache(documentUri);
	}

	clearAllOutputsGlobally(): void {
		// Clear our internal state
		this._outputsByCell.clear();

		// Fire event to notify all contributions to clear their outputs
		// This is needed because contributions may have outputs loaded from cache
		// that were never registered with the service
		this._onDidRequestClearAll.fire();
	}
}
