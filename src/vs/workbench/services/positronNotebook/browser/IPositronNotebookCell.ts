/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ISettableObservable } from '../../../../base/common/observableInternal/base.js';
import { URI } from '../../../../base/common/uri.js';
import { CodeEditorWidget } from '../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { NotebookPreloadOutputResults } from '../../positronWebviewPreloads/browser/positronWebviewPreloadService.js';

export type ExecutionStatus = 'running' | 'pending' | 'unconfirmed' | 'idle';

export enum CellSelectionStatus {
	Unselected = 'unselected',
	Selected = 'selected',
	Editing = 'editing'
}

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
	 * Current execution status for this cell
	 */
	executionStatus: ISettableObservable<ExecutionStatus, void>;

	/**
	 * The content of the cell. This is the raw text of the cell.
	 */
	getContent(): string;

	/**
	 * The notebook text model for the cell.
	 */
	cellModel: PositronNotebookCellTextModel;

	/**
	 * Get the handle number for cell from cell model
	 */
	get handleId(): number;

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
	 */
	attachContainer(container: HTMLElement): void;

	/**
	 *
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
	 * Current cell outputs as an observable
	 */
	outputs: ISettableObservable<NotebookCellOutputs[], void>;
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


// Lightweight copies of vscode interfaces for the purpose of not breaking the import rules

export enum CellKind {
	Markup = 1,
	Code = 2
}

export type NotebookCellOutputItem = Readonly<{
	mime: string;
	data: VSBuffer;
}>;

/**
 * Text output types that can be parsed for display. These come across differently than other output
 * types (need to be parsed as json), hence the distinction.
 */
export type ParsedTextOutput = {
	type: 'stdout' | 'text' | 'stderr' | 'error';
	content: string;
};

/**
 * Contents from cell outputs parsed for React components to display
 */
export type ParsedOutput = ParsedTextOutput |
{
	type: 'image';
	dataUrl: string;
} |
{
	type: 'interupt';
	trace: string;
} |
{
	type: 'unknown';
	contents: string;
};


export interface NotebookCellOutputs {
	outputId: string;
	outputs: NotebookCellOutputItem[];
	parsed: ParsedOutput;
	preloadMessageResult?: NotebookPreloadOutputResults | undefined;
}

/**
 * Lightweight copy of the vscode `NotebookCellTextModel` interface.
 */
interface PositronNotebookCellTextModel {
	readonly uri: URI;
	handle: number;
	language: string;
	cellKind: CellKind;
	outputs: Pick<NotebookCellOutputs, 'outputId' | 'outputs'>[];
}
