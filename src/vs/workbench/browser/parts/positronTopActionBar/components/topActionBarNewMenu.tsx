/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./topActionBarNewMenu';
import * as React from 'react';
import { localize } from 'vs/nls';
import { IAction, Separator } from 'vs/base/common/actions';
import { ActionBarMenuButton } from 'vs/platform/positronActionBar/browser/components/actionBarMenuButton';
import { usePositronActionBarContext } from 'vs/platform/positronActionBar/browser/positronActionBarContext';
import { PositronNewWorkspaceAction, PositronNewWorkspaceFromGitAction } from 'vs/workbench/browser/actions/positronActions';

/**
 * TopActionBarNewMenu component.
 * @returns The component.
 */
export const TopActionBarNewMenu = () => {
	// Hooks.
	const positronActionBarContext = usePositronActionBarContext();

	// fetch actions when menu is shown
	const actions = () => {
		const actions: IAction[] = [];
		positronActionBarContext.appendCommandAction(actions, 'welcome.showNewFileEntries', localize('positronNewFile', "New File..."));
		actions.push(new Separator());
		positronActionBarContext.appendCommandAction(actions, PositronNewWorkspaceAction.ID);
		positronActionBarContext.appendCommandAction(actions, PositronNewWorkspaceFromGitAction.ID);
		actions.push(new Separator());
		positronActionBarContext.appendCommandAction(actions, 'workbench.action.newWindow');
		return actions;
	};

	// compontent
	return (
		<ActionBarMenuButton
			iconId='positron-new'
			actions={actions}
			tooltip={localize('positronNewFileWorkspace', "New File/Workspace")}
		/>
	);
};
