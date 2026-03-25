/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { isEqual } from '../../../../base/common/resources.js';
import { Action2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IPositronNotebookInstance } from './IPositronNotebookInstance.js';
import { getNotebookInstanceFromActiveEditorPane, getNotebookInstanceFromEditorPane } from './notebookUtils.js';

/**
 * Base class for notebook-level actions that operate on IPositronNotebookInstance.
 * Automatically gets the active notebook instance and passes it to the runNotebookAction method.
 *
 * When invoked from the editor action bar, the resource URI of the editor group's active editor
 * is passed as the first argument, allowing the action to target the correct notebook even when
 * multiple notebooks are open side-by-side.
 */
export abstract class NotebookAction2 extends Action2 {
	override async run(accessor: ServicesAccessor, ...args: unknown[]): Promise<void> {
		const editorService = accessor.get(IEditorService);

		let notebook: IPositronNotebookInstance | undefined;

		// If a resource URI was passed (e.g. from the editor action bar),
		// find the notebook instance for that specific resource.
		const resourceUri = URI.isUri(args[0]) ? args[0] : undefined;
		if (resourceUri) {
			for (const pane of editorService.visibleEditorPanes) {
				const candidate = getNotebookInstanceFromEditorPane(pane);
				if (candidate && isEqual(candidate.uri, resourceUri)) {
					notebook = candidate;
					break;
				}
			}
		}

		// Fall back to the active editor pane (e.g. when invoked from command palette)
		if (!notebook) {
			notebook = getNotebookInstanceFromActiveEditorPane(editorService);
		}

		if (!notebook) {
			return;
		}

		const result = this.runNotebookAction(notebook, accessor, ...args);
		// Handle both sync (void) and async (Promise) returns
		if (result instanceof Promise) {
			await result;
		}
	}

	protected abstract runNotebookAction(notebook: IPositronNotebookInstance, accessor: ServicesAccessor, ...args: unknown[]): Promise<void> | void;
}
