/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { AsyncIterableObject } from 'vs/base/common/async';
import { decodeBase64, VSBuffer } from 'vs/base/common/buffer';
import { CancellationToken } from 'vs/base/common/cancellation';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { basename } from 'vs/base/common/path';
import { URI } from 'vs/base/common/uri';
import { generateUuid } from 'vs/base/common/uuid';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ILogService } from 'vs/platform/log/common/log';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { IOutputItemDto } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { CellExecutionUpdateType } from 'vs/workbench/contrib/notebook/common/notebookExecutionService';
import { INotebookExecutionStateService } from 'vs/workbench/contrib/notebook/common/notebookExecutionStateService';
import { INotebookKernel, INotebookKernelChangeEvent, INotebookKernelService, VariablesResult } from 'vs/workbench/contrib/notebook/common/notebookKernelService';
import { INotebookService } from 'vs/workbench/contrib/notebook/common/notebookService';
import { INotebookRuntimeKernelService } from 'vs/workbench/contrib/notebookRuntimeKernel/browser/interfaces/notebookRuntimeKernelService';
import { ILanguageRuntimeMessageOutput, ILanguageRuntimeMetadata, ILanguageRuntimeService, LanguageRuntimeSessionMode, RuntimeCodeExecutionMode, RuntimeErrorBehavior } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IRuntimeSessionService } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';

// TODO: Add from PR #5680.
/** The type of a Jupyter notebook cell output. */
enum JupyterNotebookCellOutputType {
	/** One of possibly many outputs related to an execution. */
	DisplayData = 'display_data',

