/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./actionBar';
import * as React from 'react';
import { PropsWithChildren } from 'react'; // eslint-disable-line no-duplicate-imports
import { localize } from 'vs/nls';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { PositronActionBar } from 'vs/platform/positronActionBar/browser/positronActionBar';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { ActionBarRegion } from 'vs/platform/positronActionBar/browser/components/actionBarRegion';
import { ActionBarButton } from 'vs/platform/positronActionBar/browser/components/actionBarButton';
import { ActionBarSeparator } from 'vs/platform/positronActionBar/browser/components/actionBarSeparator';
import { PositronConsoleServices } from 'vs/workbench/contrib/positronConsole/browser/positronConsoleState';
import { usePositronConsoleContext } from 'vs/workbench/contrib/positronConsole/browser/positronConsoleContext';
import { PositronActionBarContextProvider } from 'vs/platform/positronActionBar/browser/positronActionBarContext';
import { ConsoleReplMenuButton } from 'vs/workbench/contrib/positronConsole/browser/components/consoleReplMenuButton';

// Constants.
const kPaddingLeft = 14;
const kPaddingRight = 8;

/**
 * ActionBarProps interface.
 */
export interface ActionBarProps extends PositronConsoleServices {
	// Services.
	readonly commandService: ICommandService;
	readonly configurationService: IConfigurationService;
	readonly contextKeyService: IContextKeyService;
	readonly contextMenuService: IContextMenuService;
	readonly keybindingService: IKeybindingService;
	readonly workbenchLayoutService: IWorkbenchLayoutService;
}

/**
 * ActionBar component.
 * @param props An ActionBarProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActionBar = (props: PropsWithChildren<ActionBarProps>) => {
	// Hooks.
	const positronConsoleContext = usePositronConsoleContext();

	// Toggle trace handler.
	const toggleTraceHandler = async () => {
		positronConsoleContext.currentPositronConsoleInstance?.toggleTrace();
	};

	// Clear console handler.
	const clearConsoleHandler = async () => {
		positronConsoleContext.currentPositronConsoleInstance?.clearConsole();
	};

	// Render.
	return (
		<PositronActionBarContextProvider {...props}>
			<div className='action-bar'>
				<PositronActionBar size='small' borderTop={true} borderBottom={true} paddingLeft={kPaddingLeft} paddingRight={kPaddingRight}>
					<ActionBarRegion align='left'>
						<ConsoleReplMenuButton />
					</ActionBarRegion>
					<ActionBarRegion align='right'>
						<ActionBarButton iconId='positron-list' align='right' tooltip={localize('positronToggleTrace', "Toggle Trace")} onClick={toggleTraceHandler} />
						<ActionBarSeparator />
						<ActionBarButton iconId='positron-clean' align='right' tooltip={localize('positronClearConsole', "Clear console")} onClick={clearConsoleHandler} />
					</ActionBarRegion>
				</PositronActionBar>
			</div>
		</PositronActionBarContextProvider>
	);
};
