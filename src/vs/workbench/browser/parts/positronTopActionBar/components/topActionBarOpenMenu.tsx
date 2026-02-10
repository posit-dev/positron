/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './topActionBarOpenMenu.css';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { URI } from '../../../../../base/common/uri.js';
import { isMacintosh } from '../../../../../base/common/platform.js';
import { unmnemonicLabel } from '../../../../../base/common/labels.js';
import { Verbosity } from '../../../../../platform/label/common/label.js';
import { IWindowOpenable } from '../../../../../platform/window/common/window.js';
import { Action, IAction, Separator } from '../../../../../base/common/actions.js';
import { OpenRecentAction } from '../../../actions/windowActions.js';
import { IsMacNativeContext } from '../../../../../platform/contextkey/common/contextkeys.js';
import { IOpenRecentAction } from '../../titlebar/menubarControl.js';
import { ClearRecentFilesAction } from '../../editor/editorActions.js';
import { IRecent, isRecentFolder, isRecentWorkspace } from '../../../../../platform/workspaces/common/workspaces.js';
import { ActionBarMenuButton } from '../../../../../platform/positronActionBar/browser/components/actionBarMenuButton.js';
import { usePositronActionBarContext } from '../../../../../platform/positronActionBar/browser/positronActionBarContext.js';
import { OpenFileAction, OpenFileFolderAction, OpenFolderAction } from '../../../actions/workspaceActions.js';
import { usePositronTopActionBarContext } from '../positronTopActionBarContext.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';

/**
 * Constants.
 */
const MAX_MENU_RECENT_ENTRIES = 10;

/**
 * Localized strings.
 */
const positronOpen = localize('positronOpen', "Open");
const positronOpenFile = localize('positronOpenFile', "Open File...");
const positronOpenFolder = localize('positronOpenFolder', "Open Folder...");
const positronOpenFileFolder = localize('positronOpenFileFolder', "Open File/Folder");

/**
 * TopActionBarOpenMenu component.
 * @returns The component.
 */
export const TopActionBarOpenMenu = () => {
	// Hooks.
	const services = usePositronReactServicesContext();
	const positronActionBarContext = usePositronActionBarContext()!;
	const positronTopActionBarContext = usePositronTopActionBarContext()!;


	function recentMenuActions(recent: IRecent[]) {
		const actions: IAction[] = [];
		if (recent.length > 0) {
			for (let i = 0; i < MAX_MENU_RECENT_ENTRIES && i < recent.length; i++) {
				actions.push(createOpenRecentMenuAction(recent[i]));
			}
			actions.push(new Separator());
		}
		return actions;
	}

	// based on code in menubarControl.ts
	function createOpenRecentMenuAction(recent: IRecent): IOpenRecentAction {

		let label: string;
		let uri: URI;
		let commandId: string;
		let openable: IWindowOpenable;
		const remoteAuthority = recent.remoteAuthority;

		if (isRecentFolder(recent)) {
			uri = recent.folderUri;
			label = recent.label || services.labelService.getWorkspaceLabel(uri, { verbose: Verbosity.LONG });
			commandId = 'openRecentFolder';
			openable = { folderUri: uri };
		} else if (isRecentWorkspace(recent)) {
			uri = recent.workspace.configPath;
			label = recent.label || services.labelService.getWorkspaceLabel(recent.workspace, { verbose: Verbosity.LONG });
			commandId = 'openRecentWorkspace';
			openable = { workspaceUri: uri };
		} else {
			uri = recent.fileUri;
			label = recent.label || services.labelService.getUriLabel(uri);
			commandId = 'openRecentFile';
			openable = { fileUri: uri };
		}

		const ret: IAction = new Action(commandId, unmnemonicLabel(label), undefined, undefined, event => {
			const browserEvent = event as KeyboardEvent;
			const openInNewWindow = event && ((!isMacintosh && (browserEvent.ctrlKey || browserEvent.shiftKey)) || (isMacintosh && (browserEvent.metaKey || browserEvent.altKey)));

			return services.hostService.openWindow([openable], {
				forceNewWindow: !!openInNewWindow,
				remoteAuthority: remoteAuthority || null // local window if remoteAuthority is not set or can not be deducted from the openable
			});
		});

		return Object.assign(ret, { uri, remoteAuthority });
	}


	// fetch actions when menu is shown
	const actions = async () => {
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
		actions.push(new Separator());

		// recent files/workspaces actions
		const recent = await services.workspacesService.getRecentlyOpened();
		if (recent && positronTopActionBarContext) {
			const recentActions = [
				...recentMenuActions(recent.workspaces),
				...recentMenuActions(recent.files)
			];
			if (recentActions.length > 0) {
				actions.push(...recentActions);
				actions.push(new Separator());
				positronActionBarContext.appendCommandAction(actions, {
					id: OpenRecentAction.ID
				});
				actions.push(new Separator());
				positronActionBarContext.appendCommandAction(actions, {
					id: ClearRecentFilesAction.ID
				});
			}
		}
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
