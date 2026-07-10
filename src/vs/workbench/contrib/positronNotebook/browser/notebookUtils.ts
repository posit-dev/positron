/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { CancelablePromise, createCancelablePromise, timeout } from '../../../../base/common/async.js';
import { CancellationError } from '../../../../base/common/errors.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IPositronNotebookInstance } from './IPositronNotebookInstance.js';
import { PositronNotebookEditor } from './PositronNotebookEditor.js';
import { POSITRON_NOTEBOOK_EDITOR_ID } from '../common/positronNotebookCommon.js';
import { NOTEBOOK_EDITOR_ID } from '../../notebook/common/notebookCommon.js';
import { IEditorPane } from '../../../common/editor.js';

/** Default timeout for waiting for notebook instance (5 seconds) */
const NOTEBOOK_TIMEOUT_MS = 5000;

/** Polling interval when waiting for notebook instance */
const NOTEBOOK_POLL_INTERVAL_MS = 100;

/**
 * Waits for the notebook instance to become available from the active editor pane.
 * This handles the timing gap between when the editor pane becomes active and when
 * the notebook instance is actually available (after setInput() is called).
 *
 * @param editorService The editor service to get the active editor pane from
 * @param timeoutMs Maximum time to wait for the notebook (defaults to 5 seconds)
 * @returns A cancelable promise that resolves with the notebook instance
 * @throws Error if the notebook doesn't become available within the timeout
 * @throws CancellationError if the promise is cancelled
 */
export function waitForNotebook(
	editorService: IEditorService,
	timeoutMs: number = NOTEBOOK_TIMEOUT_MS
): CancelablePromise<IPositronNotebookInstance> {
	return createCancelablePromise(async token => {
		let elapsed = 0;

		while (!token.isCancellationRequested) {
			const notebook = getNotebookInstanceFromActiveEditorPane(editorService);
			if (notebook) {
				return notebook;
			}

			if (elapsed >= timeoutMs) {
				throw new Error('Notebook is taking too long to load. Please close this dialog and try again.');
			}

			await timeout(NOTEBOOK_POLL_INTERVAL_MS, token);
			elapsed += NOTEBOOK_POLL_INTERVAL_MS;
		}

		throw new CancellationError();
	});
}

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
 * Actionable message shown when a notebook is open, but in the built-in
 * (Jupyter) notebook editor rather than the Positron Notebook Editor. The
 * Positron notebook API only operates on Positron Notebook Editor instances, so
 * this tells the user how to switch editors.
 */
export const UNSUPPORTED_NOTEBOOK_EDITOR_MESSAGE = localize('positronNotebook.unsupportedEditor', "The active notebook is open in the default notebook editor, which does not support this operation. Reopen it in the Positron Notebook Editor (run the \"View: Reopen Editor With...\" command and choose \"Positron Notebook\", or set \"positron.notebook.enabled\" to true and reopen the notebook), then try again.");

/**
 * When the active editor holds a notebook that the Positron notebook API cannot
 * operate on because it is open in the built-in notebook editor rather than the
 * Positron Notebook Editor, returns an actionable message explaining how to
 * switch editors. Returns undefined when the active editor is a Positron
 * notebook or is not a notebook at all.
 *
 * @param editorService The editor service
 */
export function getUnsupportedNotebookEditorMessage(editorService: IEditorService): string | undefined {
	return editorService.activeEditorPane?.getId() === NOTEBOOK_EDITOR_ID
		? UNSUPPORTED_NOTEBOOK_EDITOR_MESSAGE
		: undefined;
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

	// Extract the notebook instance from the editor.
	// The cast to IPositronNotebookInstance is safe because PositronNotebookInstance implements the interface.
	const activeNotebook = (editorPane as PositronNotebookEditor).notebookInstance as IPositronNotebookInstance | undefined;
	return activeNotebook;
}
