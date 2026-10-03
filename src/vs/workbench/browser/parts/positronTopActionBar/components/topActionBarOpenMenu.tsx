/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './topActionBarOpenMenu.css';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { IAction } from '../../../../../base/common/actions.js';
import { IsMacNativeContext } from '../../../../../platform/contextkey/common/contextkeys.js';
import { ActionBarMenuButton } from '../../../../../platform/positronActionBar/browser/components/actionBarMenuButton.js';
import { usePositronActionBarContext } from '../../../../../platform/positronActionBar/browser/positronActionBarContext.js';
import { OpenFileAction, OpenFileFolderAction, OpenFolderAction } from '../../../actions/workspaceActions.js';
import { PositronOpenFolderInNewWindowAction } from '../../../actions/positronActions.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';

/**
 * Localized strings.
 */
const positronOpen = localize('positronOpen', "Open");
const positronOpenFile = localize('positronOpenFile', "Open File...");
const positronOpenFolder = localize('positronOpenFolder', "Open Folder...");
const positronOpenFileFolder = localize('positronOpenFileFolder', "Open File/Folder");

/**
 * TopActionBarOpenMenu component.
 * @returns The rendered component.
 */
export const TopActionBarOpenMenu = () => {
	// Hooks.
	const services = usePositronReactServicesContext();
	const positronActionBarContext = usePositronActionBarContext()!;

	// fetch actions when menu is shown
	const actions = () => {
		// core open actions
		const actions: IAction[] = [];
		if (IsMacNativeContext.getValue(services.contextKeyService)) {
			positronActionBarContext.appendCommandAction(actions, {
				id: OpenFileFolderAction.ID,
				label: positronOpenFile
			});
		} else {
			positronActionBarContext.appendCommandAction(actions, {
				id: OpenFileAction.ID
			});
		}
		positronActionBarContext.appendCommandAction(actions, {
			id: OpenFolderAction.ID,
			label: positronOpenFolder
		});
		positronActionBarContext.appendCommandAction(actions, {
			id: PositronOpenFolderInNewWindowAction.ID
		});
		return actions;
	};

	// Render.
	return (
		<ActionBarMenuButton
			actions={actions}
			icon={ThemeIcon.fromId('folder-opened')}
			iconFontSize={18}
			label={positronOpen}
			tooltip={positronOpenFileFolder}
		/>
	);
};
