/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { Range } from '../../../../editor/common/core/range.js';
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
import { DeferredPromise, RunOnceScheduler } from '../../../../base/common/async.js';
import { CodeAttributionSource, ILanguageRuntimeCodeExecutedEvent } from '../../../services/positronConsole/common/positronConsoleCodeExecution.js';
import { IPositronConsoleService } from '../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { IRuntimeSessionService, ILanguageRuntimeSession } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { ITerminalService } from '../../terminal/browser/terminal.js';
import { TerminalCapability, ICommandDetectionCapability } from '../../../../platform/terminal/common/capabilities/capabilities.js';

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
 * Shell languages that should be executed via terminal.
 */
const SHELL_LANGUAGES = new Set(['bash', 'sh', 'zsh', 'fish', 'shell', 'powershell', 'pwsh', 'cmd']);

/**
 * Check if a language should be executed via terminal.
 */
function isShellLanguage(language: string): boolean {
	return SHELL_LANGUAGES.has(language.toLowerCase());
}

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

	/** Currently running range by cell ID - for partial cell execution */
	private readonly _runningRanges = new Map<string, Range>();

	/** Queued ranges by cell ID - multiple ranges can be queued within same cell */
	private readonly _queuedRanges = new Map<string, Range[]>();

	private readonly _onDidChangeExecutionState = this._register(new Emitter<ExecutionStateChangeEvent>());
	readonly onDidChangeExecutionState: Event<ExecutionStateChangeEvent> = this._onDidChangeExecutionState.event;

	private readonly _onDidReceiveOutput = this._register(new Emitter<ExecutionOutputEvent>());
	readonly onDidReceiveOutput: Event<ExecutionOutputEvent> = this._onDidReceiveOutput.event;

	private readonly _onDidExecuteCode = this._register(new Emitter<ILanguageRuntimeCodeExecutedEvent>());
	readonly onDidExecuteCode: Event<ILanguageRuntimeCodeExecutedEvent> = this._onDidExecuteCode.event;

	constructor(
		@IQuartoKernelManager private readonly _kernelManager: IQuartoKernelManager,
		@IQuartoDocumentModelService private readonly _documentModelService: IQuartoDocumentModelService,
		@IEditorService private readonly _editorService: IEditorService,
		@IEphemeralStateService private readonly _ephemeralStateService: IEphemeralStateService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@ILogService private readonly _logService: ILogService,
		@IPositronConsoleService private readonly _consoleService: IPositronConsoleService,
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
		@ITerminalService private readonly _terminalService: ITerminalService,
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

	/**
	 * Execute a set of cells as identified by their ranges in the document.
	 */
	async executeCellRanges(documentUri: URI, cellRanges: Range[], token?: CancellationToken) {
		const documentModel = this._documentModelService.getModelForUri(documentUri);
		const cellsToExecute: QuartoCodeCell[] = [];
		const quartoCells = documentModel.cells;

		// For each range, find the Quarto cell that it corresponds to.
		for (const range of cellRanges) {
			for (const quartoCell of quartoCells) {
				// Consider: does not currently support partial execution (we
				// just use guess from the range)
				const midpointLine = (range.startLineNumber + range.endLineNumber) / 2;
				if (midpointLine >= quartoCell.codeStartLine &&
					midpointLine <= quartoCell.codeEndLine
				) {
					cellsToExecute.push(quartoCell);
					break;
				}
			}

			// If we got this far, then none of the Quarto cells in the document
			// appear to match the requested range.
			this._logService.warn(
				`Skipping execution request for cell at ${JSON.stringify(range)} ` +
				`in document ${documentUri.toString()} because no cell was found ` +
				`in that range.`);
		}

		// Now that we have QuartoCodeCells, proceed with execution
		return this.executeCells(documentUri, cellsToExecute, token);
	}

	/**
	 * Execute inline cells for the "Execute Code" action.
	 * This executes just the code in the specified ranges, even if they are partial cells.
	 * The output replaces any previous output for the containing cell.
	 * Multiple calls to this method will queue executions properly.
	 */
	async executeInlineCells(documentUri: URI, codeRanges: Range[], token?: CancellationToken): Promise<void> {
		if (codeRanges.length === 0) {
			return;
		}

		this._logService.debug(`[QuartoExecutionManager] Queueing ${codeRanges.length} inline code ranges for execution`);

		const documentModel = this._documentModelService.getModelForUri(documentUri);
		const quartoCells = documentModel.cells;

		// For each range, find the containing cell and prepare execution info
		interface InlineExecution {
			cell: QuartoCodeCell;
			codeRange: Range;
		}
		const executions: InlineExecution[] = [];

		for (const range of codeRanges) {
			// Find the cell containing this range
			let containingCell: QuartoCodeCell | undefined;
			for (const quartoCell of quartoCells) {
				const midpointLine = (range.startLineNumber + range.endLineNumber) / 2;
				if (midpointLine >= quartoCell.codeStartLine &&
					midpointLine <= quartoCell.codeEndLine
				) {
					containingCell = quartoCell;
					break;
				}
			}

			if (!containingCell) {
				this._logService.warn(
					`Skipping inline execution for range at ${JSON.stringify(range)} ` +
					`in document ${documentUri.toString()} because no cell was found ` +
					`containing that range.`);
				continue;
			}

			executions.push({
				cell: containingCell,
				codeRange: range,
			});
		}

		if (executions.length === 0) {
			return;
		}

		// Add all ranges to queued state with decorations
		for (const execution of executions) {
			this._addToQueuedRanges(execution.cell.id, execution.codeRange);
			// Only set state to Queued if cell is not already running
			// (if it's running, the queued range decoration will still show)
			const currentState = this.getExecutionState(execution.cell.id);
			if (currentState !== CellExecutionState.Running) {
				this._setCellState(execution.cell.id, CellExecutionState.Queued, documentUri);
			}
		}

		// Fire state change to update decorations immediately
		this._onDidChangeExecutionState.fire({
			execution: {
				cellId: executions[0].cell.id,
				state: CellExecutionState.Queued,
				executionId: '',
				documentUri,
			},
			previousState: CellExecutionState.Idle,
		});

		// Chain execution promises using the document-level queue
		const lastPromise = this._executionQueue.get(documentUri) ?? Promise.resolve();

		const executionPromise = lastPromise.then(async () => {
			for (const execution of executions) {
				// Check cancellation before each range
				if (token?.isCancellationRequested) {
					// Mark remaining queued ranges as idle
					for (const e of executions) {
						this._removeFromQueuedRanges(e.cell.id, e.codeRange);
					}
					break;
				}

				try {
					await this._executeRange(documentUri, execution.cell, execution.codeRange, token);
				} catch (error) {
					this._logService.error(`[QuartoExecutionManager] Inline execution error for cell ${execution.cell.id}:`, error);
					this._setCellState(execution.cell.id, CellExecutionState.Error, documentUri);
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

	/**
	 * Execute a specific range of code within a cell.
	 * This is the unified execution method used by both cell execution and inline execution.
	 */
	private async _executeRange(
		documentUri: URI,
		cell: QuartoCodeCell,
		codeRange: Range,
		token?: CancellationToken
	): Promise<void> {
		const cellLanguage = cell.language.toLowerCase();

		// Check if this is a shell language - execute via terminal
		if (isShellLanguage(cellLanguage)) {
			return this._executeRangeViaTerminal(documentUri, cell, codeRange, token);
		}

		// Check if cell language matches the document's primary language
		// If not, execute via console service instead of kernel
		const textModel = await this._getTextModel(documentUri);
		if (textModel) {
			const quartoModel = this._documentModelService.getModel(textModel);
			const primaryLanguage = quartoModel.primaryLanguage?.toLowerCase();

			if (primaryLanguage && cellLanguage !== primaryLanguage) {
				// Non-primary language: execute via console service
				return this._executeRangeViaConsole(documentUri, cell, codeRange, token);
			}
		}

		// Ensure kernel is ready
		const session = await this._kernelManager.ensureKernelForDocument(documentUri, token);
		if (!session) {
			this._logService.warn(`[QuartoExecutionManager] No session available for ${documentUri.toString()}`);
			this._setCellState(cell.id, CellExecutionState.Error, documentUri);
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

		// Remove this range from the queued ranges (it's now running)
		this._removeFromQueuedRanges(cell.id, codeRange);

		// Track the running range for decorations BEFORE firing state change
		// This ensures decorations can read the range when handling the state change event
		this._runningRanges.set(cell.id, codeRange);

		// Update state to running
		this._runningCells.set(documentUri, cell.id);
		this._setCellState(cell.id, CellExecutionState.Running, documentUri);

		// Clear previous outputs for this cell
		this._outputsByCell.delete(cell.id);

		try {
			// Set up message handlers
			this._setupMessageHandlers(tracker, session, documentUri);

			// Get just the code in the specified range
			const code = await this._getCodeInRange(documentUri, codeRange);
			if (!code) {
				throw new Error('Could not get code in range');
			}

			// Execute the code
			this._logService.debug(`[QuartoExecutionManager] Executing inline code in cell ${cell.id} with execution ID ${executionId}`);
			session.execute(
				code,
				executionId,
				RuntimeCodeExecutionMode.Interactive,
				RuntimeErrorBehavior.Continue
			);

			// Fire the event signaling code execution.
			const event: ILanguageRuntimeCodeExecutedEvent = {
				executionId: executionId,
				sessionId: session.sessionId,
				attribution: {
					source: CodeAttributionSource.Notebook,
					metadata: {
						cell: {
							uri: cell.id,
							notebook: {
								uri: documentUri,
							},
						},
					},
				},
				code,
				languageId: cell.language,
				runtimeName: session.runtimeMetadata.runtimeName,
				errorBehavior: RuntimeErrorBehavior.Continue,
				mode: RuntimeCodeExecutionMode.Interactive,
			};
			this._onDidExecuteCode.fire(event);

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
			this._runningRanges.delete(cell.id);
			disposables.dispose();
			cts.dispose();
			await this._persistQueueState(documentUri);
		}
	}

	/**
	 * Execute a range of code via the console service.
	 * This is used for cells whose language doesn't match the document's primary language.
	 * Also captures outputs to show as inline output in addition to console output.
	 */
	private async _executeRangeViaConsole(
		documentUri: URI,
		cell: QuartoCodeCell,
		codeRange: Range,
		token?: CancellationToken
	): Promise<void> {
		this._logService.debug(
			`[QuartoExecutionManager] Executing ${cell.language} code via console (non-primary language)`
		);

		// Remove this range from the queued ranges (it's now running)
		this._removeFromQueuedRanges(cell.id, codeRange);

		// Track the running range for decorations BEFORE firing state change
		this._runningRanges.set(cell.id, codeRange);

		// Update state to running
		this._setCellState(cell.id, CellExecutionState.Running, documentUri);

		// Clear previous outputs for this cell
		this._outputsByCell.delete(cell.id);

		// Generate our own execution ID so we can listen for outputs
		const executionId = `${QUARTO_EXEC_PREFIX}-console-${generateUuid()}`;

		// Create a tracker for this execution
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

		try {
			// Get just the code in the specified range
			const code = await this._getCodeInRange(documentUri, codeRange);
			if (!code) {
				throw new Error('Could not get code in range');
			}

			// Try to get the existing console session for this language BEFORE executing.
			// If one exists, we can set up message handlers before execution starts.
			// This avoids the race condition where execution starts before handlers are set up.
			const existingSession = this._runtimeSessionService.getConsoleSessionForLanguage(cell.language);
			if (existingSession) {
				this._setupConsoleMessageHandlers(tracker, existingSession, documentUri);
			}

			// Execute via console service with our execution ID
			// This will create/start the session if needed and return the session ID
			const sessionId = await this._consoleService.executeCode(
				cell.language,
				undefined,
				code,
				{
					source: CodeAttributionSource.Notebook,
					metadata: {
						cell: {
							uri: cell.id,
							notebook: {
								uri: documentUri,
							},
						},
					},
				},
				true,  // focus
				false, // allowIncomplete
				RuntimeCodeExecutionMode.Interactive,
				RuntimeErrorBehavior.Continue,
				executionId,
			);

			// If we didn't have an existing session, a new one was created.
			// Set up handlers now - since the session is new, it won't have executed yet.
			if (!existingSession) {
				const newSession = this._runtimeSessionService.getSession(sessionId);
				if (newSession) {
					this._setupConsoleMessageHandlers(tracker, newSession, documentUri);
				}
			}

			// Wait for execution to complete
			await Promise.race([
				deferred.p,
				new Promise<void>((_, reject) => {
					const cancellationListener = cts.token.onCancellationRequested(() => {
						reject(new Error('Execution cancelled'));
					});
					disposables.add(cancellationListener);
				}),
			]);

			// Mark as completed
			this._setCellState(cell.id, CellExecutionState.Completed, documentUri);
		} catch (error) {
			if (cts.token.isCancellationRequested) {
				this._setCellState(cell.id, CellExecutionState.Idle, documentUri);
			} else {
				this._logService.error(
					`[QuartoExecutionManager] Console execution failed for cell ${cell.id}:`,
					error
				);
				this._setCellState(cell.id, CellExecutionState.Error, documentUri);
			}
		} finally {
			// Clean up
			this._runningRanges.delete(cell.id);
			this._executionTrackers.delete(cell.id);
			disposables.dispose();
			cts.dispose();
		}
	}

	/**
	 * Execute a range of code via the terminal.
	 * This is used for shell/bash cells that should be executed in a terminal.
	 */
	private async _executeRangeViaTerminal(
		documentUri: URI,
		cell: QuartoCodeCell,
		codeRange: Range,
		token?: CancellationToken
	): Promise<void> {
		this._logService.debug(
			`[QuartoExecutionManager] Executing ${cell.language} code via terminal`
		);

		// Remove this range from the queued ranges (it's now running)
		this._removeFromQueuedRanges(cell.id, codeRange);

		// Track the running range for decorations BEFORE firing state change
		this._runningRanges.set(cell.id, codeRange);

		// Update state to running
		this._setCellState(cell.id, CellExecutionState.Running, documentUri);

		// Clear previous outputs for this cell
		this._outputsByCell.delete(cell.id);

		// Generate execution ID
		const executionId = `${QUARTO_EXEC_PREFIX}-terminal-${generateUuid()}`;

		// Create a tracker for this execution
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

		let exitCode: number | undefined;

		try {
			// Get just the code in the specified range
			const code = await this._getCodeInRange(documentUri, codeRange);
			if (!code) {
				throw new Error('Could not get code in range');
			}

			// Get or create terminal
			const terminal = await this._terminalService.getActiveOrCreateInstance();

			// Ensure xterm is available
			const xterm = await terminal.xtermReadyPromise;
			if (!xterm) {
				throw new Error('Xterm is not available');
			}

			// Check for command detection capability (shell integration)
			const commandDetection = terminal.capabilities?.get(TerminalCapability.CommandDetection);

			// Register start marker before executing
			const startMarker = xterm.raw.registerMarker();
			disposables.add({ dispose: () => startMarker?.dispose() });

			if (commandDetection) {
				// Rich execution: use shell integration
				exitCode = await this._executeTerminalWithShellIntegration(
					terminal, commandDetection, code, tracker, documentUri, xterm, startMarker, disposables
				);
			} else {
				// Fallback: use idle detection without shell integration
				exitCode = await this._executeTerminalWithoutShellIntegration(
					terminal, code, tracker, documentUri, xterm, startMarker, disposables
				);
			}

			// Set final state based on exit code
			if (exitCode !== undefined && exitCode !== 0) {
				this._setCellState(cell.id, CellExecutionState.Error, documentUri);
			} else {
				this._setCellState(cell.id, CellExecutionState.Completed, documentUri);
			}
		} catch (error) {
			if (cts.token.isCancellationRequested) {
				this._setCellState(cell.id, CellExecutionState.Idle, documentUri);
			} else {
				this._logService.error(
					`[QuartoExecutionManager] Terminal execution failed for cell ${cell.id}:`,
					error
				);
				this._setCellState(cell.id, CellExecutionState.Error, documentUri);
			}
		} finally {
			// Clean up
			this._runningRanges.delete(cell.id);
			this._executionTrackers.delete(cell.id);
			disposables.dispose();
			cts.dispose();
		}
	}

	/**
	 * Execute command in terminal with shell integration (rich mode).
	 * Uses command detection to know when the command finishes and get output.
	 */
	private async _executeTerminalWithShellIntegration(
		terminal: import('../../terminal/browser/terminal.js').ITerminalInstance,
		commandDetection: ICommandDetectionCapability,
		code: string,
		tracker: ExecutionTracker,
		documentUri: URI,
		xterm: import('../../terminal/browser/xterm/xtermTerminal.js').XtermTerminal,
		startMarker: import('@xterm/xterm').IMarker | undefined,
		disposables: DisposableStore
	): Promise<number | undefined> {
		const { cts } = tracker;

		// Set up promise to wait for command completion
		const commandFinishedPromise = new DeferredPromise<import('../../../../platform/terminal/common/capabilities/capabilities.js').ITerminalCommand | undefined>();

		disposables.add(commandDetection.onCommandFinished(command => {
			this._logService.debug(`[QuartoExecutionManager] Terminal command finished`);
			commandFinishedPromise.complete(command);
		}));

		// Track idle on prompt as a fallback
		const idlePromise = this._trackIdleOnPrompt(terminal, 1000, disposables);

		// Execute the command
		this._logService.debug(`[QuartoExecutionManager] Executing terminal command: ${code.substring(0, 50)}...`);
		await terminal.runCommand(code, true);

		// Wait for either command finish or idle
		const result = await Promise.race([
			commandFinishedPromise.p.then(cmd => ({ type: 'finished' as const, command: cmd })),
			idlePromise.then(() => ({ type: 'idle' as const, command: undefined })),
			new Promise<{ type: 'cancelled'; command: undefined }>((_, reject) => {
				const listener = cts.token.onCancellationRequested(() => {
					reject(new Error('Execution cancelled'));
				});
				disposables.add(listener);
			}),
			new Promise<{ type: 'disposed'; command: undefined }>((resolve) => {
				disposables.add(terminal.onDisposed(() => {
					resolve({ type: 'disposed', command: undefined });
				}));
			}),
		]);

		if (result.type === 'disposed') {
			throw new Error('Terminal was closed');
		}

		// Get output
		let output: string | undefined;
		let exitCode: number | undefined;

		if (result.type === 'finished' && result.command) {
			// Get output from command detection - this is the cleanest source
			output = result.command.getOutput();
			exitCode = result.command.exitCode;

			if (output !== undefined) {
				this._logService.debug(`[QuartoExecutionManager] Got output via shell integration getOutput(), exit code: ${exitCode}`);
			} else {
				// getOutput() returned undefined - try using the command's markers directly
				// This happens when executedMarker or endMarker is on the same line or missing
				const cmd = result.command;
				if (cmd.executedMarker && cmd.endMarker) {
					// Use executedMarker (where output starts) to endMarker (where it ends)
					try {
						const outputStartLine = cmd.executedMarker.line;
						const outputEndLine = cmd.endMarker.line;
						this._logService.debug(`[QuartoExecutionManager] Using command markers: executed=${outputStartLine}, end=${outputEndLine}`);

						if (outputStartLine < outputEndLine) {
							// Get content from executed line (skip it, output starts on next line) to end
							const lines: string[] = [];
							for (let i = outputStartLine + 1; i < outputEndLine; i++) {
								const line = xterm.raw.buffer.active.getLine(i);
								if (line) {
									lines.push(line.translateToString(true));
								}
							}
							output = lines.join('\n');
							this._logService.debug(`[QuartoExecutionManager] Got output via command markers`);
						}
					} catch (e) {
						this._logService.warn(`[QuartoExecutionManager] Failed to get output via command markers:`, e);
					}
				}
			}
		}

		// Final fallback to our own marker-based capture
		// This is less precise as it captures everything from our start marker
		if (output === undefined && startMarker) {
			const endMarker = xterm.raw.registerMarker();
			disposables.add({ dispose: () => endMarker?.dispose() });
			try {
				output = xterm.getContentsAsText(startMarker, endMarker);
				this._logService.debug(`[QuartoExecutionManager] Got output via our own markers (fallback)`);
				// In fallback mode, we need to clean the output since it includes command + prompt
				if (output) {
					output = this._cleanTerminalOutput(output, code);
				}
			} catch (e) {
				this._logService.warn(`[QuartoExecutionManager] Failed to get output via markers:`, e);
			}
		}

		// Emit output
		if (output !== undefined && output.trim().length > 0) {
			this._emitTerminalOutput(tracker, documentUri, output, exitCode);
		}

		return exitCode;
	}

	/**
	 * Execute command in terminal without shell integration (fallback mode).
	 * Uses idle detection and markers to capture output.
	 */
	private async _executeTerminalWithoutShellIntegration(
		terminal: import('../../terminal/browser/terminal.js').ITerminalInstance,
		code: string,
		tracker: ExecutionTracker,
		documentUri: URI,
		xterm: import('../../terminal/browser/xterm/xtermTerminal.js').XtermTerminal,
		startMarker: import('@xterm/xterm').IMarker | undefined,
		disposables: DisposableStore
	): Promise<number | undefined> {
		const { cts } = tracker;

		// Wait for terminal to be idle before executing
		await this._waitForTerminalIdle(terminal.onData, 500);

		// Execute the command
		this._logService.debug(`[QuartoExecutionManager] Executing terminal command (no shell integration): ${code.substring(0, 50)}...`);
		await terminal.sendText(code, true);

		// Wait for idle with prompt heuristics
		const idleResult = await Promise.race([
			this._waitForTerminalIdleWithPromptHeuristics(terminal.onData, terminal, 1000, 10000),
			new Promise<{ detected: boolean }>((_, reject) => {
				const listener = cts.token.onCancellationRequested(() => {
					reject(new Error('Execution cancelled'));
				});
				disposables.add(listener);
			}),
		]);

		this._logService.debug(`[QuartoExecutionManager] Idle detection result: ${idleResult.detected}`);

		// Get output via markers
		let output: string | undefined;
		if (startMarker) {
			const endMarker = xterm.raw.registerMarker();
			disposables.add({ dispose: () => endMarker?.dispose() });
			try {
				output = xterm.getContentsAsText(startMarker, endMarker);
				this._logService.debug(`[QuartoExecutionManager] Got output via markers (no shell integration)`);
				// Clean the output since marker-based capture includes command + prompt
				if (output) {
					output = this._cleanTerminalOutput(output, code);
				}
			} catch (e) {
				this._logService.warn(`[QuartoExecutionManager] Failed to get output via markers:`, e);
			}
		}

		// Emit output (no exit code available without shell integration)
		if (output !== undefined && output.trim().length > 0) {
			this._emitTerminalOutput(tracker, documentUri, output, undefined);
		}

		return undefined; // No exit code without shell integration
	}

	/**
	 * Emit terminal output as inline output.
	 * Uses stdout for success, error format for non-zero exit codes.
	 * Output should already be cleaned before calling this method.
	 */
	private _emitTerminalOutput(
		tracker: ExecutionTracker,
		documentUri: URI,
		output: string,
		exitCode: number | undefined
	): void {
		// Skip if no meaningful output
		if (!output || output.trim().length === 0) {
			return;
		}

		// Determine output type based on exit code
		const isError = exitCode !== undefined && exitCode !== 0;
		const mime = isError
			? 'application/vnd.code.notebook.error'
			: 'application/vnd.code.notebook.stdout';

		if (isError) {
			// Format as error with exit code information
			this._addOutput(tracker, documentUri, [{
				mime,
				data: JSON.stringify({
					name: 'ShellError',
					message: `Command exited with code ${exitCode}`,
					stack: output,
				}),
			}]);
		} else {
			// Format as stdout (preserves ANSI codes)
			this._addOutput(tracker, documentUri, [{
				mime,
				data: output,
			}]);
		}
	}

	/**
	 * Clean terminal output by removing the echoed command and shell prompts.
	 * Terminal output typically contains:
	 * 1. The command as it was typed/sent (echoed by terminal)
	 * 2. The actual command output
	 * 3. The shell prompt after execution
	 *
	 * Terminal output may not have clean newlines - content can be separated
	 * by carriage returns, prompts may appear inline, etc.
	 */
	private _cleanTerminalOutput(output: string, commandText?: string): string {
		// First, strip ANSI codes for analysis
		let cleanOutput = this._stripAnsiCodes(output);

		// Normalize line endings and split on common prompt patterns
		// This handles cases where terminal output doesn't have clean newlines
		cleanOutput = cleanOutput.replace(/\r\n?/g, '\n');

		const promptPatterns = [
			// allow-any-unicode-next-line
			/(\u276f\s+)/g,      // Starship prompt ❯
			/(\$\s+)/g,          // Bash prompt $
			/(>\s+)/g,           // Generic prompt >
		];

		// If the output seems to be all on one line with prompts embedded,
		// split it up by inserting newlines before prompts
		for (const pattern of promptPatterns) {
			cleanOutput = cleanOutput.replace(pattern, '\n$1');
		}

		// Now split into lines
		const lines = cleanOutput.split('\n').map(l => l.trim()).filter(l => l.length > 0);

		if (lines.length === 0) {
			return '';
		}

		// Find lines to keep - exclude command echo and prompts
		const outputLines: string[] = [];
		const commandToMatch = commandText ? commandText.trim() : '';

		for (const line of lines) {
			// Skip lines that contain the command we executed
			if (commandToMatch && line.includes(commandToMatch)) {
				continue;
			}

			// Skip lines that look like prompts (path + prompt character)
			if (this._looksLikePromptLine(line)) {
				continue;
			}

			// Skip lines that are just the command without prompt
			// (in case the command was echoed separately)
			if (commandToMatch) {
				const normalizedLine = line.toLowerCase();
				const normalizedCommand = commandToMatch.toLowerCase();
				if (normalizedLine === normalizedCommand ||
					normalizedLine.endsWith(normalizedCommand)) {
					continue;
				}
			}

			outputLines.push(line);
		}

		return outputLines.join('\n');
	}

	/**
	 * Check if a line looks like a shell prompt line.
	 * Prompt lines typically contain a path and end with a prompt character.
	 */
	private _looksLikePromptLine(line: string): boolean {
		// Lines ending with common prompt characters
		if (/[\$#%>\u276f]\s*$/.test(line)) {
			return true;
		}

		// Lines that look like paths with branch info (common in starship/powerline)
		// e.g., "/path/to/repo feature/branch*"
		if (/^[\/~].*\s+\S+\*?\s*$/.test(line) && !line.includes('=')) {
			return true;
		}

		// Lines starting with prompt characters
		if (/^[\$#%>\u276f]\s/.test(line)) {
			return true;
		}

		return false;
	}

	/**
	 * Strip ANSI escape codes from a string.
	 */
	private _stripAnsiCodes(text: string): string {

		return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
			.replace(/\x1b\][^\x07]*\x07/g, '') // OSC sequences
			.replace(/\x1b[PX^_][^\x1b]*\x1b\\/g, '') // DCS/SOS/PM/APC sequences
			.replace(/[\x00-\x09\x0b-\x1f]/g, ''); // Other control characters except \n
	}

	/**
	 * Wait for terminal data stream to idle.
	 */
	private async _waitForTerminalIdle(onData: Event<unknown>, idleDurationMs: number): Promise<void> {
		const store = new DisposableStore();
		const deferred = new DeferredPromise<void>();
		const scheduler = store.add(new RunOnceScheduler(() => deferred.complete(), idleDurationMs));
		store.add(onData(() => scheduler.schedule()));
		scheduler.schedule();
		return deferred.p.finally(() => store.dispose());
	}

	/**
	 * Wait for terminal idle with prompt detection heuristics.
	 */
	private async _waitForTerminalIdleWithPromptHeuristics(
		onData: Event<unknown>,
		terminal: import('../../terminal/browser/terminal.js').ITerminalInstance,
		idlePollIntervalMs: number,
		extendedTimeoutMs: number
	): Promise<{ detected: boolean }> {
		await this._waitForTerminalIdle(onData, idlePollIntervalMs);

		const xterm = await terminal.xtermReadyPromise;
		if (!xterm) {
			return { detected: false };
		}

		const startTime = Date.now();

		while (Date.now() - startTime < extendedTimeoutMs) {
			try {
				const buffer = xterm.raw.buffer.active;
				const line = buffer.getLine(buffer.baseY + buffer.cursorY);
				if (line) {
					const content = line.translateToString(true);
					if (this._detectsCommonPromptPattern(content)) {
						return { detected: true };
					}
				}
			} catch {
				// Continue polling
			}
			await this._waitForTerminalIdle(onData, Math.min(idlePollIntervalMs, extendedTimeoutMs - (Date.now() - startTime)));
		}

		return { detected: false };
	}

	/**
	 * Detect common shell prompt patterns.
	 */
	private _detectsCommonPromptPattern(cursorLine: string): boolean {
		if (cursorLine.trim().length === 0) {
			return false;
		}

		// PowerShell prompt: PS C:\>
		if (/PS\s+[A-Z]:\\.*>\s*$/.test(cursorLine)) {
			return true;
		}

		// Command Prompt: C:\path>
		if (/^[A-Z]:\\.*>\s*$/.test(cursorLine)) {
			return true;
		}

		// Bash-style prompts ending with $
		if (/\$\s*$/.test(cursorLine)) {
			return true;
		}

		// Root prompts ending with #
		if (/#\s*$/.test(cursorLine)) {
			return true;
		}

		// Starship prompt character
		if (/\u276f\s*$/.test(cursorLine)) {
			return true;
		}

		// Generic prompts ending with > or %
		if (/[>%]\s*$/.test(cursorLine)) {
			return true;
		}

		return false;
	}

	/**
	 * Track terminal for idle on prompt using shell integration sequences.
	 */
	private async _trackIdleOnPrompt(
		terminal: import('../../terminal/browser/terminal.js').ITerminalInstance,
		idleDurationMs: number,
		store: DisposableStore
	): Promise<void> {
		const idleOnPrompt = new DeferredPromise<void>();
		const onData = terminal.onData;
		const scheduler = store.add(new RunOnceScheduler(() => {
			idleOnPrompt.complete();
		}, idleDurationMs));

		const enum TerminalState {
			Initial,
			Prompt,
			Executing,
			PromptAfterExecuting,
		}
		let state: TerminalState = TerminalState.Initial;

		store.add(onData(e => {
			// Look for shell integration sequences: 133;A (prompt), 133;C/D (executed)
			const matches = e.matchAll(/(?:\x1b\]|\x9d)[16]33;(?<type>[ACD])(?:;.*)?(?:\x1b\\|\x07|\x9c)/g);
			for (const match of matches) {
				if (match.groups?.type === 'A') {
					if (state === TerminalState.Initial) {
						state = TerminalState.Prompt;
					} else if (state === TerminalState.Executing) {
						state = TerminalState.PromptAfterExecuting;
					}
				} else if (match.groups?.type === 'C' || match.groups?.type === 'D') {
					state = TerminalState.Executing;
				}
			}
			// Schedule completion when we see prompt after executing
			if (state === TerminalState.PromptAfterExecuting) {
				scheduler.schedule();
			} else {
				scheduler.cancel();
			}
		}));

		return idleOnPrompt.p;
	}

	/**
	 * Set up message handlers for console session output.
	 * Similar to _setupMessageHandlers but for console sessions.
	 */
	private _setupConsoleMessageHandlers(
		tracker: ExecutionTracker,
		session: ILanguageRuntimeSession,
		documentUri: URI
	): void {
		const { execution, deferred, disposables } = tracker;
		const executionId = execution.executionId;

		// Handle output messages (display_data)
		disposables.add(session.onDidReceiveRuntimeMessageOutput(message => {
			if (message.parent_id !== executionId) {
				return;
			}
			const webMessage = message as ILanguageRuntimeMessageWebOutput;
			this._handleOutputMessage(tracker, documentUri, message.data, webMessage);
		}));

		// Handle result messages (execute_result)
		disposables.add(session.onDidReceiveRuntimeMessageResult(message => {
			if (message.parent_id !== executionId) {
				return;
			}
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
				this._logService.debug(`[QuartoExecutionManager] Console execution completed for ${executionId}`);
				deferred.complete();
			}
		}));
	}

	/**
	 * Get code content for a specific range in the document.
	 */
	private async _getCodeInRange(documentUri: URI, range: Range): Promise<string | undefined> {
		try {
			const textModel = await this._getTextModel(documentUri);
			if (!textModel) {
				return undefined;
			}

			return textModel.getValueInRange(range);
		} catch (error) {
			this._logService.warn(`[QuartoExecutionManager] Failed to get code in range:`, error);
			return undefined;
		}
	}

	async cancelQueuedCell(documentUri: URI, cellId: string): Promise<void> {
		this._logService.debug(`[QuartoExecutionManager] Cancelling queued cell ${cellId} for ${documentUri.toString()}`);

		const queuedCells = this._queuedCells.get(documentUri) ?? [];
		if (!queuedCells.includes(cellId)) {
			this._logService.debug(`[QuartoExecutionManager] Cell ${cellId} is not queued, ignoring cancel request`);
			return;
		}

		// Set state to Idle (this will signal to _executeCell to skip the cell)
		this._setCellState(cellId, CellExecutionState.Idle, documentUri);

		// Remove from queue
		this._removeFromQueue(documentUri, cellId);

		await this._persistQueueState(documentUri);
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

	getExecutionRange(cellId: string): Range | undefined {
		return this._runningRanges.get(cellId);
	}

	getQueuedRanges(cellId: string): Range[] {
		return [...(this._queuedRanges.get(cellId) ?? [])];
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
	 * Internally converts the cell to a range and delegates to _executeRange.
	 */
	private async _executeCell(
		documentUri: URI,
		cell: QuartoCodeCell,
		token?: CancellationToken
	): Promise<void> {
		// Check if the cell was cancelled while queued
		// This happens when the user clicks the cancel button on a queued cell
		const currentState = this.getExecutionState(cell.id);
		if (currentState !== CellExecutionState.Queued) {
			this._logService.debug(`[QuartoExecutionManager] Cell ${cell.id} was cancelled while queued (state: ${currentState}), skipping execution`);
			return;
		}

		// Look up the current cell position from the document model
		// (the cell may have moved if the document was edited while queued)
		const textModel = await this._getTextModel(documentUri);
		if (!textModel) {
			this._logService.warn(`[QuartoExecutionManager] No text model available for ${documentUri.toString()}`);
			this._setCellState(cell.id, CellExecutionState.Error, documentUri);
			this._removeFromQueue(documentUri, cell.id);
			return;
		}

		const quartoModel = this._documentModelService.getModel(textModel);
		const currentCell = quartoModel.getCellById(cell.id);
		if (!currentCell) {
			this._logService.warn(`[QuartoExecutionManager] Cell ${cell.id} no longer exists in document`);
			this._setCellState(cell.id, CellExecutionState.Error, documentUri);
			this._removeFromQueue(documentUri, cell.id);
			return;
		}

		// Convert the cell to a range covering its code content
		const codeRange = new Range(
			currentCell.codeStartLine,
			1,
			currentCell.codeEndLine,
			textModel.getLineMaxColumn(currentCell.codeEndLine)
		);

		// Remove from queue before executing
		this._removeFromQueue(documentUri, cell.id);
		await this._persistQueueState(documentUri);

		// Delegate to the unified range execution
		return this._executeRange(documentUri, currentCell, codeRange, token);
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

		// Determine which rich MIME types are present to filter out redundant text/plain
		// When a richer representation (HTML, images) is available, we should not show
		// the plain text fallback as it duplicates the content
		const hasHtml = 'text/html' in data;
		const hasImage = mimeOrder.some(mime =>
			mime.startsWith('image/') && mime in data
		);
		const shouldExcludePlainText = hasHtml || hasImage;

		for (const mime of mimeOrder) {
			// Skip text/plain when a richer representation is available
			if (mime === 'text/plain' && shouldExcludePlainText) {
				continue;
			}

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
	 * Add a range to the queued ranges for a cell.
	 */
	private _addToQueuedRanges(cellId: string, range: Range): void {
		const ranges = this._queuedRanges.get(cellId) ?? [];
		// Check if this exact range is already queued (by line numbers)
		const exists = ranges.some(r =>
			r.startLineNumber === range.startLineNumber &&
			r.endLineNumber === range.endLineNumber
		);
		if (!exists) {
			ranges.push(range);
			this._queuedRanges.set(cellId, ranges);
		}
	}

	/**
	 * Remove a range from the queued ranges for a cell.
	 */
	private _removeFromQueuedRanges(cellId: string, range: Range): void {
		const ranges = this._queuedRanges.get(cellId);
		if (ranges) {
			const index = ranges.findIndex(r =>
				r.startLineNumber === range.startLineNumber &&
				r.endLineNumber === range.endLineNumber
			);
			if (index >= 0) {
				ranges.splice(index, 1);
				if (ranges.length === 0) {
					this._queuedRanges.delete(cellId);
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
