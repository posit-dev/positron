/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./customFolderMenuItems';
import * as React from 'react';
// import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { localize } from 'vs/nls';
import { CustomFolderMenuItem } from 'vs/workbench/browser/parts/positronTopActionBar/customFolderModalPopup/customFolderMenuItem';
import { CustomFolderMenuSeparator } from 'vs/workbench/browser/parts/positronTopActionBar/customFolderModalPopup/customFolderMenuSeparator';
import { IRecentlyOpened, isRecentWorkspace, isRecentFolder, IRecentWorkspace, IRecentFile, IRecentFolder, isRecentFile } from 'vs/platform/workspaces/common/workspaces';
import { ILabelService, Verbosity } from 'vs/platform/label/common/label';

/**
 * Constants.
 */
//const MAX_MENU_RECENT_ENTRIES = 10;

/**
 * CustomFolderMenuItemsProps interface.
 */
interface CustomFolderMenuItemsProps {
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

	const getLabel = (x: IRecentWorkspace | IRecentFolder | IRecentFile) => {
		if (isRecentWorkspace(x)) {
			return x.label || props.labelService.getWorkspaceLabel(x.workspace, { verbose: Verbosity.LONG });
		} else if (isRecentFolder(x)) {
			return x.label || props.labelService.getWorkspaceLabel(x.folderUri, { verbose: Verbosity.LONG });
		} else if (isRecentFile(x)) {
			return x.label || props.labelService.getWorkspaceLabel(x.fileUri, { verbose: Verbosity.LONG });
		} else {
			return 'uaua';
		}
	};

	const RecentWorkspacesCustomFolderMenuItems = () => {
		if (!props.recentlyOpened.workspaces.length) {
			return null;
		}

		// let count = 0;
		return (
			<>
				<CustomFolderMenuSeparator />

				{props.recentlyOpened.workspaces.map(x => {
					const label = getLabel(x);
					return !label ? null : <CustomFolderMenuItem
						title={getLabel(x)}
						onSelected={props.onMenuItemSelected}
					/>;

				}
				)}
			</>
		);
	};

	const RecentFilesCustomFolderMenuItems = () => {
		if (!props.recentlyOpened.files.length) {
			return null;
		}

		// let count = 0;
		return (
			<>
				<CustomFolderMenuSeparator />

				{props.recentlyOpened.files.map(x => {
					return <CustomFolderMenuItem
						title={getLabel(x)}
						onSelected={props.onMenuItemSelected}
					/>;

				}
				)}
			</>
		);
	};

	// Render.
	return (
		<div className='custom-folder-menu-items'>
			<CustomFolderMenuItem
				title={localize('positronNewFolder', "New Folder...")}
				onSelected={props.onMenuItemSelected}
			/>
			<CustomFolderMenuItem
				title={localize('positronNewFolderFromGit', "New Folder from Git...")}
				onSelected={props.onMenuItemSelected}
			/>

			<CustomFolderMenuSeparator />

			<CustomFolderMenuItem
				title={localize('positronOpenFolder', "Open Folder...")}
				onSelected={props.onMenuItemSelected}
			/>
			<CustomFolderMenuItem
				title={localize('positronOpenFolderInNewWindow', "Open Folder in New Window...")}
				onSelected={props.onMenuItemSelected}
			/>

			<RecentWorkspacesCustomFolderMenuItems />

			<RecentFilesCustomFolderMenuItems />

			<CustomFolderMenuSeparator />

			<CustomFolderMenuItem
				title={localize('positronClearRecentlyOpenedFolders', "Clear Recently Opened Folders")}
				onSelected={props.onMenuItemSelected}
			/>
		</div>
	);
};
