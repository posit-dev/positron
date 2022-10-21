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

	const command = positronTopBarContext?.commands.get(props.id);
	const execute = () => {
		positronTopBarContext?.commandService.executeCommand(props.id);
	};

	return (
		<>
			{command && <TopBarButton execute={execute} iconClassName={props.iconClassName} tooltip={command?.tooltip} />}
		</>
	);
};

