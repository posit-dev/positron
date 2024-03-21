/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { ISettableObservable, observableValue } from 'vs/base/common/observableInternal/base';
import { URI } from 'vs/base/common/uri';
import { ITextModel } from 'vs/editor/common/model';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { ICellViewModel } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { CellKind, ICellOutput } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { IPositronNotebookInstance } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookInstance';


type ExecutionStatus = 'running' | 'pending' | 'unconfirmed' | 'idle';


export class PositronNotebookCell extends Disposable implements IPositronNotebookCell {
	executionStatus: ISettableObservable<ExecutionStatus, void>;
	outputs: ISettableObservable<ICellOutput[], void>;

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

	get kind(): CellKind {
		return this.cellModel.cellKind;
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
}

/**
 * Wrapper class for notebook cell that exposes the properties that the UI needs to render the cell.
 */
export interface IPositronNotebookCell {

	/**
	 * Is the cell a code or markup cell?
	 */
	get kind(): CellKind;

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

export interface IPositronNotebookCodeCell extends IPositronNotebookCell {
	kind: CellKind.Code;
}

export function isCodeCell(cell: IPositronNotebookCell): cell is IPositronNotebookCodeCell {
	return cell.kind === CellKind.Code;
}

export interface IPositronNotebookMarkupCell extends IPositronNotebookCell {
	kind: CellKind.Markup;
}

export function isMarkupCell(cell: IPositronNotebookCell): cell is IPositronNotebookMarkupCell {
	return cell.kind === CellKind.Markup;
}


