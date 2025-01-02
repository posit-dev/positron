/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { ResourceMap } from '../../../../base/common/map.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { RuntimeCodeExecutionMode, RuntimeErrorBehavior, RuntimeState } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { NotebookCellTextModel } from '../../notebook/common/model/notebookCellTextModel.js';
import { NotebookTextModel } from '../../notebook/common/model/notebookTextModel.js';
import { INotebookExecutionStateService } from '../../notebook/common/notebookExecutionStateService.js';
import { RuntimeNotebookCellExecution } from './runtimeNotebookCellExecution.js';

export class RuntimeNotebookKernelSession extends Disposable {
	/**
	 * A map of the last queued cell execution promise for each notebook, keyed by notebook URI.
	 * Each queued cell execution promise is chained to the previous one for the notebook,
	 * so that cells are executed in order.
	 */
	private readonly _pendingCellExecutionsByNotebookUri = new ResourceMap<Promise<void>>();

	private _pendingRuntimeExecution: RuntimeNotebookCellExecution | undefined;

	constructor(
		private readonly _session: ILanguageRuntimeSession,
		private readonly _notebook: NotebookTextModel,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILogService private readonly _logService: ILogService,
		@INotebookExecutionStateService private readonly _notebookExecutionStateService: INotebookExecutionStateService,
	) {
		super();
	}

	/**
	 * Register a disposable to be cleaned up when this object is disposed.
	 */
	public register(disposable: IDisposable): void {
		this._register(disposable);
	}

	async executeCells(cellHandles: number[]): Promise<void> {
		const executionPromises: Promise<void>[] = [];
		for (const cellHandle of cellHandles) {
			const cell = this._notebook.cells.find(cell => cell.handle === cellHandle);
			// TODO: When does this happen?
			if (!cell) {
				continue;
			}
			executionPromises.push(this.queueCellExecution(cell));
		}
		await Promise.all(executionPromises);
	}

	private async queueCellExecution(cell: NotebookCellTextModel): Promise<void> {
		// Get the pending execution for this notebook, if one exists.
		const pendingExecution = this._pendingCellExecutionsByNotebookUri.get(this._notebook.uri);

		// Chain this execution after the pending one.
		const currentExecution = Promise.resolve(pendingExecution)
			.then(() => this.executeCell(cell))
			.finally(() => {
				// If this was the last execution in the chain, remove it from the map,
				// starting a new chain.
				if (this._pendingCellExecutionsByNotebookUri.get(this._notebook.uri) === currentExecution) {
					this._pendingCellExecutionsByNotebookUri.delete(this._notebook.uri);
				}
			});

		// Update the pending execution for this notebook.
		this._pendingCellExecutionsByNotebookUri.set(this._notebook.uri, currentExecution);

		return currentExecution;
	}

	private async executeCell(cell: NotebookCellTextModel): Promise<void> {
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
			RuntimeNotebookCellExecution, this._session, cellExecution, cell
		));
		this._pendingRuntimeExecution = execution;

		try {
			this._session.execute(
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

	async interrupt(): Promise<void> {
		if (this._session.getRuntimeState() === RuntimeState.Busy ||
			this._session.getRuntimeState() === RuntimeState.Interrupting) {
			// The session is in an interruptible state, interrupt it.
			this._session.interrupt();
		} else if (this._session.getRuntimeState() === RuntimeState.Exiting ||
			this._session.getRuntimeState() === RuntimeState.Exited ||
			this._session.getRuntimeState() === RuntimeState.Restarting ||
			this._session.getRuntimeState() === RuntimeState.Uninitialized) {

			// TODO: Is it possible that a user could interrupt without a RuntimeNotebookKernelSession at all?
			//       That would leave the executions running atm.

			const execution = this._pendingRuntimeExecution;
			if (!execution) {
				// It shouldn't be possible to interrupt an execution without having set a token source.
				// Log a warning and do nothing.
				this._logService.warn(`Tried to interrupt notebook ${this._notebook.uri.toString()} with no executing cell.`);
				return;
			}

			// It's possible that the session exited after the execution started.
			// Log a warning and cancel the execution promise.
			// TODO: Should this be primarily handled in a session.onDidEndSession listener?
			this._logService.warn(`Tried to interrupt notebook ${this._notebook.uri.toString()} with no running session. Cancelling execution.`);
			execution.error({
				name: 'Session Exited Unexpectedly',
				message: 'The session has exited unexpectedly.',
			});
		}
	}
}
