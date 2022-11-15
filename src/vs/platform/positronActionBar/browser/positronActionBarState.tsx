/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { Action } from 'vs/base/common/actions';
import { unmnemonicLabel } from 'vs/base/common/labels';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { CommandCenter } from 'vs/platform/commandCenter/common/commandCenter';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';

/**
 * The tooltip reset timeout in milliseconds.
 */
const kTooltipReset = 500;

/**
 * PositronActionBarServices interface. Defines the set of services that are required by a Positron action bar.
 */
export interface PositronActionBarServices {
	commandService: ICommandService;
	configurationService: IConfigurationService;
	contextKeyService: IContextKeyService;
	contextMenuService: IContextMenuService;
	keybindingService: IKeybindingService;
}

/**
 * The Positron action bar state.
 */
export interface PositronActionBarState extends PositronActionBarServices {
	createCommandAction(commandId: string, label?: string): Action | undefined;
	isCommandEnabled(commandId: string): boolean;
	showTooltipDelay(): number;
	refreshTooltipKeepAlive(): void;
	menuShowing: boolean;
	setMenuShowing(menuShowing: boolean): void;
}

/**
 * The usePositronActionBarState custom hook.
 * @param services A PositronActionBarServices that contains the Positron action bar services.
 * @returns The hook.
 */
export const usePositronActionBarState = (services: PositronActionBarServices): PositronActionBarState => {
	// Hooks.
	const [lastTooltipHiddenAt, setLastTooltipHiddenAt] = useState<number>(0);
	const [menuShowing, setMenuShowing] = useState(false);

	// Add event handlers.
	useEffect(() => {
		const disposableStore = new DisposableStore();

		return () => disposableStore.dispose();
	}, []);

	/**
	 * Creates a command action.
	 * @param commandId The command ID.
	 * @param label The optional label.
	 * @returns The command action, if it was successfully created; otherwise, undefined.
	 */
	const createCommandAction = (commandId: string, label?: string) => {
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

	/**
	 * Determines whether a command is enabled.
	 * @param commandId The command ID
	 * @returns A value which indicates whether the command is enabled.
	 */
	const isCommandEnabled = (commandId: string) => {
		// Get the command info from the command center.
		const commandInfo = CommandCenter.commandInfo(commandId);
		if (!commandInfo) {
			return false;
		}

		// If the command doesn't have a precondition, it's enabled.
		if (!commandInfo.precondition) {
			return true;
		}

		// Return true if the specified command ID is enabled; otherwise, false.
		return services.contextKeyService.contextMatchesRules(commandInfo.precondition);
	};

	// Return the Positron top action bar state.
	return {
		...services,
		createCommandAction,
		isCommandEnabled,
		showTooltipDelay: () => new Date().getTime() - lastTooltipHiddenAt < kTooltipReset ? 0 : services.configurationService.getValue<number>('workbench.hover.delay'),
		refreshTooltipKeepAlive: () => setLastTooltipHiddenAt(new Date().getTime()),
		menuShowing,
		setMenuShowing
	};
};
