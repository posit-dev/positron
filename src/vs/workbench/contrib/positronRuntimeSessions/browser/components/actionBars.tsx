/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./actionBars';
import * as React from 'react';
import { PropsWithChildren, } from 'react'; // eslint-disable-line no-duplicate-imports
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { PositronActionBar } from 'vs/platform/positronActionBar/browser/positronActionBar';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { PositronActionBarContextProvider } from 'vs/platform/positronActionBar/browser/positronActionBarContext';
import { usePositronRuntimeSessionsContext } from 'vs/workbench/contrib/positronRuntimeSessions/browser/positronRuntimeSessionsContext';
import { PositronSessionsServices } from 'vs/workbench/contrib/positronRuntimeSessions/browser/positronRuntimeSessionsState';

// Constants.
const kPaddingLeft = 8;
const kPaddingRight = 8;

/**
 * ActionBarsProps interface.
 */
export interface ActionBarsProps extends PositronSessionsServices {
	// Services.
	readonly commandService: ICommandService;
	readonly configurationService: IConfigurationService;
	readonly contextKeyService: IContextKeyService;
	readonly contextMenuService: IContextMenuService;
	readonly keybindingService: IKeybindingService;
	readonly layoutService: IWorkbenchLayoutService;
}

/**
 * ActionBars component.
 * @param props An ActionBarsProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActionBars = (props: PropsWithChildren<ActionBarsProps>) => {
	// Context hooks.
	const positronSessionsContext = usePositronRuntimeSessionsContext();

	// If there are no instances, return null.
	if (positronSessionsContext.positronSessions.length === 0) {
		return null;
	}

	// Render.
	return (
		<PositronActionBarContextProvider {...props}>
			<div className='action-bars'>
				<PositronActionBar size='small' borderTop={true} borderBottom={true} paddingLeft={kPaddingLeft} paddingRight={kPaddingRight}>
					{positronSessionsContext.positronSessions.length} sessions
				</PositronActionBar>
			</div>
		</PositronActionBarContextProvider>
	);
};
