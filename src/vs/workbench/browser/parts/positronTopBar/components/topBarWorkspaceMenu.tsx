/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./topBarWorkspaceMenu';
import * as React from 'react';
import { localize } from 'vs/nls';
import { IAction, Separator } from 'vs/base/common/actions';
import { OpenFolderAction } from 'vs/workbench/browser/actions/workspaceActions';
import { ClearRecentFilesAction } from 'vs/workbench/browser/parts/editor/editorActions';
import { recentMenuActions } from 'vs/workbench/browser/parts/positronTopBar/components/topBarOpenMenu';
import { usePositronTopBarContext } from 'vs/workbench/browser/parts/positronTopBar/positronTopBarContext';
import { usePositronActionBarContext } from 'vs/platform/positronActionBar/browser/positronActionBarContext';
import { ActionBarMenuButton } from 'vs/platform/positronActionBar/browser/components/actionBarMenuButton';
import { PositronNewWorkspaceAction, PositronNewWorkspaceFromGitAction, PositronOpenWorkspaceInNewWindowAction } from 'vs/workbench/browser/actions/positronActions';

const kCloseFolder = 'workbench.action.closeFolder';
const kWorkbenchSettings = 'workbench.action.openWorkspaceSettings';
const kDuplicateWorkspace = 'workbench.action.duplicateWorkspaceInNewWindow';

export const TopBarWorkspaceMenu = () => {
	// Hooks.
	const positronActionBarContext = usePositronActionBarContext();
	const positronTopBarContext = usePositronTopBarContext();

	// fetch actions when menu is shown
	const actions = async () => {
		const actions: IAction[] = [];
		const addAction = (id: string, label?: string) => {
			const action = positronActionBarContext.createCommandAction(id, label);
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
		actions.push(new Separator());
		addAction(kDuplicateWorkspace, localize('positronDuplicateWorkspace', "Duplicate Workspace"));

		const recent = await positronTopBarContext.workspacesService.getRecentlyOpened();
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

	// Render.
	return (
		<ActionBarMenuButton
			iconId='root-folder'
			align='right'
			actions={actions}
			text={positronTopBarContext.workspaceFolder ? positronTopBarContext.workspaceFolder.name : undefined}
			tooltip={positronTopBarContext.workspaceFolder?.uri?.fsPath || ''}
		/>
	);
};
