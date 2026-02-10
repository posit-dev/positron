/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './actionBarCommandButton.css';

// React.
import { useEffect, useRef, useState } from 'react';

// Other dependencies.
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { CommandCenter } from '../../../commandCenter/common/commandCenter.js';
import { useRegisterWithActionBar } from '../useRegisterWithActionBar.js';
import { usePositronActionBarContext } from '../positronActionBarContext.js';
import { ActionBarButton, ActionBarButtonProps } from './actionBarButton.js';
import { usePositronReactServicesContext } from '../../../../base/browser/positronReactRendererContext.js';

/**
 * ActionBarCommandButtonProps interface.
 */
type ActionBarCommandButtonProps = ActionBarButtonProps & {
	readonly commandId: string;
}

/**
 * ActionBarCommandButton component.
 * @param props An ActionBarCommandButtonProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActionBarCommandButton = (props: ActionBarCommandButtonProps) => {
	// Hooks.
	const services = usePositronReactServicesContext();
	const positronActionBarContext = usePositronActionBarContext();
	const [commandDisabled, setCommandDisabled] = useState(
		!positronActionBarContext.isCommandEnabled(props.commandId)
	);
	const buttonRef = useRef<HTMLButtonElement>(undefined!);

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
			disposableStore.add(services.contextKeyService.onDidChangeContext(e => {
				// If any of the precondition keys are affected, update the enabled state.
				if (e.affectsSome(keys)) {
					setCommandDisabled(!services.contextKeyService.contextMatchesRules(commandInfo.precondition));
				}
			}));
		}

		// Return the clean up for our event handlers.
		return () => disposableStore.dispose();
	}, [services.contextKeyService, props.commandId]);

	// Participate in roving tabindex.
	useRegisterWithActionBar([buttonRef]);

	// Returns a dynamic tooltip for the command button.
	const tooltip = (): string | undefined => {
		// Get the title for the command from the command center.
		const title = CommandCenter.title(props.commandId);
		if (!title) {
			return undefined;
		}

		// Get the keybinding label for the command from the keybinding service.
		const keybindingLabel = services.keybindingService.lookupKeybinding(props.commandId)?.getLabel();

		// If there's no keybinding label, return the title as the tooltip.
		if (!keybindingLabel) {
			return title;
		}

		// Return the tooltip.
		return `${title} (${keybindingLabel})`;
	};

	// Render.
	return (
		<ActionBarButton
			ref={buttonRef}
			{...props}
			disabled={props.disabled || commandDisabled}
			tooltip={tooltip}
			onPressed={() =>
				services.commandService.executeCommand(props.commandId)
			}
		/>
	);
};
