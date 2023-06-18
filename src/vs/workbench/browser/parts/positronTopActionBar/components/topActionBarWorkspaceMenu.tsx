/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./topActionBarWorkspaceMenu';
import * as React from 'react';
import { localize } from 'vs/nls';
import { IAction, Separator } from 'vs/base/common/actions';
import { ClearRecentFilesAction } from 'vs/workbench/browser/parts/editor/editorActions';
import { ActionBarMenuButton } from 'vs/platform/positronActionBar/browser/components/actionBarMenuButton';
import { usePositronActionBarContext } from 'vs/platform/positronActionBar/browser/positronActionBarContext';
import { recentMenuActions } from 'vs/workbench/browser/parts/positronTopActionBar/components/topActionBarOpenMenu';
import { usePositronTopActionBarContext } from 'vs/workbench/browser/parts/positronTopActionBar/positronTopActionBarContext';

const kWorkbenchSettings = 'workbench.action.openWorkspaceSettings';
const kDuplicateWorkspace = 'workbench.action.duplicateWorkspaceInNewWindow';

export const TopActionBarWorkspaceMenu = () => {
	// Hooks.
	const positronActionBarContext = usePositronActionBarContext();
	const positronTopActionBarContext = usePositronTopActionBarContext();

	// fetch actions when menu is shown
	const actions = async () => {
		const actions: IAction[] = [];
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
			iconFontSize={20}
			align='right'
			actions={actions}
			text={positronTopActionBarContext.workspaceFolder ? positronTopActionBarContext.workspaceFolder.name : undefined}
			maxTextWidth={200}
			tooltip={positronTopActionBarContext.workspaceFolder?.uri?.fsPath || ''}
		/>
	);
};
