/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { isEqual } from '../../../../base/common/resources.js';
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

/**
 * Checks if any notebook instance for a given URI is connected to an editor.
 *
 * @param editorService The editor service
 * @param uri The notebook URI to check
 * @returns True if any notebook instance for this URI is connected to an editor, false otherwise
 */
export function hasConnectedNotebookForUri(
	editorService: IEditorService,
	uri: URI
): boolean {
	for (const editorPane of editorService.visibleEditorPanes) {
		if (editorPane.getId() === POSITRON_NOTEBOOK_EDITOR_ID) {
			const notebookEditor = editorPane as PositronNotebookEditor;
			const instance = notebookEditor.notebookInstance;

			if (instance && isEqual(instance.uri, uri) && instance.connectedToEditor) {
				return true;
			}
		}
	}
	return false;
}

/**
 * Retrieves all Positron notebook instances from visible editor panes.
 *
 * @param editorService The editor service
 * @param uri Optional URI to filter instances by
 * @returns Array of all notebook instances, optionally filtered by URI
 */
export function getAllPositronNotebookInstances(
	editorService: IEditorService,
	uri?: URI
): IPositronNotebookInstance[] {
	const instances: IPositronNotebookInstance[] = [];

	for (const editorPane of editorService.visibleEditorPanes) {
		if (editorPane.getId() === POSITRON_NOTEBOOK_EDITOR_ID) {
			const notebookEditor = editorPane as PositronNotebookEditor;
			const instance = notebookEditor.notebookInstance;

			if (instance) {
				if (!uri || isEqual(instance.uri, uri)) {
					instances.push(instance);
				}
			}
		}
	}

	return instances;
}
