/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { useState } from 'react';
import { unmnemonicLabel } from 'vs/base/common/labels';
import { Action, IAction, Separator } from 'vs/base/common/actions';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { CommandCenter } from 'vs/platform/commandCenter/common/commandCenter';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ContextKeyExpression, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';

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
 * CommandAction interface.
 */
export interface CommandAction {
	id: string;
	label?: string;
	separator?: boolean;
	when?: ContextKeyExpression;
}

/**
 * The Positron action bar state.
 */
export interface PositronActionBarState extends PositronActionBarServices {
	appendCommandAction(actions: IAction[], commandAction: CommandAction): void;
	isCommandEnabled(commandId: string): boolean;
	showTooltipDelay(): number;
	updateTooltipLastHiddenAt(): void;
	resetTooltipLastHiddenAt(): void;
	menuShowing: boolean;
	setMenuShowing(menuShowing: boolean): void;
	focusableComponents: Set<HTMLElement>;
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
	const [focusableComponents] = useState(new Set<HTMLElement>());

	/**
	 * Appends a command action.
	 * @param actions The set of actions to append the command action to.
	 * @param commandAction The CommandAction to append.
	 */
	const appendCommandAction = (actions: IAction[], commandAction: CommandAction) => {
		// Get the command info from the command center.
		const commandInfo = CommandCenter.commandInfo(commandAction.id);

		// If the command info was found, and the when expression matches, create the command action
		// and push it to the actions.
		if (commandInfo && services.contextKeyService.contextMatchesRules(commandAction.when)) {
			// Determine whether the command action will be enabled and set the label to use.
			const enabled = !commandInfo.precondition || services.contextKeyService.contextMatchesRules(commandInfo.precondition);
			const label = commandAction.label || (typeof (commandInfo.title) === 'string' ? commandInfo.title : commandInfo.title.value);

			// Append the separator.
			if (commandAction.separator) {
				actions.push(new Separator());
			}

			// Create the command action and push it.
			actions.push(new Action(commandAction.id, unmnemonicLabel(label), undefined, enabled, () => {
				services.commandService.executeCommand(commandAction.id);
			}));
		}
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
		appendCommandAction,
		isCommandEnabled,
		showTooltipDelay: () => new Date().getTime() - lastTooltipHiddenAt < kTooltipReset ?
			0 :
			services.configurationService.getValue<number>('workbench.hover.delay'),
		updateTooltipLastHiddenAt: () => setLastTooltipHiddenAt(new Date().getTime()),
		resetTooltipLastHiddenAt: () => setLastTooltipHiddenAt(0),
		menuShowing,
		setMenuShowing,
		focusableComponents
	};
};
