/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import 'vs/css!./media/css/positronTopBar';
const React = require('react');
import { TopBarButton } from 'vs/workbench/browser/parts/positronTopBar/components/topBarButton/topBarButton';
import { TopBarCommandCenter } from 'vs/workbench/browser/parts/positronTopBar/components/topBarCommandCenter/topBarCommandCenter';
import { TopBarRegion } from 'vs/workbench/browser/parts/positronTopBar/components/topBarRegion/topBarRegion';
import { TopBarSeparator } from 'vs/workbench/browser/parts/positronTopBar/components/topBarSeparator/topBarSeparator';
import { TooltipManager } from 'vs/workbench/browser/parts/positronTopBar/tooltipManager';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { ICommandService } from 'vs/platform/commands/common/commands';

import { ICommandsMap, MenuRegistry } from 'vs/platform/actions/common/actions';

/**
 * PositronTopBarProps interface.
 */
interface PositronTopBarProps {
	quickInputService: IQuickInputService;
	commandService: ICommandService;
}

/**
 * PositronTopBar component.
 * @param props A PositronTopBarProps that contains the component properties.
 * @returns The component.
 */
export const PositronTopBar = (props: PositronTopBarProps) => {
	// Hooks.
	const [hoverManager] = useState(new TooltipManager());

	const [commands, setCommands] = useState(MenuRegistry.getCommands());

	useEffect(() => {
		const unsubscribe = MenuRegistry.onDidChangeMenu(e => {
			// TODO: be smarter here as we can query for whether any commands
			// we care about have changed
			setCommands(MenuRegistry.getCommands());
		});
		return () => {
			unsubscribe.dispose();
		};
	});

	// Render.
	return (
		<div className='positron-top-bar'>
			<TopBarRegion align='left'>
				<TopBarButton tooltipManager={hoverManager} iconClassName='new-file-icon' dropDown={true} tooltip='New file' />
				<TopBarSeparator />
				<TopBarButton tooltipManager={hoverManager} iconClassName='new-project-icon' tooltip='New project' />
				<TopBarSeparator />
				<TopBarButton tooltipManager={hoverManager} iconClassName='open-file-icon' dropDown={true} tooltip='Open file' />
				<TopBarSeparator />
				<TopBarButton tooltipManager={hoverManager} iconClassName='save-icon' tooltip='Save' />
				<TopBarButton tooltipManager={hoverManager} iconClassName='save-all-icon' tooltip='Save all' />
			</TopBarRegion>

			<TopBarRegion align='center'>
				{topBarCommandButton('workbench.action.navigateBack', 'back-icon', hoverManager, commands, props.commandService)}
				{topBarCommandButton('workbench.action.navigateForward', 'forward-icon', hoverManager, commands, props.commandService)}
				<TopBarCommandCenter {...props} />
			</TopBarRegion>

			<TopBarRegion align='right'>
				<TopBarButton iconClassName='print-icon' />
			</TopBarRegion>
		</div>
	);
};


function topBarCommandButton(
	id: string,
	iconClassName: string,
	tooltipManager: TooltipManager,
	commands: ICommandsMap,
	commandService: ICommandService
) {
	const command = commands.get(id);
	const execute = () => commandService.executeCommand(id);
	if (command) {
		return (
			<TopBarButton
				execute={execute}
				iconClassName={iconClassName}
				tooltip={command?.tooltip}
				tooltipManager={tooltipManager}
			></TopBarButton>
		);
	} else {
		return null;
	}
}
