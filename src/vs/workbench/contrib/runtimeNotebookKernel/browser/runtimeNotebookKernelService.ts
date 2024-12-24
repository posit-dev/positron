/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { AsyncIterableObject, DeferredPromise, Sequencer } from '../../../../base/common/async.js';
import { decodeBase64, VSBuffer } from '../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ResourceMap } from '../../../../base/common/map.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { ILanguageRuntimeMessageError, ILanguageRuntimeMessageInput, ILanguageRuntimeMessageOutput, ILanguageRuntimeMessagePrompt, ILanguageRuntimeMessageState, ILanguageRuntimeMessageStream, ILanguageRuntimeMetadata, ILanguageRuntimeService, RuntimeCodeExecutionMode, RuntimeErrorBehavior, RuntimeOnlineState } from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { IRuntimeStartupService } from '../../../services/runtimeStartup/common/runtimeStartupService.js';
import { NotebookCellTextModel } from '../../notebook/common/model/notebookCellTextModel.js';
import { NotebookTextModel } from '../../notebook/common/model/notebookTextModel.js';
import { IOutputItemDto } from '../../notebook/common/notebookCommon.js';
import { CellExecutionUpdateType } from '../../notebook/common/notebookExecutionService.js';
import { INotebookCellExecution, INotebookExecutionStateService } from '../../notebook/common/notebookExecutionStateService.js';
import { INotebookKernel, INotebookKernelChangeEvent, INotebookKernelService, VariablesResult } from '../../notebook/common/notebookKernelService.js';
import { INotebookService } from '../../notebook/common/notebookService.js';
import { registerRuntimeNotebookKernelActions } from '../common/runtimeNotebookKernelActions.js';
import { isRuntimeNotebookKernelEnabled, POSITRON_RUNTIME_NOTEBOOK_KERNELS_EXTENSION_ID } from '../common/runtimeNotebookKernelConfig.js';
import { IRuntimeNotebookKernelService } from './interfaces/runtimeNotebookKernelService.js';
import { NotebookExecutionStatus } from './notebookExecutionStatus.js';
import { ActiveNotebookHasRunningRuntimeManager } from '../common/activeNotebookHasRunningRuntime.js';

/**
 * The view type supported by Positron runtime notebook kernels. Currently only Jupyter notebooks are supported.
 */
const viewType = 'jupyter-notebook';

/**
 * The affinity of a kernel for a notebook.
 *
 * NOTE: This should match vscode.NotebookControllerAffinity.
 */
enum NotebookKernelAffinity {
	/** The default affinity. */
	Default = 1,

	/** A kernel will be automatically started if it is a notebook's only preferred kernel. */
	Preferred = 2
}

/**
 * The type of a Jupyter notebook cell output.
 *
 * Used by the ipynb notebook serializer (extensions/ipynb/src/serializers.ts) to convert from
 * VSCode notebook cell outputs to Jupyter notebook cell outputs.
 *
 * See: https://jupyter-client.readthedocs.io/en/latest/messaging.html
 */
enum JupyterNotebookCellOutputType {
	/** An error occurred during an execution. */
	Error = 'error',

	/** Output from one of the standard streams (stdout or stderr). */
	Stream = 'stream',

	/** One of possibly many outputs related to an execution. */
	DisplayData = 'display_data',

	/** The result of an execution. */
	ExecuteResult = 'execute_result',
}

export class RuntimeNotebookKernelService extends Disposable implements IRuntimeNotebookKernelService {
	/** Map of runtime notebook kernels keyed by kernel ID. */
	private readonly _kernels = new Map<string, RuntimeNotebookKernel>();

