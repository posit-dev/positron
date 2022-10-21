/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from 'react';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { PositronTopBarServices } from 'vs/workbench/browser/parts/positronTopBar/positronTopBar';
import { PositronTopBarState } from 'vs/workbench/browser/parts/positronTopBar/positronTopBarState';
import { MenuRegistry } from 'vs/platform/actions/common/actions';

export const usePositronTopBarState = (services: PositronTopBarServices): PositronTopBarState => {
	// Hooks.
	const [configurationService] = useState<IConfigurationService>(services.configurationService);
	const [quickInputService] = useState<IQuickInputService>(services.quickInputService);
	const [commandService] = useState<ICommandService>(services.commandService);
	const [commands, setCommands] = useState(MenuRegistry.getCommands());
	const [lastTooltipShownAt, setLastTooltipShownAt] = useState<number>(0);

	useEffect(() => {
		const unsubscribe = MenuRegistry.onDidChangeMenu(e => {
			// TODO: be smarter here as we can query for whether any commands
			// we care about have changed
			setCommands(MenuRegistry.getCommands());
		});
		return () => {
			unsubscribe.dispose();
		};
	}, [commands]);


	return {
		configurationService,
		quickInputService,
		commandService,
		commands,
		lastTooltipShownAt,
		setLastTooltipShownAt,
	};
};

// // Export usePositronTopBarState.
// export default usePositronTopBarState;
