/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import { useEffect, useState } from 'react';

// Other dependencies.
import { unmnemonicLabel } from '../../../base/common/labels.js';
import { DisposableStore } from '../../../base/common/lifecycle.js';
import { IHoverManager } from '../../hover/browser/hoverManager.js';
import { CommandCenter } from '../../commandCenter/common/commandCenter.js';
import { Action, IAction, Separator } from '../../../base/common/actions.js';
import { ContextKeyExpression } from '../../contextkey/common/contextkey.js';
import { PositronActionBarHoverManager } from './positronActionBarHoverManager.js';
import { usePositronReactServicesContext } from '../../../base/browser/positronReactRendererContext.js';

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
export interface PositronActionBarState {
	appendCommandAction(actions: IAction[], commandAction: CommandAction): void;
	isCommandEnabled(commandId: string): boolean;
	hoverManager: IHoverManager;
	menuShowing: boolean;
	setMenuShowing(menuShowing: boolean): void;
	focusableComponents: Set<HTMLElement>;
}

/**
 * The usePositronActionBarState custom hook.
 * @returns The hook.
 */
export const usePositronActionBarState = (): PositronActionBarState => {
	// Hooks.
	const services = usePositronReactServicesContext();
	const [menuShowing, setMenuShowing] = useState(false);
	const [focusableComponents] = useState(new Set<HTMLElement>());
	const [hoverManager, setHoverManager] = useState<IHoverManager>(undefined!);

	// Main use effect.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Create the hover manager.
		setHoverManager(disposableStore.add(new PositronActionBarHoverManager(
			true,
			services.configurationService,
			services.hoverService
		)));

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
		appendCommandAction,
		isCommandEnabled,
		hoverManager,
		menuShowing,
		setMenuShowing,
		focusableComponents
	};
};
