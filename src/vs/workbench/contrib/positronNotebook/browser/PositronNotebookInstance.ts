/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { ISettableObservable, observableValue } from 'vs/base/common/observableInternal/base';
import { URI } from 'vs/base/common/uri';
import { ITextModel } from 'vs/editor/common/model';
import { localize } from 'vs/nls';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { NotebookTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookTextModel';
import { ICellOutput } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { INotebookExecutionService } from 'vs/workbench/contrib/notebook/common/notebookExecutionService';
import { INotebookExecutionStateService } from 'vs/workbench/contrib/notebook/common/notebookExecutionStateService';
import { PositronNotebookEditor } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookEditor';
import { PositronNotebookEditorInput } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookEditorInput';


type ExecutionStatus = 'running' | 'pending' | 'unconfirmed' | 'idle';
/**
 * A headless instance that controls the complexity of the notebook.
 * This is where all the logic and state for the notebooks is controlled and encapsulated.
 * This is then given to the UI to render.
 */
interface IPositronNotebookInstance {

	/**
	 * URI of the notebook file being edited
	 */
	get uri(): URI;

	/**
	 * The cells that make up the notebook
	 */
	cells: ISettableObservable<PositronNotebookCell[]>;

	/**
	 * The currently selected cells. Typically a single cell but can be multiple cells.
	 */
	selectedCells: PositronNotebookCell[];

	/**
	 * The current execution status for the notebook. This is derived via the cells status
	 */
	// executionStatus: IPositronNotebookCell['executionStatus'];

	/**
	 * Hook up the instance with an editor. This is used to allow things like scoped context keys
	 * that require things like DOM nodes to be available.
	 * @param editor The editor to attach the notebook to
	 */
	attachToEditor(editor: PositronNotebookEditor): void;

	/**
	 * Detach the instance from the editor. This is used to clean up any resources that were
	 * attached to the editor and also prevent the notebook from executing when there would be no
	 * output.
	 */
	detachFromEditor(): void;


	// Methods for interacting with the notebook

	/**
	 * Run the given cells
	 * @param cells The cells to run
	 */
	runCells(cells: PositronNotebookCell[]): Promise<void>;

	/**
	 * Run the selected cells
	 */
	runSelectedCells(): Promise<void>;

	/**
	 * Run all cells in the notebook
	 */
	runAllCells(): Promise<void>;

	/**
	 * Add a new cell of a given type to the notebook at the requested index
	 */
	addCell(type: 'code' | 'markdown', index: number): void;
}




export class PositronNotebookInstance extends Disposable implements IPositronNotebookInstance {

	selectedCells: PositronNotebookCell[] = [];
	// executionStatus: 'running' | 'pending' | 'unconfirmed' | 'idle' = 'idle';
	/**
	 * Internal cells that we use to manage the state of the notebook
	 */
	private _cells: PositronNotebookCell[] = [];
	/**
	 * User facing cells wrapped in an observerable for the UI to react to changes
	 */
	cells: ISettableObservable<PositronNotebookCell[]>;

	// private _editor: PositronNotebookEditor | undefined;

	/**
	 * Constructor.
	 * @param _input The editor input for the notebook
	 */
	constructor(
		public _input: PositronNotebookEditorInput,
		@INotebookExecutionService private readonly notebookExecutionService: INotebookExecutionService,
		@INotebookExecutionStateService private readonly notebookExecutionStateService: INotebookExecutionStateService,
		@IContextKeyService public _contextKeyService: IContextKeyService,

	) {
		super();

		this.cells = observableValue<PositronNotebookCell[]>('positronNotebookCells', this._cells);

		this.setupViewModel();
		console.log('PositronNotebookInstance created for: ', this._input);
	}

	/**
	 * Context key service scoped to the dom note the notebook is rendered in.
	 */
	_scopedContextKeyService: IContextKeyService | undefined;

	attachToEditor(editor: PositronNotebookEditor): void {

		console.log('Attach to editor', editor);
		if (!editor._parentDiv) {
			throw new Error(localize(
				'noParentDiv',
				"No parent div for editor to create scoped context key service with."
			));
		}
		// Create a new context service that has the output overlay container as the root element.
		this._scopedContextKeyService = this._contextKeyService.createScoped(editor._parentDiv);
	}

	detachFromEditor(): void {
		this._scopedContextKeyService = undefined;
	}

	get uri(): URI {
		return this._input.resource;
	}

	async runCells(cells: PositronNotebookCell[]): Promise<void> {

		if (!cells) {
			throw new Error(localize('noCells', "No cells to run"));
		}
		await this._runCells(cells);
	}

	async runAllCells(): Promise<void> {
		await this._runCells(this._cells);
	}

	async runSelectedCells(): Promise<void> {
		await this._runCells(this.selectedCells);
	}

	/**
	 * Internal method to run cells, used by other cell running methods.
	 * @param cells Cells to run
	 * @returns
	 */
	private async _runCells(cells: PositronNotebookCell[]): Promise<void> {
		if (!this._viewModel) {
			throw new Error(localize('noModel', "No model"));
		}

		for (const cell of cells) {
			cell.executionStatus.set('running', undefined);
		}

		const hasExecutions = [...cells].some(cell => Boolean(this.notebookExecutionStateService.getCellExecution(cell.uri)));

		if (hasExecutions) {
			this.notebookExecutionService.cancelNotebookCells(this._viewModel, Array.from(cells).map(c => c.viewModel));
			return;
		}

		if (this._scopedContextKeyService === undefined) {
			throw new Error(localize('noContext', "No scoped context key service"));
		}

		await this.notebookExecutionService.executeNotebookCells(this._viewModel, Array.from(cells).map(c => c.viewModel), this._scopedContextKeyService);
		for (const cell of cells) {
			cell.executionStatus.set('idle', undefined);
		}
	}

	/**
	 * A context key service for the notebook. Right now this is entirely unused but is needed as an
	 * argument to the executeNotebookCells method
	 */
	contextKeyService: IContextKeyService | undefined = undefined;


	addCell(type: 'code' | 'markdown', index: number): void {
		throw new Error('Method not implemented.');
	}

	private _viewModel: NotebookTextModel | undefined = undefined;
	private async setupViewModel() {
		const model = await this._input.resolve();
		if (model === null) {
			throw new Error(
				localize(
					'fail.noModel',
					'Failed to find a model for view type {0}.',
					this._input.viewType
				)
			);
		}

		const notebookModel = model.notebook;
		this._cells = notebookModel.cells.map(cell =>
			new PositronNotebookCell(cell, this)
		);
		this.cells.set(this._cells, undefined);

		this._viewModel = notebookModel;
		console.log('Model resolved: ', this._viewModel);
	}
}



/**
 * Wrapper class for notebook cell that exposes the properties that the UI needs to render the cell.
 */
interface IPositronNotebookCell {

	/**
	 * Cell specific uri for the cell within the notebook
	 */
	get uri(): URI;

	/**
	 * The content of the cell. This is the raw text of the cell.
	 */
	getContent(): string;

	/**
	 * The view model for the cell.
	 */
	viewModel: NotebookCellTextModel;

	/**
	 * The text model for the cell. This is needed for the monaco editor widgets
	 */
	textModel?: ITextModel;

	/**
	 * Current execution status for this cell
	 */
	executionStatus: ISettableObservable<ExecutionStatus, void>;

	/**
	 * Current cell outputs as an observable
	 */
	outputs: ISettableObservable<ICellOutput[], void>;

	/**
	 * Run this cell
	 */
	run(): void;
}

export class PositronNotebookCell extends Disposable implements IPositronNotebookCell {
	executionStatus: ISettableObservable<ExecutionStatus, void>;
	outputs: ISettableObservable<ICellOutput[], void>;

	constructor(public viewModel: NotebookCellTextModel, private _instance: IPositronNotebookInstance) {
		super();
		this.executionStatus = observableValue<ExecutionStatus, void>('cellExecutionStatus', 'idle');
		this.outputs = observableValue<ICellOutput[], void>('cellOutputs', this.viewModel.outputs);

		// Listen for changes to the cell outputs and update the observable
		this._register(
			this.viewModel.onDidChangeOutputs(() => {
				// By unpacking the array and repacking we make sure that
				// the React component will rerender when the outputs change. Probably not
				// great to have this leak here.
				this.outputs.set([...this.viewModel.outputs], undefined);
			})
		);
	}

	get uri(): URI {
		return this.viewModel.uri;
	}

	getContent(): string {
		return this.viewModel.getValue();
	}

	run(): void {
		this._instance.runCells([this]);
	}

	// override dispose() {
	// 	super.dispose();
	// }
}
