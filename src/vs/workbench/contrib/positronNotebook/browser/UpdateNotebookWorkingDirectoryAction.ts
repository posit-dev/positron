/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { POSITRON_NOTEBOOK_EDITOR_ID } from '../common/positronNotebookCommon.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { getContextFromActiveEditor } from '../../notebook/browser/controller/coreActions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IPositronNotebookInstance } from './IPositronNotebookInstance.js';
import { Action2, MenuId } from '../../../../platform/actions/common/actions.js';
import { localize, localize2 } from '../../../../nls.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { Schemas } from '../../../../base/common/network.js';
import { IPositronNotebookService } from './positronNotebookService.js';
import { IPathService } from '../../../services/path/common/pathService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IQuickInputService, QuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { INotebookLanguageRuntimeSession } from '../../../services/runtimeSession/common/runtimeSessionService.js';

// Constants
const UPDATE_ID = 'update';
const KEEP_ID = 'keep';

/**
 * Action to update the working directory of a notebook session to match the
 * notebook's file location. This is useful when a notebook has been moved.
 */
export class UpdateNotebookWorkingDirectoryAction extends Action2 {
	constructor() {
		super({
			id: 'positronNotebook.updateWorkingDirectory',
			category: localize2('notebook.category', 'Notebook'),
			title: localize2('updateWorkingDirectory', 'Update Working Directory'),
			positronActionBarOptions: {
				controlType: 'button',
				displayTitle: false
			},
			icon: ThemeIcon.fromId('alert'),
			f1: true,
			menu: [
				{
					id: MenuId.EditorActionsRight,
					group: 'navigation',
					when: ContextKeyExpr.equals('activeEditor', POSITRON_NOTEBOOK_EDITOR_ID)

				}
			]
			// TODO: only show in action bar if the active editor is a Positron notebook
			// and the notebook working directory differs from the notebook location
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		// Get services
		const editorService = accessor.get(IEditorService);
		const logService = accessor.get(ILogService);
		const notificationService = accessor.get(INotificationService);
		const notebookService = accessor.get(IPositronNotebookService);
		const pathService = accessor.get(IPathService);
		const workspaceContextService = accessor.get(IWorkspaceContextService);

		// Get the active notebook context
		const context = getContextFromActiveEditor(editorService);
		if (!context) {
			logService.warn('[Positron Notebook]: No active notebook editor found when trying to update working directory');
			return;
		}
		// Get the notebook URI
		const newUri = context.notebookEditor.textModel.uri;
		// Skip untitled notebooks
		if (newUri.scheme === Schemas.untitled) {
			notificationService.info(localize(
				'positron.notebook.updateWorkingDirectory.untitledNotebook',
				'Cannot update working directory for untitled notebooks. Please save the notebook first.'
			));
			return;
		}
		// Resolve the new URI to a working directory
		const newWorkingDirectory = await this.resolveNotebookWorkingDirectory(newUri);
		if (!newWorkingDirectory) {
			return;
		}

		// Get the current session object tied to the active notebook
		const notebookInstance = notebookService.listInstances().find((instance: IPositronNotebookInstance) =>
			instance.uri.toString() === newUri.toString()
		);
		if (!notebookInstance) {
			logService.warn(`[Positron Notebook]: No notebook instance found for ${newUri.toString()}`);
			return;
		}
		const session = notebookInstance.runtimeSession.read(undefined);
		if (!session) {
			notificationService.warn(localize(
				'positron.notebook.updateWorkingDirectory.noNotebookSession',
				'Cannot update working directory. No interpreter session is running for notebook {0}', newUri.toString()
			));
			return;
		}
		// Get the current working directory
		const currentWorkingDirectory = session.dynState.currentNotebookUri;
		if (!currentWorkingDirectory) {
			return;
		}


		// Resolve both paths (untildify + symlink resolution) for comparison
		const currentWorkingDirectoryResolved = await this.resolvePath(currentWorkingDirectory);
		const newWorkingDirectoryResolved = await this.resolvePath(newWorkingDirectory);

		if (currentWorkingDirectoryResolved !== newWorkingDirectoryResolved) {
			// Format the paths for display
			const path = await pathService.path;
			const workspaceFolder = workspaceContextService.getWorkspaceFolder(newUri) || undefined;
			const workspaceFolderName = workspaceFolder ? workspaceFolder.name : '';

			// Convert an absolute path to a display path relative to the workspace folder if it's inside it
			const makeDisplayPath = function (p: string): string {
				if (!workspaceFolder) {
					return p;
				}
				const workspaceFolderPath = workspaceFolder.uri.scheme === Schemas.file ? workspaceFolder.uri.fsPath : workspaceFolder.uri.path;
				const relativePath = path.relative(workspaceFolderPath, p);
				if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
					return p;
				}
				return path.join(workspaceFolderName, relativePath);
			};

			const currentWorkingDirectoryDisplay = makeDisplayPath(currentWorkingDirectoryResolved);
			const newWorkingDirectoryDisplay = makeDisplayPath(newWorkingDirectoryResolved);

			this.updateWorkingDirectory(
				accessor,
				currentWorkingDirectoryDisplay,
				newWorkingDirectoryDisplay,
				session
			);
		}
	}

	private async updateWorkingDirectory(
		accessor: ServicesAccessor,
		currentWorkingDirectory: string,
		newWorkingDirectory: string,
		session: INotebookLanguageRuntimeSession
	): Promise<void> {
		// Access services
		const notificationService = accessor.get(INotificationService);
		const quickInputService = accessor.get(IQuickInputService);

		// Create options for quick-pick
		const quickPickItems: QuickPickItem[] = [
			{
				label: localize('positron.notebook.updateWorkingDirectory.quickPick.update', 'Update'),
				id: UPDATE_ID
			},
			{
				label: localize('positron.notebook.updateWorkingDirectory.quickPick.keep', 'Keep'),
				id: KEEP_ID
			}
		];

		// TODO: add the following localized string as description to quickpick
		const description = localize(
			'positron.notebook.workingDirectoryChanged',
			// eslint-disable-next-line local/code-no-unexternalized-strings
			'This notebook was moved to a new location but your session is still running from the original directory.'
			+ '<br><br>Saved at: <code>{0}</code>'
			+ '<br>Running from: <code>{1}</code>'
			+ '<br><br>Update the running working directory to match where the notebook is saved? (Recommended)',
			currentWorkingDirectory,
			newWorkingDirectory,
		);

		const result = await quickInputService.pick(
			quickPickItems,
			{
				title: localize('positron.notebook.workingDirectoryChanged.title', 'Update working directory?'),
				canPickMany: false,
			}
		);

		if (result?.id === UPDATE_ID) {
			try {
				await session.setWorkingDirectory(newWorkingDirectory);
			} catch (error) {
				notificationService.error(localize(
					'positron.notebook.updateWorkingDirectory.failed',
					'Failed to update working directory to {0}.',
					newWorkingDirectory
				));
			}
		}
	}
}
