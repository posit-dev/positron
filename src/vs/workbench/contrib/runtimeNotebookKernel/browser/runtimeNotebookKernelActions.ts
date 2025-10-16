/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { URI } from '../../../../base/common/uri.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IProgressService, ProgressLocation } from '../../../../platform/progress/common/progress.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { NotebookEditorWidget } from '../../notebook/browser/notebookEditorWidget.js';
import { NOTEBOOK_KERNEL } from '../../notebook/common/notebookContextKeys.js';
import { isNotebookEditorInput } from '../../notebook/common/notebookEditorInput.js';
import { POSITRON_NOTEBOOK_EDITOR_ID } from '../../positronNotebook/common/positronNotebookCommon.js';
import { ActiveNotebookHasRunningRuntime } from '../common/activeRuntimeNotebookContextManager.js';
import { POSITRON_RUNTIME_NOTEBOOK_KERNELS_EXTENSION_ID } from '../common/runtimeNotebookKernelConfig.js';

const category = localize2('positron.runtimeNotebookKernel.category', "Notebook");

/** Whether a Positron kernel is selected for the active notebook. */
const NOTEBOOK_POSITRON_KERNEL_SELECTED = ContextKeyExpr.regex(NOTEBOOK_KERNEL.key, new RegExp(`${POSITRON_RUNTIME_NOTEBOOK_KERNELS_EXTENSION_ID}\/.*`));

/** The context for actions run from the notebook editor toolbar. */
interface INotebookEditorToolbarContext {
	ui: boolean;
	notebookEditor: NotebookEditorWidget;
	source: 'notebookToolbar';
}

/** Restart the active runtime notebook kernel. */
class RuntimeNotebookKernelRestartAction extends Action2 {
	/** The action's ID. */
	public static readonly ID = 'positron.runtimeNotebookKernel.restart';

	constructor() {
		super({
			id: RuntimeNotebookKernelRestartAction.ID,
			title: localize2('positron.command.restartNotebookInterpreter', 'Restart Kernel'),
			positronActionBarOptions: {
				controlType: 'button',
				displayTitle: false
			},
			icon: Codicon.positronRestartRuntimeThin,
			f1: true,
			category,
			precondition: ActiveNotebookHasRunningRuntime,
			menu: [
				// VSCode notebooks
				{
					id: MenuId.NotebookToolbar,
					group: 'navigation/execute@5',
					order: 5,
					when: NOTEBOOK_POSITRON_KERNEL_SELECTED,
				},
				// Positron notebooks
				{
					id: MenuId.EditorActionsRight,
					group: 'navigation',
					order: 0,
					when: ContextKeyExpr.equals('activeEditor', POSITRON_NOTEBOOK_EDITOR_ID),
				}
			]
		});
	}

	override async run(accessor: ServicesAccessor, context?: INotebookEditorToolbarContext | URI): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const progressService = accessor.get(IProgressService);
		const notificationService = accessor.get(INotificationService);
		const runtimeSessionService = accessor.get(IRuntimeSessionService);

		// Try to use the notebook URI from the context - set if run via the notebook editor toolbar.
		let notebookUri: URI | undefined;
		let source: string;
		if (context) {
			if ('notebookEditor' in context) {
				source = 'User clicked restart button in VSCode notebook editor toolbar';
				notebookUri = context.notebookEditor.textModel?.uri;
			} else {
				source = 'User clicked restart button in Positron notebook editor toolbar';
				notebookUri = context;
			}
		} else {
			source = `Restart notebook kernel command ${RuntimeNotebookKernelRestartAction.ID} executed`;
			const activeEditor = editorService.activeEditor;
			if (!isNotebookEditorInput(activeEditor)) {
				throw new Error('No active notebook. This command should only be available when a notebook is active.');
			}
			notebookUri = activeEditor.resource;
		}

		// If no context was provided, try to get the active notebook URI.
		if (!notebookUri) {
			const activeEditor = editorService.activeEditor;
			if (!isNotebookEditorInput(activeEditor)) {
				throw new Error('No active notebook. This command should only be available when a notebook is active.');
			}
			notebookUri = activeEditor.resource;
		}

		// Get the session for the active notebook.
		const session = runtimeSessionService.getNotebookSessionForNotebookUri(notebookUri);
		if (!session) {
			throw new Error('No session found for active notebook. This command should only be available when a session is running.');
		}

		// Restart the session with a progress bar.
		try {
			await progressService.withProgress({
				location: ProgressLocation.Notification,
				title: localize("positron.notebook.restart.restarting", "Restarting {0} interpreter for '{1}'",
					session.runtimeMetadata.runtimeName, notebookUri.fsPath),
			}, () => runtimeSessionService.restartSession(session.metadata.sessionId, source));
		} catch (error) {
			notificationService.error(
				localize("positron.notebook.restart.failed", "Restarting {0} interpreter for '{1}' failed. Reason: {2}",
					session.runtimeMetadata.runtimeName, notebookUri.fsPath, error.message));
		}
	}
}

export function registerRuntimeNotebookKernelActions(): void {
	registerAction2(RuntimeNotebookKernelRestartAction);
}
