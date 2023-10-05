/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./customFolderMenuItems';
import * as React from 'react';
import { localize } from 'vs/nls';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { ILabelService, Verbosity } from 'vs/platform/label/common/label';
import { CommandCenter } from 'vs/platform/commandCenter/common/commandCenter';
import { OpenFolderAction } from 'vs/workbench/browser/actions/workspaceActions';
import { CommandAction } from 'vs/platform/positronActionBar/browser/positronActionBarState';
import { ContextKeyExpr, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { ClearRecentWorkspacesAction } from 'vs/workbench/browser/parts/editor/workspaceActions';
import { EmptyWorkspaceSupportContext, WorkbenchStateContext } from 'vs/workbench/common/contextkeys';
import { CustomFolderMenuItem } from 'vs/workbench/browser/parts/positronTopActionBar/customFolderModalPopup/customFolderMenuItem';
import { CustomFolderMenuSeparator } from 'vs/workbench/browser/parts/positronTopActionBar/customFolderModalPopup/customFolderMenuSeparator';
import { IRecentlyOpened, isRecentWorkspace, isRecentFolder, IRecentWorkspace, IRecentFolder } from 'vs/platform/workspaces/common/workspaces';
import { PositronNewFolderAction, PositronNewFolderFromGitAction, PositronOpenFolderInNewWindowAction } from 'vs/workbench/browser/actions/positronActions';

/**
 * Constants.
 */
//const MAX_MENU_RECENT_ENTRIES = 10;
const kCloseFolder = 'workbench.action.closeFolder';

/**
 * CustomFolderMenuItemsProps interface.
 */
interface CustomFolderMenuItemsProps {
	commandService: ICommandService;
	contextKeyService: IContextKeyService;
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
	 * Gets the label for an IRecentWorkspace or IRecentFolder.
	 * @param recent The IRecentWorkspace or IRecentFolder.
	 * @returns The label for the IRecentWorkspace or IRecentFolder.
	 */
	const getRecentWorkspaceFolderLabel = (recent: IRecentWorkspace | IRecentFolder) => {
		if (isRecentWorkspace(recent)) {
			return recent.label || props.labelService.getWorkspaceLabel(recent.workspace, { verbose: Verbosity.LONG });
		} else if (isRecentFolder(recent)) {
			return recent.label || props.labelService.getWorkspaceLabel(recent.folderUri, { verbose: Verbosity.LONG });
		} else {
			throw new Error('Failed to get recent label.');
		}
	};

	/**
	 * CustomFolderCommandMenuItem component.
	 * @param commandAction The CommandAction for the custom folder command menu item.
	 */
	const CustomFolderCommandMenuItem = (commandAction: CommandAction) => {
		// Get the command info from the command center.
		const commandInfo = CommandCenter.commandInfo(commandAction.id);

		// If the command info was found, and the when expression matches, return the custom folder
		// command menu item. If not, return null.
		if (commandInfo && props.contextKeyService.contextMatchesRules(commandAction.when)) {
			// Determine whether the command action will be enabled and set the label to use.
			const enabled = !commandInfo.precondition || props.contextKeyService.contextMatchesRules(commandInfo.precondition);
			const label = commandAction.label || (typeof (commandInfo.title) === 'string' ? commandInfo.title : commandInfo.title.value);

			// Return the
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
		} else {
			return null;
		}
	};

	const RecentWorkspacesCustomFolderMenuItems = () => {
		// If there are no recently opened workspaces, return null.
		if (!props.recentlyOpened.workspaces.length) {
			return null;
		}

		// let count = 0;
		// Return the
		return (
			<>
				<CustomFolderMenuSeparator />

				{props.recentlyOpened.workspaces.map(recent => {
					const label = getRecentWorkspaceFolderLabel(recent);
					if (!label) {
						return null;
					} else {
						return (
							<CustomFolderMenuItem
								label={getRecentWorkspaceFolderLabel(recent)}
								enabled={true}
								onSelected={props.onMenuItemSelected}
							/>
						);
					}
				})}
			</>
		);
	};

	// Render.
	return (
		<div className='custom-folder-menu-items'>
			<CustomFolderCommandMenuItem id={PositronNewFolderAction.ID} />
			<CustomFolderCommandMenuItem id={PositronNewFolderFromGitAction.ID} />

			<CustomFolderMenuSeparator />

			<CustomFolderCommandMenuItem
				id={OpenFolderAction.ID}
				label={localize('positronOpenFolder', "Open Folder...")} />

			<CustomFolderCommandMenuItem id={PositronOpenFolderInNewWindowAction.ID} />

			<CustomFolderCommandMenuItem
				id={kCloseFolder}
				label={localize('positronCloseFolder', "Close Folder...")}
				separator={true}
				when={ContextKeyExpr.and(
					WorkbenchStateContext.isEqualTo('folder'),
					EmptyWorkspaceSupportContext
				)}
			/>

			<RecentWorkspacesCustomFolderMenuItems />

			<CustomFolderMenuSeparator />

			<CustomFolderCommandMenuItem id={ClearRecentWorkspacesAction.ID} />
		</div>
	);
};
