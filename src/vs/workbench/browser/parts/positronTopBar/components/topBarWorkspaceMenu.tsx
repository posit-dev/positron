/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import React = require('react');
import { localize } from 'vs/nls';
import { usePositronTopBarContext } from 'vs/workbench/browser/parts/positronTopBar/positronTopBarContext';
import { TopBarMenuButton } from 'vs/workbench/browser/parts/positronTopBar/components/topBarMenuButton';
import { IAction, Separator } from 'vs/base/common/actions';
import { commandAction } from 'vs/workbench/browser/parts/positronTopBar/actions';
import { PositronNewWorkspaceAction, PositronNewWorkspaceFromGitAction, PositronOpenWorkspaceInNewWindowAction } from 'vs/workbench/browser/actions/positronActions';
import { OpenFolderAction } from 'vs/workbench/browser/actions/workspaceActions';
import { recentMenuActions } from 'vs/workbench/browser/parts/positronTopBar/components/topBarOpenMenu';
import { ClearRecentFilesAction } from 'vs/workbench/browser/parts/editor/editorActions';

const kCloseFolder = 'workbench.action.closeFolder';
const kWorkbenchSettings = 'workbench.action.openWorkspaceSettings';

export const kWorkspaceMenuCommands = [
	PositronNewWorkspaceAction.ID,
	PositronNewWorkspaceFromGitAction.ID,
	OpenFolderAction.ID,
	PositronOpenWorkspaceInNewWindowAction.ID,
	kCloseFolder,
	ClearRecentFilesAction.ID,
	kWorkbenchSettings
];


export const TopBarWorkspaceMenu = () => {
	// Hooks.
	const positronTopBarContext = usePositronTopBarContext();
	if (!positronTopBarContext) {
		return null;
	}

	// fetch actions when menu is shown
	const actions = async () => {

		const actions: IAction[] = [];
		const addAction = (id: string, label?: string) => {
			const action = commandAction(id, positronTopBarContext, label);
			if (action) {
				actions.push(action);
			}
		};

		addAction(PositronNewWorkspaceAction.ID);
		addAction(PositronNewWorkspaceFromGitAction.ID);
		actions.push(new Separator());
		addAction(OpenFolderAction.ID, localize('positronOpenWorkspace', "Open Workspace..."));
		addAction(PositronOpenWorkspaceInNewWindowAction.ID);
		addAction(kCloseFolder);

		const recent = await positronTopBarContext?.workspacesService.getRecentlyOpened();
		if (positronTopBarContext && recent?.workspaces?.length) {
			actions.push(new Separator());
			actions.push(...recentMenuActions(recent.workspaces, positronTopBarContext));
			actions.push(new Separator());
			addAction(ClearRecentFilesAction.ID);
		}

		actions.push(new Separator());
		addAction(kWorkbenchSettings);

		return actions;
	};

	// compontent
	return (
		<TopBarMenuButton
			actions={actions}
			iconId='root-folder'
			text={positronTopBarContext?.workspaceFolder ? positronTopBarContext.workspaceFolder.name : 'Workspace: (None)'}
			tooltip={positronTopBarContext?.workspaceFolder?.uri?.fsPath || ''}
		/>
	);
};
