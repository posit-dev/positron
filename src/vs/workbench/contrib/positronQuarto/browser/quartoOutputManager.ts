/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { IEditorContribution } from '../../../../editor/common/editorCommon.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { QuartoOutputViewZone } from './quartoOutputViewZone.js';
import { IQuartoDocumentModelService } from './quartoDocumentModelService.js';
import { IQuartoExecutionManager, ICellOutput, CellExecutionState, IQuartoOutputCacheService } from '../common/quartoExecutionTypes.js';
import { POSITRON_QUARTO_INLINE_OUTPUT_KEY } from '../common/positronQuartoConfig.js';
import { IPositronNotebookOutputWebviewService } from '../../positronOutputWebview/browser/notebookOutputWebviewService.js';
import { IQuartoKernelManager } from './quartoKernelManager.js';

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
}

/**
 * Debounce delay for view zone position updates (ms).
 */
const VIEW_ZONE_UPDATE_DEBOUNCE = 50;

/**
 * Editor contribution that manages output view zones for a single editor.
 * One instance per editor that displays a Quarto document.
 */
export class QuartoOutputContribution extends Disposable implements IEditorContribution {
	static readonly ID = 'editor.contrib.quartoOutput';

	private readonly _viewZones = new Map<string, QuartoOutputViewZone>();
	private readonly _outputsByCell = new Map<string, ICellOutput[]>();
	private _documentUri: URI | undefined;
	private _featureEnabled: boolean;
	private _outputHandlingInitialized = false;

	// Performance optimization: debounced view zone position updates
	private _viewZoneUpdateTimeout: ReturnType<typeof setTimeout> | undefined;

	private readonly _onDidChangeOutputs = this._register(new Emitter<OutputChangeEvent>());
	readonly onDidChangeOutputs = this._onDidChangeOutputs.event;

