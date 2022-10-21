/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { ICommandsMap, MenuRegistry } from 'vs/platform/actions/common/actions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { PositronTopBarServices } from 'vs/workbench/browser/parts/positronTopBar/positronTopBar';

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
	commandService
}: PositronTopBarServices): PositronTopBarState => {
	// Hooks.
	const [commands, setCommands] = useState<ICommandsMap>(MenuRegistry.getCommands());
	const [lastTooltipShownAt, setLastTooltipShownAt] = useState<number>(0);

	useEffect(() => {
		const disposable = MenuRegistry.onDidChangeMenu(e => {
			// TODO: be smarter here as we can query for whether any commands
			// we care about have changed
			setCommands(MenuRegistry.getCommands());
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
