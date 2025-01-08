/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { AsyncIterableObject } from '../../../../base/common/async.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ResourceMap } from '../../../../base/common/map.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IProgressService, ProgressLocation } from '../../../../platform/progress/common/progress.js';
import { ILanguageRuntimeMetadata, RuntimeCodeExecutionMode, RuntimeErrorBehavior, RuntimeState } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPYNB_VIEW_TYPE } from '../../notebook/browser/notebookBrowser.js';
import { NotebookCellTextModel } from '../../notebook/common/model/notebookCellTextModel.js';
import { INotebookExecutionStateService } from '../../notebook/common/notebookExecutionStateService.js';
import { INotebookKernel, INotebookKernelChangeEvent, VariablesResult } from '../../notebook/common/notebookKernelService.js';
import { INotebookService } from '../../notebook/common/notebookService.js';
import { POSITRON_RUNTIME_NOTEBOOK_KERNELS_EXTENSION_ID } from '../common/runtimeNotebookKernelConfig.js';
import { RuntimeNotebookCellExecution } from './runtimeNotebookCellExecution.js';

export class RuntimeNotebookKernel extends Disposable implements INotebookKernel {
	public readonly viewType = IPYNB_VIEW_TYPE;

	public readonly extension = new ExtensionIdentifier(POSITRON_RUNTIME_NOTEBOOK_KERNELS_EXTENSION_ID);

	public readonly preloadUris: URI[] = [];

	public readonly preloadProvides: string[] = [];

	public readonly implementsInterrupt = true;

	public readonly implementsExecutionOrder = true;

	public readonly hasVariableProvider = false;

	// A kernel's localResourceRoot gets added to the localResourceRoot of the notebook's back layer webview.
	// MainThreadKernel uses the extensionLocation, but our kernels live in the main thread.
	// Not sure what to use here.
	public readonly localResourceRoot = URI.parse('');

	private readonly _onDidChange = this._register(new Emitter<INotebookKernelChangeEvent>());

	/** An event that fires when the kernel's details change. */
	public readonly onDidChange = this._onDidChange.event;

	/**
	 * A map of the last queued cell execution promise for each notebook, keyed by notebook URI.
	 * Each queued cell execution promise is chained to the previous one for the notebook,
	 * so that cells are executed in order.
	 */
	private readonly _pendingCellExecutionsByNotebookUri = new ResourceMap<Promise<void>>();

	private _pendingRuntimeExecution: RuntimeNotebookCellExecution | undefined;

	private _sessionsByNotebookUri = new ResourceMap<ILanguageRuntimeSession>();

	constructor(
		public readonly runtime: ILanguageRuntimeMetadata,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILogService private readonly _logService: ILogService,
		@INotebookService private readonly _notebookService: INotebookService,
		@INotebookExecutionStateService private readonly _notebookExecutionStateService: INotebookExecutionStateService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IProgressService private readonly _progressService: IProgressService,
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
	) {
		super();
	}

	get id(): string {
		// This kernel ID format is assumed by a few services and should be changed carefully.
		return `${this.extension.value}/${this.runtime.runtimeId}`;
	}

	get label(): string {
		return this.runtime.runtimeName;
	}

	get description(): string {
		return this.runtime.runtimePath;
	}

	get detail(): string | undefined {
		return undefined;
	}

	get supportedLanguages(): string[] {
		return [this.runtime.languageId, 'raw'];
	}

	async executeNotebookCellsRequest(notebookUri: URI, cellHandles: number[]): Promise<void> {
		// NOTE: This method should not throw to avoid undefined behavior in the notebook UI.
		try {
			this._logService.debug(`[RuntimeNotebookKernel] Executing cells: ${cellHandles.join(', ')} for notebook ${notebookUri.toString()}`);

			const notebook = this._notebookService.getNotebookTextModel(notebookUri);
			if (!notebook) {
				// Not sure when this happens, so we're copying ExtHostNotebookKernels.$executeCells
				// and throwing.
				const error = new Error(`No notebook document for '${notebookUri.toString()}'`);
				this._logService.error(`[RuntimeNotebookKernel] ${error.message}`);
				throw error;
			}

			let session = this._sessionsByNotebookUri.get(notebookUri);
			if (!session) {
				session = await this._progressService.withProgress({
					location: ProgressLocation.Notification,
					title: localize(
						"positron.notebook.kernel.starting",
						"Starting {0} interpreter for '{1}'",
						this.label,
						notebookUri.fsPath,
					),
				}, async () => {
					return await this.selectRuntime(notebookUri, `Runtime kernel ${this.id} executed cells for notebook`);
				});
			}

			// Execute the cells.
			const executionPromises: Promise<void>[] = [];
			for (const cellHandle of cellHandles) {
				const cell = notebook.cells.find(cell => cell.handle === cellHandle);
				if (!cell) {
					// Not sure when this happens, so we're copying ExtHostNotebookKernels.$executeCells
					// and silently skipping the cell.
					continue;
				}
				executionPromises.push(this.queueCellExecution(cell, notebookUri, session));
			}
			await Promise.all(executionPromises);
		} catch (err) {
			this._logService.error(`Error executing cells: ${err.stack ?? err.toString()}`);
		}
	}

