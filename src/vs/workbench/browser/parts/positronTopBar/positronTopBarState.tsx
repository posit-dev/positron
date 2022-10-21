/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { ICommandsMap, isIMenuItem, MenuId, MenuRegistry } from 'vs/platform/actions/common/actions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { PositronTopBarServices } from 'vs/workbench/browser/parts/positronTopBar/positronTopBar';
import { ICommandAction } from 'vs/platform/action/common/action';

/**
 * The Positron top bar state.
 */
export interface PositronTopBarState {
	configurationService: IConfigurationService;
	quickInputService: IQuickInputService;
	commandService: ICommandService;
	commands: ICommandsMap;
	lastTooltipShownAt: number;
	setLastTooltipShownAt(value: number): void;
}

/**
 * The usePositronTopBarState custom hook.
 * @param services A PositronTopBarServices that contains the Positron top bar services.
 * @returns The hook.
 */
export const usePositronTopBarState = ({
	configurationService,
	quickInputService,
	commandService,
}: PositronTopBarServices, commandIds: string[]): PositronTopBarState => {
	// Hooks.
	const [commands, setCommands] = useState<ICommandsMap>(MenuRegistry.getCommands());
	const [lastTooltipShownAt, setLastTooltipShownAt] = useState<number>(0);

	useEffect(() => {
		const disposable = MenuRegistry.onDidChangeMenu(e => {
			if (e.has(MenuId.CommandPalette)) {
				// look in the command pallette as some commands (e.g. file save commands) are
				// only registered there
				const commandsMap = new Map<string, ICommandAction>();
				const commandPallette = MenuRegistry.getMenuItems(MenuId.CommandPalette);
				commandPallette.forEach(item => {
					if (isIMenuItem(item) && commandIds.includes(item.command.id)) {
						commandsMap.set(item.command.id, item.command);
					}
				});
				setCommands(commandsMap);
			}
		});
		return () => disposable.dispose();
	}, [commands]);

	// Return the Positron top bar state.
	return {
		configurationService,
		quickInputService,
		commandService,
		commands,
		lastTooltipShownAt,
		setLastTooltipShownAt,
	};
};
