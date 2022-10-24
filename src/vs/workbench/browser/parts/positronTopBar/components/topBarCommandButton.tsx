/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import React = require('react');
import { usePositronTopBarContext } from 'vs/workbench/browser/parts/positronTopBar/positronTopBarContext';
import { TopBarButton } from 'vs/workbench/browser/parts/positronTopBar/components/topBarButton/topBarButton';

/**
 * TopBarCommandButtonProps interface.
 */
interface TopBarCommandButtonProps {
	iconId: string;
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
	const command = positronTopBarContext?.commands.get(props.commandId);

	// If the command cannot be found, render nothing.
	if (!command) {
		return null;
	}

	// Handlers.
	const executeHandler = () => positronTopBarContext?.commandService.executeCommand(props.commandId);

	// Props.
	const kb = positronTopBarContext?.keybindingService.lookupKeybinding(command?.id)?.getLabel();
	const commandText = command.tooltip || command.title;
	const tooltipText = typeof (commandText) === 'string' ? commandText : commandText.value;
	const tooltip = kb ? `${tooltipText} (${kb})` : tooltipText;

	// Render.
	return <TopBarButton iconId={props.iconId} tooltip={tooltip} execute={executeHandler} />;
};
