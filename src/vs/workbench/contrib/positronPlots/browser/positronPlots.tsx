/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronPlots';
import * as React from 'react';
import { PropsWithChildren, useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { PositronPlotsServices } from 'vs/workbench/contrib/positronPlots/browser/positronPlotsState';
import { PositronPlotsContextProvider } from 'vs/workbench/contrib/positronPlots/browser/positronPlotsContext';
import { IPositronPlotsService } from 'vs/workbench/services/positronPlots/common/positronPlots';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { PlotsContainer } from 'vs/workbench/contrib/positronPlots/browser/components/plotsContainer';
import { ActionBars } from 'vs/workbench/contrib/positronPlots/browser/components/actionBars';

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
	readonly positronPlotsService: IPositronPlotsService;
}

/**
 * PositronPlots component.
 * @param props A PositronPlotsProps that contains the component properties.
 * @returns The rendered component.
 */
export const PositronPlots = (props: PropsWithChildren<PositronPlotsProps>) => {

	// Hooks.
	const [width, setWidth] = useState(props.reactComponentContainer.width);
	const [height, setHeight] = useState(props.reactComponentContainer.height);

	// Add IReactComponentContainer event handlers.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onSizeChanged event handler.
		disposableStore.add(props.reactComponentContainer.onSizeChanged(size => {
			setWidth(size.width);
			setHeight(size.height);
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, []);

	// Render.
	return (
		<PositronPlotsContextProvider {...props}>
			<ActionBars {...props} />
			<PlotsContainer
				width={width}
				height={height - 34} />
		</PositronPlotsContextProvider>
	);

};
