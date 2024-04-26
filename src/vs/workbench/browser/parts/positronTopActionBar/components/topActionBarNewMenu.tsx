/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./topActionBarNewMenu';
import * as React from 'react';
import { localize } from 'vs/nls';
import { IAction, Separator } from 'vs/base/common/actions';
import { ActionBarMenuButton } from 'vs/platform/positronActionBar/browser/components/actionBarMenuButton';
import { usePositronActionBarContext } from 'vs/platform/positronActionBar/browser/positronActionBarContext';
import { PositronNewFolderAction, PositronNewFolderFromGitAction, PositronNewProjectAction } from 'vs/workbench/browser/actions/positronActions';
import { IsDevelopmentContext } from 'vs/platform/contextkey/common/contextkeys';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { USE_POSITRON_PROJECT_WIZARD_CONFIG_KEY } from 'vs/workbench/services/positronNewProject/common/positronNewProjectEnablement';

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
		// TODO: [New Project] Remove feature flag when New Project action is ready for release
		// This removes the action from the New menu in the action bar when not in a development context
		const projectWizardEnabled =
			ContextKeyExpr.deserialize(
				`config.${USE_POSITRON_PROJECT_WIZARD_CONFIG_KEY}`
			);
		positronActionBarContext.appendCommandAction(actions, {
			id: PositronNewProjectAction.ID,
			when: ContextKeyExpr.or(projectWizardEnabled, IsDevelopmentContext),
		});
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
			text={positronNew}
			actions={actions}
			tooltip={positronNewFileFolder}
		/>
	);
};
