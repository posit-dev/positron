/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './customFolderMenuItems.css';

// React.
import React from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { URI } from '../../../../../base/common/uri.js';
import { isMacintosh } from '../../../../../base/common/platform.js';
import { IWindowOpenable } from '../../../../../platform/window/common/window.js';
import { IHostService } from '../../../../services/host/browser/host.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { ILabelService, Verbosity } from '../../../../../platform/label/common/label.js';
import { CommandCenter } from '../../../../../platform/commandCenter/common/commandCenter.js';
import { OpenFolderAction } from '../../../actions/workspaceActions.js';
import { CommandAction } from '../../../../../platform/positronActionBar/browser/positronActionBarState.js';
import { ContextKeyExpr, IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { ClearRecentWorkspacesAction } from '../../editor/workspaceActions.js';
import { EmptyWorkspaceSupportContext, WorkbenchStateContext } from '../../../../common/contextkeys.js';
import { IRecentlyOpened, isRecentWorkspace, isRecentFolder } from '../../../../../platform/workspaces/common/workspaces.js';
import { CustomFolderMenuItem } from './customFolderMenuItem.js';
import { CustomFolderMenuSeparator } from './customFolderMenuSeparator.js';
import { CustomFolderRecentlyUsedMenuItem } from './customFolderRecentlyUsedMenuItem.js';
import { PositronNewFolderAction, PositronNewFolderFromGitAction, PositronNewProjectAction, PositronOpenFolderInNewWindowAction } from '../../../actions/positronActions.js';

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
				{props.recentlyOpened.workspaces.slice(0, 10).map((recent, index) => {
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
						<CustomFolderRecentlyUsedMenuItem
							key={index}
							enabled={true}
							label={label}
							onOpen={e => {
								props.onMenuItemSelected();
								props.hostService.openWindow([openable], {
									forceNewWindow: (!isMacintosh && (e.ctrlKey || e.shiftKey)) || (isMacintosh && (e.metaKey || e.altKey)),
									remoteAuthority: recent.remoteAuthority || null
								});
							}}
							onOpenInNewWindow={e => {
								props.onMenuItemSelected();
								props.hostService.openWindow([openable], {
									forceNewWindow: true,
									remoteAuthority: recent.remoteAuthority || null
								});
							}}
						/>
					);
				})}
			</>
		);
	};

	// Render.
	return (
		<div className='custom-folder-menu-items'>
			<CommandActionCustomFolderMenuItem id={PositronNewProjectAction.ID} />
			<CommandActionCustomFolderMenuItem id={PositronNewFolderAction.ID} />
			<CommandActionCustomFolderMenuItem id={PositronNewFolderFromGitAction.ID} />
			<CustomFolderMenuSeparator />
			<CommandActionCustomFolderMenuItem
				id={OpenFolderAction.ID}
				label={(() => localize('positronOpenFolder', "Open Folder..."))()} />
			<CommandActionCustomFolderMenuItem id={PositronOpenFolderInNewWindowAction.ID} />
			<CommandActionCustomFolderMenuItem
				id={kCloseFolder}
				label={(() => localize('positronCloseFolder', "Close Folder"))()}
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
