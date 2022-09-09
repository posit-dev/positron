/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { ILanguageRuntime, ILanguageRuntimeMessage } from 'vs/workbench/contrib/languageRuntime/common/languageRuntimeService';
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

	/** Counter for REPLs; used to generate unique URIs */
	private static _replCounter = 0;

	/** Counter for executions; used to generate unique execution IDs */
	private static _executionCounter = 0;

	constructor(private readonly _kernel: INotebookKernel,
		@INotebookKernelService private readonly _notebookKernelService: INotebookKernelService,
		@INotebookService private readonly _notebookService: INotebookService,
		@INotebookExecutionStateService private readonly _notebookExecutionStateService: INotebookExecutionStateService,
	) {

		// Initialize base disposable functionality
		super();

		this.language = this._kernel.supportedLanguages[0];
		this.name = this._kernel.label;

		// The NotebookKernel interface doesen't have any notion of the language
		// version, so use 1.0 as the default.
		this.version = '1.0';

		this.messages = this._register(new Emitter<ILanguageRuntimeMessage>());

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
				transientDocumentMetadata: {}
			} // options
		);

		// Bind the kernel we were given to the notebook text model we just created
		this._notebookKernelService.selectKernelForNotebook(this._kernel, this._nbTextModel);
	}

	language: string;

	name: string;

	version: string;

	messages: Emitter<ILanguageRuntimeMessage>;

	execute(code: string): Thenable<string> {

		// Create a unique execution ID.
		const id = 'cell-exe-' + NotebookLanguageRuntime._executionCounter++;

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
			// TODO: handle output changes
		});

		const exe = this._notebookExecutionStateService.createCellExecution(this._uri, cell.handle);
		if (!exe) {
			throw new Error(`Cannot create cell execution state for code: ${code}`);
		}

		// Ask the kernel to execute the cell
		this._kernel.executeNotebookCellsRequest(this._uri, [exe.cellHandle]);

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
