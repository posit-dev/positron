/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { INotebookEditorOptions } from '../../notebook/browser/notebookBrowser.js';

/**
 * Identifies a cell at the top of the viewport for scroll restoration.
 * Using a cell anchor rather than absolute pixel positions handles async
 * content rendering that changes heights above the viewport.
 */
export interface IPositronNotebookScrollAnchor {
	/** Index of the cell at the top of the viewport. */
	cellIndex: number;
	/** Pixels from the top of that cell's DOM element to the viewport top.
	 *  Positive means the cell is partially scrolled out of view above. */
	offsetFromCell: number;
}

/**
 * Notebook editor view state persisted when the editor is backgrounded,
 * or when Positron is reloaded.
 */
export interface IPositronNotebookViewState {
	scrollPosition?: IPositronNotebookScrollAnchor;
}

/**
 * Editor options for the Positron notebook editor.
 */
export interface IPositronNotebookEditorOptions extends Omit<INotebookEditorOptions, 'viewState'> {
	readonly viewState?: IPositronNotebookViewState;
}
