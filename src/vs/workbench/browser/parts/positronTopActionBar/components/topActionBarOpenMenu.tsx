/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./topActionBarOpenMenu';
import * as React from 'react';
import { localize } from 'vs/nls';
import { URI } from 'vs/base/common/uri';
import { isMacintosh } from 'vs/base/common/platform';
import { unmnemonicLabel } from 'vs/base/common/labels';
import { IWindowOpenable } from 'vs/platform/window/common/window';
import { Action, IAction, Separator } from 'vs/base/common/actions';
import { OpenRecentAction } from 'vs/workbench/browser/actions/windowActions';
import { IsMacNativeContext } from 'vs/platform/contextkey/common/contextkeys';
import { IOpenRecentAction } from 'vs/workbench/browser/parts/titlebar/menubarControl';
import { ClearRecentFilesAction } from 'vs/workbench/browser/parts/editor/editorActions';
import { IRecent, isRecentFolder, isRecentWorkspace } from 'vs/platform/workspaces/common/workspaces';
import { ActionBarMenuButton } from 'vs/platform/positronActionBar/browser/components/actionBarMenuButton';
import { usePositronActionBarContext } from 'vs/platform/positronActionBar/browser/positronActionBarContext';
import { PositronTopActionBarState } from 'vs/workbench/browser/parts/positronTopActionBar/positronTopActionBarState';
import { OpenFileAction, OpenFileFolderAction, OpenFolderAction } from 'vs/workbench/browser/actions/workspaceActions';
import { usePositronTopActionBarContext } from 'vs/workbench/browser/parts/positronTopActionBar/positronTopActionBarContext';

const MAX_MENU_RECENT_ENTRIES = 10;

/**
 * TopActionBarOpenMenu component.
 * @returns The component.
 */
export const TopActionBarOpenMenu = () => {
	// Hooks.
	const positronActionBarContext = usePositronActionBarContext()!;
	const positronTopActionBarContext = usePositronTopActionBarContext()!;

	// fetch actions when menu is shown
	const actions = async () => {
		// core open actions
		const actions: IAction[] = [];
		if (IsMacNativeContext.getValue(positronActionBarContext.contextKeyService)) {
			positronActionBarContext.appendCommandAction(actions, OpenFileFolderAction.ID, localize('positronOpenFile', "Open File..."));
		} else {
			positronActionBarContext.appendCommandAction(actions, OpenFileAction.ID);
		}

		positronActionBarContext.appendCommandAction(actions, OpenFolderAction.ID, localize('positronOpenWorkspace', "Open Workspace..."));
		actions.push(new Separator());

		// recent files/workspaces actions
		const recent = await positronTopActionBarContext.workspacesService.getRecentlyOpened();
		if (recent && positronTopActionBarContext) {
			const recentActions = [
				...recentMenuActions(recent.workspaces, positronTopActionBarContext),
				...recentMenuActions(recent.files, positronTopActionBarContext)
			];
			if (recentActions.length > 0) {
				actions.push(...recentActions);
				actions.push(new Separator());
				positronActionBarContext.appendCommandAction(actions, OpenRecentAction.ID);
				actions.push(new Separator());
				positronActionBarContext.appendCommandAction(actions, ClearRecentFilesAction.ID);
			}
		}
		return actions;
	};

	// Render.
	return (
		<ActionBarMenuButton
			iconId='positron-open'
			actions={actions}
			tooltip={localize('positronOpenFileWorkspace', "Open File/Workspace")}
		/>
	);
};

export function recentMenuActions(recent: IRecent[], context: PositronTopActionBarState,) {
	const actions: IAction[] = [];
	if (recent.length > 0) {
		for (let i = 0; i < MAX_MENU_RECENT_ENTRIES && i < recent.length; i++) {
			actions.push(createOpenRecentMenuAction(context, recent[i]));
		}
		actions.push(new Separator());
	}
	return actions;
}

// based on code in menubarControl.ts
function createOpenRecentMenuAction(context: PositronTopActionBarState, recent: IRecent): IOpenRecentAction {

	let label: string;
	let uri: URI;
	let commandId: string;
	let openable: IWindowOpenable;
	const remoteAuthority = recent.remoteAuthority;

	if (isRecentFolder(recent)) {
		uri = recent.folderUri;
		label = recent.label || context.labelService.getWorkspaceLabel(uri, { verbose: true });
		commandId = 'openRecentFolder';
		openable = { folderUri: uri };
	} else if (isRecentWorkspace(recent)) {
		uri = recent.workspace.configPath;
		label = recent.label || context.labelService.getWorkspaceLabel(recent.workspace, { verbose: true });
		commandId = 'openRecentWorkspace';
		openable = { workspaceUri: uri };
	} else {
		uri = recent.fileUri;
		label = recent.label || context.labelService.getUriLabel(uri);
		commandId = 'openRecentFile';
		openable = { fileUri: uri };
	}

	const ret: IAction = new Action(commandId, unmnemonicLabel(label), undefined, undefined, event => {
		const browserEvent = event as KeyboardEvent;
		const openInNewWindow = event && ((!isMacintosh && (browserEvent.ctrlKey || browserEvent.shiftKey)) || (isMacintosh && (browserEvent.metaKey || browserEvent.altKey)));

		return context.hostService.openWindow([openable], {
			forceNewWindow: !!openInNewWindow,
			remoteAuthority: remoteAuthority || null // local window if remoteAuthority is not set or can not be deducted from the openable
		});
	});

	return Object.assign(ret, { uri, remoteAuthority });
}
