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
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ILanguageRuntimeMetadata, RuntimeState } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
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
		this._logService.debug(`[RuntimeNotebookKernel] Executing cells: ${cellHandles.join(', ')}`);

		const notebookRuntimeKernelSession = this.getOrCreateKernelSession(notebookUri);

		// Execute the cells.
		try {
			await notebookRuntimeKernelSession.executeCells(cellHandles);
		} catch (err) {
			this._logService.debug(`Error executing cells: ${err.stack ?? err}`);
		}
	}

	private getOrCreateKernelSession(notebookUri: URI): RuntimeNotebookKernelSession {
		const existingKernelSession = this._kernelSessionsByNotebookUri.get(notebookUri);
		if (existingKernelSession) {
			return existingKernelSession;
		}

		const notebook = this._notebookService.getNotebookTextModel(notebookUri);
		if (!notebook) {
			// Copying ExtHostNotebookController.getNotebookDocument for now.
			throw new Error(`NO notebook document for '${notebookUri}'`);
		}

		const session = this._runtimeSessionService.getNotebookSessionForNotebookUri(notebookUri);
		if (!session) {
			// An execution was requested before a session was started for the notebook,
			// which should not happen.
			throw new Error(`NO runtime session for notebook '${notebookUri}'`);
		}

		// TODO: Need to check the state of the session too...?

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
