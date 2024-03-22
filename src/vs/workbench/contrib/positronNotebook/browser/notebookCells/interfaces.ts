/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { ISettableObservable } from 'vs/base/common/observableInternal/base';
import { URI } from 'vs/base/common/uri';
import { ITextModel } from 'vs/editor/common/model';
import { ICellViewModel } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { CellKind, ICellOutput } from 'vs/workbench/contrib/notebook/common/notebookCommon';

export type ExecutionStatus = 'running' | 'pending' | 'unconfirmed' | 'idle';

/**
 * Wrapper class for notebook cell that exposes the properties that the UI needs to render the cell.
 * This interface is extended to provide the specific properties for code and markup cells.
 */
export interface IPositronNotebookGeneralCell extends Disposable {

	/**
	 * The kind of cell
	 */
	kind: CellKind;

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
	 * Delete this cell
	 */
	delete(): void;
}


/**
 * Cell that contains code that can be executed
 */
export interface IPositronNotebookCodeCell extends IPositronNotebookGeneralCell {
	kind: CellKind.Code;

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

export function isCodeCell(cell: IPositronNotebookGeneralCell): cell is IPositronNotebookCodeCell {
	return cell.kind === CellKind.Code;
}


/**
 * Cell that contains markup content
 */
export interface IPositronNotebookMarkupCell extends IPositronNotebookGeneralCell {
	kind: CellKind.Markup;
	renderedHtml: ISettableObservable<string | undefined>;
}

export function isMarkupCell(cell: IPositronNotebookGeneralCell): cell is IPositronNotebookMarkupCell {
	return cell.kind === CellKind.Markup;
}