	/** The result of an execution. */
	ExecuteResult = 'execute_result',
}

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
		@ILogService private readonly _logService: ILogService,
		@INotebookService private readonly _notebookService: INotebookService,
		@INotebookExecutionStateService private readonly _notebookExecutionStateService: INotebookExecutionStateService,
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
		@IQuickInputService private readonly _quickInputService: IQuickInputService,
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

		const session = this._runtimeSessionService.getNotebookSessionForNotebookUri(uri);
		if (!session) {
			throw new Error(`NO runtime session for notebook '${uri}'`);
		}

		this._logService.debug(`[NotebookRuntimeKernel] Executing cells: ${cellHandles.join(', ')}`);
		for (const cellHandle of cellHandles) {
			const cell = notebookModel.cells.find(cell => cell.handle === cellHandle);
			// TODO: When does this happen?
			if (!cell) {
				continue;
			}

			const code = cell.getValue();

			// If the cell is empty, skip it.
			if (!code.trim()) {
				continue;
			}

			const execution = this._notebookExecutionStateService.getCellExecution(cell.uri);
			if (!execution) {
				throw new Error(`NO execution for cell '${cell.uri}'`);
			}

			// Clear any existing outputs.
			execution.update([{
				editType: CellExecutionUpdateType.Output,
				cellHandle,
				outputs: [],
			}]);

			// TODO: This can be a simple counter for the session.
			const id = generateUuid();

			const disposables = new DisposableStore();

			// TODO: We could register all of these when the session is attached and route them to
			//       the right place. Not sure which is better.
			disposables.add(session.onDidReceiveRuntimeMessageInput(message => {
				// Only handle replies to this execution.
				if (message.parent_id !== id) {
					return;
				}

				// Update the cell's execution order (usually displayed in notebook UIs).
				// TODO: Which of these should we prefer?
				// cell.internalMetadata.executionOrder = message.execution_count;
				execution.update([{
					editType: CellExecutionUpdateType.ExecutionState,
					executionOrder: message.execution_count,
				}]);
			}));

			disposables.add(session.onDidReceiveRuntimeMessagePrompt(async message => {
				// Only handle replies to this execution.
				if (message.parent_id !== id) {
					return;
				}

				// Let the user input a reply.
				const reply = await this._quickInputService.input({
					password: message.password,
					prompt: message.prompt,
				});

				// Reply to the prompt.
				session.replyToPrompt(message.id, reply ?? '');
			}));

			const handleRuntimeMessageOutput = async (
				message: ILanguageRuntimeMessageOutput,
				outputType: JupyterNotebookCellOutputType,
			) => {
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
				execution.update([{
					editType: CellExecutionUpdateType.Output,
					cellHandle,
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
			};

			disposables.add(session.onDidReceiveRuntimeMessageOutput(async message => {
				await handleRuntimeMessageOutput(message, JupyterNotebookCellOutputType.DisplayData);
			}));

			disposables.add(session.onDidReceiveRuntimeMessageResult(async message => {
				await handleRuntimeMessageOutput(message, JupyterNotebookCellOutputType.ExecuteResult);
			}));

			disposables.add(session.onDidReceiveRuntimeMessageStream(async message => {
				// Only handle replies to this execution.
				if (message.parent_id !== id) {
					return;
				}

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
				const lastOutput = cell.outputs.at(-1);
				const lastOutputItems = lastOutput?.outputs;
				if (lastOutputItems && lastOutputItems.every(item => item.mime === mime)) {
					execution.update([{
						editType: CellExecutionUpdateType.OutputItems,
						append: true,
						outputId: lastOutput.outputId,
						items: [newOutputItem],
					}]);
				} else {
					execution.update([{
						editType: CellExecutionUpdateType.Output,
						cellHandle,
						append: true,
						outputs: [{
							outputId: message.id,
							outputs: [newOutputItem],
							metadata: message.metadata,
						}]
					}]);
				}
			}));

			disposables.add(session.onDidReceiveRuntimeMessageState(message => {
				// Only handle replies to this execution.
				if (message.parent_id !== id) {
					return;
				}
			}));

			try {
				session.execute(
					code,
					id,
					RuntimeCodeExecutionMode.Interactive,
					RuntimeErrorBehavior.Stop,
				);
			} catch (err) {
				throw err;
			}
		}
	}

	async cancelNotebookCellExecution(uri: URI, cellHandles: number[]): Promise<void> {
		this._logService.debug(`[NotebookRuntimeKernel] Interrupting`);

		// TODO: Actually interrupt the execution.
	}

	provideVariables(notebookUri: URI, parentId: number | undefined, kind: 'named' | 'indexed', start: number, token: CancellationToken): AsyncIterableObject<VariablesResult> {
		throw new Error('Method not implemented.');
	}
}

// class NotebookRuntimeKernelSession {
// 	constructor(
// 		private readonly _kernel: NotebookRuntimeKernel,
// 		private readonly _session: ILanguageRuntimeSession,
// 		private readonly _notebookUri: URI,
// 	) {
// 	}
// }

class NotebookRuntimeKernelService extends Disposable implements INotebookRuntimeKernelService {
	constructor(
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILogService private readonly _logService: ILogService,
		@ILanguageRuntimeService private readonly _languageRuntimeService: ILanguageRuntimeService,
		@INotebookKernelService private readonly _notebookKernelService: INotebookKernelService,
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
	) {
		super();

		this._register(this._languageRuntimeService.onDidRegisterRuntime(runtime => {
			const kernel = this._instantiationService.createInstance(NotebookRuntimeKernel, runtime);
			// TODO: Dispose the kernel when the runtime is disposed/unregistered?
			this._notebookKernelService.registerKernel(kernel);
			this._logService.debug(`[NotebookRuntimeKernelService] Registered kernel for runtime: ${runtime.runtimeName}`);

			// TODO: Dispose
			this._notebookKernelService.onDidChangeSelectedNotebooks(async e => {
				if (e.oldKernel === kernel.id) {
					// This kernel was deselected.
					// TODO: Shutdown the session.
				} else if (e.newKernel === kernel.id) {
					// This kernel was selected.
					// TODO: Add selectNotebookRuntime to runtime session service?
					await this._runtimeSessionService.startNewRuntimeSession(
						runtime.runtimeId,
						basename(e.notebook.fsPath),
						LanguageRuntimeSessionMode.Notebook,
						e.notebook,
						// TODO: Is this a user action or can it be automatic?
						`Runtime selected for notebook`,
					);
				}
			});
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
