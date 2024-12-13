/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './actionBars.css';

// React.
import React, { PropsWithChildren, useEffect } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IConfigurationChangeEvent, IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
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
import { CopyPlotTarget, PlotsClearAction, PlotsCopyAction, PlotsNextAction, PlotsPopoutAction, PlotsPreviousAction, PlotsSaveAction } from '../positronPlotsActions.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { HtmlPlotClient } from '../htmlPlotClient.js';
import { POSITRON_EDITOR_PLOTS, positronPlotsEditorEnabled } from '../../../positronPlotsEditor/browser/positronPlotsEditor.contribution.js';
import { IAccessibilityService } from '../../../../../platform/accessibility/common/accessibility.js';

// Constants.
const kPaddingLeft = 14;
const kPaddingRight = 8;

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
	const [useEditorPlots, setUseEditorPlots] = React.useState<boolean>(positronPlotsEditorEnabled(props.configurationService));

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

	const enablePopoutPlot = hasPlots &&
		selectedPlot instanceof HtmlPlotClient;

	const enableEditorPlot = hasPlots && useEditorPlots
		&& (selectedPlot instanceof PlotClientInstance
			|| selectedPlot instanceof StaticPlotClient);

	useEffect(() => {
		const disposable = props.configurationService.onDidChangeConfiguration((event: IConfigurationChangeEvent) => {
			if (event.affectedKeys.has(POSITRON_EDITOR_PLOTS)) {
				setUseEditorPlots(positronPlotsEditorEnabled(props.configurationService));
			}
		});
		return () => disposable.dispose();
	}, [props.configurationService]);

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
		props.commandService.executeCommand(PlotsCopyAction.ID, CopyPlotTarget.VIEW);
	};

	const popoutPlotHandler = () => {
		props.commandService.executeCommand(PlotsPopoutAction.ID);
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

						{(enableSizingPolicy || enableSavingPlots || enableZoomPlot || enablePopoutPlot) ? <ActionBarSeparator /> : null}
						{enableSavingPlots ? <ActionBarButton iconId='positron-save' tooltip={localize('positronSavePlot', "Save plot")}
							ariaLabel={localize('positronSavePlot', "Save plot")} onPressed={savePlotHandler} /> : null}
						{enableCopyPlot ? <ActionBarButton iconId='copy' disabled={!hasPlots} tooltip={localize('positron-copy-plot', "Copy plot to clipboard")} ariaLabel={localize('positron-copy-plot', "Copy plot to clipboard")}
							onPressed={copyPlotHandler} /> : null}
						{enableZoomPlot ? <ZoomPlotMenuButton actionHandler={zoomPlotHandler} zoomLevel={props.zoomLevel} /> : null}
						{enableSizingPolicy ?
							<SizingPolicyMenuButton
								keybindingService={props.keybindingService}
								layoutService={props.layoutService}
								notificationService={positronPlotsContext.notificationService}
								plotsService={positronPlotsContext.positronPlotsService}
								plotClient={selectedPlot}
							/>
							: null
						}
						{enablePopoutPlot ?
							<ActionBarButton
								iconId='positron-open-in-new-window'
								align='right'
								tooltip={localize('positron-popout-plot', "Open plot in new window")}
								ariaLabel={localize('positron-popout-plot', "Open plot in new window")}
								onPressed={popoutPlotHandler} />
							: null
						}
						{enableEditorPlot ?
							<ActionBarButton
								iconId='go-to-file'
								align='right'
								tooltip={localize('positron-open-plot-editor', "Open plot in editor")}
								ariaLabel={localize('positron-open-plot-editor', "Open plot in editor")}
								onPressed={() => {
									if (hasPlots) {
										positronPlotsContext.positronPlotsService.openEditor();
									}
								}} />
							: null
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
