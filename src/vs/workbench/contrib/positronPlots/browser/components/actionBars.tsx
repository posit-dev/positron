/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./actionBars';
import * as React from 'react';
import { PropsWithChildren, useEffect } from 'react'; // eslint-disable-line no-duplicate-imports
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
import { PositronActionBarContextProvider } from 'vs/platform/positronActionBar/browser/positronActionBarContext';
import { usePositronPlotsContext } from 'vs/workbench/contrib/positronPlots/browser/positronPlotsContext';
import { ActionBarSeparator } from 'vs/platform/positronActionBar/browser/components/actionBarSeparator';

// Constants.
const kPaddingLeft = 14;
const kPaddingRight = 8;

/**
 * ActionBarsProps interface.
 */
export interface ActionBarsProps {
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
	// Hooks.
	const positronPlotsContext = usePositronPlotsContext();

	useEffect(() => {
		// Empty for now.
	});

	// Clear all the plots from the service.
	const clearAllPlotsHandler = () => {
		positronPlotsContext.positronPlotsService.removeAllPlots();
	};

	// Navigate to the previous plot in the plot history.
	const showPreviousPlotHandler = () => {
		positronPlotsContext.positronPlotsService.selectPreviousPlot();
	};

	// Navigate to the next plot in the plot history.
	const showNextPlotHandler = () => {
		positronPlotsContext.positronPlotsService.selectNextPlot();
	};

	// Remove the selected plot from the service.
	const removeSelectedPlotHandler = () => {
		positronPlotsContext.positronPlotsService.removeSelectedPlot();
	};

	// Render.
	return (
		<PositronActionBarContextProvider {...props}>
			<div className='action-bars'>
				<PositronActionBar size='small' paddingLeft={kPaddingLeft} paddingRight={kPaddingRight}>
					<ActionBarRegion align='left'>
						<ActionBarButton iconId='positron-left-arrow' tooltip={localize('positronShowPreviousPlot', "Show previous plot")} onClick={showPreviousPlotHandler} />
						<ActionBarButton iconId='positron-right-arrow' tooltip={localize('positronShowNextPlot', "Show next plot")} onClick={showNextPlotHandler} />
						<ActionBarSeparator />
						<ActionBarButton iconId='positron-clear' tooltip={localize('positronRemoveSelectedPlot', "Remove selected plot")} onClick={removeSelectedPlotHandler} />
						<ActionBarSeparator />
						<ActionBarButton iconId='positron-clean' tooltip={localize('positronClearAllPlots', "Clear all plots")} onClick={clearAllPlotsHandler} />
					</ActionBarRegion>
				</PositronActionBar>
			</div>
		</PositronActionBarContextProvider>
	);
};
