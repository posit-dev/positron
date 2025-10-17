/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IPositronNotebookInstance } from './IPositronNotebookInstance.js';
import { PositronNotebookEditor } from './PositronNotebookEditor.js';
import { POSITRON_NOTEBOOK_EDITOR_ID } from '../common/positronNotebookCommon.js';

/**
 * Retrieves the active Positron notebook instance from the editor service.
 *
 * @param editorService The editor service
 * @returns The active notebook instance, or undefined if no Positron notebook is active
 */
export function getActiveNotebook(editorService: IEditorService): IPositronNotebookInstance | undefined {
	const activeEditorPane = editorService.activeEditorPane;

	// Check if the active editor is a Positron Notebook Editor
	if (!activeEditorPane || activeEditorPane.getId() !== POSITRON_NOTEBOOK_EDITOR_ID) {
		return undefined;
	}

	// Extract the notebook instance from the editor
	const activeNotebook = (activeEditorPane as PositronNotebookEditor).notebookInstance;
	return activeNotebook;
}
