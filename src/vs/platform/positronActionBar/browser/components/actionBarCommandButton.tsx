/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./actionBarCommandButton';
import * as React from 'react';
import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { DisposableStore } from 'vs/base/common/lifecycle';
import { CommandCenter } from 'vs/platform/commandCenter/common/commandCenter';
import { ActionBarButton } from 'vs/platform/positronActionBar/browser/components/actionBarButton';
import { usePositronActionBarContext } from 'vs/platform/positronActionBar/browser/positronActionBarContext';

/**
 * ActionBarCommandButtonProps interface.
 */
interface ActionBarCommandButtonProps {
	iconId: string;
	align?: 'left' | 'right';
	commandId: string;
}

/**
 * ActionBarCommandButton component.
 * @param props An ActionBarCommandButtonProps that contains the component properties.
 * @returns The component.
 */
export const ActionBarCommandButton = (props: ActionBarCommandButtonProps) => {
	// Hooks.
	const positronActionBarContext = usePositronActionBarContext();
	const [disabled, setDisabled] = useState(!positronActionBarContext.isCommandEnabled(props.commandId));

	// Add our event handlers.
	useEffect(() => {
		// Create a disposable store for the event handlers we'll add.
		const disposableStore = new DisposableStore();

		// Get the command info. If it's found and it has a precondition, track changes for its keys.
		const commandInfo = CommandCenter.commandInfo(props.commandId);
		if (commandInfo && commandInfo.precondition) {
			// Get the set of precondition keys that we need to monitor.
			const keys = new Set(commandInfo.precondition.keys());

			// Add the context key service change tracker.
			disposableStore.add(positronActionBarContext.contextKeyService.onDidChangeContext(e => {
				// If any of the precondition keys are affected, update the enabled state.
				if (e.affectsSome(keys)) {
					setDisabled(!positronActionBarContext.contextKeyService.contextMatchesRules(commandInfo.precondition));
				}
			}));
		}

		// Return the clean up for our event handlers.
		return () => disposableStore.dispose();
	}, []);

	// Handlers.
	const executeHandler = () => positronActionBarContext.commandService.executeCommand(props.commandId);

	// Returns a dynamic tooltip for the command button.
	const tooltip = (): string | undefined => {
		// Get the title for the command from the command center.
		const title = CommandCenter.title(props.commandId);
		if (!title) {
			return undefined;
		}

		// Get the keybinding label for the command from the keybinding service.
		const keybindingLabel = positronActionBarContext.keybindingService.lookupKeybinding(props.commandId)?.getLabel();

		// If there's no keybinding label, return the title as the tooltip.
		if (!keybindingLabel) {
			return title;
		}

		// Return the tooltip.
		return `${title} (${keybindingLabel})`;
	};

	// Render.
	return <ActionBarButton {...props} tooltip={tooltip} disabled={disabled} onClick={executeHandler} />;
};
