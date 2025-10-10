/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { IEditorPane } from '../../../common/editor.js';
import { POSITRON_NOTEBOOK_EDITOR_ID } from '../common/positronNotebookCommon.js';
import { IPositronNotebookInstance } from './IPositronNotebookInstance.js';

/**
 * Extracts the Positron notebook instance from a generic editor pane, if it contains one.
 *
 * The workbench editor service deals with generic `IEditorPane` objects that could
 * represent any type of editor (text, notebook, diff, etc.). When integrating Positron notebooks
 * with the extension API, we need to identify which editor panes contain Positron notebooks.
 *
 * @returns The notebook instance if the pane is a Positron notebook editor, undefined otherwise
 */

export function getNotebookInstanceFromEditorPane(editorPane?: IEditorPane): IPositronNotebookInstance | undefined {
	if (editorPane &&
		editorPane.getId() === POSITRON_NOTEBOOK_EDITOR_ID) {
		// TODO: Should the notebook instance should be returned by editorPane.getControl() as done upstream to avoid the `as any`?
		//       If we import PositronNotebookEditor and do `instanceof` we end up with circular imports
		return (editorPane as any).notebookInstance as IPositronNotebookInstance;
	}
	return undefined;
}
