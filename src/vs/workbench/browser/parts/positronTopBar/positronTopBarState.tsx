/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { Action } from 'vs/base/common/actions';
import { unmnemonicLabel } from 'vs/base/common/labels';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { CommandCenter } from 'vs/platform/commandCenter/common/commandCenter';
import { PositronTopBarServices } from 'vs/workbench/browser/parts/positronTopBar/positronTopBar';
import { IWorkspaceContextService, IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';

/**
 * The tooltip reset timeout in milliseconds.
 */
const kTooltipReset = 500;

/**
 * The Positron top bar state.
 */
export interface PositronTopBarState extends PositronTopBarServices {
	workspaceFolder?: IWorkspaceFolder;
	createCommandAction(commandId: string, label?: string): Action | undefined;
	showTooltipDelay(): number;
	tooltipHidden(): void;
}

/**
 * The usePositronTopBarState custom hook.
 * @param services A PositronTopBarServices that contains the Positron top bar services.
 * @returns The hook.
 */
export const usePositronTopBarState = (services: PositronTopBarServices): PositronTopBarState => {
	// Hooks.
	const [workspaceFolder, setWorkspaceFolder] = useState<IWorkspaceFolder | undefined>(singleWorkspaceFolder(services.workspaceContextService));
	const [lastTooltipHiddenAt, setLastTooltipHiddenAt] = useState<number>(0);

	// Add event handlers.
	useEffect(() => {
		const disposableStore = new DisposableStore();

		disposableStore.add(services.workspaceContextService.onDidChangeWorkspaceFolders(e => {
			setWorkspaceFolder(singleWorkspaceFolder(services.workspaceContextService));
		}));

		return () => disposableStore.dispose();
	});

	/**
	 * Gets the tooltip delay.
	 * @returns The tooltip delay in milliseconds.
	 */
	const showTooltipDelay = () => new Date().getTime() - lastTooltipHiddenAt < kTooltipReset ? 0 : services.configurationService.getValue<number>('workbench.hover.delay');

	/**
	 * Called when a tooltip is hidden. This will determine whether another tooltip will be shown
	 * immediately or after the value returned by showTooltipDelay.
	 */
	const tooltipHidden = () => setLastTooltipHiddenAt(new Date().getTime());

	/**
	 * Creates a command action.
	 * @param commandId The command ID.
	 * @param label The optional label.
	 * @returns The command action, if it was successfully created; otherwise, undefined.
	 */
	const createCommandAction = (commandId: string, label?: string): Action | undefined => {
		// Get the command info from the command center.
		const commandInfo = CommandCenter.commandInfo(commandId);
		if (!commandInfo) {
			return undefined;
		}

		// Determine whether the command action will be enabled and set the label to use.
		const enabled = !commandInfo.precondition || services.contextKeyService.contextMatchesRules(commandInfo.precondition);
		label = label || (typeof (commandInfo.title) === 'string' ? commandInfo.title : commandInfo.title.value);

		// Create and return the action.
		return new Action(commandId, unmnemonicLabel(label), undefined, enabled, () => {
			services.commandService.executeCommand(commandId);
		});
	};

	// Return the Positron top bar state.
	return {
		...services,
		workspaceFolder,
		createCommandAction,
		showTooltipDelay,
		tooltipHidden
	};
};


function singleWorkspaceFolder(workspaceContextService: IWorkspaceContextService) {
	const folders = workspaceContextService.getWorkspace().folders;
	if (folders.length) {
		return folders[0];
	} else {
		return undefined;
	}
}
