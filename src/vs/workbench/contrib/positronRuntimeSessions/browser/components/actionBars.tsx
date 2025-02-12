/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './actionBars.css';

// React.
import React, { PropsWithChildren } from 'react';

// Other dependencies.
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { PositronActionBar } from '../../../../../platform/positronActionBar/browser/positronActionBar.js';
import { IWorkbenchLayoutService } from '../../../../services/layout/browser/layoutService.js';
import { PositronActionBarContextProvider } from '../../../../../platform/positronActionBar/browser/positronActionBarContext.js';
import { usePositronRuntimeSessionsContext } from '../positronRuntimeSessionsContext.js';
import { PositronSessionsServices } from '../positronRuntimeSessionsState.js';

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
	if (positronSessionsContext.positronSessions.size === 0) {
		return null;
	}

	// Render.
	return (
		<PositronActionBarContextProvider {...props}>
			<div className='action-bars'>
				<PositronActionBar borderBottom={true} borderTop={true} paddingLeft={kPaddingLeft} paddingRight={kPaddingRight} size='small'>
					{positronSessionsContext.positronSessions.size} sessions
				</PositronActionBar>
			</div>
		</PositronActionBarContextProvider>
	);
};
