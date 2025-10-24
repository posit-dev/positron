/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IPositronNotebookInstance } from './IPositronNotebookInstance.js';
import { PositronNotebookEditor } from './PositronNotebookEditor.js';
import { POSITRON_NOTEBOOK_EDITOR_ID } from '../common/positronNotebookCommon.js';
import { IEditorPane } from '../../../common/editor.js';

/**
 * Retrieves the active Positron notebook instance from the editor service.
 *
 * @param editorService The editor service
 * @returns The active notebook instance, or undefined if no Positron notebook is active
 */
export function getNotebookInstanceFromActiveEditorPane(editorService: IEditorService): IPositronNotebookInstance | undefined {
	return getNotebookInstanceFromEditorPane(editorService.activeEditorPane);
}

/**
 * Retrieves the Positron notebook instance from an editor pane.
 *
 * @param editorPane The editor pane
 * @returns The active notebook instance, or undefined if the editor pane is not a Positron notebook
 */
export function getNotebookInstanceFromEditorPane(editorPane?: IEditorPane): IPositronNotebookInstance | undefined {
	// Check if the active editor is a Positron Notebook Editor
	if (!editorPane || editorPane.getId() !== POSITRON_NOTEBOOK_EDITOR_ID) {
		return undefined;
	}

	// Extract the notebook instance from the editor
	const activeNotebook = (editorPane as PositronNotebookEditor).notebookInstance;
	return activeNotebook;
}
