/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronPlots';
import * as React from 'react';
import { PropsWithChildren } from 'react'; // eslint-disable-line no-duplicate-imports
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { PositronPlotsServices } from 'vs/workbench/contrib/positronPlots/browser/positronPlotsState';
import { PositronPlotsContextProvider } from 'vs/workbench/contrib/positronPlots/browser/positronPlotsContext';

/**
 * PositronPlotsProps interface.
 */
export interface PositronPlotsProps extends PositronPlotsServices {
	// Services.
	readonly commandService: ICommandService;
	readonly configurationService: IConfigurationService;
	readonly contextKeyService: IContextKeyService;
	readonly contextMenuService: IContextMenuService;
	readonly keybindingService: IKeybindingService;
	readonly layoutService: IWorkbenchLayoutService;
	readonly reactComponentContainer: IReactComponentContainer;
}

/**
 * PositronPlots component.
 * @param props A PositronPlotsProps that contains the component properties.
 * @returns The rendered component.
 */
export const PositronPlots = (props: PropsWithChildren<PositronPlotsProps>) => {
	// Render.
	return (
		<PositronPlotsContextProvider {...props}>
			<div className='positron-plots'>
				<p>There was a PLOT here.</p>
				<p>It's gone now.</p>
			</div>
		</PositronPlotsContextProvider>
	);
};
