/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./topBarNewMenu';
import * as React from 'react';
import { localize } from 'vs/nls';
import { IAction, Separator } from 'vs/base/common/actions';
import { ActionBarMenuButton } from 'vs/platform/positronActionBar/browser/components/actionBarMenuButton';
import { usePositronActionBarContext } from 'vs/platform/positronActionBar/browser/positronActionBarContext';
import { PositronNewWorkspaceAction, PositronNewWorkspaceFromGitAction } from 'vs/workbench/browser/actions/positronActions';

/**
 * TopBarNewMenu component.
 * @returns The component.
 */
export const TopBarNewMenu = () => {
	// Hooks.
	const positronActionBarContext = usePositronActionBarContext();

	// fetch actions when menu is shown
	const actions = async () => {
		const actions: IAction[] = [];
		const addAction = (id: string, label?: string) => {
			const action = positronActionBarContext.createCommandAction(id, label);
			if (action) {
				actions.push(action);
			}
		};

		// core new actions
		addAction('workbench.action.files.newUntitledFile', localize('positronNewFile', "New File"));
		actions.push(new Separator());
		addAction(PositronNewWorkspaceAction.ID);
		addAction(PositronNewWorkspaceFromGitAction.ID);
		actions.push(new Separator());
		addAction('workbench.action.newWindow');

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
