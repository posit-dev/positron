/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./customFolderMenuItems';
import * as React from 'react';
import { localize } from 'vs/nls';
import { URI } from 'vs/base/common/uri';
import { isMacintosh } from 'vs/base/common/platform';
import { IWindowOpenable } from 'vs/platform/window/common/window';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { ILabelService, Verbosity } from 'vs/platform/label/common/label';
import { CommandCenter } from 'vs/platform/commandCenter/common/commandCenter';
import { OpenFolderAction } from 'vs/workbench/browser/actions/workspaceActions';
import { CommandAction } from 'vs/platform/positronActionBar/browser/positronActionBarState';
import { ContextKeyExpr, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { ClearRecentWorkspacesAction } from 'vs/workbench/browser/parts/editor/workspaceActions';
import { EmptyWorkspaceSupportContext, WorkbenchStateContext } from 'vs/workbench/common/contextkeys';
import { IRecentlyOpened, isRecentWorkspace, isRecentFolder } from 'vs/platform/workspaces/common/workspaces';
import { CustomFolderMenuItem } from 'vs/workbench/browser/parts/positronTopActionBar/customFolderModalPopup/customFolderMenuItem';
import { CustomFolderMenuSeparator } from 'vs/workbench/browser/parts/positronTopActionBar/customFolderModalPopup/customFolderMenuSeparator';
import { PositronNewFolderAction, PositronNewFolderFromGitAction, PositronOpenFolderInNewWindowAction } from 'vs/workbench/browser/actions/positronActions';

/**
 * Constants.
 */
const kCloseFolder = 'workbench.action.closeFolder';

/**
 * CustomFolderMenuItemsProps interface.
 */
interface CustomFolderMenuItemsProps {
	commandService: ICommandService;
	contextKeyService: IContextKeyService;
	hostService: IHostService;
	labelService: ILabelService;
	recentlyOpened: IRecentlyOpened;
	onMenuItemSelected: () => void;
}

/**
 * CustomFolderMenuItems component.
 * @param props A CustomFolderMenuItemsProps that contains the component properties.
 * @returns The rendered component.
 */
export const CustomFolderMenuItems = (props: CustomFolderMenuItemsProps) => {
	/**
	 * CommandActionCustomFolderMenuItem component.
	 * @param commandAction The CommandAction.
	 * @returns The rendered component.
	 */
	const CommandActionCustomFolderMenuItem = (commandAction: CommandAction) => {
		// Get the command info from the command center.
		const commandInfo = CommandCenter.commandInfo(commandAction.id);

		// If the command info wasn't found, or the when expression doesn't match, return null.
		if (!commandInfo || !props.contextKeyService.contextMatchesRules(commandAction.when)) {
			return null;
		}

		// Determine whether the command action will be enabled and set the label to use.
		const enabled = !commandInfo.precondition ||
			props.contextKeyService.contextMatchesRules(commandInfo.precondition);
		const label = commandAction.label ||
			(typeof (commandInfo.title) === 'string' ?
				commandInfo.title :
				commandInfo.title.value);

		// Render.
		return (
			<>
				{commandAction.separator && <CustomFolderMenuSeparator />}
				<CustomFolderMenuItem
					enabled={enabled}
					label={label}
					onSelected={() => {
						props.onMenuItemSelected();
						props.commandService.executeCommand(commandAction.id);
					}}
				/>
			</>
		);
	};

	/**
	 * RecentWorkspacesCustomFolderMenuItems component.
	 * @returns The rendered component.
	 */
	const RecentWorkspacesCustomFolderMenuItems = () => {
		// If there are no recently opened workspaces, return null.
		if (!props.recentlyOpened.workspaces.length) {
			return null;
		}

		// Render.
		return (
			<>
				<CustomFolderMenuSeparator />
				{props.recentlyOpened.workspaces.slice(0, 10).map(recent => {
					// Setup the handler.
					let uri: URI;
					let label: string;
					let openable: IWindowOpenable;
					if (isRecentWorkspace(recent)) {
						uri = recent.workspace.configPath;
						label = recent.label || props.labelService.getWorkspaceLabel(recent.workspace, { verbose: Verbosity.LONG });
						openable = { workspaceUri: uri };
					} else if (isRecentFolder(recent)) {
						uri = recent.folderUri;
						label = recent.label || props.labelService.getWorkspaceLabel(uri, { verbose: Verbosity.LONG });
						openable = { folderUri: uri };
					} else {
						// This can't happen.
						return null;
					}

					// Render.
					return (
						<CustomFolderMenuItem label={label} enabled={true} onSelected={e => {
							props.onMenuItemSelected();
							props.hostService.openWindow([openable], {
								forceNewWindow: (!isMacintosh && (e.ctrlKey || e.shiftKey)) || (isMacintosh && (e.metaKey || e.altKey)),
								remoteAuthority: recent.remoteAuthority || null
							});
						}} />
					);
				})}
			</>
		);
	};

	// Render.
	return (
		<div className='custom-folder-menu-items'>
			<CommandActionCustomFolderMenuItem id={PositronNewFolderAction.ID} />
			<CommandActionCustomFolderMenuItem id={PositronNewFolderFromGitAction.ID} />
			<CustomFolderMenuSeparator />
			<CommandActionCustomFolderMenuItem
				id={OpenFolderAction.ID}
				label={localize('positronOpenFolder', "Open Folder...")} />
			<CommandActionCustomFolderMenuItem id={PositronOpenFolderInNewWindowAction.ID} />
			<CommandActionCustomFolderMenuItem
				id={kCloseFolder}
				label={localize('positronCloseFolder', "Close Folder")}
				separator={true}
				when={ContextKeyExpr.and(
					WorkbenchStateContext.isEqualTo('folder'),
					EmptyWorkspaceSupportContext
				)}
			/>
			<RecentWorkspacesCustomFolderMenuItems />
			<CustomFolderMenuSeparator />
			<CommandActionCustomFolderMenuItem id={ClearRecentWorkspacesAction.ID} />
		</div>
	);
};
