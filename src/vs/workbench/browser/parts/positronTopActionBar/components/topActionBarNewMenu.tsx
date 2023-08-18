/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./topActionBarNewMenu';
import * as React from 'react';
import { localize } from 'vs/nls';
import { IAction, Separator } from 'vs/base/common/actions';
import { ActionBarMenuButton } from 'vs/platform/positronActionBar/browser/components/actionBarMenuButton';
import { usePositronActionBarContext } from 'vs/platform/positronActionBar/browser/positronActionBarContext';
import { PositronNewFolderAction, PositronNewFolderFromGitAction } from 'vs/workbench/browser/actions/positronActions';

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
		positronActionBarContext.appendCommandAction(actions, {
			id: 'welcome.showNewFileEntries',
			label: localize('positronNewFile', "New File...")
		});
		actions.push(new Separator());
		positronActionBarContext.appendCommandAction(actions, {
			id: PositronNewFolderAction.ID
		});
		positronActionBarContext.appendCommandAction(actions, {
			id: PositronNewFolderFromGitAction.ID
		});
		actions.push(new Separator());
		positronActionBarContext.appendCommandAction(actions, {
			id: 'workbench.action.newWindow'
		});
		return actions;
	};

	// compontent
	return (
		<ActionBarMenuButton
			iconId='positron-new'
			text={localize('positronNew', "New")}
			actions={actions}
			tooltip={localize('positronNewFileFolder', "New File/Folder")}
		/>
	);
};
