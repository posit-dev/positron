/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Action2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IPositronNotebookInstance } from './IPositronNotebookInstance.js';
import { getNotebookInstanceFromActiveEditorPane } from './notebookUtils.js';

/**
 * Base class for notebook-level actions that operate on IPositronNotebookInstance.
 * Automatically gets the active notebook instance and passes it to the runNotebookAction method.
 */
export abstract class NotebookAction2 extends Action2 {
	override async run(accessor: ServicesAccessor, ...args: any[]): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const activeNotebook = getNotebookInstanceFromActiveEditorPane(editorService);
		if (!activeNotebook) {
			return;
		}
		const result = this.runNotebookAction(activeNotebook, accessor);
		// Handle both sync (void) and async (Promise) returns
		if (result instanceof Promise) {
			await result;
		}
	}

	protected abstract runNotebookAction(notebook: IPositronNotebookInstance, accessor: ServicesAccessor): Promise<any> | void;
}

