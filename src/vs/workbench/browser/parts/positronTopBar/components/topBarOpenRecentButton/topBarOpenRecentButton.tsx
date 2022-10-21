/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

// menubarControl.ts

import React = require('react');
import { usePositronTopBarContext } from 'vs/workbench/browser/parts/positronTopBar/positronTopBarContext';
import { TopBarMenuButton } from 'vs/workbench/browser/parts/positronTopBar/components/topBarMenuButton/topBarMenuButton';
import { URI } from 'vs/base/common/uri';
import { isMacintosh } from 'vs/base/common/platform';
import { Action, IAction, Separator } from 'vs/base/common/actions';
import { IRecent, isRecentFolder, isRecentWorkspace } from 'vs/platform/workspaces/common/workspaces';
import { IOpenRecentAction } from 'vs/workbench/browser/parts/titlebar/menubarControl';
import { IWindowOpenable } from 'vs/platform/window/common/window';
import { unmnemonicLabel } from 'vs/base/common/labels';
import { PositronTopBarState } from 'vs/workbench/browser/parts/positronTopBar/positronTopBarState';

const MAX_MENU_RECENT_ENTRIES = 10;

/**
 * TopBarOpenRecentButton component.
 * @returns The component.
 */
export const TopBarOpenRecentButton = () => {

	// Hooks.
	const context = usePositronTopBarContext();

	// fetch actions when menu is shown
	const actions = async () => {
		const actions: IAction[] = [];
		const recent = await context?.workspacesService.getRecentlyOpened();
		if (recent && context) {
			actions.push(
				...recentMenuActions(context, recent.workspaces),
				...recentMenuActions(context, recent.files)
			);
		}
		return actions;
	};

	// compontent
	return (
		<TopBarMenuButton actions={actions} iconClassName='open-file-icon' tooltip='Open file' />
	);
};

function recentMenuActions(context: PositronTopBarState, recent: IRecent[]) {
	const actions: IAction[] = [];
	if (recent.length > 0) {
		for (let i = 0; i < MAX_MENU_RECENT_ENTRIES && i < recent.length; i++) {
			actions.push(createOpenRecentMenuAction(context, recent[i]));
		}
		actions.push(new Separator());
	}
	return actions;
}

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
