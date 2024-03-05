/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { ISettableObservable, observableValue } from 'vs/base/common/observableInternal/base';
import { URI } from 'vs/base/common/uri';
import { ITextModel } from 'vs/editor/common/model';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { localize } from 'vs/nls';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { insertCellAtIndex } from 'vs/workbench/contrib/notebook/browser/controller/cellOperations';
import { IBaseCellEditorOptions, INotebookEditorCreationOptions } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { NotebookViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/notebookViewModelImpl';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { NotebookTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookTextModel';
import { CellEditType, CellKind, ICellOutput, ICellReplaceEdit, SelectionStateType } from 'vs/workbench/contrib/notebook/common/notebookCommon';
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
	 * Attach the notebook view model for the notebook to the instance.
	 * In the future this can/should be placed within this class, but now it's
	 * easiest to do it on render.
	 * @param viewModel NotebookViewModel for the notebook
	 */
	attachViewModel(viewModel: NotebookViewModel): void;

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
	addCell(type: keyof typeof cellTypeToKind, index: number): void;

	/**
	 * Delete a cell from the notebook
	 */
	deleteCell(cell: PositronNotebookCell): void;


}


const cellTypeToKind = {
	'code': CellKind.Code,
	'markdown': CellKind.Markup,
};




export class PositronNotebookInstance extends Disposable implements IPositronNotebookInstance {


	selectedCells: PositronNotebookCell[] = [];
	// executionStatus: 'running' | 'pending' | 'unconfirmed' | 'idle' = 'idle';
	/**
	 * Internal cells that we use to manage the state of the notebook
	 */
	private _cells: PositronNotebookCell[] = [];

	/**
	 * A set of disposables that are linked to a given model
	 * that need to be cleaned up when the model is changed.
	 */
	private _modelStore = this._register(new DisposableStore());



	private language: string | undefined = undefined;
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
		readonly creationOptions: INotebookEditorCreationOptions | undefined,
		@INotebookExecutionService private readonly notebookExecutionService: INotebookExecutionService,
		@INotebookExecutionStateService private readonly notebookExecutionStateService: INotebookExecutionStateService,
		@IContextKeyService public _contextKeyService: IContextKeyService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();

		this.cells = observableValue<PositronNotebookCell[]>('positronNotebookCells', this._cells);

		this.setupNotebookTextModel();
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

	// private _notebookViewModel: NotebookViewModel | undefined = undefined;

	// async setModel(textModel: NotebookTextModel, viewState?: INotebookEditorViewState): Promise<void> {
	// 	if (this._notebookViewModel === undefined || !this._notebookViewModel.equal(textModel)) {
	// 		// Make sure we're working with a fresh model state
	// 		this.detachModel();

	// 		// In the vscode implementation they have a separate _attachModel method that is called
	// 		// but we just inline it here because it's confusing to have both a setModel and
	// 		// attachModel methods when the attachModel method is only called from setModel.

	// 		this._notebookViewModel =
	// 			this.instantiationService.createInstance(
	// 				NotebookViewModel,
	// 				textModel.viewType,
	// 				textModel,
	// 				this._viewContext,
	// 				this.getLayoutInfo(),
	// 				{ isReadOnly: this._readOnly }
	// 			);

	// 		// Emit an event into the view context for layout change so things can get initialized
	// 		// properly.
	// 		this._viewContext.eventDispatcher.emit(
	// 			[new NotebookLayoutChangedEvent({ width: true, fontInfo: true }, this.getLayoutInfo())]
	// 		);

	// 		// Update read only status of notebook. Why here?
	// 		this._notebookOptions.updateOptions(this._readOnly);

	// 		// Bring the view model back to the state it was in when the view state was saved.
	// 		this.getViewModel()?.restoreEditorViewState(viewState);


	// 		const viewModel = this._notebookViewModel;
	// 		if (viewModel) {
	// 			this._localStore.add(viewModel.onDidChangeViewCells(e => {
	// 				this._onDidChangeViewCells.fire(e);
	// 			}));
	// 		}

	// 		this._viewModelObservable.set(viewModel, undefined);

	// 		// Get the kernel up and running for the notebook.
	// 		this.setupKernel();


	// 		// TODO: Finish implementing this.
	// 	} else {

	// 	}


	// }

