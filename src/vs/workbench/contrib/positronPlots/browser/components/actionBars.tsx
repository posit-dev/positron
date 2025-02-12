/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './actionBars.css';

// React.
import React, { PropsWithChildren } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { PositronActionBar } from '../../../../../platform/positronActionBar/browser/positronActionBar.js';
import { IWorkbenchLayoutService } from '../../../../services/layout/browser/layoutService.js';
import { ActionBarRegion } from '../../../../../platform/positronActionBar/browser/components/actionBarRegion.js';
import { ActionBarButton } from '../../../../../platform/positronActionBar/browser/components/actionBarButton.js';
import { PositronActionBarContextProvider } from '../../../../../platform/positronActionBar/browser/positronActionBarContext.js';
import { usePositronPlotsContext } from '../positronPlotsContext.js';
import { ActionBarSeparator } from '../../../../../platform/positronActionBar/browser/components/actionBarSeparator.js';
import { SizingPolicyMenuButton } from './sizingPolicyMenuButton.js';
import { HistoryPolicyMenuButton } from './historyPolicyMenuButton.js';
import { ZoomPlotMenuButton } from './zoomPlotMenuButton.js';
import { PlotClientInstance } from '../../../../services/languageRuntime/common/languageRuntimePlotClient.js';
import { StaticPlotClient } from '../../../../services/positronPlots/common/staticPlotClient.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { PlotActionTarget, PlotsClearAction, PlotsCopyAction, PlotsNextAction, PlotsPopoutAction, PlotsPreviousAction, PlotsSaveAction } from '../positronPlotsActions.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { HtmlPlotClient } from '../htmlPlotClient.js';
import { IAccessibilityService } from '../../../../../platform/accessibility/common/accessibility.js';
import { OpenInEditorMenuButton } from './openInEditorMenuButton.js';
import { DarkFilterMenuButton } from './darkFilterMenuButton.js';
import { IPreferencesService } from '../../../../services/preferences/common/preferences.js';

// Constants.
const kPaddingLeft = 14;
const kPaddingRight = 8;

// Localized strings.
const showPreviousPlot = localize('positronShowPreviousPlot', "Show previous plot");
const showNextPlot = localize('positronShowNextPlot', "Show next plot");
const savePlot = localize('positronSavePlot', "Save plot");
const copyPlotToClipboard = localize('positronCopyPlotToClipboard', "Copy plot to clipboard");
const openPlotInNewWindow = localize('positronOpenPlotInNewWindow', "Open plot in new window");
const openInEditorTab = localize('positronOpenPlotInEditorTab', "Open in editor tab");
const clearAllPlots = localize('positronClearAllPlots', "Clear all plots");

/**
 * ActionBarsProps interface.
 */
export interface ActionBarsProps {
	// Services.
	readonly accessibilityService: IAccessibilityService;
	readonly commandService: ICommandService;
	readonly configurationService: IConfigurationService;
	readonly contextKeyService: IContextKeyService;
	readonly contextMenuService: IContextMenuService;
	readonly hoverService: IHoverService;
	readonly keybindingService: IKeybindingService;
	readonly layoutService: IWorkbenchLayoutService;
	readonly notificationService: INotificationService;
	readonly preferencesService: IPreferencesService;
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
		&& (selectedPlot instanceof StaticPlotClient
			|| selectedPlot instanceof PlotClientInstance);
	const enableSavingPlots = hasPlots
		&& (selectedPlot instanceof PlotClientInstance
			|| selectedPlot instanceof StaticPlotClient);

	const enableCopyPlot = hasPlots &&
		(selectedPlot instanceof StaticPlotClient
			|| selectedPlot instanceof PlotClientInstance);
	const enableDarkFilter = enableCopyPlot;

	const enablePopoutPlot = hasPlots &&
		selectedPlot instanceof HtmlPlotClient;

	const enableEditorPlot = hasPlots
		&& (selectedPlot instanceof PlotClientInstance
			|| selectedPlot instanceof StaticPlotClient);

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
		props.commandService.executeCommand(PlotsSaveAction.ID, PlotActionTarget.VIEW);
	};

	const copyPlotHandler = () => {
		props.commandService.executeCommand(PlotsCopyAction.ID, PlotActionTarget.VIEW);
	};

	const popoutPlotHandler = () => {
		props.commandService.executeCommand(PlotsPopoutAction.ID);
	};

	// Render.
	return (
		<PositronActionBarContextProvider {...props}>
			<div className='action-bars'>
				<PositronActionBar
					borderBottom={true}
					borderTop={true}
					paddingLeft={kPaddingLeft}
					paddingRight={kPaddingRight}
					size='small'
				>
					<ActionBarRegion location='left'>
						<ActionBarButton
							ariaLabel={showPreviousPlot}
							disabled={disableLeft}
							iconId='positron-left-arrow'
							tooltip={showPreviousPlot}
							onPressed={showPreviousPlotHandler}
						/>
						<ActionBarButton
							ariaLabel={showNextPlot}
							disabled={disableRight}
							iconId='positron-right-arrow'
							tooltip={showNextPlot}
							onPressed={showNextPlotHandler}
						/>

						{(enableSizingPolicy || enableSavingPlots || enableZoomPlot || enablePopoutPlot) &&
							<ActionBarSeparator />
						}

						{enableSavingPlots &&
							<ActionBarButton
								ariaLabel={savePlot}
								iconId='positron-save'
								tooltip={savePlot}
								onPressed={savePlotHandler}
							/>
						}
						{enableCopyPlot &&
							<ActionBarButton
								ariaLabel={copyPlotToClipboard}
								disabled={!hasPlots}
								iconId='copy'
								tooltip={copyPlotToClipboard}
								onPressed={copyPlotHandler}
							/>
						}
						{enableZoomPlot &&
							<ZoomPlotMenuButton
								actionHandler={zoomPlotHandler}
								zoomLevel={props.zoomLevel}
							/>}
						{enableSizingPolicy &&
							<SizingPolicyMenuButton
								keybindingService={props.keybindingService}
								layoutService={props.layoutService}
								notificationService={positronPlotsContext.notificationService}
								plotClient={selectedPlot}
								plotsService={positronPlotsContext.positronPlotsService}
							/>
						}
						{enablePopoutPlot &&
							<ActionBarButton
								align='right'
								ariaLabel={openPlotInNewWindow}
								iconId='positron-open-in-new-window'
								tooltip={openPlotInNewWindow}
								onPressed={popoutPlotHandler}
							/>
						}
						{enableEditorPlot &&
							<OpenInEditorMenuButton
								ariaLabel={openInEditorTab}
								commandService={positronPlotsContext.commandService}
								defaultGroup={positronPlotsContext.positronPlotsService.getPreferredEditorGroup()}
								tooltip={openInEditorTab}
							/>
						}
					</ActionBarRegion>
					<ActionBarRegion location='right'>
						{enableDarkFilter &&
							<DarkFilterMenuButton
								plotsService={positronPlotsContext.positronPlotsService}
								preferencesService={positronPlotsContext.preferencesService}
							/>
						}
						<HistoryPolicyMenuButton
							plotsService={positronPlotsContext.positronPlotsService}
						/>
						<ActionBarSeparator />
						<ActionBarButton
							align='right'
							ariaLabel={clearAllPlots}
							disabled={noPlots}
							iconId='clear-all'
							tooltip={clearAllPlots}
							onPressed={clearAllPlotsHandler}
						/>
					</ActionBarRegion>
				</PositronActionBar>
			</div>
		</PositronActionBarContextProvider>
	);
};
