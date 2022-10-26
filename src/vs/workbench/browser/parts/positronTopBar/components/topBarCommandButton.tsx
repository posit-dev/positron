/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import React = require('react');
import { useEffect, useState } from 'react';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { CommandCenter } from 'vs/platform/commandCenter/common/commandCenter';
import { usePositronTopBarContext } from 'vs/workbench/browser/parts/positronTopBar/positronTopBarContext';
import { TopBarButton } from 'vs/workbench/browser/parts/positronTopBar/components/topBarButton/topBarButton';
import { TooltipAlignment } from 'vs/workbench/browser/parts/positronTopBar/components/tooltip/tooltip';

/**
 * TopBarCommandButtonProps interface.
 */
interface TopBarCommandButtonProps {
	iconId: string;
	tooltipAlignment: TooltipAlignment;
	commandId: string;
}

/**
 * TopBarCommandButton component.
 * @param props A TopBarCommandButtonProps that contains the component properties.
 * @returns The component.
 */
export const TopBarCommandButton = (props: TopBarCommandButtonProps) => {
	// Hooks.
	const positronTopBarContext = usePositronTopBarContext();
	const [enabled, setEnabled] = useState(positronTopBarContext?.isCommandEnabled(props.commandId));

	// Ensure that the top bar context exists.
	if (!positronTopBarContext) {
		return null;
	}

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
			disposableStore.add(positronTopBarContext.contextKeyService.onDidChangeContext(e => {
				// If any of the precondition keys are affected, update the enabled state.
				if (e.affectsSome(keys)) {
					setEnabled(positronTopBarContext.contextKeyService.contextMatchesRules(commandInfo.precondition));
				}
			}));
		}

		// Return the clean up for our event handlers.
		return () => disposableStore.dispose();
	}, []);

	// Handlers.
	const executeHandler = () => positronTopBarContext?.commandService.executeCommand(props.commandId);

	// Returns a dynamic tooltip for the command button.
	const tooltip = (): string | undefined => {
		// Get the title for the command from the command center.
		const title = CommandCenter.title(props.commandId);
		if (!title) {
			return undefined;
		}

		// Get the keybinding label for the command from the keybinding service.
		const keybindingLabel = positronTopBarContext?.keybindingService.lookupKeybinding(props.commandId)?.getLabel();

		// If there's no keybinding label, return the title as the tooltip.
		if (!keybindingLabel) {
			return title;
		}

		// Return the tooltip.
		return `${title} (${keybindingLabel})`;
	};

	// Render.
	return (
		<TopBarButton {...props} tooltip={tooltip} enabled={enabled} onClick={executeHandler} />
	);
};
