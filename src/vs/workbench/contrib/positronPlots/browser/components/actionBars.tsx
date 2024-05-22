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
import { SizingPolicyMenuButton } from 'vs/workbench/contrib/positronPlots/browser/components/sizingPolicyMenuButton';
import { HistoryPolicyMenuButton } from 'vs/workbench/contrib/positronPlots/browser/components/historyPolicyMenuButton';
import { ZoomPlotMenuButton } from 'vs/workbench/contrib/positronPlots/browser/components/zoomPlotMenuButton';
import { PlotClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimePlotClient';
import { StaticPlotClient } from 'vs/workbench/services/positronPlots/common/staticPlotClient';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { PlotsClearAction, PlotsCopyAction, PlotsNextAction, PlotsPreviousAction, PlotsSaveAction } from 'vs/workbench/contrib/positronPlots/browser/positronPlotsActions';

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
	readonly notificationService: INotificationService;
	readonly zoomHandler: (zoomLevel: number) => void;
	readonly zoomLevel: number;
}

/**
 * ActionBars component.
 * @param props An ActionBarsProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActionBars = (props: PropsWithChildren<ActionBarsProps>) => {
	// Hooks.
	const positronPlotsContext = usePositronPlotsContext();

	// Do we have any plots?
	const noPlots = positronPlotsContext.positronPlotInstances.length === 0;
	const hasPlots = !noPlots;
	const disableLeft = noPlots || positronPlotsContext.selectedInstanceIndex <= 0;
	const disableRight = noPlots || positronPlotsContext.selectedInstanceIndex >=
		positronPlotsContext.positronPlotInstances.length - 1;
	const selectedPlot = positronPlotsContext.positronPlotInstances[positronPlotsContext.selectedInstanceIndex];

	// Only show the sizing policy controls when Positron is in control of the
	// sizing (i.e. don't show it on static plots)
	const enableSizingPolicy = hasPlots
		&& selectedPlot instanceof PlotClientInstance;
	const enableZoomPlot = hasPlots
		&& selectedPlot instanceof StaticPlotClient;
	const enableSavingPlots = hasPlots
		&& (selectedPlot instanceof PlotClientInstance
			|| selectedPlot instanceof StaticPlotClient);

	const enableCopyPlot = hasPlots &&
		(positronPlotsContext.positronPlotInstances[positronPlotsContext.selectedInstanceIndex]
			instanceof StaticPlotClient
			|| positronPlotsContext.positronPlotInstances[positronPlotsContext.selectedInstanceIndex]
			instanceof PlotClientInstance);

	useEffect(() => {
		// Empty for now.
	});

	// Clear all the plots from the service.
	const clearAllPlotsHandler = () => {
		if (hasPlots) {
			props.commandService.executeCommand(PlotsClearAction.ID);
		}
	};

	// Navigate to the previous plot in the plot history.
	const showPreviousPlotHandler = () => {
		if (!disableLeft) {
			props.commandService.executeCommand(PlotsPreviousAction.ID);
		}
	};

	// Navigate to the next plot in the plot history.
	const showNextPlotHandler = () => {
		if (!disableRight) {
			props.commandService.executeCommand(PlotsNextAction.ID);
		}
	};

	const zoomPlotHandler = (zoomLevel: number) => {
		props.zoomHandler(zoomLevel);
	};
	const savePlotHandler = () => {
		props.commandService.executeCommand(PlotsSaveAction.ID);
	};

	const copyPlotHandler = () => {
		props.commandService.executeCommand(PlotsCopyAction.ID);
	};

	// Render.
	return (
		<PositronActionBarContextProvider {...props}>
			<div className='action-bars'>
				<PositronActionBar size='small' borderTop={true} borderBottom={true} paddingLeft={kPaddingLeft} paddingRight={kPaddingRight}>
					<ActionBarRegion location='left'>
						<ActionBarButton iconId='positron-left-arrow' disabled={disableLeft} tooltip={localize('positronShowPreviousPlot', "Show previous plot")}
							ariaLabel={localize('positronShowPreviousPlot', "Show previous plot")} onPressed={showPreviousPlotHandler} />
						<ActionBarButton iconId='positron-right-arrow' disabled={disableRight} tooltip={localize('positronShowNextPlot', "Show next plot")}
							ariaLabel={localize('positronShowNextPlot', "Show next plot")} onPressed={showNextPlotHandler} />

						{(enableSizingPolicy || enableSavingPlots || enableZoomPlot) && <ActionBarSeparator />}
						{enableSavingPlots && <ActionBarButton iconId='positron-save' tooltip={localize('positronSavePlot', "Save plot")}
							ariaLabel={localize('positronSavePlot', "Save plot")} onPressed={savePlotHandler} />}
						{enableCopyPlot && <ActionBarButton iconId='copy' disabled={!hasPlots} tooltip={localize('positron-copy-plot', "Copy plot to clipboard")} ariaLabel={localize('positron-copy-plot', "Copy plot to clipboard")}
							onPressed={copyPlotHandler} />}
						{enableZoomPlot && <ZoomPlotMenuButton actionHandler={zoomPlotHandler} zoomLevel={props.zoomLevel} />}
						{enableSizingPolicy &&
							<SizingPolicyMenuButton
								keybindingService={props.keybindingService}
								layoutService={props.layoutService}
								notificationService={positronPlotsContext.notificationService}
								plotsService={positronPlotsContext.positronPlotsService}
							/>
						}
					</ActionBarRegion>
					<ActionBarRegion location='right'>
						<HistoryPolicyMenuButton plotsService={positronPlotsContext.positronPlotsService} />
						<ActionBarSeparator />
						<ActionBarButton iconId='clear-all' align='right' disabled={noPlots} tooltip={localize('positronClearAllPlots', "Clear all plots")}
							ariaLabel={localize('positronClearAllPlots', "Clear all plots")} onPressed={clearAllPlotsHandler} />
					</ActionBarRegion>
				</PositronActionBar>
			</div>
		</PositronActionBarContextProvider>
	);
};
