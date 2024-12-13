/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ResourceMap } from '../../../../base/common/map.js';
import { URI } from '../../../../base/common/uri.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ILanguageRuntimeMessageError, ILanguageRuntimeMessageInput, ILanguageRuntimeMessageOutput, ILanguageRuntimeMessagePrompt, ILanguageRuntimeMessageState, ILanguageRuntimeMessageStream, ILanguageRuntimeMetadata, ILanguageRuntimeService, RuntimeCodeExecutionMode, RuntimeErrorBehavior, RuntimeOnlineState } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { NotebookTextModel } from '../../notebook/common/model/notebookTextModel.js';
import { INotebookCellExecution, INotebookExecutionStateService } from '../../notebook/common/notebookExecutionStateService.js';
import { INotebookKernel, INotebookKernelChangeEvent, INotebookKernelService, VariablesResult } from '../../notebook/common/notebookKernelService.js';
import { INotebookService } from '../../notebook/common/notebookService.js';
import { isRuntimeNotebookKernelEnabled } from '../common/runtimeNotebookKernelServiceConfig.js';
import { IRuntimeNotebookKernelService } from './interfaces/runtimeNotebookKernelService.js';
import { AsyncIterableObject, DeferredPromise, Sequencer } from '../../../../base/common/async.js';
import { NotebookCellTextModel } from '../../notebook/common/model/notebookCellTextModel.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { CellExecutionUpdateType } from '../../notebook/common/notebookExecutionService.js';
import { IOutputItemDto } from '../../notebook/common/notebookCommon.js';
import { decodeBase64, VSBuffer } from '../../../../base/common/buffer.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';

// TODO: Add from PR #5680.
/** The type of a Jupyter notebook cell output. */
enum JupyterNotebookCellOutputType {
	/** One of possibly many outputs related to an execution. */
	DisplayData = 'display_data',

	/** The result of an execution. */
	ExecuteResult = 'execute_result',
}

