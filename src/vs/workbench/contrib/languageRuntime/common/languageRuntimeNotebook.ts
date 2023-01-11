/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { ILogService } from 'vs/platform/log/common/log';
import { ILanguageRuntime, ILanguageRuntimeMessageError, ILanguageRuntimeMessageEvent, ILanguageRuntimeInfo, ILanguageRuntimeMessage, ILanguageRuntimeMetadata, ILanguageRuntimeMessageOutput, ILanguageRuntimeMessagePrompt, ILanguageRuntimeMessageState, IRuntimeClientInstance, LanguageRuntimeHistoryType, LanguageRuntimeMessageType, LanguageRuntimeStartupBehavior, RuntimeClientType, RuntimeCodeFragmentStatus, RuntimeOnlineState, RuntimeState, ILanguageRuntimeMessageInput } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { NotebookTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookTextModel';
import { CellEditType, CellKind } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { INotebookExecutionStateService } from 'vs/workbench/contrib/notebook/common/notebookExecutionStateService';
import { INotebookKernel, INotebookKernelService } from 'vs/workbench/contrib/notebook/common/notebookKernelService';
import { INotebookService } from 'vs/workbench/contrib/notebook/common/notebookService';

/**
 * Class that implements the ILanguageRuntime interface by wrapping INotebookKernel
 */
export class NotebookLanguageRuntime extends Disposable implements ILanguageRuntime {

	/** The notebook text model */
	private _nbTextModel: NotebookTextModel;

	/** The URI for the "notebook" backing the kernel */
	private _uri: URI;

	/** The ID for the currently executing "cell" */
	private _executingCellId?: string;

	/** Counter for REPLs; used to generate unique URIs */
	private static _replCounter = 0;

	/** Counter for messages; used to generate unique message IDs */
	private static _msgCounter = 0;

	/** Emitter for runtime messages */
	private readonly _messages: Emitter<ILanguageRuntimeMessage>;

	/** Emitter for runtime state changes */
	private readonly _state: Emitter<RuntimeState>;

	/** Emitter for runtime startup event */
	private readonly _startup: Emitter<ILanguageRuntimeInfo>;

	private readonly _onDidReceiveRuntimeMessageOutputEmitter = new Emitter<ILanguageRuntimeMessageOutput>();
	private readonly _onDidReceiveRuntimeMessageInputEmitter = new Emitter<ILanguageRuntimeMessageInput>();
	private readonly _onDidReceiveRuntimeMessageErrorEmitter = new Emitter<ILanguageRuntimeMessageError>();
	private readonly _onDidReceiveRuntimeMessagePromptEmitter = new Emitter<ILanguageRuntimeMessagePrompt>();
	private readonly _onDidReceiveRuntimeMessageStateEmitter = new Emitter<ILanguageRuntimeMessageState>();
	private readonly _onDidReceiveRuntimeMessageEventEmitter = new Emitter<ILanguageRuntimeMessageEvent>();

	private _currentState: RuntimeState = RuntimeState.Uninitialized;

	constructor(private readonly _kernel: INotebookKernel,
		@INotebookKernelService private readonly _notebookKernelService: INotebookKernelService,
		@INotebookService private readonly _notebookService: INotebookService,
		@INotebookExecutionStateService private readonly _notebookExecutionStateService: INotebookExecutionStateService,
		@ILogService private readonly _logService: ILogService) {

		// Initialize base disposable functionality
		super();

		// The NotebookKernel interface doesen't have any notion of the language
		// version, so use 1.0 as the default.
		this.metadata = {
			version: '1.0',
			id: _kernel.id,
			language: _kernel.supportedLanguages[0],
			name: `${this._kernel.label} - ${this._kernel.description} [Notebook Bridge]`,
			startupBehavior: LanguageRuntimeStartupBehavior.Implicit
		};

		this._messages = this._register(new Emitter<ILanguageRuntimeMessage>());
		this.onDidReceiveRuntimeMessage = this._messages.event;

		this._state = this._register(new Emitter<RuntimeState>());
		this.onDidChangeRuntimeState = this._state.event;

		this._startup = this._register(new Emitter<ILanguageRuntimeInfo>());
		this.onDidCompleteStartup = this._startup.event;

		// Listen to our own messages and track current state
		this.onDidChangeRuntimeState((state) => {
			this._currentState = state;

			// When moving into the ready state, emit a startup event
			if (state === RuntimeState.Ready) {
				this._startup.fire({
					banner: `${this._kernel.label} [Notebook Kernel]`,
					implementation_version: '0.1.0',
					language_version: this.metadata.version
				});
			}
		});

		// Copy the kernel's ID as the runtime's ID

		// Create a unique URI for the notebook backing the kernel. Looks like:
		//  repl://python-1,
		//  repl://python-2, etc.
		this._uri = URI.parse('repl:///' +
			this.metadata.language +
			'-' +
			NotebookLanguageRuntime._replCounter++);

		this._nbTextModel = this._notebookService.createNotebookTextModel(
			// TODO: do we need our own view type? seems ideal
			'interactive',
			this._uri,
			{
				cells: [{
					source: '',
					language: this.metadata.language,
					mime: `application/${this.metadata.language}`,
					cellKind: CellKind.Code,
					outputs: [],
					metadata: {}
				}],
				metadata: {}
			}, // data
			{
				transientOutputs: false,
				transientCellMetadata: {},
				transientDocumentMetadata: {},
				cellContentMetadata: {}
			} // options
		);

		// Bind the kernel we were given to the notebook text model we just created
		this._notebookKernelService.selectKernelForNotebook(this._kernel, this._nbTextModel);

		// Listen for execution state changes
		this._notebookExecutionStateService.onDidChangeCellExecution((e) => {
			// There's no way to subscribe to notifications for a particular notebook, so
			// just ignore execution state changes for other notebooks.
			if (!e.affectsNotebook(this._uri)) {
				return;
			}

			// Ignore any execution state changes when we aren't tracking a cell execution
			if (!this._executingCellId) {
				return;
			}

			// The new state will be 'undefined' when the cell is no longer executing;
			// set the language runtime state to 'idle' in that case.
			if (typeof e.changed === 'undefined') {
				this._state.fire(RuntimeState.Idle);
				this._logService.trace(`Cell execution of ${e.cellHandle} (${this._executingCellId}) complete`);

				this._messages.fire({
					type: LanguageRuntimeMessageType.State,
					id: 'status-' + NotebookLanguageRuntime._msgCounter++,
					parent_id: this._executingCellId,
					state: RuntimeOnlineState.Idle,
				} as ILanguageRuntimeMessageState);

				this._onDidReceiveRuntimeMessageStateEmitter.fire({
					type: LanguageRuntimeMessageType.State,
					id: 'status-' + NotebookLanguageRuntime._msgCounter++,
					parent_id: this._executingCellId,
					state: RuntimeOnlineState.Idle,
				});

				// Clear the cell execution state
				this._executingCellId = '';
			} else {
				this._state.fire(RuntimeState.Busy);
			}
		});
	}

	getExecutionHistory(type: LanguageRuntimeHistoryType, max: number): Thenable<string[][]> {
		// Notebook kernels don't expose this functionality, so return an empty
		// array
		return Promise.resolve([]);
	}

	isCodeFragmentComplete(code: string): Thenable<RuntimeCodeFragmentStatus> {
		// Notebook kernels don't expose this functionality, so assume all code
		// to be complete. The consequence of this folly is that incomplete code
		// fragments will evaluate to an error, which we can live with.
		return Promise.resolve(RuntimeCodeFragmentStatus.Complete);
	}

	onDidCompleteStartup: Event<ILanguageRuntimeInfo>;

	onDidReceiveRuntimeMessage: Event<ILanguageRuntimeMessage>;

	onDidChangeRuntimeState: Event<RuntimeState>;

	onDidReceiveRuntimeMessageOutput = this._onDidReceiveRuntimeMessageOutputEmitter.event;
	onDidReceiveRuntimeMessageInput = this._onDidReceiveRuntimeMessageInputEmitter.event;
	onDidReceiveRuntimeMessageError = this._onDidReceiveRuntimeMessageErrorEmitter.event;
	onDidReceiveRuntimeMessagePrompt = this._onDidReceiveRuntimeMessagePromptEmitter.event;
	onDidReceiveRuntimeMessageState = this._onDidReceiveRuntimeMessageStateEmitter.event;
	onDidReceiveRuntimeMessagesEvent = this._onDidReceiveRuntimeMessageEventEmitter.event;

	metadata: ILanguageRuntimeMetadata;

	/**
	 * "Starts" the notebook kernel
	 * @returns Promise that resolves when the kernel is ready to execute code (immediately)
	 */
	start(): Thenable<ILanguageRuntimeInfo> {
		// We don't have the ability to start/stop the notebook kernel; it's all
		// managed (invisibly) in the notebook kernel service, so just return a
		// resolved promise. The kernel will be started when the notebook is first
		// asked to execute code.
		return Promise.resolve({
			banner: '',
			language_version: this.metadata.version,
			implementation_version: '1.0',
		} as ILanguageRuntimeInfo);
	}

	/** Gets the current state of the notebook runtime */
	getRuntimeState(): RuntimeState {
		return this._currentState;
	}

	execute(code: string, id: string): Thenable<string> {

		// Ensure we aren't already executing a cell
		if (this._executingCellId) {
			this._logService.error(`Cell execution of ${this._executingCellId} already in progress`);
			throw new Error(`Cell execution of ${this._executingCellId}  already in progress`);
		}

		// Replace the "cell" contents with what the user entered
		this._nbTextModel.applyEdits([{
			editType: CellEditType.Replace,
			cells: [{
				source: code,
				language: this.metadata.language,
				mime: `text/${this.metadata.language}`,
				cellKind: CellKind.Code,
				outputs: [],
				metadata: {}
			}],
			count: 1,
			index: 0
		}],
			true, // Synchronous
			undefined,
			() => undefined,
			undefined,
			false);

		const cell = this._nbTextModel?.cells[0]!;
		cell.onDidChangeOutputs((e) => {
			const data: { [k: string]: any } = {};

			// Build map of all outputs
			for (const output of e.newOutputs) {
				for (const o of output.outputs) {
					// TODO: should we really be converting from VSBuffer to a
					// string?
					data[o.mime] = o.data.toString();
				}
			}

			// Emit a message describing the outputs
			this._messages.fire({
				type: LanguageRuntimeMessageType.Output,
				id: 'output-' + NotebookLanguageRuntime._msgCounter++,
				parent_id: id,
				data: data
			} as ILanguageRuntimeMessageOutput);

			this._onDidReceiveRuntimeMessageOutputEmitter.fire({
				type: LanguageRuntimeMessageType.Output,
				id: 'output-' + NotebookLanguageRuntime._msgCounter++,
				parent_id: id,
				data: data as any
			});
		});

		// Create a cell execution to track the execution of this code fragment
		const exe = this._notebookExecutionStateService.createCellExecution(this._uri, cell.handle);
		if (!exe) {
			throw new Error(`Cannot create cell execution state for code: ${code}`);
		}

		// Ask the kernel to execute the cell
		this._kernel.executeNotebookCellsRequest(this._uri, [exe.cellHandle]);

		// Save and return the ID for the cell execution
		this._executingCellId = id;
		return new Promise((resolve, reject) => {
			resolve(id);
		});
	}

	createClient(type: RuntimeClientType): Thenable<IRuntimeClientInstance> {
		// This notebook API doesn't support creating clients
		throw new Error('Method not implemented.');
	}

	listClients(): Thenable<IRuntimeClientInstance[]> {
		// It is not possible to create clients in this notebook API,
		// so just return an empty list
		return new Promise((resolve, _reject) => {
			resolve([]);
		});
	}

	replyToPrompt(id: string, value: string): void {
		// This notebook API doesn't support prompting the user for input
		throw new Error('Method not implemented.');
	}

	interrupt(): void {
		// Notebook kernel liftime is managed elsewhere
		throw new Error('Method not implemented.');
	}

	restart(): void {
		// Notebook kernel liftime is managed elsewhere
		throw new Error('Method not implemented.');
	}

	shutdown(): void {
		// Notebook kernel liftime is managed elsewhere
		throw new Error('Method not implemented.');
	}
}
