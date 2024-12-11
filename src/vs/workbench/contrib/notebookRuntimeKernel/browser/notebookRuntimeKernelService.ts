/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { AsyncIterableObject } from 'vs/base/common/async';
import { CancellationToken } from 'vs/base/common/cancellation';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ILogService } from 'vs/platform/log/common/log';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { INotebookKernel, INotebookKernelChangeEvent, INotebookKernelService, VariablesResult } from 'vs/workbench/contrib/notebook/common/notebookKernelService';
import { INotebookService } from 'vs/workbench/contrib/notebook/common/notebookService';
import { INotebookRuntimeKernelService } from 'vs/workbench/contrib/notebookRuntimeKernel/browser/interfaces/notebookRuntimeKernelService';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

class NotebookRuntimeKernel implements INotebookKernel {
	public readonly viewType = 'jupyter-notebook';

	public readonly extension = new ExtensionIdentifier('positron-notebook-controllers');

	public readonly preloadUris: URI[] = [];

	public readonly preloadProvides: string[] = [];

	public readonly implementsInterrupt = true;

	public readonly implementsExecutionOrder = true;

	public readonly hasVariableProvider = false;

	public readonly localResourceRoot: URI = URI.parse('');

	private readonly _onDidChange = new Emitter<INotebookKernelChangeEvent>();
	public readonly onDidChange: Event<INotebookKernelChangeEvent> = this._onDidChange.event;

	constructor(
		private readonly _runtime: ILanguageRuntimeMetadata,
		@INotebookService private readonly _notebookService: INotebookService,
		@ILogService private readonly _logService: ILogService,
	) {
	}

	get id(): string {
		// TODO: Is it ok if the ID doesn't match {publisher}.{extension}.{runtimeId}?
		return `positron.${this._runtime.runtimeId}`;
	}

	get label(): string {
		return this._runtime.runtimeName;
	}

	get description(): string {
		return this._runtime.runtimePath;
	}

	get detail(): string | undefined {
		return undefined;
	}

	get supportedLanguages(): string[] {
		return [this._runtime.languageId, 'raw'];
	}

	async executeNotebookCellsRequest(uri: URI, cellHandles: number[]): Promise<void> {
		const notebookModel = this._notebookService.getNotebookTextModel(uri);
		if (!notebookModel) {
			// Copying ExtHostNotebookController.getNotebookDocument for now.
			throw new Error(`NO notebook document for '${uri}'`);
		}
		const cells: NotebookCellTextModel[] = [];
		for (const cellHandle of cellHandles) {
			const cell = notebookModel.cells.find(cell => cell.handle === cellHandle);
			if (cell) {
				cells.push(cell);
			}
		}
		this._logService.debug(`[NotebookRuntimeKernel] Executing cells: ${cells.map(cell => cell.handle).join(', ')}`);

		// TODO: Actually execute the cells.
	}

	async cancelNotebookCellExecution(uri: URI, cellHandles: number[]): Promise<void> {
		this._logService.debug(`[NotebookRuntimeKernel] Interrupting`);

		// TODO: Actually interrupt the execution.
	}

	provideVariables(notebookUri: URI, parentId: number | undefined, kind: 'named' | 'indexed', start: number, token: CancellationToken): AsyncIterableObject<VariablesResult> {
		throw new Error('Method not implemented.');
	}
}

class NotebookRuntimeKernelService extends Disposable implements INotebookRuntimeKernelService {
	constructor(
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILogService private readonly _logService: ILogService,
		@ILanguageRuntimeService private readonly _languageRuntimeService: ILanguageRuntimeService,
		@INotebookKernelService private readonly _notebookKernelService: INotebookKernelService,
	) {
		super();

		this._register(this._languageRuntimeService.onDidRegisterRuntime(runtime => {
			const kernel = this._instantiationService.createInstance(NotebookRuntimeKernel, runtime);
			this._notebookKernelService.registerKernel(kernel);
			this._logService.debug(`[NotebookRuntimeKernelService] Registered kernel for runtime: ${runtime.runtimeName}`);
		}));

		// TODO: Also register kernels for existing runtimes.
	}

	/**
	 * Needed for service branding in dependency injector.
	 */
	declare readonly _serviceBrand: undefined;

	/**
	 * Placeholder that gets called to "initialize" the service.
	 */
	initialize(): void {
	}
}

// Register the service.
registerSingleton(
	INotebookRuntimeKernelService,
	NotebookRuntimeKernelService,
	InstantiationType.Delayed,
);
