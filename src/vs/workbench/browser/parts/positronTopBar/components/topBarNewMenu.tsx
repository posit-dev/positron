/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import React = require('react');
// import { useMemo } from 'react';
import { localize } from 'vs/nls';
import { usePositronTopBarContext } from 'vs/workbench/browser/parts/positronTopBar/positronTopBarContext';
import { TopBarMenuButton } from 'vs/workbench/browser/parts/positronTopBar/components/topBarMenuButton';
import { IAction, Separator } from 'vs/base/common/actions';
import { commandAction } from 'vs/workbench/browser/parts/positronTopBar/actions';
import { PositronNewWorkspaceAction, PositronNewWorkspaceFromGitAction } from 'vs/workbench/browser/actions/positronActions';

const kNewUntitledFile = 'workbench.action.files.newUntitledFile';
const kNewWindow = 'workbench.action.newWindow';

// export const kNewMenuCommands = [
// 	kNewUntitledFile,
// 	PositronNewWorkspaceAction.ID,
// 	PositronNewWorkspaceFromGitAction.ID,
// 	kNewWindow
// ];

/**
 * TopBarNewMenu component.
 * @returns The component.
 */
export const TopBarNewMenu = () => {
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

		// core new actions
		addAction(kNewUntitledFile, localize('positronNewFile', "New File"));
		actions.push(new Separator());
		addAction(PositronNewWorkspaceAction.ID);
		addAction(PositronNewWorkspaceFromGitAction.ID);
		actions.push(new Separator());
		addAction(kNewWindow);

		return actions;
	};

	// compontent
	return (
		<TopBarMenuButton
			actions={actions}
			iconId='positron-new'
			tooltip={localize('positronNewFileWorkspace', "New File/Workspace")}
		/>
	);
};
