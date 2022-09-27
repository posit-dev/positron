/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { ILogService } from 'vs/platform/log/common/log';
import { ILanguageRuntime, ILanguageRuntimeInfo, ILanguageRuntimeMessage, ILanguageRuntimeOutput, ILanguageRuntimeState, LanguageRuntimeMessageType, RuntimeOnlineState, RuntimeState } from 'vs/workbench/contrib/languageRuntime/common/languageRuntimeService';
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

	constructor(private readonly _kernel: INotebookKernel,
		@INotebookKernelService private readonly _notebookKernelService: INotebookKernelService,
		@INotebookService private readonly _notebookService: INotebookService,
		@INotebookExecutionStateService private readonly _notebookExecutionStateService: INotebookExecutionStateService,
		@ILogService private readonly _logService: ILogService) {

		// Initialize base disposable functionality
		super();

		this.language = this._kernel.supportedLanguages[0];
		this.name = this._kernel.label;

		// The NotebookKernel interface doesen't have any notion of the language
		// version, so use 1.0 as the default.
		this.version = '1.0';

		this.messages = this._register(new Emitter<ILanguageRuntimeMessage>());

		this.state = this._register(new Emitter<RuntimeState>());

		// Copy the kernel's ID as the runtime's ID
		this.id = this._kernel.id;

		// Create a unique URI for the notebook backing the kernel. Looks like:
		//  repl://python-1,
		//  repl://python-2, etc.
		this._uri = URI.parse('repl:///' +
			this.language +
			'-' +
			NotebookLanguageRuntime._replCounter++);

		this._nbTextModel = this._notebookService.createNotebookTextModel(
			// TODO: do we need our own view type? seems ideal
			'interactive',
			this._uri,
			{
				cells: [{
					source: '',
					language: this.language,
					mime: `application/${this.language}`,
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
				this.state.fire(RuntimeState.Idle);
				this._logService.trace(`Cell execution of ${e.cellHandle} (${this._executingCellId}) complete`);
				this.messages.fire({
					type: LanguageRuntimeMessageType.State,
					id: 'status-' + NotebookLanguageRuntime._msgCounter++,
					parent_id: this._executingCellId,
					state: RuntimeOnlineState.Idle,
				} as ILanguageRuntimeState);

				// Clear the cell execution state
				this._executingCellId = '';
			} else {
				this.state.fire(RuntimeState.Busy);
			}
		});
	}

	state: Emitter<RuntimeState>;

	language: string;

	name: string;

	version: string;

	messages: Emitter<ILanguageRuntimeMessage>;

	id: string;

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
			language_version: this.version,
			implementation_version: '1.0',
		} as ILanguageRuntimeInfo);
	}

	execute(code: string): Thenable<string> {

		// Ensure we aren't already executing a cell
		if (this._executingCellId) {
			this._logService.error(`Cell execution of ${this._executingCellId} already in progress`);
			throw new Error(`Cell execution of ${this._executingCellId}  already in progress`);
		}

		// Create a unique execution ID.
		const id = 'cell-exe-' + NotebookLanguageRuntime._msgCounter++;

		// Replace the "cell" contents with what the user entered
		this._nbTextModel.applyEdits([{
			editType: CellEditType.Replace,
			cells: [{
				source: code,
				language: this.language,
				mime: `text/${this.language}`,
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
			const data = new Map<string, string>();

			// Build map of all outputs
			for (const output of e.newOutputs) {
				for (const o of output.outputs) {
					// TODO: should we really be converting from VSBuffer to a
					// string?
					data.set(o.mime, o.data.toString());
				}
			}

			// Emit a message describing the outputs
			this.messages.fire({
				type: 'output',
				id: 'output-' + NotebookLanguageRuntime._msgCounter++,
				parent_id: id,
				data: data
			} as ILanguageRuntimeOutput);
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

	interrupt(): void {
		throw new Error('Method not implemented.');
	}

	restart(): void {
		throw new Error('Method not implemented.');
	}

	shutdown(): void {
		throw new Error('Method not implemented.');
	}
}