	constructor(
		private readonly _editor: ICodeEditor,
		@IQuartoExecutionManager private readonly _executionManager: IQuartoExecutionManager,
		@IQuartoDocumentModelService private readonly _documentModelService: IQuartoDocumentModelService,
		@IQuartoKernelManager private readonly _kernelManager: IQuartoKernelManager,
		@IQuartoOutputCacheService private readonly _cacheService: IQuartoOutputCacheService,
		@IPositronNotebookOutputWebviewService private readonly _webviewService: IPositronNotebookOutputWebviewService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILogService private readonly _logService: ILogService,
		@IQuartoOutputManager private readonly _outputManager: IQuartoOutputManager,
	) {
		super();

		// Get document URI from editor model
		const model = this._editor.getModel();
		this._documentUri = model?.uri;

		// Check if feature is enabled
		this._featureEnabled = this._configurationService.getValue<boolean>(POSITRON_QUARTO_INLINE_OUTPUT_KEY) ?? false;

		// Always listen for configuration changes so we can initialize when feature is enabled
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(POSITRON_QUARTO_INLINE_OUTPUT_KEY)) {
				this._handleFeatureToggle();
			}
		}));

		// Handle editor model changes (e.g., file closed and reopened)
		this._register(this._editor.onDidChangeModel(() => {
			this._disposeAllViewZones();
			this._outputsByCell.clear();

			// Update document URI for the new model
			const newModel = this._editor.getModel();
			this._documentUri = newModel?.uri;

			// Reset initialization flag so we can re-initialize for the new document
			this._outputHandlingInitialized = false;

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
		this._register(this._kernelManager.onDidChangeKernelState(event => {
			if (this._documentUri && event.documentUri.toString() === this._documentUri.toString()) {
				this._updateViewZoneSessions();
			}
		}));

		// Listen for execution outputs
		this._register(this._executionManager.onDidReceiveOutput(event => {
			if (this._featureEnabled && this._documentUri && event.documentUri.toString() === this._documentUri.toString()) {
				this._handleOutput(event.cellId, event.output);
			}
		}));

		// Listen for execution state changes to clear outputs on new execution
		this._register(this._executionManager.onDidChangeExecutionState(event => {
			if (this._featureEnabled &&
				this._documentUri &&
				event.execution.documentUri.toString() === this._documentUri.toString() &&
				event.execution.state === CellExecutionState.Running &&
				event.previousState !== CellExecutionState.Running) {
				// Clear outputs when execution starts
				this._clearCellOutputs(event.execution.cellId);
			}
		}));

		// Listen for model content changes to update view zone positions (debounced)
		this._register(this._editor.onDidChangeModelContent(() => {
			if (this._featureEnabled) {
				this._scheduleViewZonePositionUpdate();
			}
		}));

		// Listen to output manager service for split editor synchronization
		// When another editor clears outputs, we should also clear
		this._register(this._outputManager.onDidChangeOutputs(event => {
			if (this._featureEnabled && this._documentUri && event.documentUri.toString() === this._documentUri.toString()) {
				this._syncOutputsFromService(event);
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

	override dispose(): void {
		// Clear pending timeouts
		if (this._viewZoneUpdateTimeout) {
			clearTimeout(this._viewZoneUpdateTimeout);
			this._viewZoneUpdateTimeout = undefined;
		}

		this._disposeAllViewZones();
		super.dispose();
	}

	private _isQuartoDocument(): boolean {
		const path = this._documentUri?.path;
		return path !== undefined && path.endsWith('.qmd');
	}

	/**
	 * Load cached outputs and restore view zones.
	 */
	private async _loadCachedOutputs(): Promise<void> {
		if (!this._documentUri) {
			return;
		}

		try {
			const cachedDoc = await this._cacheService.loadCache(this._documentUri);
			if (!cachedDoc || cachedDoc.cells.length === 0) {
				this._logService.debug('[QuartoOutputContribution] No cached outputs to restore');
				return;
			}

			const model = this._editor.getModel();
			if (!model) {
				return;
			}

			const quartoModel = this._documentModelService.getModel(model);
			let restoredCount = 0;

			for (const cachedCell of cachedDoc.cells) {
				// Find the cell by content hash (validates cell hasn't changed)
				const cell = quartoModel.findCellByContentHash(cachedCell.contentHash);
				if (!cell) {
					// Cell content has changed - skip stale output
					this._logService.debug('[QuartoOutputContribution] Skipping stale cached output for cell', cachedCell.cellId);
					continue;
				}

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

		// Save to cache
		if (this._documentUri) {
			const model = this._editor.getModel();
			if (model) {
				const quartoModel = this._documentModelService.getModel(model);
				const cell = quartoModel.getCellById(cellId);
				if (cell) {
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

		// Show the view zone
		viewZone.show();

		return viewZone;
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
	 * Schedule a debounced view zone position update.
	 * This is called frequently during typing, so we debounce to avoid excessive updates.
	 */
	private _scheduleViewZonePositionUpdate(): void {
		if (this._viewZoneUpdateTimeout) {
			clearTimeout(this._viewZoneUpdateTimeout);
		}

		this._viewZoneUpdateTimeout = setTimeout(() => {
			this._viewZoneUpdateTimeout = undefined;
			this._updateViewZonePositionsImmediate();
		}, VIEW_ZONE_UPDATE_DEBOUNCE);
	}

	/**
	 * Actually update view zone positions.
	 */
	private _updateViewZonePositionsImmediate(): void {
		const model = this._editor.getModel();
		if (!model) {
			return;
		}

		const quartoModel = this._documentModelService.getModel(model);

		for (const [cellId, viewZone] of this._viewZones) {
			const cell = quartoModel.getCellById(cellId);
			if (cell) {
				viewZone.updateAfterLineNumber(cell.endLine);
			} else {
				// Cell was deleted - remove the view zone
				viewZone.dispose();
				this._viewZones.delete(cellId);
				this._outputsByCell.delete(cellId);
			}
		}
	}

	private _handleFeatureToggle(): void {
		const enabled = this._configurationService.getValue<boolean>(POSITRON_QUARTO_INLINE_OUTPUT_KEY) ?? false;
		this._featureEnabled = enabled;

		if (!enabled) {
			// Hide all view zones when feature is disabled
			this._disposeAllViewZones();
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
}
