/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { ISettableObservable } from 'vs/base/common/observableInternal/base';
import { URI } from 'vs/base/common/uri';
import { CodeEditorWidget } from 'vs/editor/browser/widget/codeEditor/codeEditorWidget';
import { ITextModel } from 'vs/editor/common/model';
import { ICellViewModel } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { CellKind, ICellOutput } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { CellSelectionType } from 'vs/workbench/contrib/positronNotebook/browser/notebookCells/selectionMachine';

export type ExecutionStatus = 'running' | 'pending' | 'unconfirmed' | 'idle';


/**
 * Wrapper class for notebook cell that exposes the properties that the UI needs to render the cell.
 * This interface is extended to provide the specific properties for code and markdown cells.
 */
export interface IPositronNotebookCell extends Disposable {

	/**
	 * The kind of cell
	 */
	kind: CellKind;

	/**
	 * Cell specific uri for the cell within the notebook
	 */
	get uri(): URI;

	/**
	 * URI for the notebook that contains this cell
	 */
	get notebookUri(): URI;

	/**
	 * Is this cell selected?
	 */
	selected: ISettableObservable<boolean>;

	/**
	 * Is this cell currently being edited?
	 */
	editing: ISettableObservable<boolean>;

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

	/**
	 * Run this cell
	 */
	run(): void;

	/**
	 * Type guard for checking if cell is a markdown cell
	 */
	isMarkdownCell(): this is IPositronNotebookMarkdownCell;

	/**
	 * Type guard for checking if cell is a code cell
	 */
	isCodeCell(): this is IPositronNotebookCodeCell;

	/**
	 * Select this cell
	 * @param type The type of selection to apply. E.g. an editing selection or a normal selection.
	 */
	select(type: CellSelectionType): void;

	/**
	 * Set focus to this cell
	 */
	focus(): void;

	/**
	 * Set focus on the editor within the cell
	 */
	focusEditor(): void;

	/**
	 * Remove focus from within monaco editor and out to the cell itself
	 */
	defocusEditor(): void;

	/**
	 * Deselect this cell
	 */
	deselect(): void;

	/**
	 * Attach the cell to a container. Used for things like focus management
	 * @param container Element that the cell is rendered into.
	 */
	attachContainer(container: HTMLElement): void;

	/**
	 * Attach the editor widget to the cell
	 * @param editor Code editor widget associated with cell.
	 */
	attachEditor(editor: CodeEditorWidget): void;

	/**
	 * Detach the editor from the cell
	 */
	detachEditor(): void;
}


/**
 * Cell that contains code that can be executed
 */
export interface IPositronNotebookCodeCell extends IPositronNotebookCell {
	kind: CellKind.Code;

	/**
	 * Current execution status for this cell
	 */
	executionStatus: ISettableObservable<ExecutionStatus, void>;

	/**
	 * Current cell outputs as an observable
	 */
	outputs: ISettableObservable<ICellOutput[], void>;
}



/**
 * Cell that contains markdown content
 */
export interface IPositronNotebookMarkdownCell extends IPositronNotebookCell {
	kind: CellKind.Markup;

	/**
	 * Observable content of cell. Equivalent to the cell's content, but as an observable
	 */
	markdownString: ISettableObservable<string | undefined>;

	/**
	 * Observable that indicates whether the editor is currently shown
	 */
	editorShown: ISettableObservable<boolean>;

	/**
	 * Toggle the editor for this cell
	 */
	toggleEditor(): void;
}

