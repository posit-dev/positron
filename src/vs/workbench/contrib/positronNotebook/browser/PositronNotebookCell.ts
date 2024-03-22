/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns
import { marked } from 'marked';

import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { ISettableObservable, observableValue } from 'vs/base/common/observableInternal/base';
import { URI } from 'vs/base/common/uri';
import { ITextModel } from 'vs/editor/common/model';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ICellViewModel } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { CellKind, ICellOutput } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { IPositronNotebookInstance } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookInstance';


type ExecutionStatus = 'running' | 'pending' | 'unconfirmed' | 'idle';


class PositronNotebookCellGeneral extends Disposable implements IPositronNotebookGeneralCell {
	executionStatus: ISettableObservable<ExecutionStatus, void>;
	outputs: ISettableObservable<ICellOutput[], void>;

	// Not marked as private so we can access it in subclasses
	_disposableStore = new DisposableStore();

	constructor(
		public cellModel: NotebookCellTextModel,
		private _instance: IPositronNotebookInstance,
		@ITextModelService private readonly textModelResolverService: ITextModelService,
	) {
		super();
		this.executionStatus = observableValue<ExecutionStatus, void>('cellExecutionStatus', 'idle');
		this.outputs = observableValue<ICellOutput[], void>('cellOutputs', this.cellModel.outputs);

		// Listen for changes to the cell outputs and update the observable
		this._register(
			this.cellModel.onDidChangeOutputs(() => {
				// By unpacking the array and repacking we make sure that
				// the React component will rerender when the outputs change. Probably not
				// great to have this leak here.
				this.outputs.set([...this.cellModel.outputs], undefined);
			})
		);
	}

	get uri(): URI {
		return this.cellModel.uri;
	}

	get viewModel(): ICellViewModel {

		const notebookViewModel = this._instance.viewModel;
		if (!notebookViewModel) {
			throw new Error('Notebook view model not found');
		}

		const viewCells = notebookViewModel.viewCells;

		const cell = viewCells.find(cell => cell.uri.toString() === this.cellModel.uri.toString());

		if (cell) {
			return cell;
		}

		throw new Error('Cell view model not found');
	}

	getContent(): string {
		return this.cellModel.getValue();
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

	override dispose(): void {
		this._disposableStore.dispose();
		super.dispose();
	}
}

/**
 * Wrapper class for notebook cell that exposes the properties that the UI needs to render the cell.
 * This interface is extended to provide the specific properties for code and markup cells.
 */
export interface IPositronNotebookGeneralCell extends Disposable {

	/**
	 * Cell specific uri for the cell within the notebook
	 */
	get uri(): URI;

	/**
	 * The content of the cell. This is the raw text of the cell.
	 */
	getContent(): string;

	/**
	 * The notebook text model for the cell.
	 */
	cellModel: NotebookCellTextModel;

	/**
	 * Get the view model for the cell
	 */
	get viewModel(): ICellViewModel;

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

/**
 * Cell that contains code that can be executed
 */
export interface IPositronNotebookCodeCell extends IPositronNotebookGeneralCell {
	kind: CellKind.Code;
}

class PositronNotebookCodeCell extends PositronNotebookCellGeneral implements IPositronNotebookCodeCell {
	kind: CellKind.Code = CellKind.Code;
}


/**
 * Cell that contains markup content
 */
export interface IPositronNotebookMarkupCell extends IPositronNotebookGeneralCell {
	kind: CellKind.Markup;
	renderedHtml: ISettableObservable<string | undefined>;
}

class PositronNotebookMarkupCell extends PositronNotebookCellGeneral implements IPositronNotebookMarkupCell {

	renderedHtml: ISettableObservable<string | undefined> = observableValue<string | undefined, void>('renderedHTML', undefined);
	kind: CellKind.Markup = CellKind.Markup;

	constructor(
		cellModel: NotebookCellTextModel,
		instance: IPositronNotebookInstance,
		textModelResolverService: ITextModelService,
	) {
		super(cellModel, instance, textModelResolverService);

		// Render the markdown content and update the observable when the cell content changes
		this._disposableStore.add(this.cellModel.onDidChangeContent(() => {
			this._renderContent();
		}));

		this._renderContent();
	}

	private _renderContent(): void {
		const renderedHtml = marked(this.getContent());
		if (typeof renderedHtml !== 'string') {
			throw new Error('Notebooks do not support async markdown rendering yet.');
		}
		this.renderedHtml.set(renderedHtml, undefined);
	}
}

/**
 * Instantiate a notebook cell based on the cell's kind
 * @param cell Text model for the cell
 * @param instance The containing Positron notebook instance that this cell resides in.
 * @param instantiationService The instantiation service to use to create the cell
 * @returns The instantiated notebook cell of the correct type.
 */
export function createNotebookCell(cell: NotebookCellTextModel, instance: IPositronNotebookInstance, instantiationService: IInstantiationService): IPositronNotebookGeneralCell {
	if (cell.cellKind === CellKind.Code) {
		return instantiationService.createInstance(PositronNotebookCodeCell, cell, instance);
	} else {
		return instantiationService.createInstance(PositronNotebookMarkupCell, cell, instance);
	}
}



