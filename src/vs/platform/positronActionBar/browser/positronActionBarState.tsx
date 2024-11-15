/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { useEffect, useState } from 'react';

// Other dependencies.
import { unmnemonicLabel } from 'vs/base/common/labels';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IHoverService } from 'vs/platform/hover/browser/hover';
import { Action, IAction, Separator } from 'vs/base/common/actions';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IModifierKeyStatus, ModifierKeyEmitter } from 'vs/base/browser/dom';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { CommandCenter } from 'vs/platform/commandCenter/common/commandCenter';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { HoverManager, IHoverManager } from 'vs/platform/hover/browser/hoverManager';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IAccessibilityService } from 'vs/platform/accessibility/common/accessibility';
import { ContextKeyExpression, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';

/**
 * PositronActionBarServices interface. Defines the set of services that are required by a Positron
 * action bar.
 */
export interface PositronActionBarServices {
	readonly accessibilityService: IAccessibilityService;
	readonly commandService: ICommandService;
	readonly configurationService: IConfigurationService;
	readonly contextKeyService: IContextKeyService;
	readonly contextMenuService: IContextMenuService;
	readonly hoverService: IHoverService;
	readonly keybindingService: IKeybindingService;
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
	useAlternativeActions: boolean;
	appendCommandAction(actions: IAction[], commandAction: CommandAction): void;
	isCommandEnabled(commandId: string): boolean;
	hoverManager: IHoverManager;
	menuShowing: boolean;
	setMenuShowing(menuShowing: boolean): void;
	focusableComponents: Set<HTMLElement>;
}

/**
 * Determines whether alternative actions should be used.
 * @param accessibilityService The accessibility service.
 * @param modifierKeyStatus The modifier key status.
 * @returns A value which indicates whether alternative actions should be used.
 */
const shouldUseAlternativeActions = (accessibilityService: IAccessibilityService, modifierKeyStatus?: IModifierKeyStatus) => {
	// If the modifier key status was not supplied, get it from the modifier key emitter.
	if (!modifierKeyStatus) {
		modifierKeyStatus = ModifierKeyEmitter.getInstance().keyStatus;
	}

	// Return true if the alt key is pressed and motion is not reduced.
	return modifierKeyStatus.altKey && !accessibilityService.isMotionReduced();
};

/**
 * The usePositronActionBarState custom hook.
 * @param services A PositronActionBarServices that contains the Positron action bar services.
 * @returns The hook.
 */
export const usePositronActionBarState = (
	services: PositronActionBarServices
): PositronActionBarState => {
	// State hooks.
	const [useAlternativeActions, setUseAlternativeActions] = useState(
		shouldUseAlternativeActions(services.accessibilityService)
	);
	const [menuShowing, setMenuShowing] = useState(false);
	const [focusableComponents] = useState(new Set<HTMLElement>());
	const [hoverManager, setHoverManager] = useState<HoverManager>(undefined!);

	// Main use effect.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Create the hover manager.
		setHoverManager(disposableStore.add(new HoverManager(
			true,
			services.configurationService,
			services.hoverService
		)));

		// Get the modifier key emitter.
		const modifierKeyEmitter = ModifierKeyEmitter.getInstance();
		disposableStore.add(modifierKeyEmitter.event(modifierKeyStatus => {
			// Update the use alternative actions state.
			setUseAlternativeActions(shouldUseAlternativeActions(
				services.accessibilityService,
				modifierKeyStatus
			));
		}));

		// Return the cleanup function that will dispose of the disposables.
		return () => disposableStore.dispose();
	}, [services.accessibilityService, services.configurationService, services.hoverService]);

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
			const enabled = !commandInfo.precondition ||
				services.contextKeyService.contextMatchesRules(commandInfo.precondition);
			const label = commandAction.label ||
				(typeof (commandInfo.title) === 'string' ?
					commandInfo.title :
					commandInfo.title.value
				);

			// Append the separator.
			if (commandAction.separator) {
				actions.push(new Separator());
			}

			// Create the command action and push it.
			actions.push(new Action(
				commandAction.id,
				unmnemonicLabel(label),
				undefined,
				enabled, () => {
					services.commandService.executeCommand(commandAction.id);
				}
			));
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
		useAlternativeActions,
		appendCommandAction,
		isCommandEnabled,
		hoverManager,
		menuShowing,
		setMenuShowing,
		focusableComponents
	};
};