class RuntimeNotebookKernelService extends Disposable implements IRuntimeNotebookKernelService {
	private readonly _kernels = new Map<string, RuntimeNotebookKernel>();

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILanguageRuntimeService private readonly _languageRuntimeService: ILanguageRuntimeService,
		@INotebookKernelService private readonly _notebookKernelService: INotebookKernelService,
		@INotebookService private readonly _notebookService: INotebookService,
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
	) {
		super();

		if (!isRuntimeNotebookKernelEnabled(this._configurationService)) {
			return;
		}

		// Register a kernel when a runtime is registered.
		this._register(this._languageRuntimeService.onDidRegisterRuntime(runtime => {
			this._registerKernel(runtime);
		}));

		// Register a kernel for each existing runtime.
		for (const runtime of this._languageRuntimeService.registeredRuntimes) {
			this._registerKernel(runtime);
		}

		// When one of our kernels is selected for a notebook, select the corresponding session
		// via the runtime session service.
		this._register(this._notebookKernelService.onDidChangeSelectedNotebooks(async e => {
			const newKernel = e.newKernel && this._kernels.get(e.newKernel);
			if (newKernel) {
				await this._runtimeSessionService.selectRuntime(
					newKernel.runtime.runtimeId,
					// TODO: Is this a user action or can it be automatic?
					`Runtime selected for notebook`,
					e.notebook,
				);
			}
		}));

		// When a notebook is closed, shut down the corresponding session.
		this._register(this._notebookService.onWillRemoveNotebookDocument(async _notebook => {
			// TODO: Add a shutdownNotebookSession to the runtime session service and call it here.
			//       We need a dedicated method so that the runtime session service can manage
			//       concurrent attempts to start/shutdown/restart while the shutdown is in progress.
		}));
	}

	private _registerKernel(runtime: ILanguageRuntimeMetadata): void {
		// TODO: Dispose the kernel when the runtime is disposed/unregistered?
		const kernel = this._instantiationService.createInstance(RuntimeNotebookKernel, runtime);
		// TODO: Error if a kernel is already registered for the ID.
		this._kernels.set(kernel.id, kernel);
		this._notebookKernelService.registerKernel(kernel);
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

class RuntimeNotebookKernel implements INotebookKernel {
	public readonly viewType = 'jupyter-notebook';

	// TODO: Is this ok?
	public readonly extension = new ExtensionIdentifier('positron-notebook-controllers');

	public readonly preloadUris: URI[] = [];

	public readonly preloadProvides: string[] = [];

	public readonly implementsInterrupt = true;

	public readonly implementsExecutionOrder = true;

	public readonly hasVariableProvider = false;

	public readonly localResourceRoot: URI = URI.parse('');

	private readonly _onDidChange = new Emitter<INotebookKernelChangeEvent>();
	public readonly onDidChange = this._onDidChange.event;

	private readonly _notebookRuntimeKernelSessionsByNotebookUri = new ResourceMap<RuntimeNotebookKernelSession>();

	constructor(
		public readonly runtime: ILanguageRuntimeMetadata,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILogService private readonly _logService: ILogService,
		@INotebookService private readonly _notebookService: INotebookService,
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
	) { }

	get id(): string {
		// TODO: Is it ok if the ID doesn't match {publisher}.{extension}.{runtimeId}?
		return `positron.${this.runtime.runtimeId}`;
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

		const notebook = this._notebookService.getNotebookTextModel(notebookUri);
		if (!notebook) {
			// Copying ExtHostNotebookController.getNotebookDocument for now.
			throw new Error(`NO notebook document for '${notebookUri}'`);
		}

		const session = this._runtimeSessionService.getNotebookSessionForNotebookUri(notebookUri);
		if (!session) {
			throw new Error(`NO runtime session for notebook '${notebookUri}'`);
		}

		// TODO: Dispose?
		let notebookRuntimeKernelSession = this._notebookRuntimeKernelSessionsByNotebookUri.get(notebookUri);
		if (!notebookRuntimeKernelSession) {
			notebookRuntimeKernelSession = this._instantiationService.createInstance(RuntimeNotebookKernelSession, session, notebook);
			this._notebookRuntimeKernelSessionsByNotebookUri.set(notebookUri, notebookRuntimeKernelSession);
		}

		await notebookRuntimeKernelSession.executeCells(cellHandles);
	}

	async cancelNotebookCellExecution(uri: URI, _cellHandles: number[]): Promise<void> {
		this._logService.debug(`[RuntimeNotebookKernel] Interrupting`);

		const session = this._runtimeSessionService.getNotebookSessionForNotebookUri(uri);
		if (!session) {
			throw new Error(`NO runtime session for notebook '${uri}'`);
		}

		session.interrupt();
	}

	provideVariables(notebookUri: URI, parentId: number | undefined, kind: 'named' | 'indexed', start: number, token: CancellationToken): AsyncIterableObject<VariablesResult> {
		throw new Error('provideVariables not implemented.');
	}
}

class RuntimeNotebookKernelSession extends Disposable {
	/**
	 * A map of the last queued cell execution promise for each notebook, keyed by notebook URI.
	 * Each queued cell execution promise is chained to the previous one for the notebook,
	 * so that cells are executed in order.
	 */
	private readonly _pendingCellExecutionsByNotebookUri = new ResourceMap<Promise<void>>();

	constructor(
		private readonly _session: ILanguageRuntimeSession,
		private readonly _notebook: NotebookTextModel,
		@ILogService private readonly _logService: ILogService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@INotebookExecutionStateService private readonly _notebookExecutionStateService: INotebookExecutionStateService,
	) {
		super();
	}

	async executeCells(cellHandles: number[]): Promise<void> {
		const executionPromises: Promise<void>[] = [];
		for (const cellHandle of cellHandles) {
			const cell = this._notebook.cells.find(cell => cell.handle === cellHandle);
			// TODO: When does this happen?
			if (!cell) {
				continue;
			}

			executionPromises.push(this._queueCellExecution(cell));
		}

		try {
			await Promise.all(executionPromises);
		} catch (err) {
			this._logService.debug(`Error executing cells: ${err.stack ?? err}`);
		}
	}

	private async _queueCellExecution(cell: NotebookCellTextModel): Promise<void> {
		// Get the pending execution for this notebook, if one exists.
		const pendingExecution = this._pendingCellExecutionsByNotebookUri.get(this._notebook.uri);

		// Chain this execution after the pending one.
		const currentExecution = Promise.resolve(pendingExecution)
			.then(() => this._executeCell(cell))
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

	private async _executeCell(cell: NotebookCellTextModel): Promise<void> {
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

		// TODO: This can be a simple counter for the session.
		const id = generateUuid();

		// TODO: Error if there's already a runtimeExecution for this ID?
		//       Or get another id?

		const runtimeExecution = this._register(this._instantiationService.createInstance(
			RuntimeNotebookCellExecution, this._session, cellExecution, cell
		));

		try {
			this._session.execute(
				code,
				id,
				RuntimeCodeExecutionMode.Interactive,
				RuntimeErrorBehavior.Stop,
			);
		} catch (err) {
			runtimeExecution.error(err);
		}

		return runtimeExecution.promise;
	}
}

class RuntimeNotebookCellExecution extends Disposable {
	private _deferred = new DeferredPromise<void>();

	// Create a promise tracking the current message for the cell. Each execution may
	// receive multiple messages, which we want to handle in sequence.
	private _taskQueue = new Sequencer();

	constructor(
		private readonly _session: ILanguageRuntimeSession,
		private readonly _cellExecution: INotebookCellExecution,
		private readonly _cell: NotebookCellTextModel,
		@ILogService private readonly _logService: ILogService,
		@IQuickInputService private readonly _quickInputService: IQuickInputService,
	) {
		super();

		this._register(this._session.onDidReceiveRuntimeMessageInput(async message => {
			await this._taskQueue.queue(() => this._handleRuntimeMessageInput(message));
		}));

		this._register(this._session.onDidReceiveRuntimeMessagePrompt(async message => {
			await this._taskQueue.queue(() => this._handleRuntimeMessagePrompt(message));
		}));

		this._register(this._session.onDidReceiveRuntimeMessageOutput(async message => {
			await this._taskQueue.queue(() => this._handleRuntimeMessageOutput(
				message, JupyterNotebookCellOutputType.DisplayData
			));
		}));

		this._register(this._session.onDidReceiveRuntimeMessageResult(async message => {
			await this._taskQueue.queue(() => this._handleRuntimeMessageOutput(
				message, JupyterNotebookCellOutputType.ExecuteResult
			));
		}));

		this._register(this._session.onDidReceiveRuntimeMessageStream(async message => {
			await this._taskQueue.queue(() => this._handleRuntimeMessageStream(message));
		}));

		this._register(this._session.onDidReceiveRuntimeMessageError(async message => {
			await this._taskQueue.queue(() => this._handleRuntimeMessageError(message));
		}));

		this._register(this._session.onDidReceiveRuntimeMessageState(async message => {
			await this._taskQueue.queue(() => this._handleRuntimeMessageState(message));
		}));

		this._cellExecution.update([{
			// Start the execution timer.
			editType: CellExecutionUpdateType.ExecutionState,
			runStartTime: Date.now(),
		}, {
			// Clear any existing outputs.
			editType: CellExecutionUpdateType.Output,
			cellHandle: this._cellExecution.cellHandle,
			outputs: [],
		}]);
	}

	public complete(): void {
		// End the cell execution.
		this._cellExecution.complete({
			runEndTime: Date.now(),
			lastRunSuccess: true,
		});

		this._deferred.complete();

		// TODO: Do we need to track whether we're disposed in some cases?
		this.dispose();
	}

	public error(err: any): void {
		// End the cell execution with the error.
		this._cellExecution.complete({
			runEndTime: Date.now(),
			lastRunSuccess: false,
			error: {
				message: err.message,
				stack: err.stack,
				uri: this._cell.uri,
				location: undefined,
			},
		});

		this._deferred.error(err);

		// TODO: Do we need to track whether we're disposed in some cases?
		this.dispose();
	}

	private async _handleRuntimeMessageInput(message: ILanguageRuntimeMessageInput): Promise<void> {
		// Update the cell's execution order (usually displayed in notebook UIs).
		this._cellExecution.update([{
			editType: CellExecutionUpdateType.ExecutionState,
			executionOrder: message.execution_count,
		}]);
	}

	private async _handleRuntimeMessagePrompt(message: ILanguageRuntimeMessagePrompt): Promise<void> {
		// Let the user input a reply.
		const reply = await this._quickInputService.input({
			password: message.password,
			prompt: message.prompt,
		});

		// Reply to the prompt.
		this._session.replyToPrompt(message.id, reply ?? '');
	}

	private async _handleRuntimeMessageOutput(
		message: ILanguageRuntimeMessageOutput,
		outputType: JupyterNotebookCellOutputType,
	): Promise<void> {
		const outputItems: IOutputItemDto[] = [];
		for (const [mime, data] of Object.entries(message.data)) {
			switch (mime) {
				case 'image/png':
				case 'image/jpeg':
					outputItems.push({ data: decodeBase64(String(data)), mime });
					break;
				// This list is a subset of src/vs/workbench/contrib/notebook/browser/view/cellParts/cellOutput.JUPYTER_RENDERER_MIMETYPES
				case 'application/geo+json':
				case 'application/vdom.v1+json':
				case 'application/vnd.dataresource+json':
				case 'application/vnd.jupyter.widget-view+json':
				case 'application/vnd.plotly.v1+json':
				case 'application/vnd.r.htmlwidget':
				case 'application/vnd.vega.v2+json':
				case 'application/vnd.vega.v3+json':
				case 'application/vnd.vega.v4+json':
				case 'application/vnd.vega.v5+json':
				case 'application/vnd.vegalite.v1+json':
				case 'application/vnd.vegalite.v2+json':
				case 'application/vnd.vegalite.v3+json':
				case 'application/vnd.vegalite.v4+json':
				case 'application/x-nteract-model-debug+json':
					// The JSON cell output item will be rendered using the appropriate notebook renderer.
					outputItems.push({ data: VSBuffer.fromString(JSON.stringify(data, undefined, '\t')), mime });
					break;
				default:
					outputItems.push({ data: VSBuffer.fromString(String(data)), mime });
			}
		}
		this._cellExecution.update([{
			editType: CellExecutionUpdateType.Output,
			cellHandle: this._cellExecution.cellHandle,
			append: true,
			outputs: [{
				outputId: message.id,
				outputs: outputItems,
				metadata: {
					...message.metadata,
					outputType,
				}
			}]
		}]);
	}

	private async _handleRuntimeMessageStream(message: ILanguageRuntimeMessageStream): Promise<void> {
		// Convert the runtime message into an output item data transfer object.
		let mime: string;
		if (message.name === 'stdout') {
			mime = 'application/vnd.code.notebook.stdout';
		} else if (message.name === 'stderr') {
			mime = 'application/vnd.code.notebook.stderr';
		} else {
			this._logService.warn(`[NotebookRuntimeKernel] Ignoring runtime message with unknown stream name: ${message.name}`);
			return;
		}
		const newOutputItem: IOutputItemDto = { data: VSBuffer.fromString(message.text), mime };

		// If the last output has items of the same mime type (i.e. from the same stream: stdout/stderr),
		// append the new item to the last output. Otherwise, create a new output.
		const lastOutput = this._cell.outputs.at(-1);
		const lastOutputItems = lastOutput?.outputs;
		if (lastOutputItems && lastOutputItems.every(item => item.mime === mime)) {
			this._cellExecution.update([{
				editType: CellExecutionUpdateType.OutputItems,
				append: true,
				outputId: lastOutput.outputId,
				items: [newOutputItem],
			}]);
		} else {
			this._cellExecution.update([{
				editType: CellExecutionUpdateType.Output,
				cellHandle: this._cellExecution.cellHandle,
				append: true,
				outputs: [{
					outputId: message.id,
					outputs: [newOutputItem],
					metadata: message.metadata,
				}]
			}]);
		}
	}

	private async _handleRuntimeMessageError(message: ILanguageRuntimeMessageError): Promise<void> {
		this._cellExecution.update([{
			editType: CellExecutionUpdateType.Output,
			cellHandle: this._cellExecution.cellHandle,
			append: true,
			outputs: [{
				outputId: message.id,
				outputs: [{
					data: VSBuffer.fromString(JSON.stringify({
						name: message.name,
						message: message.message,
						stack: message.traceback.join('\n'),
					}, undefined, '\t')),
					mime: 'application/vnd.code.notebook.error',
				}]
			}]
		}]);
		this._cellExecution.complete({
			runEndTime: Date.now(),
			lastRunSuccess: false,
			error: {
				message: message.message,
				stack: message.traceback.join('\n'),
				uri: this._cell.uri,
				location: undefined,
			},
		});

		// The execution is finished - stop listening for replies.
		this.error(new Error(
			`Received language runtime error message: ${JSON.stringify(message)}`
		));
	}

	private async _handleRuntimeMessageState(message: ILanguageRuntimeMessageState): Promise<void> {
		if (message.state === RuntimeOnlineState.Idle) {
			this.complete();
		}
	}

	public get promise(): Promise<void> {
		return this._deferred.p;
	}
}

// Register the service.
registerSingleton(
	IRuntimeNotebookKernelService,
	RuntimeNotebookKernelService,
	InstantiationType.Delayed,
);
