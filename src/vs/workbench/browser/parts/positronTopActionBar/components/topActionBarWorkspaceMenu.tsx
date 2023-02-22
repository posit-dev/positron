/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./topActionBarWorkspaceMenu';
import * as React from 'react';
import { localize } from 'vs/nls';
import { IAction, Separator } from 'vs/base/common/actions';
import { OpenFolderAction } from 'vs/workbench/browser/actions/workspaceActions';
import { ClearRecentFilesAction } from 'vs/workbench/browser/parts/editor/editorActions';
import { recentMenuActions } from 'vs/workbench/browser/parts/positronTopActionBar/components/topActionBarOpenMenu';
import { usePositronTopActionBarContext } from 'vs/workbench/browser/parts/positronTopActionBar/positronTopActionBarContext';
import { usePositronActionBarContext } from 'vs/platform/positronActionBar/browser/positronActionBarContext';
import { ActionBarMenuButton } from 'vs/platform/positronActionBar/browser/components/actionBarMenuButton';
import { PositronNewWorkspaceAction, PositronNewWorkspaceFromGitAction, PositronOpenWorkspaceInNewWindowAction } from 'vs/workbench/browser/actions/positronActions';

const kCloseFolder = 'workbench.action.closeFolder';
const kWorkbenchSettings = 'workbench.action.openWorkspaceSettings';
const kDuplicateWorkspace = 'workbench.action.duplicateWorkspaceInNewWindow';

export const TopActionBarWorkspaceMenu = () => {
	// Hooks.
	const positronActionBarContext = usePositronActionBarContext();
	const positronTopActionBarContext = usePositronTopActionBarContext();

	// fetch actions when menu is shown
	const actions = async () => {
		const actions: IAction[] = [];
		positronActionBarContext.appendCommandAction(actions, PositronNewWorkspaceAction.ID);
		positronActionBarContext.appendCommandAction(actions, PositronNewWorkspaceFromGitAction.ID);
		actions.push(new Separator());
		positronActionBarContext.appendCommandAction(actions, OpenFolderAction.ID, localize('positronOpenWorkspace', "Open Workspace..."));
		positronActionBarContext.appendCommandAction(actions, PositronOpenWorkspaceInNewWindowAction.ID);
		positronActionBarContext.appendCommandAction(actions, kCloseFolder);
		actions.push(new Separator());
		positronActionBarContext.appendCommandAction(actions, kDuplicateWorkspace, localize('positronDuplicateWorkspace', "Duplicate Workspace"));
		const recent = await positronTopActionBarContext.workspacesService.getRecentlyOpened();
		if (positronTopActionBarContext && recent?.workspaces?.length) {
			actions.push(new Separator());
			actions.push(...recentMenuActions(recent.workspaces, positronTopActionBarContext));
			actions.push(new Separator());
			positronActionBarContext.appendCommandAction(actions, ClearRecentFilesAction.ID);
		}
		actions.push(new Separator());
		positronActionBarContext.appendCommandAction(actions, kWorkbenchSettings);
		return actions;
	};

	// Render.
	return (
		<ActionBarMenuButton
			iconId='positron-workspace'
			align='right'
			actions={actions}
			text={positronTopActionBarContext.workspaceFolder ? positronTopActionBarContext.workspaceFolder.name : undefined}
			maxTextWidth={200}
			tooltip={positronTopActionBarContext.workspaceFolder?.uri?.fsPath || ''}
		/>
	);
};
