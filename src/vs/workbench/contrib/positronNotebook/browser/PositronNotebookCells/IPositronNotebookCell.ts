/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IObservable, ISettableObservable } from '../../../../../base/common/observable.js';
import { URI } from '../../../../../base/common/uri.js';
import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { CodeEditorWidget } from '../../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { CellRevealType, INotebookEditorOptions } from '../../../notebook/browser/notebookBrowser.js';
import { NotebookPreloadOutputResults } from '../../../../services/positronWebviewPreloads/browser/positronWebviewPreloadService.js';
import { CellSelectionType } from '../selectionMachine.js';

export type ExecutionStatus = 'running' | 'pending' | 'idle';

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
	readonly kind: CellKind;

	/**
	 * The current zero-based index of the cell in the notebook
	 */
	get index(): number;

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
	readonly executionStatus: IObservable<ExecutionStatus>;

	/**
	 * Current selection status for this cell
	 */
	readonly selectionStatus: ISettableObservable<CellSelectionStatus>;

	/**
	 * The content of the cell. This is the raw text of the cell.
	 */
	getContent(): string;

	/**
	 * The notebook text model for the cell.
	 */
	readonly cellModel: PositronNotebookCellTextModel;

	/**
	 * The cell's code editor widget.
	 */
	readonly editor: ICodeEditor | undefined;

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
	 * Insert a new code cell above this cell
	 */
	insertCodeCellAbove(): void;

	/**
	 * Insert a new code cell below this cell
	 */
	insertCodeCellBelow(): void;

	/**
	 * Type guard for checking if cell is a markdown cell
	 */
	isMarkdownCell(): this is IPositronNotebookMarkdownCell;

	/**
	 * Type guard for checking if cell is a code cell
	 */
	isCodeCell(): this is IPositronNotebookCodeCell;

	/**
	 * Check if this cell is the last cell in the notebook
	 */
	isLastCell(): boolean;

	/**
	 * Check if this cell is the only cell in the notebook
	 */
	isOnlyCell(): boolean;

	/**
	 * Set focus to this cell
	 */
	focus(): void;

	/**
	 * Show the cell's editor.
	 * @param focus Whether to focus the editor after showing it. Default: false.
	 * @returns Promise that resolves to the editor when it is available, or undefined if the editor could not be shown.
	 */
	showEditor(focus?: boolean): Promise<ICodeEditor | undefined>;

	/**
	 * Remove focus from within monaco editor and out to the cell itself
	 */
	defocusEditor(): void;

	/**
	 * Select this cell
	 * @param type Selection type.
	 */
	select(type: CellSelectionType): void;

	/**
	 * Reveal the cell in the viewport
	 * @param type Reveal type.
	 */
	reveal(type?: CellRevealType): void;

	/**
	 * Apply notebook editor options to this cell. Used by the IDE to select and/or reveal the cell.
	 * @param options Notebook editor options to apply.
	 */
	setOptions(options: INotebookEditorOptions | undefined): Promise<void>;

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
	readonly kind: CellKind.Code;


	/**
	 * Current cell outputs as an observable
	 */
	readonly outputs: IObservable<NotebookCellOutputs[]>;

	/**
	 * Duration of the last execution in milliseconds
	 */
	readonly lastExecutionDuration: IObservable<number | undefined>;

	/**
	 * Execution order number for the last execution
	 */
	readonly lastExecutionOrder: IObservable<number | undefined>;

	/**
	 * Whether the last execution was successful
	 */
	readonly lastRunSuccess: IObservable<boolean | undefined>;

	/**
	 * Timestamp when the last execution ended
	 */
	readonly lastRunEndTime: IObservable<number | undefined>;
}



/**
 * Cell that contains markdown content
 */
export interface IPositronNotebookMarkdownCell extends IPositronNotebookCell {
	readonly kind: CellKind.Markup;

	/**
	 * Observable content of cell. Equivalent to the cell's content, but as an observable
	 */
	readonly markdownString: IObservable<string | undefined>;

	/**
	 * Observable that indicates whether the editor is currently shown
	 */
	readonly editorShown: IObservable<boolean>;

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
	readonly outputId: string;
	readonly outputs: NotebookCellOutputItem[];
	readonly parsed: ParsedOutput;
	preloadMessageResult?: NotebookPreloadOutputResults | undefined;
}

/**
 * Partial interface of the vscode `NotebookCellTextModel` class.
 */
export interface PositronNotebookCellTextModel {
	readonly uri: URI;
	readonly handle: number;
	readonly language: string;
	readonly cellKind: CellKind;
	readonly outputs: Pick<NotebookCellOutputs, 'outputId' | 'outputs'>[];
}
