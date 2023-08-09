/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./topActionBarFolderMenu';
import * as React from 'react';
import { localize } from 'vs/nls';
import { IAction, Separator } from 'vs/base/common/actions';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { OpenFolderAction } from 'vs/workbench/browser/actions/workspaceActions';
import { EmptyWorkspaceSupportContext, WorkbenchStateContext } from 'vs/workbench/common/contextkeys';
import { ActionBarMenuButton } from 'vs/platform/positronActionBar/browser/components/actionBarMenuButton';
import { usePositronActionBarContext } from 'vs/platform/positronActionBar/browser/positronActionBarContext';
import { recentMenuActions } from 'vs/workbench/browser/parts/positronTopActionBar/components/topActionBarOpenMenu';
import { usePositronTopActionBarContext } from 'vs/workbench/browser/parts/positronTopActionBar/positronTopActionBarContext';
import { PositronNewFolderAction, PositronNewFolderFromGitAction, PositronOpenFolderInNewWindowAction } from 'vs/workbench/browser/actions/positronActions';

// Constants.
const kCloseFolder = 'workbench.action.closeFolder';

/**
 * TopActionBarFolderMenu component.
 * @returns The rendered component.
 */
export const TopActionBarFolderMenu = () => {
	// Hooks.
	const positronActionBarContext = usePositronActionBarContext();
	const positronTopActionBarContext = usePositronTopActionBarContext();

	// fetch actions when menu is shown
	const actions = async () => {
		const actions: IAction[] = [];
		positronActionBarContext.appendCommandAction(actions, {
			id: PositronNewFolderAction.ID
		});
		positronActionBarContext.appendCommandAction(actions, {
			id: PositronNewFolderFromGitAction.ID
		});
		actions.push(new Separator());
		positronActionBarContext.appendCommandAction(actions, {
			id: OpenFolderAction.ID,
			label: localize('positronOpenFolder', "Open Folder...")
		});

		positronActionBarContext.appendCommandAction(actions, {
			id: PositronOpenFolderInNewWindowAction.ID
		});

		// As of Private Alpha (August, 2023), we are not exposing the user to the concept of a
		// "Workspace" in this user experience.
		// positronActionBarContext.appendCommandAction(actions, {
		// 	id: OpenWorkspaceAction.ID
		// });

		actions.push(new Separator());

		// As of Private Alpha (August, 2023), we are not exposing the user to the concept of a
		// "Workspace" in this user experience.
		// positronActionBarContext.appendCommandAction(actions, {
		// 	id: kDuplicateWorkspace,
		// 	label: localize('positronDuplicateWorkspace', "Duplicate Workspace")
		// });

		// When a folder is open, the action is called "Close Folder...".
		positronActionBarContext.appendCommandAction(actions, {
			id: kCloseFolder,
			label: localize('positronCloseFolder', "Close Folder..."),
			separator: true,
			when: ContextKeyExpr.and(
				WorkbenchStateContext.isEqualTo('folder'),
				EmptyWorkspaceSupportContext
			)
		});

		// When a workspace is open, the action is called "Close Workspace...".
		positronActionBarContext.appendCommandAction(actions, {
			id: kCloseFolder,
			label: localize('positronCloseWorkspace', "Close Workspace..."),
			separator: true,
			when: ContextKeyExpr.and(
				WorkbenchStateContext.isEqualTo('workspace'),
				EmptyWorkspaceSupportContext
			)
		});

		const recent = await positronTopActionBarContext.workspacesService.getRecentlyOpened();
		if (positronTopActionBarContext && recent?.workspaces?.length) {
			actions.push(new Separator());
			actions.push(...recentMenuActions(recent.workspaces, positronTopActionBarContext));

			// For now, do not add this command action because it clears files and folders. It would
			// be better to have an action that just clears folders / workspaces.
			// actions.push(new Separator());
			// positronActionBarContext.appendCommandAction(actions, {
			// 	commandId: ClearRecentFilesAction.ID
			// });
		}


		// As of Private Alpha (August, 2023), we are not exposing the user to the concept of a
		// "Workspace" in this user experience.
		// actions.push(new Separator());
		// positronActionBarContext.appendCommandAction(actions, {
		// 	id: kWorkbenchSettings
		// });

		return actions;
	};

	// Render.
	return (
		<ActionBarMenuButton
			iconId='folder'
			iconFontSize={18}
			align='right'
			actions={actions}
			text={positronTopActionBarContext.workspaceFolder ? positronTopActionBarContext.workspaceFolder.name : undefined}
			maxTextWidth={200}
			tooltip={positronTopActionBarContext.workspaceFolder?.uri?.fsPath || ''}
		/>
	);
};