	/** Map of runtime notebook kernels keyed by runtime ID. */
	private readonly _kernelsByRuntimeId = new Map<string, RuntimeNotebookKernel>();

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILanguageRuntimeService private readonly _languageRuntimeService: ILanguageRuntimeService,
		@ILogService private readonly _logService: ILogService,
		@INotebookKernelService private readonly _notebookKernelService: INotebookKernelService,
		@INotebookService private readonly _notebookService: INotebookService,
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
		@IRuntimeStartupService private readonly _runtimeStartupService: IRuntimeStartupService,
	) {
		super();

		// NOTE: These two instances could be services but we'll keep them here for now.

		// Create the notebook execution status bar entry.
		this._register(this._instantiationService.createInstance(NotebookExecutionStatus));

		// Create the active notebook has running runtime context manager.
		this._register(this._instantiationService.createInstance(ActiveNotebookHasRunningRuntimeManager));

		// If runtime notebook kernels are disabled, do not proceed.
		// In that case, the positron-notebook-controllers extension's kernels will be used.
		if (!isRuntimeNotebookKernelEnabled(this._configurationService)) {
			return;
		}

		// Create a kernel when a runtime is registered.
		this._register(this._languageRuntimeService.onDidRegisterRuntime(runtime => {
			this.createRuntimeNotebookKernel(runtime);
		}));

		// Create a kernel for each existing runtime.
		for (const runtime of this._languageRuntimeService.registeredRuntimes) {
			this.createRuntimeNotebookKernel(runtime);
		}

		// When a known kernel is selected for a notebook, select the corresponding runtime for the notebook.
		this._register(this._notebookKernelService.onDidChangeSelectedNotebooks(async e => {
			const oldKernel = e.oldKernel && this._kernels.get(e.oldKernel);
			const newKernel = e.newKernel && this._kernels.get(e.newKernel);
			if (newKernel) {
				// A known kernel was selected, select the corresponding runtime.
				await this._runtimeSessionService.selectRuntime(
					newKernel.runtime.runtimeId,
					`Runtime kernel ${newKernel.id} selected for notebook`,
					e.notebook,
				);
			} else if (oldKernel) {
				// The user switched from a known kernel to an unknown kernel, shutdown the existing runtime.
				// TODO: Add a shutdownNotebookSession to the runtime session service and call it here.
				//       We need a dedicated method so that the runtime session service can manage
				//       concurrent attempts to start/shutdown/restart while the shutdown is in progress.
			}
		}));

		// When a notebook is added, update its kernel affinity.
		this._register(this._notebookService.onWillAddNotebookDocument(async notebook => {
			await this.updateKernelNotebookAffinity(notebook);
		}));

		// Update the kernel affinity of all existing notebooks.
		for (const notebook of this._notebookService.getNotebookTextModels()) {
			this.updateKernelNotebookAffinity(notebook)
				.catch(err => this._logService.error(`Error updating affinity for notebook ${notebook.uri.fsPath}: ${err}`));
		}

		// When a notebook is closed, shut down the corresponding session.
		this._register(this._notebookService.onWillRemoveNotebookDocument(async notebook => {
			// TODO: Add a shutdownNotebookSession to the runtime session service and call it here.
			//       We need a dedicated method so that the runtime session service can manage
			//       concurrent attempts to start/shutdown/restart while the shutdown is in progress.
		}));

		// Register kernel source action providers. This is how we customize the
		// kernel selection quickpick. Each command must return a valid runtime ID.
		this._register(this._notebookKernelService.registerKernelSourceActionProvider(viewType, {
			viewType,
			async provideKernelSourceActions() {
				return [
					{
						label: 'Python Environments...',
						command: {
							id: 'workbench.action.languageRuntime.pick',
							title: 'Select Python Interpreter',
							arguments: ['python'],
						},
					},
					{
						label: 'R Environments...',
						command: {
							id: 'workbench.action.languageRuntime.pick',
							title: 'Select R Interpreter',
							arguments: ['r'],
						},
					}
				];
			},
			// Kernel source actions are currently constant so we don't need this event.
			onDidChangeSourceActions: undefined,
		}));
	}

	/**
	 * Create and register a notebook kernel for a given language runtime.
	 *
	 * @param runtime The language runtime to create a notebook kernel for.
	 */
	private createRuntimeNotebookKernel(runtime: ILanguageRuntimeMetadata): void {
		// TODO: Dispose the kernel when the runtime is disposed/unregistered?
		const kernel = this._register(this._instantiationService.createInstance(RuntimeNotebookKernel, runtime));

		// TODO: Error if a kernel is already registered for the ID.
		this._kernels.set(kernel.id, kernel);
		this._kernelsByRuntimeId.set(runtime.runtimeId, kernel);
		this._register(this._notebookKernelService.registerKernel(kernel));
	}

	/**
	 * Update a notebook's affinity for all kernels.
	 *
	 * Positron automatically starts a kernel if it is the only 'preferred' kernel for the notebook.
	 *
	 * @param notebook The notebook whose affinity to update.
	 * @returns Promise that resolves when the notebook's affinity has been updated for all kernels.
	 */
	private async updateKernelNotebookAffinity(notebook: NotebookTextModel): Promise<void> {
		const cells = notebook.cells;
		if (cells.length === 0 ||
			(cells.length === 1 && cells[0].getValue() === '')) {
			// If its an empty notebook (i.e. it has a single empty cell, or no cells),
			// wait for its data to be updated. This works around the  fact that `vscode.openNotebookDocument()`
			// first creates a notebook (triggering `onDidOpenNotebookDocument`),
			// and later updates its content (triggering `onDidChangeNotebookDocument`).
			await new Promise<void>((resolve) => {
				// Apply a short timeout to avoid waiting indefinitely.
				const timeout = setTimeout(() => {
					disposable.dispose();
					resolve();
				}, 50);
				const disposable = notebook.onDidChangeContent(_e => {
					clearTimeout(timeout);
					disposable.dispose();
					resolve();
				});
			});
		}

		// Get the notebook's language.
		const languageId = getNotebookLanguage(notebook);
		if (!languageId) {
			this._logService.debug(`Could not determine notebook ${notebook.uri.fsPath} language`);
			return;
		}

		// Get the preferred kernel for the language.
		let preferredRuntime: ILanguageRuntimeMetadata;
		try {
			preferredRuntime = this._runtimeStartupService.getPreferredRuntime(languageId);
		} catch (err) {
			// It may error if there are no registered runtimes for the language, so log and return.
			this._logService.debug(`Failed to get preferred runtime for language ${languageId}: ${err}`);
			return;
		}
		const preferredKernel = this._kernelsByRuntimeId.get(preferredRuntime.runtimeId);
		this._logService.debug(`Preferred kernel for notebook ${notebook.uri.fsPath}: ${preferredKernel?.label}`);

		// Set the affinity across all known kernels.
		for (const kernel of this._kernels.values()) {
			const affinity = kernel === preferredKernel
				? NotebookKernelAffinity.Preferred
				: NotebookKernelAffinity.Default;
			this._notebookKernelService.updateKernelNotebookAffinity(kernel, notebook.uri, affinity);
			this._logService.trace(`Updated notebook affinity for kernel: ${kernel.label}, ` +
				`notebook: ${notebook.uri.fsPath}, affinity: ${affinity}`);
		}
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

// TODO: Move each class to a separate file.
export class RuntimeNotebookKernel extends Disposable implements INotebookKernel {
	public readonly viewType = viewType;

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

	private readonly _notebookRuntimeKernelSessionsByNotebookUri = new ResourceMap<RuntimeNotebookKernelSession>();

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

		// Get the cells to execute from their handles.
		const cells: NotebookCellTextModel[] = [];
		for (const cellHandle of cellHandles) {
			const cell = notebook.cells.find(cell => cell.handle === cellHandle);
			// TODO: When does this happen?
			if (!cell) {
				continue;
			}
			cells.push(cell);
		}

		// Execute the cells.
		try {
			await notebookRuntimeKernelSession.executeCells(cells);
		} catch (err) {
			this._logService.debug(`Error executing cells: ${err.stack ?? err}`);
		}
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

	public override dispose(): void {
		super.dispose();

		for (const disposable of this._notebookRuntimeKernelSessionsByNotebookUri.values()) {
			disposable.dispose();
		}
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
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@INotebookExecutionStateService private readonly _notebookExecutionStateService: INotebookExecutionStateService,
	) {
		super();
	}

	async executeCells(cells: NotebookCellTextModel[]): Promise<void> {
		const executionPromises = cells.map(cell => this.queueCellExecution(cell));
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
			await this._taskQueue.queue(() => this.handleRuntimeMessageInput(message));
		}));

		this._register(this._session.onDidReceiveRuntimeMessagePrompt(async message => {
			await this._taskQueue.queue(() => this.handleRuntimeMessagePrompt(message));
		}));

		this._register(this._session.onDidReceiveRuntimeMessageOutput(async message => {
			await this._taskQueue.queue(() => this.handleRuntimeMessageOutput(
				message, JupyterNotebookCellOutputType.DisplayData
			));
		}));

		this._register(this._session.onDidReceiveRuntimeMessageResult(async message => {
			await this._taskQueue.queue(() => this.handleRuntimeMessageOutput(
				message, JupyterNotebookCellOutputType.ExecuteResult
			));
		}));

		this._register(this._session.onDidReceiveRuntimeMessageStream(async message => {
			await this._taskQueue.queue(() => this.handleRuntimeMessageStream(message));
		}));

		this._register(this._session.onDidReceiveRuntimeMessageError(async message => {
			await this._taskQueue.queue(() => this.handleRuntimeMessageError(message));
		}));

		this._register(this._session.onDidReceiveRuntimeMessageState(async message => {
			await this._taskQueue.queue(() => this.handleRuntimeMessageState(message));
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

	public error(err: Error): void {
		// End the cell execution with the error.
		this._cellExecution.complete({
			runEndTime: Date.now(),
			lastRunSuccess: false,
			error: {
				message: err.message,
				stack: err?.stack ?? JSON.stringify(err),
				uri: this._cell.uri,
				location: undefined,
			},
		});

		this._deferred.error(err);

		// TODO: Do we need to track whether we're disposed in some cases?
		this.dispose();
	}

	private async handleRuntimeMessageInput(message: ILanguageRuntimeMessageInput): Promise<void> {
		// Update the cell's execution order (usually displayed in notebook UIs).
		this._cellExecution.update([{
			editType: CellExecutionUpdateType.ExecutionState,
			executionOrder: message.execution_count,
		}]);
	}

	private async handleRuntimeMessagePrompt(message: ILanguageRuntimeMessagePrompt): Promise<void> {
		// Let the user input a reply.
		const reply = await this._quickInputService.input({
			password: message.password,
			prompt: message.prompt,
		});

		// Reply to the prompt.
		this._session.replyToPrompt(message.id, reply ?? '');
	}

	private async handleRuntimeMessageOutput(
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
				metadata: { outputType },
			}]
		}]);
	}

	private async handleRuntimeMessageStream(message: ILanguageRuntimeMessageStream): Promise<void> {
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
					metadata: { outputType: JupyterNotebookCellOutputType.Stream },
				}]
			}]);
		}
	}

	private async handleRuntimeMessageError(message: ILanguageRuntimeMessageError): Promise<void> {
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
				}],
				metadata: { outputType: JupyterNotebookCellOutputType.Error },
			}],
		}]);

		this.error({
			name: message.name,
			message: message.message,
			stack: message.traceback.join('\n'),
		});
	}

	private async handleRuntimeMessageState(message: ILanguageRuntimeMessageState): Promise<void> {
		if (message.state === RuntimeOnlineState.Idle) {
			this.complete();
		}
	}

	public get promise(): Promise<void> {
		return this._deferred.p;
	}
}

/**
 * Try to determine a notebook's language.
 *
 * @param notebook The notebook to determine the language of.
 * @returns The language ID of the notebook, or `undefined` if it could not be determined.
 */
function getNotebookLanguage(notebook: NotebookTextModel): string | undefined {
	// First try the notebook metadata.
	const metadata = notebook.metadata?.metadata as any;
	const languageId = metadata?.language_info?.name ?? metadata?.kernelspec?.language;
	if (languageId) {
		return languageId;
	}

	// Fall back to the first cell's language, if available.
	for (const cell of notebook.cells) {
		const language = cell.language;
		if (language !== 'markdown' &&
			language !== 'raw' &&
			language !== 'text') {
			return language;
		}
	}

	// Could not determine the notebook's language.
	return undefined;
}

// Register the service.
registerSingleton(
	IRuntimeNotebookKernelService,
	RuntimeNotebookKernelService,
	InstantiationType.Delayed,
);

// Register actions.
registerRuntimeNotebookKernelActions();
