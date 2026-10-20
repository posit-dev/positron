/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './customFolderMenuItems.css';

// React.
import { useEffect, useRef, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { isEqual } from '../../../../../base/common/resources.js';
import { CustomFolderMenuItem } from './customFolderMenuItem.js';
import { isMacintosh } from '../../../../../base/common/platform.js';
import { OpenFolderAction } from '../../../actions/workspaceActions.js';
import { Verbosity } from '../../../../../platform/label/common/label.js';
import { CustomFolderMenuSeparator } from './customFolderMenuSeparator.js';
import { ClearRecentWorkspacesAction } from '../../editor/workspaceActions.js';
import { IWindowOpenable } from '../../../../../platform/window/common/window.js';
import { CustomFolderRecentlyUsedMenuItem } from './customFolderRecentlyUsedMenuItem.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { CommandCenter } from '../../../../../platform/commandCenter/common/commandCenter.js';
import { EmptyWorkspaceSupportContext, WorkbenchStateContext } from '../../../../common/contextkeys.js';
import { CommandAction } from '../../../../../platform/positronActionBar/browser/positronActionBarState.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IRecentlyOpened, IRecentFolder, IRecentWorkspace, isRecentWorkspace, isRecentFolder, restoreRecentlyOpened, toStoreData } from '../../../../../platform/workspaces/common/workspaces.js';
import { PositronNewFolderFromTemplateAction, PositronNewFolderFromGitAction, PositronOpenFolderInNewWindowAction } from '../../../actions/positronActions.js';

/**
 * Constants.
 */
const kCloseFolder = 'workbench.action.closeFolder';
const kPinnedFoldersStorageKey = 'positron.customFolderMenu.pinnedFolders';

/**
 * A recently opened folder or workspace.
 */
type RecentFolderOrWorkspace = IRecentFolder | IRecentWorkspace;

/**
 * Gets the URI of a recently opened folder or workspace.
 * @param recent The recently opened folder or workspace.
 * @returns The URI.
 */
const recentUri = (recent: RecentFolderOrWorkspace) =>
	isRecentFolder(recent) ? recent.folderUri : recent.workspace.configPath;

/**
 * Reads the pinned folders and workspaces.
 * @param storageService The storage service.
 * @param logService The log service.
 * @returns The pinned folders and workspaces.
 */
const readPinnedFolders = (storageService: IStorageService, logService: ILogService) =>
	restoreRecentlyOpened(
		storageService.getObject(kPinnedFoldersStorageKey, StorageScope.APPLICATION),
		logService
	).workspaces;

/**
 * Stores the pinned folders and workspaces. They are shared by all windows, like the recently
 * opened list they are picked from.
 * @param storageService The storage service.
 * @param pinned The pinned folders and workspaces.
 */
const storePinnedFolders = (storageService: IStorageService, pinned: RecentFolderOrWorkspace[]) => {
	storageService.store(
		kPinnedFoldersStorageKey,
		toStoreData({ workspaces: pinned, files: [] }),
		StorageScope.APPLICATION,
		StorageTarget.MACHINE
	);
};

/**
 * CustomFolderMenuItemsProps interface.
 */
interface CustomFolderMenuItemsProps {
	recentlyOpened: IRecentlyOpened;
	onMenuItemSelected: () => void;
}

/**
 * CustomFolderMenuItems component.
 * @param props A CustomFolderMenuItemsProps that contains the component properties.
 * @returns The rendered component.
 */
export const CustomFolderMenuItems = (props: CustomFolderMenuItemsProps) => {
	// Context hooks.
	const services = usePositronReactServicesContext();

	// State hooks.
	const [pinnedFolders, setPinnedFolders] = useState(() =>
		readPinnedFolders(services.storageService, services.logService)
	);

	// Reference hooks.
	const pinButtonsRef = useRef(new Map<string, HTMLButtonElement>());
	const pinButtonToFocusRef = useRef<string | undefined>(undefined);

	// Pinning or unpinning moves a folder between the pinned and recent lists, which remounts its
	// menu item and drops keyboard focus. After the move, focus the pin button of the moved folder.
	useEffect(() => {
		if (pinButtonToFocusRef.current) {
			pinButtonsRef.current.get(pinButtonToFocusRef.current)?.focus();
			pinButtonToFocusRef.current = undefined;
		}
	});

	// The recently opened folders and workspaces that aren't pinned.
	const recentFolders = props.recentlyOpened.workspaces
		.filter(recent => !pinnedFolders.some(pinned => isEqual(recentUri(pinned), recentUri(recent))))
		.slice(0, 10);

	/**
	 * Pins or unpins a folder or workspace.
	 * @param recent The folder or workspace.
	 */
	const togglePinned = (recent: RecentFolderOrWorkspace) => {
		// Start from the stored pins, not this menu's state, so that pins changed in another
		// window since this menu opened are not overwritten.
		const uri = recentUri(recent);
		const storedPinnedFolders = readPinnedFolders(services.storageService, services.logService);
		const newPinnedFolders = storedPinnedFolders.some(pinned => isEqual(recentUri(pinned), uri)) ?
			storedPinnedFolders.filter(pinned => !isEqual(recentUri(pinned), uri)) :
			[...storedPinnedFolders, recent];
		storePinnedFolders(services.storageService, newPinnedFolders);
		pinButtonToFocusRef.current = uri.toString();
		setPinnedFolders(newPinnedFolders);
	};

	/**
	 * CommandActionCustomFolderMenuItem component.
	 * @param commandAction The CommandAction.
	 * @returns The rendered component.
	 */
	const CommandActionCustomFolderMenuItem = (commandAction: CommandAction) => {
		// Get the command info from the command center.
		const commandInfo = CommandCenter.commandInfo(commandAction.id);

		// If the command info wasn't found, or the when expression doesn't match, return null.
		if (!commandInfo || !services.contextKeyService.contextMatchesRules(commandAction.when)) {
			return null;
		}

		// Determine whether the command action will be enabled and set the label to use.
		const enabled = !commandInfo.precondition ||
			services.contextKeyService.contextMatchesRules(commandInfo.precondition);
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
						services.commandService.executeCommand(commandAction.id);
					}}
				/>
			</>
		);
	};

	/**
	 * Renders the menu item of a recently opened folder or workspace.
	 * @param recent The folder or workspace.
	 * @param pinned Whether the folder or workspace is pinned.
	 * @returns The rendered menu item.
	 */
	const renderRecentMenuItem = (recent: RecentFolderOrWorkspace, pinned: boolean) => {
		// Setup the handler.
		const uri = recentUri(recent);
		const key = uri.toString();
		let label: string;
		let openable: IWindowOpenable;
		if (isRecentWorkspace(recent)) {
			label = recent.label || services.labelService.getWorkspaceLabel(recent.workspace, { verbose: Verbosity.LONG });
			openable = { workspaceUri: uri };
		} else {
			label = recent.label || services.labelService.getWorkspaceLabel(uri, { verbose: Verbosity.LONG });
			openable = { folderUri: uri };
		}

		// Render.
		return (
			<CustomFolderRecentlyUsedMenuItem
				key={key}
				enabled={true}
				label={label}
				pinButtonRef={pinButton => {
					if (pinButton) {
						pinButtonsRef.current.set(key, pinButton);
					} else {
						pinButtonsRef.current.delete(key);
					}
				}}
				pinned={pinned}
				onOpen={e => {
					props.onMenuItemSelected();
					services.hostService.openWindow([openable], {
						forceNewWindow: (!isMacintosh && (e.ctrlKey || e.shiftKey)) || (isMacintosh && (e.metaKey || e.altKey)),
						remoteAuthority: recent.remoteAuthority || null
					});
				}}
				onOpenInNewWindow={e => {
					props.onMenuItemSelected();
					services.hostService.openWindow([openable], {
						forceNewWindow: true,
						remoteAuthority: recent.remoteAuthority || null
					});
				}}
				onTogglePinned={() => togglePinned(recent)}
			/>
		);
	};

	// Render.
	return (
		<div className='custom-folder-menu-items'>
			<CommandActionCustomFolderMenuItem id={PositronNewFolderFromTemplateAction.ID} />
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
			{(pinnedFolders.length > 0 || recentFolders.length > 0) && <CustomFolderMenuSeparator />}
			{pinnedFolders.map(recent => renderRecentMenuItem(recent, true))}
			{pinnedFolders.length > 0 && recentFolders.length > 0 && <CustomFolderMenuSeparator />}
			{recentFolders.map(recent => renderRecentMenuItem(recent, false))}
			<CustomFolderMenuSeparator />
			<CommandActionCustomFolderMenuItem id={ClearRecentWorkspacesAction.ID} />
		</div>
	);
};
