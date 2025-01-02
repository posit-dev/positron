/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { AsyncIterableObject } from '../../../../base/common/async.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ResourceMap } from '../../../../base/common/map.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IProgressService, ProgressLocation } from '../../../../platform/progress/common/progress.js';
import { ILanguageRuntimeMetadata, RuntimeState } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { IPYNB_VIEW_TYPE } from '../../notebook/browser/notebookBrowser.js';
import { INotebookKernel, INotebookKernelChangeEvent, VariablesResult } from '../../notebook/common/notebookKernelService.js';
import { INotebookService } from '../../notebook/common/notebookService.js';
import { POSITRON_RUNTIME_NOTEBOOK_KERNELS_EXTENSION_ID } from '../common/runtimeNotebookKernelConfig.js';
import { RuntimeNotebookKernelSession } from './runtimeNotebookKernelSession.js';

export class RuntimeNotebookKernel extends Disposable implements INotebookKernel {
	public readonly viewType = IPYNB_VIEW_TYPE;

	public readonly extension = new ExtensionIdentifier(POSITRON_RUNTIME_NOTEBOOK_KERNELS_EXTENSION_ID);

	public readonly preloadUris: URI[] = [];

	public readonly preloadProvides: string[] = [];

	public readonly implementsInterrupt = true;

	public readonly implementsExecutionOrder = true;

	public readonly hasVariableProvider = false;

	// TODO: Not sure what we could set this to...
	public readonly localResourceRoot: URI = URI.parse('');

	private readonly _onDidChange = this._register(new Emitter<INotebookKernelChangeEvent>());

	/** An event that fires when the kernel's details change. */
	public readonly onDidChange = this._onDidChange.event;

	private readonly _kernelSessionsByNotebookUri = new ResourceMap<RuntimeNotebookKernelSession>();

	constructor(
		public readonly runtime: ILanguageRuntimeMetadata,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILogService private readonly _logService: ILogService,
		@INotebookService private readonly _notebookService: INotebookService,
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

			const notebookRuntimeKernelSession = await this.getOrCreateKernelSession(notebookUri);

			// Execute the cells.
			await notebookRuntimeKernelSession.executeCells(cellHandles);
		} catch (err) {
			this._logService.error(`Error executing cells: ${err.stack ?? err}`);
		}
	}

	private async getOrCreateKernelSession(notebookUri: URI): Promise<RuntimeNotebookKernelSession> {
		const existingKernelSession = this._kernelSessionsByNotebookUri.get(notebookUri);
		if (existingKernelSession) {
			this._logService.debug(`[RuntimeNotebookKernel] Kernel session already exists for notebook ${notebookUri.toString()}`);
			return existingKernelSession;
		}

		const notebook = this._notebookService.getNotebookTextModel(notebookUri);
		if (!notebook) {
			// Copying ExtHostNotebookController.getNotebookDocument for now.
			this._logService.debug(`[RuntimeNotebookKernel] No notebook document for notebook ${notebookUri.toString()}`);
			throw new Error(`NO notebook document for '${notebookUri}'`);
		}

		let session = this._runtimeSessionService.getNotebookSessionForNotebookUri(notebookUri);
		if (!session) {
			// An execution was requested before a session was started for the notebook.
			this._logService.debug(`[RuntimeNotebookKernel] No runtime session for notebook ${notebookUri.toString()}, starting a new one`);
			session = await this.startRuntimeSession(notebookUri);
		}

		// TODO: Need to check the state of the session too...?

		this._logService.debug(`[RuntimeNotebookKernel] Creating kernel session for notebook ${notebookUri.toString()}`);

		const kernelSession = this._instantiationService.createInstance(RuntimeNotebookKernelSession, session, notebook);
		this._kernelSessionsByNotebookUri.set(notebook.uri, kernelSession);

		const dispose = () => {
			kernelSession.dispose();
			if (this._kernelSessionsByNotebookUri.get(notebook.uri) === existingKernelSession) {
				this._kernelSessionsByNotebookUri.delete(notebook.uri);
			}
		};

		kernelSession.register(session.onDidEndSession(() => {
			dispose();
		}));

		kernelSession.register(session.onDidChangeRuntimeState(state => {
			if (state === RuntimeState.Exited) {
				dispose();
			}
		}));

		return kernelSession;
	}

	private async startRuntimeSession(notebookUri: URI): Promise<ILanguageRuntimeSession> {
		try {
			await this._progressService.withProgress({
				location: ProgressLocation.Notification,
				title: localize(
					"positron.notebook.kernel.starting",
					"Starting {0} interpreter for '{1}'",
					this.label,
					notebookUri.fsPath,
				),
			}, () => this._runtimeSessionService.selectRuntime(
				this.runtime.runtimeId,
				`Runtime kernel ${this.id} executed cells for notebook`,
				notebookUri,
			));

			const session = this._runtimeSessionService.getNotebookSessionForNotebookUri(notebookUri);
			if (!session) {
				throw new Error(`Unexpected error, session not found after starting for notebook '${notebookUri}'`);
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

		const notebookRuntimeKernelSession = this._kernelSessionsByNotebookUri.get(notebookUri);
		if (!notebookRuntimeKernelSession) {
			this._logService.debug(`[RuntimeNotebookKernel] No session to interrupt for notebook ${notebookUri.toString()}`);
			return;
		}

		notebookRuntimeKernelSession.interrupt();
	}

	provideVariables(notebookUri: URI, parentId: number | undefined, kind: 'named' | 'indexed', start: number, token: CancellationToken): AsyncIterableObject<VariablesResult> {
		throw new Error('provideVariables not implemented.');
	}

	public override dispose(): void {
		super.dispose();

		for (const disposable of this._kernelSessionsByNotebookUri.values()) {
			disposable.dispose();
		}
	}
}
