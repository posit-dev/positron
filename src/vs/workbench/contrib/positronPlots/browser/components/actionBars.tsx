/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './actionBars.css';

// React.
import { PropsWithChildren } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { ActionBarButton } from '../../../../../platform/positronActionBar/browser/components/actionBarButton.js';
import { PositronActionBarContextProvider } from '../../../../../platform/positronActionBar/browser/positronActionBarContext.js';
import { usePositronPlotsContext } from '../positronPlotsContext.js';
import { SizingPolicyMenuButton } from './sizingPolicyMenuButton.js';
import { ZoomPlotMenuButton } from './zoomPlotMenuButton.js';
import { PlotClientInstance } from '../../../../services/languageRuntime/common/languageRuntimePlotClient.js';
import { StaticPlotClient } from '../../../../services/positronPlots/common/staticPlotClient.js';
import { PlotsDisplayLocation } from '../../../../services/positronPlots/common/positronPlots.js';
import { PlotActionTarget, PlotsClearAction, PlotsCopyAction, PlotsGalleryInNewWindowAction, PlotsNextAction, PlotsPopoutAction, PlotsPreviousAction, PlotsSaveAction } from '../positronPlotsActions.js';
import { HtmlPlotClient } from '../htmlPlotClient.js';
import { OpenInEditorMenuButton } from './openInEditorMenuButton.js';
import { DarkFilterMenuButton } from './darkFilterMenuButton.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { PlotCodeMenuButton } from './plotCodeMenuButton.js';
import { DEFAULT_ACTION_BAR_BUTTON_WIDTH, DEFAULT_ACTION_BAR_DROPDOWN_BUTTON_WIDTH, DynamicActionBarAction, PositronDynamicActionBar } from '../../../../../platform/positronActionBar/browser/positronDynamicActionBar.js';

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
const openPlotsGalleryInNewWindow = localize('positronOpenPlotsGalleryInNewWindow', "Open plots gallery in new window");
const clearAllPlots = localize('positronClearAllPlots', "Clear all plots");

/**
 * ActionBarsProps interface.
 */
export interface ActionBarsProps {
	readonly displayLocation: PlotsDisplayLocation;
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
	const services = usePositronReactServicesContext();
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

	// Enable code actions when the plot has code metadata
	const enableCodeActions = hasPlots && !!selectedPlot?.metadata.code;

	// Only show the "Open in editor" button when in the main window
	const showOpenInEditorButton = enableEditorPlot
		&& props.displayLocation === PlotsDisplayLocation.MainWindow;

	// Clear all the plots from the service.
	const clearAllPlotsHandler = () => {
		if (hasPlots) {
			services.commandService.executeCommand(PlotsClearAction.ID);
		}
	};

	// Navigate to the previous plot in the plot history.
	const showPreviousPlotHandler = () => {
		if (!disableLeft) {
			services.commandService.executeCommand(PlotsPreviousAction.ID);
		}
	};

	// Navigate to the next plot in the plot history.
	const showNextPlotHandler = () => {
		if (!disableRight) {
			services.commandService.executeCommand(PlotsNextAction.ID);
		}
	};

	const zoomPlotHandler = (zoomLevel: number) => {
		props.zoomHandler(zoomLevel);
	};
	const savePlotHandler = () => {
		services.commandService.executeCommand(PlotsSaveAction.ID, PlotActionTarget.VIEW);
	};

	const copyPlotHandler = () => {
		services.commandService.executeCommand(PlotsCopyAction.ID, PlotActionTarget.VIEW);
	};

	const popoutPlotHandler = () => {
		services.commandService.executeCommand(PlotsPopoutAction.ID);
	};

	const openGalleryInNewWindowHandler = () => {
		services.commandService.executeCommand(PlotsGalleryInNewWindowAction.ID);
	};

	const leftActions: DynamicActionBarAction[] = [];
	// Previous plot button.
	leftActions.push({
		fixedWidth: DEFAULT_ACTION_BAR_BUTTON_WIDTH,
		separator: false,
		component: (
			<ActionBarButton
				ariaLabel={showPreviousPlot}
				disabled={disableLeft}
				icon={ThemeIcon.fromId('positron-left-arrow')}
				tooltip={showPreviousPlot}
				onPressed={showPreviousPlotHandler}
			/>
		)
	});

	// Next plot button.
	leftActions.push({
		fixedWidth: DEFAULT_ACTION_BAR_BUTTON_WIDTH,
		separator: enableSizingPolicy || enableSavingPlots || enableZoomPlot || enablePopoutPlot,
		component: (
			<ActionBarButton
				ariaLabel={showNextPlot}
				disabled={disableRight}
				icon={ThemeIcon.fromId('positron-right-arrow')}
				tooltip={showNextPlot}
				onPressed={showNextPlotHandler}
			/>
		)
	});

	// Save plot button.
	if (enableSavingPlots) {
		leftActions.push({
			fixedWidth: DEFAULT_ACTION_BAR_BUTTON_WIDTH,
			separator: false,
			component: (
				<ActionBarButton
					ariaLabel={savePlot}
					icon={ThemeIcon.fromId('positron-save')}
					tooltip={savePlot}
					onPressed={savePlotHandler}
				/>
			)
		});
	}

