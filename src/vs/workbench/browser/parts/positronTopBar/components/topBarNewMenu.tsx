/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { localize } from 'vs/nls';
import { IAction, Separator } from 'vs/base/common/actions';
import { usePositronTopBarContext } from 'vs/workbench/browser/parts/positronTopBar/positronTopBarContext';
import { TopBarMenuButton } from 'vs/workbench/browser/parts/positronTopBar/components/topBarMenuButton';
import { PositronNewWorkspaceAction, PositronNewWorkspaceFromGitAction } from 'vs/workbench/browser/actions/positronActions';

/**
 * TopBarNewMenu component.
 * @returns The component.
 */
export const TopBarNewMenu = () => {
	// Hooks.
	const positronTopBarContext = usePositronTopBarContext();

	// fetch actions when menu is shown
	const actions = async () => {
		const actions: IAction[] = [];
		const addAction = (id: string, label?: string) => {
			const action = positronTopBarContext.createCommandAction(id, label);
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
		<TopBarMenuButton
			iconId='positron-new'
			actions={actions}
			tooltip={localize('positronNewFileWorkspace', "New File/Workspace")}
		/>
	);
};
