/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import React = require('react');
import { usePositronTopBarContext } from 'vs/workbench/browser/parts/positronTopBar/positronTopBarContext';
import { TopBarButton } from 'vs/workbench/browser/parts/positronTopBar/components/topBarButton/topBarButton';
// import { ICommandAction } from 'vs/platform/action/common/action';

/**
 * TopBarCommandButtonProps interface.
 */
interface TopBarCommandButtonProps {
	id: string;
	iconClassName: string;
}

/**
 * TopBarCommandButton component.
 * @param props A TopBarCommandButtonProps that contains the component properties.
 * @returns The component.
 */
export const TopBarCommandButton = (props: TopBarCommandButtonProps) => {
	// Hooks.
	const positronTopBarContext = usePositronTopBarContext();

	// Constants.
	const command = positronTopBarContext?.commands.get(props.id);

	// Handlers.
	const executeHandler = () => positronTopBarContext?.commandService.executeCommand(props.id);

	// Render.
	return (
		<>
			{command && <TopBarButton iconClassName={props.iconClassName} tooltip={command.tooltip || command.title} execute={executeHandler} />}
		</>
	);
};

