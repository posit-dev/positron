/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { ISettableObservable, observableValue } from 'vs/base/common/observableInternal/base';
import { URI } from 'vs/base/common/uri';
import { ITextModel } from 'vs/editor/common/model';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { ICellOutput } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { IPositronNotebookInstance } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookInstance';


type ExecutionStatus = 'running' | 'pending' | 'unconfirmed' | 'idle';


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
