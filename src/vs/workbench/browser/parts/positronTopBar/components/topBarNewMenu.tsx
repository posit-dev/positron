/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import React = require('react');
import { localize } from 'vs/nls';
import { usePositronTopBarContext } from 'vs/workbench/browser/parts/positronTopBar/positronTopBarContext';
import { TopBarMenuButton } from 'vs/workbench/browser/parts/positronTopBar/components/topBarMenuButton';
import { IAction, Separator } from 'vs/base/common/actions';
import { commandAction } from 'vs/workbench/browser/parts/positronTopBar/actions';

const kNewUntitledFile = 'workbench.action.files.newUntitledFile';
const kNewWindow = 'workbench.action.newWindow';

export const kNewMenuCommands = [
	kNewUntitledFile, kNewWindow
];

/**
 * TopBarNewMenu component.
 * @returns The component.
 */
export const TopBarNewMenu = () => {

	// Hooks.
	const context = usePositronTopBarContext();

	// fetch actions when menu is shown
	const actions = async () => {

		const actions: IAction[] = [];
		const addAction = (id: string, label?: string) => {
			const action = commandAction(id, label, context);
			if (action) {
				actions.push(action);
			}
		};

		// core new actions
		addAction(kNewUntitledFile, localize('newFile', "New Text File"));
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