	private async queueCellExecution(cell: NotebookCellTextModel, notebookUri: URI, session: ILanguageRuntimeSession): Promise<void> {
		this._logService.debug(`[RuntimeNotebookKernel] Queuing cell execution: ${cell.handle} for notebook ${notebookUri.toString()}`);

		// Get the pending execution for this notebook, if one exists.
		const pendingExecution = this._pendingCellExecutionsByNotebookUri.get(notebookUri);

		// Chain this execution after the pending one.
		const currentExecution = Promise.resolve(pendingExecution)
			.then(() => this.executeCell(cell, session))
			.finally(() => {
				// If this was the last execution in the chain, remove it from the map,
				// starting a new chain.
				if (this._pendingCellExecutionsByNotebookUri.get(notebookUri) === currentExecution) {
					this._pendingCellExecutionsByNotebookUri.delete(notebookUri);
				}
			});

		// Update the pending execution for this notebook.
		this._pendingCellExecutionsByNotebookUri.set(notebookUri, currentExecution);

		return currentExecution;
	}

	private async executeCell(cell: NotebookCellTextModel, session: ILanguageRuntimeSession): Promise<void> {
		this._logService.debug(`[RuntimeNotebookKernel] Executing cell: ${cell.handle}`);

		// Don't try to execute raw cells; they're often used to define metadata e.g in Quarto notebooks.
		if (cell.language === 'raw') {
			return;
		}

		const code = cell.getValue();

		// If the cell is empty, skip it.
		if (!code.trim()) {
			return;
		}

		const cellExecution = this._notebookExecutionStateService.getCellExecution(cell.uri);
		if (!cellExecution) {
			throw new Error(`NO execution for cell '${cell.uri}'`);
		}

		const execution = this._register(this._instantiationService.createInstance(
			RuntimeNotebookCellExecution, session, cellExecution, cell
		));
		this._pendingRuntimeExecution = execution;

		try {
			session.execute(
				code,
				execution.id,
				RuntimeCodeExecutionMode.Interactive,
				RuntimeErrorBehavior.Stop,
			);
		} catch (err) {
			execution.error(err);
		}

		return this._pendingRuntimeExecution.promise.finally(() => {
			if (this._pendingRuntimeExecution === execution) {
				this._pendingRuntimeExecution = undefined;
			}
		});
	}

	public async selectRuntime(notebookUri: URI, source: string): Promise<ILanguageRuntimeSession> {
		const session = await this.doSelectRuntime(notebookUri, source);
		this._sessionsByNotebookUri.set(notebookUri, session);

		const disposables = this._register(new DisposableStore());

		const dispose = () => {
			disposables.dispose();
			this._sessionsByNotebookUri.delete(notebookUri);
		};

		disposables.add(session.onDidEndSession(() => {
			dispose();
		}));

		disposables.add(session.onDidChangeRuntimeState(state => {
			if (state === RuntimeState.Exiting ||
				state === RuntimeState.Exited ||
				state === RuntimeState.Restarting ||
				state === RuntimeState.Uninitialized) {
				dispose();
			}
		}));

		return session;
	}

	private async doSelectRuntime(notebookUri: URI, source: string): Promise<ILanguageRuntimeSession> {
		try {
			await this._runtimeSessionService.selectRuntime(
				this.runtime.runtimeId,
				source,
				notebookUri,
			);

			const session = this._runtimeSessionService.getNotebookSessionForNotebookUri(notebookUri);
			if (!session) {
				throw new Error(`Unexpected error, session not found after starting for notebook '${notebookUri}'`);
			}

			if (session.getRuntimeState() === RuntimeState.Starting) {
				this._logService.debug(`[RuntimeNotebookKernel] Waiting for session to be ready for notebook ${notebookUri.toString()}`);
				await new Promise<void>(resolve => {
					const disposable = session.onDidChangeRuntimeState(state => {
						if (state === RuntimeState.Ready) {
							disposable.dispose();
							resolve();
						}
					});
				});
			}

			return session;
		} catch (err) {
			this._notificationService.error(localize(
				"positron.notebook.kernel.starting.failed",
				"Starting {0} interpreter for '{1}' failed. Reason: {2}",
				this.label,
				notebookUri.fsPath,
				err.toString(),
			));
			throw err;
		}
	}

	async cancelNotebookCellExecution(notebookUri: URI, _cellHandles: number[]): Promise<void> {
		this._logService.debug(`[RuntimeNotebookKernel] Interrupting notebook ${notebookUri.toString()}`);

		const session = this._runtimeSessionService.getNotebookSessionForNotebookUri(notebookUri);
		if (session) {
			// If there is a session for the notebook, interrupt it.
			session.interrupt();
			return;
		}

		const execution = this._pendingRuntimeExecution;
		if (!execution) {
			// It shouldn't be possible to interrupt an execution without having set the pending execution,
			// but there's nothing more we can do so just log a warning.
			this._logService.warn(`Tried to interrupt notebook ${notebookUri.toString()} with no executing cell.`);
			return;
		}

		// It's possible that the session exited after the execution started.
		// Log a warning and error the execution.
		this._logService.warn(`Tried to interrupt notebook ${notebookUri.toString()} with no running session. Cancelling execution.`);
		execution.error({
			name: 'No Active Session',
			message: 'There is no active session for this notebook',
		});
	}

	provideVariables(notebookUri: URI, parentId: number | undefined, kind: 'named' | 'indexed', start: number, token: CancellationToken): AsyncIterableObject<VariablesResult> {
		throw new Error('provideVariables not implemented.');
	}
}
