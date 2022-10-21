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
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IWorkspacesService } from 'vs/platform/workspaces/common/workspaces';
import { ILabelService } from 'vs/platform/label/common/label';
import { IHostService } from 'vs/workbench/services/host/browser/host';

/**
 * The tooltip reset timeout in milliseconds.
 */
const kTooltipReset = 500;

/**
 * The Positron top bar state.
 */
export interface PositronTopBarState {
	configurationService: IConfigurationService;
	quickInputService: IQuickInputService;
	commandService: ICommandService;
	keybindingService: IKeybindingService;
	contextMenuService: IContextMenuService;
	workspacesService: IWorkspacesService;
	labelService: ILabelService;
	hostService: IHostService;
	commands: ICommandsMap;
	showTooltipDelay(): number;
	tooltipHidden(): void;
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
	keybindingService,
	contextMenuService,
	workspacesService,
	labelService,
	hostService
}: PositronTopBarServices, commandIds: string[]): PositronTopBarState => {
	// Get the tooltip delay.
	const tooltipDelay = configurationService.getValue<number>('workbench.hover.delay');

	// Hooks.
	const [commands, setCommands] = useState<ICommandsMap>(MenuRegistry.getCommands());
	const [lastTooltipHiddenAt, setLastTooltipHiddenAt] = useState<number>(0);

	useEffect(() => {
		const disposable = MenuRegistry.onDidChangeMenu(e => {

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

		});
		return () => disposable.dispose();
	}, [commands]);

	const showTooltipDelay = () => new Date().getTime() - lastTooltipHiddenAt < kTooltipReset ? 0 : tooltipDelay;
	const tooltipHidden = () => setLastTooltipHiddenAt(new Date().getTime());

	// Return the Positron top bar state.
	return {
		configurationService,
		quickInputService,
		commandService,
		keybindingService,
		contextMenuService,
		workspacesService,
		labelService,
		hostService,
		commands,
		showTooltipDelay,
		tooltipHidden
	};
};
