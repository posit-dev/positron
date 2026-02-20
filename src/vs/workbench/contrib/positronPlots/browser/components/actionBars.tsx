/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './actionBars.css';

// React.
import { PropsWithChildren, useEffect, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { ActionBarButton } from '../../../../../platform/positronActionBar/browser/components/actionBarButton.js';
import { PositronActionBarContextProvider } from '../../../../../platform/positronActionBar/browser/positronActionBarContext.js';
import { usePositronPlotsContext } from '../positronPlotsContext.js';
import { SizingPolicyMenuButton } from './sizingPolicyMenuButton.js';
import { PlotClientInstance } from '../../../../services/languageRuntime/common/languageRuntimePlotClient.js';
import { StaticPlotClient } from '../../../../services/positronPlots/common/staticPlotClient.js';
import { DarkFilter, PlotsDisplayLocation, ZoomLevel } from '../../../../services/positronPlots/common/positronPlots.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IAction } from '../../../../../base/common/actions.js';
import { CustomContextMenuItem } from '../../../../browser/positronComponents/customContextMenu/customContextMenuItem.js';
import { ActionBarMenuButton } from '../../../../../platform/positronActionBar/browser/components/actionBarMenuButton.js';
import { PlotActionTarget, PlotsClearAction, PlotsCopyAction, PlotsGalleryInNewWindowAction, PlotsNextAction, PlotsPopoutAction, PlotsPreviousAction, PlotsSaveAction } from '../positronPlotsActions.js';
import { HtmlPlotClient } from '../htmlPlotClient.js';
import { OpenInEditorMenuButton } from './openInEditorMenuButton.js';
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
// dark filter localized strings
const darkFilterLabel = localize('positron.darkFilter', "Dark Filter");
const darkFilterNoneLabel = localize('positron.darkFilterNone', "No Filter");
const darkFilterFollowThemeLabel = localize('positron.darkFilterFollowTheme', "Follow Theme");
const darkFilterTooltip = localize('positronDarkFilterTooltip', "Set whether a dark filter is applied to plots.");
const openDarkFilterSettings = localize('positron.openDarkFilterSettings', "Change Default in Settings...");
// zoom localized strings
const zoomLabel = localize('positron.zoom', "Zoom");
const zoomPlotTooltip = localize('positronZoomPlotTooltip', "Set the plot zoom");
const zoomLevelLabels = new Map<ZoomLevel, string>([
	[ZoomLevel.Fit, localize('positronZoomFit', 'Fit')],
	[ZoomLevel.Fifty, localize('positronZoomFifty', '50%')],
	[ZoomLevel.SeventyFive, localize('positronZoomSeventyFive', '75%')],
	[ZoomLevel.OneHundred, localize('positronZoomActual', '100%')],
	[ZoomLevel.TwoHundred, localize('positronZoomDouble', '200%')],
]);

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

	// State
	const [darkFilterMode, setDarkFilterMode] = useState(services.positronPlotsService.darkFilterMode);

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

	// Track dark filter mode changes.
	useEffect(() => {
		const disposableStore = new DisposableStore();
		// Add the event handler for dark filter mode changes.
		disposableStore.add(services.positronPlotsService.onDidChangeDarkFilterMode(mode => {
			setDarkFilterMode(mode);
		}));
		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, [services.positronPlotsService]);

	const labelForDarkFilter = (filter: DarkFilter): string => {
		switch (filter) {
			case DarkFilter.On: return darkFilterLabel;
			case DarkFilter.Off: return darkFilterNoneLabel;
			case DarkFilter.Auto: return darkFilterFollowThemeLabel;
		}
	};

	const iconForDarkFilter = (filter: DarkFilter): string => {
		switch (filter) {
			case DarkFilter.On: return 'circle-large-filled';
			case DarkFilter.Off: return 'circle-large';
			case DarkFilter.Auto: return 'color-mode';
		}
	};

	// Dark filter actions builder.
	const darkFilterActions = (): IAction[] => {
		const modes = [DarkFilter.On, DarkFilter.Off, DarkFilter.Auto];

		const actions: IAction[] = modes.map(mode => ({
			id: mode,
			label: labelForDarkFilter(mode),
			tooltip: '',
			class: undefined,
			enabled: true,
			checked: darkFilterMode === mode,
			run: () => services.positronPlotsService.setDarkFilterMode(mode)
		}));

		// Add settings action.
		actions.push({
			id: 'open-settings',
			label: openDarkFilterSettings,
			tooltip: '',
			class: undefined,
			enabled: true,
			run: async () => {
				await services.preferencesService.openUserSettings({
					jsonEditor: false,
					query: 'plots.darkFilter,positron.plots.darkFilter'
				});
			}
		});

		return actions;
	};

	// A function that converts the dark filter IAction[] to CustomContextMenuItem[] for the overflow menu.
	const darkFilterOverflowEntries = () => darkFilterActions().map(action => new CustomContextMenuItem({
		label: action.label,
		checked: action.checked,
		disabled: !action.enabled,
		onSelected: () => action.run()
	}));

	// Zoom actions builder.
	const zoomActions = (): IAction[] => {
		const zoomLevels = [ZoomLevel.Fit, ZoomLevel.Fifty, ZoomLevel.SeventyFive, ZoomLevel.OneHundred, ZoomLevel.TwoHundred];
		return zoomLevels.map(level => ({
			id: ZoomLevel[level],
			label: zoomLevelLabels.get(level) || ZoomLevel[level],
			tooltip: '',
			class: undefined,
			enabled: true,
			checked: props.zoomLevel === level,
			run: () => props.zoomHandler(level)
		}));
	};

	// A function that converts the zoom IAction[] to CustomContextMenuItem[] for the overflow menu.
	const zoomOverflowEntries = () => zoomActions().map(action => new CustomContextMenuItem({
		label: action.label,
		checked: action.checked,
		disabled: !action.enabled,
		onSelected: () => action.run()
	}));

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
		const zoomLevelLabel = zoomLevelLabels.get(props.zoomLevel) || ZoomLevel[props.zoomLevel];
		leftActions.push({
			fixedWidth: DEFAULT_ACTION_BAR_DROPDOWN_BUTTON_WIDTH,
			separator: false,
			text: zoomLevelLabel,
			component: (
				<ActionBarMenuButton
					actions={zoomActions}
					icon={ThemeIcon.fromId('positron-size-to-fit')}
					label={zoomLevelLabel}
					tooltip={zoomPlotTooltip}
				/>
			),
			overflowContextMenuSubmenu: {
				icon: 'positron-size-to-fit',
				label: zoomLabel,
				entries: zoomOverflowEntries
			}
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
			component: (
				<ActionBarMenuButton
					actions={darkFilterActions}
					align='right'
					ariaLabel={darkFilterTooltip}
					icon={ThemeIcon.fromId(iconForDarkFilter(darkFilterMode))}
					tooltip={darkFilterTooltip}
				/>
			),
			overflowContextMenuSubmenu: {
				icon: iconForDarkFilter(darkFilterMode),
				label: darkFilterLabel,
				// pass in the helper function that returns the CustomContextMenuItem[] for the submenu entries
				entries: darkFilterOverflowEntries
			}
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
