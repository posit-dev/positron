/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IProgressService, ProgressLocation } from '../../../../platform/progress/common/progress.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { NOTEBOOK_KERNEL } from '../../notebook/common/notebookContextKeys.js';
import { isNotebookEditorInput } from '../../notebook/common/notebookEditorInput.js';

const category = localize2('positron.runtimeNotebookKernelCategory', "Notebook");

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'positron.runtimeNotebookInterpreter.restart',
			// TODO: "Restart Kernel" is to match the Jupyter extension, which users might be expecting.
			title: localize2('positron.command.restartNotebookInterpreter', "Restart Kernel"),
			f1: true,
			category,
			menu: [
				{
					id: MenuId.NotebookToolbar,
					// TODO: Group and order?
					group: 'navigation/execute@5',
					order: 5,
					when: ContextKeyExpr.regex(NOTEBOOK_KERNEL.key, /^positron.positron-notebook-controllers\//),
				}
			]
		});
	}

	override async run(accessor: ServicesAccessor, ...args: any[]): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const runtimeSessionService = accessor.get(IRuntimeSessionService);
		const progressService = accessor.get(IProgressService);
		const notificationService = accessor.get(INotificationService);

		const activeInput = editorService.activeEditorPane?.input;
		if (!isNotebookEditorInput(activeInput)) {
			throw new Error('No active notebook. This command should only be available when a notebook is active.');
		}

		const notebookUri = activeInput.resource;

		// Get the session for the active notebook.
		const session = runtimeSessionService.getNotebookSessionForNotebookUri(notebookUri);
		if (!session) {
			throw new Error('No session found for active notebook. This command should only be available when a session is running.');
		}

		// Disable the hasRunningNotebookSession context before restarting.
		// if (isActiveNotebookEditorUri(notebook.uri)) {
		// 	await setHasRunningNotebookSessionContext(false);
		// }

		// Restart the session with a progress bar.
		try {
			await progressService.withProgress({
				location: ProgressLocation.Notification,
				title: localize("positron.notebook.restart.restarting", "Restarting {0} interpreter for '{1}'",
					session.runtimeMetadata.runtimeName, notebookUri.fsPath),
				// TODO: Is it always user initiated? Might be via menu or command palette, can we add that context?
			}, () => runtimeSessionService.restartSession(session.metadata.sessionId,
				`User ran restart notebook command`));

			// // Enable the hasRunningNotebookSession context.
			// if (isActiveNotebookEditorUri(notebook.uri)) {
			// 	await setHasRunningNotebookSessionContext(true);
			// }
		} catch (error) {
			notificationService.error(
				localize("positron.notebook.restart.failed", "Restarting {0} interpreter for '{1}' failed. Reason: {2}",
					session.runtimeMetadata.runtimeName, notebookUri.fsPath, error.message));
		}
	}
});