	// Copy plot button.
	if (enableCopyPlot) {
		leftActions.push({
			fixedWidth: DEFAULT_ACTION_BAR_BUTTON_WIDTH,
			separator: false,
			component: (
				<ActionBarButton
					ariaLabel={copyPlotToClipboard}
					disabled={!hasPlots}
					icon={ThemeIcon.fromId('copy')}
					tooltip={copyPlotToClipboard}
					onPressed={copyPlotHandler}
				/>
			),
			overflowContextMenuItem: {
				icon: 'copy',
				label: copyPlotToClipboard,
				disabled: !hasPlots,
				onSelected: copyPlotHandler
			}
		});
	}

	// Zoom plot menu button.
	if (enableZoomPlot) {
		leftActions.push({
			fixedWidth: DEFAULT_ACTION_BAR_DROPDOWN_BUTTON_WIDTH,
			separator: false,
			component: (
				<ZoomPlotMenuButton
					actionHandler={zoomPlotHandler}
					zoomLevel={props.zoomLevel}
				/>
			)
		});
	}

	// Sizing policy menu button.
	if (enableSizingPolicy) {
		leftActions.push({
			fixedWidth: DEFAULT_ACTION_BAR_DROPDOWN_BUTTON_WIDTH,
			separator: false,
			component: <SizingPolicyMenuButton plotClient={selectedPlot} />
		});
	}

	// Popout plot button.
	if (enablePopoutPlot) {
		leftActions.push({
			fixedWidth: DEFAULT_ACTION_BAR_BUTTON_WIDTH,
			separator: false,
			component: (
				<ActionBarButton
					ariaLabel={openPlotInNewWindow}
					icon={ThemeIcon.fromId('positron-open-in-new-window')}
					tooltip={openPlotInNewWindow}
					onPressed={popoutPlotHandler}
				/>
			),
			overflowContextMenuItem: {
				icon: 'positron-open-in-new-window',
				label: openPlotInNewWindow,
				onSelected: popoutPlotHandler
			}
		});
	}

	// Open in editor menu button.
	if (showOpenInEditorButton) {
		leftActions.push({
			fixedWidth: DEFAULT_ACTION_BAR_DROPDOWN_BUTTON_WIDTH,
			separator: false,
			component: (
				<OpenInEditorMenuButton
					ariaLabel={openInEditorTab}
					commandService={services.commandService}
					defaultGroup={services.positronPlotsService.getPreferredEditorGroup()}
					tooltip={openInEditorTab}
				/>
			)
		});
	}

	// Plot code menu button.
	if (enableCodeActions) {
		leftActions.push({
			fixedWidth: DEFAULT_ACTION_BAR_DROPDOWN_BUTTON_WIDTH,
			separator: false,
			component: <PlotCodeMenuButton plotClient={selectedPlot} />
		});
	}

	// Build right actions array.
	const rightActions: DynamicActionBarAction[] = [];
	// Dark filter menu button.
	if (enableDarkFilter) {
		rightActions.push({
			fixedWidth: DEFAULT_ACTION_BAR_DROPDOWN_BUTTON_WIDTH,
			separator: true,
			component: <DarkFilterMenuButton />
		});
	}

	// Gallery in new window button.
	if (props.displayLocation === PlotsDisplayLocation.MainWindow) {
		// Add separator if dark filter wasn't added (it has separator: true).
		const needsSeparator = !enableDarkFilter;
		rightActions.push({
			fixedWidth: DEFAULT_ACTION_BAR_BUTTON_WIDTH,
			separator: needsSeparator,
			component: (
				<ActionBarButton
					align='right'
					ariaLabel={openPlotsGalleryInNewWindow}
					icon={ThemeIcon.fromId('window')}
					tooltip={openPlotsGalleryInNewWindow}
					onPressed={openGalleryInNewWindowHandler}
				/>
			),
			overflowContextMenuItem: {
				icon: 'window',
				label: openPlotsGalleryInNewWindow,
				onSelected: openGalleryInNewWindowHandler
			}
		});
	}

	// Clear all plots button.
	rightActions.push({
		fixedWidth: DEFAULT_ACTION_BAR_BUTTON_WIDTH,
		separator: false,
		component: (
			<ActionBarButton
				align='right'
				ariaLabel={clearAllPlots}
				disabled={noPlots}
				icon={ThemeIcon.fromId('clear-all')}
				tooltip={clearAllPlots}
				onPressed={clearAllPlotsHandler}
			/>
		),
		overflowContextMenuItem: {
			icon: 'clear-all',
			label: clearAllPlots,
			disabled: noPlots,
			onSelected: clearAllPlotsHandler
		}
	});

	// Render.
	return (
		<PositronActionBarContextProvider {...props}>
			<div className='action-bars'>
				<PositronDynamicActionBar
					borderBottom={true}
					borderTop={true}
					leftActions={leftActions}
					paddingLeft={kPaddingLeft}
					paddingRight={kPaddingRight}
					rightActions={rightActions}
				/>
			</div>
		</PositronActionBarContextProvider>
	);
};
