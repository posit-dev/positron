/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { localize } from 'vs/nls';
import { usePositronTopBarContext } from 'vs/workbench/browser/parts/positronTopBar/positronTopBarContext';
import { TopBarMenuButton } from 'vs/workbench/browser/parts/positronTopBar/components/topBarMenuButton';
import { URI } from 'vs/base/common/uri';
import { isMacintosh } from 'vs/base/common/platform';
import { Action, IAction, Separator } from 'vs/base/common/actions';
import { IRecent, isRecentFolder, isRecentWorkspace } from 'vs/platform/workspaces/common/workspaces';
import { IOpenRecentAction } from 'vs/workbench/browser/parts/titlebar/menubarControl';
import { IWindowOpenable } from 'vs/platform/window/common/window';
import { unmnemonicLabel } from 'vs/base/common/labels';
import { PositronTopBarState } from 'vs/workbench/browser/parts/positronTopBar/positronTopBarState';
import { IsMacNativeContext } from 'vs/platform/contextkey/common/contextkeys';
import { OpenFileAction, OpenFileFolderAction, OpenFolderAction } from 'vs/workbench/browser/actions/workspaceActions';
import { OpenRecentAction } from 'vs/workbench/browser/actions/windowActions';
import { ClearRecentFilesAction } from 'vs/workbench/browser/parts/editor/editorActions';

const MAX_MENU_RECENT_ENTRIES = 10;

/**
 * TopBarOpenMenu component.
 * @returns The component.
 */
export const TopBarOpenMenu = () => {
	// Hooks.
	const positronTopBarContext = usePositronTopBarContext()!;

	// fetch actions when menu is shown
	const actions = async () => {
		const actions: IAction[] = [];
		const addAction = (id: string, label?: string) => {
			const action = positronTopBarContext.createCommandAction(id, label);
			if (action) {
				actions.push(action);
			}
		};

		// core open actions
		if (IsMacNativeContext.getValue(positronTopBarContext.contextKeyService)) {
			addAction(OpenFileFolderAction.ID, localize('positronOpenFile', "Open File..."));
		} else {
			addAction(OpenFileAction.ID);
		}

		addAction(OpenFolderAction.ID, localize('positronOpenWorkspace', "Open Workspace..."));
		actions.push(new Separator());

		// recent files/workspaces actions
		const recent = await positronTopBarContext.workspacesService.getRecentlyOpened();
		if (recent && positronTopBarContext) {
			const recentActions = [
				...recentMenuActions(recent.workspaces, positronTopBarContext),
				...recentMenuActions(recent.files, positronTopBarContext)
			];
			if (recentActions.length > 0) {
				actions.push(...recentActions);
				actions.push(new Separator());
				addAction(OpenRecentAction.ID);
				actions.push(new Separator());
				addAction(ClearRecentFilesAction.ID);
			}
		}
		return actions;
	};

	// Render.
	return (
		<TopBarMenuButton
			iconId='positron-open'
			actions={actions}
			tooltip={localize('positronOpenFileWorkspace', "Open File/Workspace")}
		/>
	);
};

export function recentMenuActions(recent: IRecent[], context: PositronTopBarState,) {
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
function createOpenRecentMenuAction(context: PositronTopBarState, recent: IRecent): IOpenRecentAction {

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
