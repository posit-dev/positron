/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './topActionBarNewMenu.css';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { IAction, Separator } from '../../../../../base/common/actions.js';
import { ActionBarMenuButton } from '../../../../../platform/positronActionBar/browser/components/actionBarMenuButton.js';
import { usePositronActionBarContext } from '../../../../../platform/positronActionBar/browser/positronActionBarContext.js';
import { PositronNewFolderFromTemplateAction, PositronNewFolderFromGitAction } from '../../../actions/positronActions.js';

/**
 * Localized strings.
 */
const positronNew = localize('positronNew', "New");
const positronNewFile = localize('positronNewFile', "New File...");
const positronNewFileFolder = localize('positronNewFileFolder', "New File/Folder");

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
			label: positronNewFile
		});
		actions.push(new Separator());
		positronActionBarContext.appendCommandAction(actions, {
			id: PositronNewFolderFromTemplateAction.ID,
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
			actions={actions}
			icon={ThemeIcon.fromId('positron-new')}
			label={positronNew}
			tooltip={positronNewFileFolder}
		/>
	);
};