	detachModel() {
		this._modelStore.clear();
		this._textModel = undefined;
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
		if (!this._textModel) {
			throw new Error(localize('noModel', "No model"));
		}

		for (const cell of cells) {
			cell.executionStatus.set('running', undefined);
		}

		const hasExecutions = [...cells].some(cell => Boolean(this.notebookExecutionStateService.getCellExecution(cell.uri)));

		if (hasExecutions) {
			this.notebookExecutionService.cancelNotebookCells(this._textModel, Array.from(cells).map(c => c.viewModel));
			return;
		}

		if (this._scopedContextKeyService === undefined) {
			throw new Error(localize('noContext', "No scoped context key service"));
		}

		await this.notebookExecutionService.executeNotebookCells(this._textModel, Array.from(cells).map(c => c.viewModel), this._scopedContextKeyService);
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
		if (!this._viewModel) {
			throw new Error(localize('noViewModel', "No view model for notebook"));
		}

		if (!this.language) {
			throw new Error(localize('noLanguage', "No language for notebook"));
		}
		const synchronous = true;
		const pushUndoStop = true;
		insertCellAtIndex(
			this._viewModel,
			index,
			'',
			this.language,
			cellTypeToKind[type],
			undefined,
			[],
			synchronous,
			pushUndoStop

		);
	}

	deleteCell(cell: PositronNotebookCell): void {
		if (!this._textModel) {
			throw new Error(localize('noModelForDelete', "No model for notebook to delete cell from"));
		}

		const textModel = this._textModel;
		// TODO: Hook up readOnly to the notebook actual value
		const readOnly = false;
		const computeUndoRedo = !readOnly || textModel.viewType === 'interactive';
		const cellIndex = textModel.cells.indexOf(cell.viewModel);

		const edits: ICellReplaceEdit = {
			editType: CellEditType.Replace, index: cellIndex, count: 1, cells: []
		};

		const nextCellAfterContainingSelection = textModel.cells[cellIndex + 1] ?? undefined;
		const focusRange = {
			start: cellIndex,
			end: cellIndex + 1
		};

		textModel.applyEdits([edits], true, { kind: SelectionStateType.Index, focus: focusRange, selections: [focusRange] }, () => {
			if (nextCellAfterContainingSelection) {
				const cellIndex = textModel.cells.findIndex(cell => cell.handle === nextCellAfterContainingSelection.handle);
				return { kind: SelectionStateType.Index, focus: { start: cellIndex, end: cellIndex + 1 }, selections: [{ start: cellIndex, end: cellIndex + 1 }] };
			} else {
				if (textModel.length) {
					const lastCellIndex = textModel.length - 1;
					return { kind: SelectionStateType.Index, focus: { start: lastCellIndex, end: lastCellIndex + 1 }, selections: [{ start: lastCellIndex, end: lastCellIndex + 1 }] };

				} else {
					return { kind: SelectionStateType.Index, focus: { start: 0, end: 0 }, selections: [{ start: 0, end: 0 }] };
				}
			}
		}, undefined, computeUndoRedo);

	}

	private _textModel: NotebookTextModel | undefined = undefined;

	private async setupNotebookTextModel() {
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

		const fillCells = () => {

			this._cells = notebookModel.cells.map(cell =>
				this.instantiationService.createInstance(
					PositronNotebookCell,
					cell,
					this
				)
			);

			this.language = notebookModel.cells[0].language;
			this.cells.set(this._cells, undefined);
		};

		fillCells();

		this._textModel = notebookModel;
		console.log('Model resolved: ', this._textModel);

		// TODO: Make sure this is cleaned up properly.
		this._modelStore.add(this._textModel);
		this._modelStore.add(
			this._textModel.onDidChangeContent(() => {
				fillCells();
			})
		);
	}

	/**
	 * Key-value map of language to base cell editor options for cells of that language.
	 */
	_baseCellEditorOptions: Map<string, IBaseCellEditorOptions> = new Map();

	_viewModel: NotebookViewModel | undefined = undefined;
	attachViewModel(viewModel: NotebookViewModel): void {
		this._viewModel = viewModel;
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
	 * Get the text editor model for use in the monaco editor widgets
	 */
	getTextEditorModel(): Promise<ITextModel>;

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

	/**
	 * Delete this cell
	 */
	delete(): void;
}

export class PositronNotebookCell extends Disposable implements IPositronNotebookCell {
	executionStatus: ISettableObservable<ExecutionStatus, void>;
	outputs: ISettableObservable<ICellOutput[], void>;

	constructor(
		public viewModel: NotebookCellTextModel,
		private _instance: IPositronNotebookInstance,
		@ITextModelService private readonly textModelResolverService: ITextModelService,
	) {
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

	delete(): void {
		this._instance.deleteCell(this);
	}

	async getTextEditorModel(): Promise<ITextModel> {
		const modelRef = await this.textModelResolverService.createModelReference(this.uri);
		return modelRef.object.textEditorModel;
	}



	// override dispose() {
	// 	super.dispose();
	// }
}
