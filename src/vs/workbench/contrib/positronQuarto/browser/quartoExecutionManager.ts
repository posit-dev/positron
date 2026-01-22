/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { CancellationToken, CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { ResourceMap } from '../../../../base/common/map.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IEphemeralStateService } from '../../../../platform/ephemeralState/common/ephemeralState.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { IQuartoKernelManager } from './quartoKernelManager.js';
import { IQuartoDocumentModelService } from './quartoDocumentModelService.js';
import { QuartoCodeCell } from '../common/quartoTypes.js';
import {
	CellExecution,
	CellExecutionState,
	ExecutionStateChangeEvent,
	ExecutionOutputEvent,
	ICellOutput,
	ICellOutputItem,
	ICellOutputWebviewMetadata,
	IQuartoExecutionManager,
	DEFAULT_EXECUTION_CONFIG,
} from '../common/quartoExecutionTypes.js';
import { RuntimeOnlineState, RuntimeCodeExecutionMode, RuntimeErrorBehavior, ILanguageRuntimeMessageWebOutput } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { getWebviewMessageType } from '../../../services/positronIPyWidgets/common/webviewPreloadUtils.js';
import { DeferredPromise } from '../../../../base/common/async.js';

// Re-export for convenience
export { IQuartoExecutionManager } from '../common/quartoExecutionTypes.js';

/**
 * Prefix for Quarto execution IDs.
 */
const QUARTO_EXEC_PREFIX = 'quarto-exec';

/**
 * Ephemeral state key prefix for execution queue persistence.
 */
const EXECUTION_QUEUE_KEY_PREFIX = 'positron.quarto.executionQueue';

/**
 * Internal tracking for a cell's execution.
 */
interface ExecutionTracker {
	execution: CellExecution;
	cts: CancellationTokenSource;
	deferred: DeferredPromise<void>;
	outputSize: number;
	outputCount: number;
	disposables: DisposableStore;
}

/**
 * Serialized queue state for ephemeral storage.
 */
interface SerializedQueueState {
	queuedCells: string[];
	runningCell: string | undefined;
}

/**
 * Implementation of the Quarto execution manager.
 * Manages code execution queue and output collection for Quarto documents.
 */
export class QuartoExecutionManager extends Disposable implements IQuartoExecutionManager {
	declare readonly _serviceBrand: undefined;

	/** Execution queue per document URI - chains promises for sequential execution */
	private readonly _executionQueue = new ResourceMap<Promise<void>>();

	/** Currently queued cell IDs per document */
	private readonly _queuedCells = new ResourceMap<string[]>();

	/** Currently running cell per document */
	private readonly _runningCells = new ResourceMap<string>();

	/** Execution trackers by cell ID */
	private readonly _executionTrackers = new Map<string, ExecutionTracker>();

	/** Cell execution states by cell ID */
	private readonly _cellStates = new Map<string, CellExecutionState>();

	/** In-memory cache of outputs by cell ID */
	private readonly _outputsByCell = new Map<string, ICellOutput[]>();

	private readonly _onDidChangeExecutionState = this._register(new Emitter<ExecutionStateChangeEvent>());
	readonly onDidChangeExecutionState: Event<ExecutionStateChangeEvent> = this._onDidChangeExecutionState.event;

	private readonly _onDidReceiveOutput = this._register(new Emitter<ExecutionOutputEvent>());
	readonly onDidReceiveOutput: Event<ExecutionOutputEvent> = this._onDidReceiveOutput.event;

	constructor(
		@IQuartoKernelManager private readonly _kernelManager: IQuartoKernelManager,
		@IQuartoDocumentModelService private readonly _documentModelService: IQuartoDocumentModelService,
		@IEditorService private readonly _editorService: IEditorService,
		@IEphemeralStateService private readonly _ephemeralStateService: IEphemeralStateService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		// Restore queue state on startup
		this._restoreQueueState();

		// Register disposal
		this._register(toDisposable(() => {
			// Cancel all pending executions
			for (const tracker of this._executionTrackers.values()) {
				tracker.cts.cancel();
				tracker.cts.dispose();
				tracker.disposables.dispose();
			}
			this._executionTrackers.clear();
		}));
	}

	async executeCell(documentUri: URI, cell: QuartoCodeCell, token?: CancellationToken): Promise<void> {
		return this.executeCells(documentUri, [cell], token);
	}

	async executeCells(documentUri: URI, cells: QuartoCodeCell[], token?: CancellationToken): Promise<void> {
		if (cells.length === 0) {
			return;
		}

		this._logService.debug(`[QuartoExecutionManager] Queueing ${cells.length} cells for execution`);

		// Add all cells to queue with Queued state
		for (const cell of cells) {
			this._setCellState(cell.id, CellExecutionState.Queued, documentUri);
			this._addToQueue(documentUri, cell.id);
		}

		// Persist queue state
		await this._persistQueueState(documentUri);

		// Chain execution promises
		const lastPromise = this._executionQueue.get(documentUri) ?? Promise.resolve();

		const executionPromise = lastPromise.then(async () => {
			for (const cell of cells) {
				// Check cancellation before each cell
				if (token?.isCancellationRequested) {
					// Mark remaining queued cells as idle
					for (const c of cells) {
						if (this.getExecutionState(c.id) === CellExecutionState.Queued) {
							this._setCellState(c.id, CellExecutionState.Idle, documentUri);
						}
					}
					break;
				}

				try {
					await this._executeCell(documentUri, cell, token);
				} catch (error) {
					this._logService.error(`[QuartoExecutionManager] Execution error for cell ${cell.id}:`, error);
					this._setCellState(cell.id, CellExecutionState.Error, documentUri);
				}
			}
		}).finally(() => {
			// Clean up queue reference when chain completes
			if (this._executionQueue.get(documentUri) === executionPromise) {
				this._executionQueue.delete(documentUri);
			}
		});

		this._executionQueue.set(documentUri, executionPromise);
		return executionPromise;
	}

	async cancelExecution(documentUri: URI, cellId?: string): Promise<void> {
		this._logService.debug(`[QuartoExecutionManager] Cancelling execution for ${documentUri.toString()}${cellId ? `, cell ${cellId}` : ''}`);

		// Interrupt the kernel
		this._kernelManager.interruptKernelForDocument(documentUri);

		// Cancel specific cell or all cells for document
		const queuedCells = this._queuedCells.get(documentUri) ?? [];
		const runningCell = this._runningCells.get(documentUri);

		for (const id of queuedCells) {
			if (!cellId || id === cellId) {
				const tracker = this._executionTrackers.get(id);
				if (tracker) {
					tracker.cts.cancel();
				}
				this._setCellState(id, CellExecutionState.Idle, documentUri);
			}
		}

		// Cancel running cell if requested
		if (runningCell && (!cellId || runningCell === cellId)) {
			const tracker = this._executionTrackers.get(runningCell);
			if (tracker) {
				tracker.cts.cancel();
			}
			this._setCellState(runningCell, CellExecutionState.Idle, documentUri);
		}

		// Clear queued cells
		if (!cellId) {
			this._queuedCells.delete(documentUri);
			this._runningCells.delete(documentUri);
		} else {
			const remaining = queuedCells.filter(id => id !== cellId);
			if (remaining.length > 0) {
				this._queuedCells.set(documentUri, remaining);
			} else {
				this._queuedCells.delete(documentUri);
			}
			if (runningCell === cellId) {
				this._runningCells.delete(documentUri);
			}
		}

		await this._persistQueueState(documentUri);
	}

	getExecutionState(cellId: string): CellExecutionState {
		return this._cellStates.get(cellId) ?? CellExecutionState.Idle;
	}

	getQueuedCells(documentUri: URI): string[] {
		return [...(this._queuedCells.get(documentUri) ?? [])];
	}

	getRunningCell(documentUri: URI): string | undefined {
		return this._runningCells.get(documentUri);
	}

	clearExecutionState(documentUri: URI): void {
		const queuedCells = this._queuedCells.get(documentUri) ?? [];
		const runningCell = this._runningCells.get(documentUri);

		// Clear all states for this document's cells
		for (const cellId of queuedCells) {
			this._cellStates.delete(cellId);
			this._outputsByCell.delete(cellId);
			const tracker = this._executionTrackers.get(cellId);
			if (tracker) {
				tracker.cts.cancel();
				tracker.cts.dispose();
				tracker.disposables.dispose();
				this._executionTrackers.delete(cellId);
			}
		}

		if (runningCell) {
			this._cellStates.delete(runningCell);
			this._outputsByCell.delete(runningCell);
			const tracker = this._executionTrackers.get(runningCell);
			if (tracker) {
				tracker.cts.cancel();
				tracker.cts.dispose();
				tracker.disposables.dispose();
				this._executionTrackers.delete(runningCell);
			}
		}

		this._queuedCells.delete(documentUri);
		this._runningCells.delete(documentUri);
	}

	/**
	 * Execute a single cell and collect output.
	 */
	private async _executeCell(
		documentUri: URI,
		cell: QuartoCodeCell,
		token?: CancellationToken
	): Promise<void> {
		// Ensure kernel is ready
		const session = await this._kernelManager.ensureKernelForDocument(documentUri, token);
		if (!session) {
			this._logService.warn(`[QuartoExecutionManager] No session available for ${documentUri.toString()}`);
			this._setCellState(cell.id, CellExecutionState.Error, documentUri);
			this._removeFromQueue(documentUri, cell.id);
			return;
		}

		// Check cancellation
		if (token?.isCancellationRequested) {
			return;
		}

		// Create execution tracker
		const executionId = `${QUARTO_EXEC_PREFIX}-${generateUuid()}`;
		const cts = new CancellationTokenSource(token);
		const deferred = new DeferredPromise<void>();
		const disposables = new DisposableStore();

		const tracker: ExecutionTracker = {
			execution: {
				cellId: cell.id,
				state: CellExecutionState.Running,
				executionId,
				startTime: Date.now(),
				documentUri,
			},
			cts,
			deferred,
			outputSize: 0,
			outputCount: 0,
			disposables,
		};

		this._executionTrackers.set(cell.id, tracker);

		// Update state to running
		this._removeFromQueue(documentUri, cell.id);
		this._runningCells.set(documentUri, cell.id);
		this._setCellState(cell.id, CellExecutionState.Running, documentUri);
		await this._persistQueueState(documentUri);

		// Clear previous outputs for this cell
		this._outputsByCell.delete(cell.id);

		try {
			// Set up message handlers
			this._setupMessageHandlers(tracker, session, documentUri);

			// Get cell code
			const code = await this._getCellCode(documentUri, cell);
			if (!code) {
				throw new Error('Could not get cell code');
			}

			// Execute the code
			this._logService.debug(`[QuartoExecutionManager] Executing cell ${cell.id} with execution ID ${executionId}`);
			session.execute(
				code,
				executionId,
				RuntimeCodeExecutionMode.Interactive,
				RuntimeErrorBehavior.Continue
			);

			// Set up timeout
			const timeoutMs = DEFAULT_EXECUTION_CONFIG.executionTimeout;
			let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

			if (timeoutMs > 0) {
				timeoutHandle = setTimeout(() => {
					this._logService.warn(`[QuartoExecutionManager] Execution timeout for cell ${cell.id}`);
					tracker.cts.cancel();
					deferred.error(new Error('Execution timeout'));
				}, timeoutMs);

				disposables.add(toDisposable(() => {
					if (timeoutHandle) {
						clearTimeout(timeoutHandle);
					}
				}));
			}

			// Wait for completion
			await Promise.race([
				deferred.p,
				new Promise<void>((_, reject) => {
					const cancellationListener = cts.token.onCancellationRequested(() => {
						reject(new Error('Execution cancelled'));
					});
					disposables.add(cancellationListener);
				}),
			]);

			// Update state to completed
			this._setCellState(cell.id, CellExecutionState.Completed, documentUri);

		} catch (error) {
			if (cts.token.isCancellationRequested) {
				this._setCellState(cell.id, CellExecutionState.Idle, documentUri);
			} else {
				this._logService.error(`[QuartoExecutionManager] Execution failed for cell ${cell.id}:`, error);
				this._setCellState(cell.id, CellExecutionState.Error, documentUri);
			}
		} finally {
			// Clean up
			this._runningCells.delete(documentUri);
			this._executionTrackers.delete(cell.id);
			disposables.dispose();
			cts.dispose();
			await this._persistQueueState(documentUri);
		}
	}

	/**
	 * Set up message handlers for runtime output.
	 */
	private _setupMessageHandlers(
		tracker: ExecutionTracker,
		session: import('../../../services/runtimeSession/common/runtimeSessionService.js').ILanguageRuntimeSession,
		documentUri: URI
	): void {
		const { execution, deferred, disposables } = tracker;
		const executionId = execution.executionId;

		// Handle output messages (display_data)
		disposables.add(session.onDidReceiveRuntimeMessageOutput(message => {
			if (message.parent_id !== executionId) {
				return;
			}
			// Cast to ILanguageRuntimeMessageWebOutput to get resource_roots if available
			const webMessage = message as ILanguageRuntimeMessageWebOutput;
			this._handleOutputMessage(tracker, documentUri, message.data, webMessage);
		}));

		// Handle result messages (execute_result) - these are computation results like "2 + 3"
		disposables.add(session.onDidReceiveRuntimeMessageResult(message => {
			if (message.parent_id !== executionId) {
				return;
			}
			// Cast to ILanguageRuntimeMessageWebOutput to get resource_roots if available
			const webMessage = message as ILanguageRuntimeMessageWebOutput;
			this._handleOutputMessage(tracker, documentUri, message.data, webMessage);
		}));

		// Handle stream messages (stdout/stderr)
		disposables.add(session.onDidReceiveRuntimeMessageStream(message => {
			if (message.parent_id !== executionId) {
				return;
			}
			const mime = message.name === 'stderr' ? 'application/vnd.code.notebook.stderr' : 'application/vnd.code.notebook.stdout';
			this._addOutput(tracker, documentUri, [{
				mime,
				data: message.text,
			}]);
		}));

		// Handle error messages
		disposables.add(session.onDidReceiveRuntimeMessageError(message => {
			if (message.parent_id !== executionId) {
				return;
			}
			this._addOutput(tracker, documentUri, [{
				mime: 'application/vnd.code.notebook.error',
				data: JSON.stringify({
					name: message.name,
					message: message.message,
					stack: message.traceback.join('\n'),
				}),
			}]);
		}));

		// Handle state messages (completion detection)
		disposables.add(session.onDidReceiveRuntimeMessageState(message => {
			if (message.parent_id !== executionId) {
				return;
			}
			if (message.state === RuntimeOnlineState.Idle) {
				this._logService.debug(`[QuartoExecutionManager] Execution completed for ${executionId}`);
				deferred.complete();
			}
		}));
	}

	/**
	 * Handle output message data from runtime.
	 */
	private _handleOutputMessage(
		tracker: ExecutionTracker,
		documentUri: URI,
		data: Record<string, unknown>,
		runtimeMessage?: ILanguageRuntimeMessageWebOutput
	): void {
		const outputItems: ICellOutputItem[] = [];

		// Process MIME types in order of preference
		const mimeOrder = [
			'text/html',
			'image/svg+xml',
			'image/png',
			'image/jpeg',
			'image/gif',
			'application/json',
			'text/markdown',
			'text/latex',
			'text/plain',
		];

		for (const mime of mimeOrder) {
			if (mime in data) {
				const value = data[mime];
				if (typeof value === 'string') {
					outputItems.push({ mime, data: value });
				} else if (value !== undefined) {
					outputItems.push({ mime, data: JSON.stringify(value) });
				}
			}
		}

		// Handle any remaining MIME types
		for (const [mime, value] of Object.entries(data)) {
			if (!mimeOrder.includes(mime) && value !== undefined) {
				if (typeof value === 'string') {
					outputItems.push({ mime, data: value });
				} else {
					outputItems.push({ mime, data: JSON.stringify(value) });
				}
			}
		}

		if (outputItems.length > 0) {
			// Detect if this output needs webview rendering
			const webviewType = getWebviewMessageType(outputItems);
			let webviewMetadata: ICellOutputWebviewMetadata | undefined;

			if (webviewType) {
				webviewMetadata = {
					webviewType,
					rawData: data,
					resourceRoots: runtimeMessage?.resource_roots?.map(r => {
						// Convert UriComponents to string
						if (typeof r === 'string') {
							return r;
						}
						// Handle URI-like objects
						return (r as { path?: string }).path ?? JSON.stringify(r);
					}),
				};
			}

			this._addOutput(tracker, documentUri, outputItems, webviewMetadata);
		}
	}

	/**
	 * Add output to a cell, respecting size and count limits.
	 */
	private _addOutput(
		tracker: ExecutionTracker,
		documentUri: URI,
		items: ICellOutputItem[],
		webviewMetadata?: ICellOutputWebviewMetadata
	): void {
		// Check output limits
		if (tracker.outputCount >= DEFAULT_EXECUTION_CONFIG.maxOutputItems) {
			this._logService.warn(`[QuartoExecutionManager] Output count limit reached for cell ${tracker.execution.cellId}`);
			return;
		}

		// Calculate size of new items
		let newSize = 0;
		for (const item of items) {
			newSize += item.data.length;
		}

		// Check size limit
		if (tracker.outputSize + newSize > DEFAULT_EXECUTION_CONFIG.maxOutputSize) {
			// Truncate output
			this._logService.warn(`[QuartoExecutionManager] Output size limit reached for cell ${tracker.execution.cellId}`);

			// Add truncation notice
			const truncationOutput: ICellOutput = {
				outputId: generateUuid(),
				items: [{
					mime: 'text/plain',
					data: '[Output truncated due to size limit]',
				}],
			};

			const outputs = this._outputsByCell.get(tracker.execution.cellId) ?? [];
			outputs.push(truncationOutput);
			this._outputsByCell.set(tracker.execution.cellId, outputs);

			this._onDidReceiveOutput.fire({
				cellId: tracker.execution.cellId,
				output: truncationOutput,
				documentUri,
			});

			// Set size to max to prevent further outputs
			tracker.outputSize = DEFAULT_EXECUTION_CONFIG.maxOutputSize;
			return;
		}

		// Create output with optional webview metadata
		const output: ICellOutput = {
			outputId: generateUuid(),
			items,
			webviewMetadata,
		};

		// Store output
		const outputs = this._outputsByCell.get(tracker.execution.cellId) ?? [];
		outputs.push(output);
		this._outputsByCell.set(tracker.execution.cellId, outputs);

		// Update tracker
		tracker.outputSize += newSize;
		tracker.outputCount++;

		// Fire event
		this._onDidReceiveOutput.fire({
			cellId: tracker.execution.cellId,
			output,
			documentUri,
		});
	}

	/**
	 * Get code content for a cell.
	 */
	private async _getCellCode(documentUri: URI, cell: QuartoCodeCell): Promise<string | undefined> {
		try {
			// Get the text model from the editor service
			const textModel = await this._getTextModel(documentUri);
			if (!textModel) {
				return undefined;
			}

			// Get the Quarto document model and extract cell code
			const quartoModel = this._documentModelService.getModel(textModel);
			return quartoModel.getCellCode(cell);
		} catch (error) {
			this._logService.warn(`[QuartoExecutionManager] Failed to get cell code:`, error);
			return undefined;
		}
	}

	/**
	 * Get the text model for a document URI.
	 */
	private async _getTextModel(documentUri: URI): Promise<ITextModel | undefined> {
		const editors = this._editorService.findEditors(documentUri);
		if (editors.length === 0) {
			return undefined;
		}

		const editorInput = editors[0];
		const model = await editorInput.editor.resolve();
		if (!model || !('textEditorModel' in model)) {
			return undefined;
		}

		return model.textEditorModel as ITextModel;
	}

	/**
	 * Set cell execution state and fire event.
	 */
	private _setCellState(cellId: string, state: CellExecutionState, documentUri: URI): void {
		const previousState = this._cellStates.get(cellId) ?? CellExecutionState.Idle;
		if (previousState === state) {
			return;
		}

		this._cellStates.set(cellId, state);

		const tracker = this._executionTrackers.get(cellId);
		const execution: CellExecution = tracker?.execution ?? {
			cellId,
			state,
			executionId: '',
			documentUri,
		};

		this._onDidChangeExecutionState.fire({
			execution: { ...execution, state },
			previousState,
		});
	}

	/**
	 * Add a cell to the execution queue.
	 */
	private _addToQueue(documentUri: URI, cellId: string): void {
		const queued = this._queuedCells.get(documentUri) ?? [];
		if (!queued.includes(cellId)) {
			queued.push(cellId);
			this._queuedCells.set(documentUri, queued);
		}
	}

	/**
	 * Remove a cell from the execution queue.
	 */
	private _removeFromQueue(documentUri: URI, cellId: string): void {
		const queued = this._queuedCells.get(documentUri);
		if (queued) {
			const index = queued.indexOf(cellId);
			if (index >= 0) {
				queued.splice(index, 1);
				if (queued.length === 0) {
					this._queuedCells.delete(documentUri);
				}
			}
		}
	}

	/**
	 * Get the storage key for a document's queue state.
	 */
	private _getStorageKey(documentUri: URI): string {
		const workspaceId = this._workspaceContextService.getWorkspace().id;
		return `${EXECUTION_QUEUE_KEY_PREFIX}.${workspaceId}.${documentUri.toString()}`;
	}

	/**
	 * Persist queue state to ephemeral storage.
	 */
	private async _persistQueueState(documentUri: URI): Promise<void> {
		const key = this._getStorageKey(documentUri);
		const state: SerializedQueueState = {
			queuedCells: this._queuedCells.get(documentUri) ?? [],
			runningCell: this._runningCells.get(documentUri),
		};

		try {
			await this._ephemeralStateService.setItem(key, state);
		} catch (error) {
			this._logService.warn(`[QuartoExecutionManager] Failed to persist queue state:`, error);
		}
	}

	/**
	 * Restore queue state from ephemeral storage.
	 * This is called on startup to restore queued cells that survived a reload.
	 */
	private async _restoreQueueState(): Promise<void> {
		// Note: We don't have a way to enumerate all keys in ephemeral state,
		// so we can't restore queue state for all documents.
		// Queue restoration would need to be triggered when a document opens.
		// For now, this is a placeholder for future enhancement.
		this._logService.debug('[QuartoExecutionManager] Queue state restoration not implemented');
	}
}
