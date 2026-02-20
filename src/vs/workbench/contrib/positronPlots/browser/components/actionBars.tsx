/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './actionBars.css';

// React.
import { PropsWithChildren, useCallback, useEffect, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { ActionBarButton } from '../../../../../platform/positronActionBar/browser/components/actionBarButton.js';
import { PositronActionBarContextProvider } from '../../../../../platform/positronActionBar/browser/positronActionBarContext.js';
import { usePositronPlotsContext } from '../positronPlotsContext.js';
import { PlotClientInstance } from '../../../../services/languageRuntime/common/languageRuntimePlotClient.js';
import { StaticPlotClient } from '../../../../services/positronPlots/common/staticPlotClient.js';
import { DarkFilter, PlotsDisplayLocation, ZoomLevel } from '../../../../services/positronPlots/common/positronPlots.js';
import { DisposableStore, IDisposable } from '../../../../../base/common/lifecycle.js';
import { IAction, Separator } from '../../../../../base/common/actions.js';
import { PlotSizingPolicyCustom } from '../../../../services/positronPlots/common/sizingPolicyCustom.js';
import { showSetPlotSizeModalDialog } from '../modalDialogs/setPlotSizeModalDialog.js';
import { IPositronPlotSizingPolicy } from '../../../../services/positronPlots/common/sizingPolicy.js';
import { PlotSizingPolicyIntrinsic } from '../../../../services/positronPlots/common/sizingPolicyIntrinsic.js';
import { disposableTimeout } from '../../../../../base/common/async.js';
import { CustomContextMenuItem } from '../../../../browser/positronComponents/customContextMenu/customContextMenuItem.js';
import { CustomContextMenuSeparator } from '../../../../browser/positronComponents/customContextMenu/customContextMenuSeparator.js';
import { ActionBarMenuButton } from '../../../../../platform/positronActionBar/browser/components/actionBarMenuButton.js';
import { PlotActionTarget, PlotsClearAction, PlotsCopyAction, PlotsEditorAction, PlotsGalleryInNewWindowAction, PlotsNextAction, PlotsPopoutAction, PlotsPreviousAction, PlotsSaveAction } from '../positronPlotsActions.js';
import { HtmlPlotClient } from '../htmlPlotClient.js';
import { AUX_WINDOW_GROUP_TYPE, ACTIVE_GROUP_TYPE, SIDE_GROUP_TYPE, AUX_WINDOW_GROUP, ACTIVE_GROUP, SIDE_GROUP } from '../../../../services/editor/common/editorService.js';
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
// sizing policy localized strings
const sizingPolicyLabel = localize('positron.sizingPolicy', "Sizing");
const sizingPolicyTooltip = localize('positronSizingPolicyTooltip', "Set how the plot's shape and size are determined");
const newCustomPolicyLabel = localize('positronNewCustomSize', "New Custom Size...");
const changeCustomPolicyLabel = localize('positronChangeCustomSize', "Change Custom Size...");
// open in editor localized strings
const openInEditorLabel = localize('positron.openInEditor', "Open in Editor");
const openInEditorDropdownLabel = localize('positron-editor-open-in-editor-dropdown', "Select where to open plot");

// Open in editor command interface and data.
interface OpenInEditorCommand {
	editorTarget: AUX_WINDOW_GROUP_TYPE | ACTIVE_GROUP_TYPE | SIDE_GROUP_TYPE;
	label: string;
}

const openInEditorCommands: Array<OpenInEditorCommand> = [
	{
		editorTarget: AUX_WINDOW_GROUP,
		label: localize('positron-editor-new-window', "Open in new window")
	},
	{
		editorTarget: ACTIVE_GROUP,
		label: localize('positron-editor-new-tab', "Open in editor tab")
	},
	{
		editorTarget: SIDE_GROUP,
		label: localize('positron-editor-new-tab-right', "Open in editor tab to the Side")
	},
];

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
	const plotClientForPolicy = selectedPlot instanceof PlotClientInstance ? selectedPlot : undefined;

	// State for sizing policy label.
	const [activePolicyLabel, setActivePolicyLabel] = useState(() =>
		plotClientForPolicy?.sizingPolicy.getName(plotClientForPolicy) ?? ''
	);

	// State for open in editor default action.
	const [defaultEditorAction, setDefaultEditorAction] = useState<number>(
		services.positronPlotsService.getPreferredEditorGroup()
	);

	// Handler to open plot in editor and update default action.
	const openEditorPlotHandler = useCallback((groupType: number) => {
		services.commandService.executeCommand(PlotsEditorAction.ID, groupType);
		setDefaultEditorAction(groupType);
	}, [services.commandService]);

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

	// Track sizing policy changes.
	useEffect(() => {
		if (!plotClientForPolicy) {
			return;
		}

		const disposables = new DisposableStore();

		const attachPolicy = (policy: IPositronPlotSizingPolicy) => {
			const policyDisposables = new DisposableStore();

			// If the intrinsic policy is active and the plot's intrinsic size has not been received,
			// debounce the active policy label update to avoid flickering.
			let debounceTimeout: IDisposable | undefined;
			if (policy instanceof PlotSizingPolicyIntrinsic && !plotClientForPolicy.receivedIntrinsicSize) {
				debounceTimeout = disposableTimeout(() => {
					setActivePolicyLabel(policy.getName(plotClientForPolicy));
				}, 250, policyDisposables);
			} else {
				setActivePolicyLabel(policy.getName(plotClientForPolicy));
			}

			if (policy instanceof PlotSizingPolicyIntrinsic) {
				// Update the active policy label when the selected policy's name changes.
				policyDisposables.add(plotClientForPolicy.onDidSetIntrinsicSize(() => {
					debounceTimeout?.dispose();
					setActivePolicyLabel(policy.getName(plotClientForPolicy));
				}));
			}

			return policyDisposables;
		};

		let policyDisposables = attachPolicy(services.positronPlotsService.selectedSizingPolicy);

		// Update the active policy label when the selected policy changes.
		disposables.add(plotClientForPolicy.onDidChangeSizingPolicy(policy => {
			policyDisposables.dispose();
			policyDisposables = attachPolicy(policy);
		}));
		return () => {
			disposables.dispose();
			policyDisposables.dispose();
		};
	}, [plotClientForPolicy, services.positronPlotsService.selectedSizingPolicy]);

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

	// Sizing policy actions builder.
	const sizingPolicyActions = (): IAction[] => {
		if (!plotClientForPolicy) {
			return [];
		}

		const selectedPolicy = services.positronPlotsService.selectedSizingPolicy;

		// Build the actions for all sizing policies except the custom policy.
		const actions: IAction[] = [];
		services.positronPlotsService.sizingPolicies.forEach(policy => {
			if (policy.id !== PlotSizingPolicyCustom.ID) {
				// Only enable the intrinsic policy if the plot's intrinsic size is known.
				const enabled = policy instanceof PlotSizingPolicyIntrinsic ?
					!!plotClientForPolicy.intrinsicSize : true;

				actions.push({
					id: policy.id,
					label: policy.getName(plotClientForPolicy),
					tooltip: '',
					class: undefined,
					enabled,
					checked: policy.id === selectedPolicy.id,
					run: () => {
						plotClientForPolicy.sizingPolicy = policy;
					}
				});
			}
		});

		// Add a separator and the custom policy, if it exists.
		actions.push(new Separator());
		const customPolicy = services.positronPlotsService.sizingPolicies.find(
			policy => policy.id === PlotSizingPolicyCustom.ID) as PlotSizingPolicyCustom;
		if (customPolicy) {
			actions.push({
				id: customPolicy.id,
				label: customPolicy.getName(plotClientForPolicy),
				tooltip: '',
				class: undefined,
				enabled: true,
				checked: customPolicy.id === selectedPolicy.id,
				run: () => {
					plotClientForPolicy.sizingPolicy = customPolicy;
				}
			});
		}

		actions.push({
			id: 'custom',
			label: customPolicy ? changeCustomPolicyLabel : newCustomPolicyLabel,
			tooltip: '',
			class: undefined,
			enabled: true,
			run: () => {
				showSetPlotSizeModalDialog(
					customPolicy ? customPolicy.size : undefined,
					result => {
						if (result === null) {
							// The user clicked the delete button; this results in a special `null`
							// value that signals that the custom policy should be deleted.
							services.positronPlotsService.clearCustomPlotSize();
						} else if (result) {
							if (result.size.width < 100 || result.size.height < 100) {
								// The user entered a size that's too small. Plots drawn at this
								// size would be too small to be useful, so we show an error
								// message.
								services.notificationService.error(
									localize(
										'positronPlotSizeTooSmall',
										"The custom plot size {0}x{1} is invalid. The size must be at least 100x100.",
										result.size.width,
										result.size.height
									)
								);
							} else {
								// The user entered a valid size; set the custom policy.
								services.positronPlotsService.setCustomPlotSize(result.size);
								plotClientForPolicy.sizingPolicy = new PlotSizingPolicyCustom(result.size);
							}
						}
					}
				);
			}
		});

		return actions;
	};

	// A function that converts the sizing policy IAction[] to CustomContextMenuItem[] for the overflow menu.
	const sizingPolicyOverflowEntries = () => sizingPolicyActions().map(action => {
		if (action instanceof Separator) {
			return new CustomContextMenuSeparator();
		}
		return new CustomContextMenuItem({
			label: action.label,
			checked: action.checked,
			disabled: !action.enabled,
			onSelected: () => action.run()
		});
	});

	// Open in editor actions builder.
	const openInEditorActions = (): IAction[] => {
		return openInEditorCommands.map(command => ({
			id: PlotsEditorAction.ID,
			label: command.label,
			tooltip: '',
			class: undefined,
			checked: defaultEditorAction === command.editorTarget,
			enabled: true,
			run: () => openEditorPlotHandler(command.editorTarget)
		}));
	};

	// A function that converts the open in editor IAction[] to CustomContextMenuItem[] for the overflow menu.
	const openInEditorOverflowEntries = () => openInEditorActions().map(action => new CustomContextMenuItem({
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
			text: activePolicyLabel,
			component: (
				<ActionBarMenuButton
					actions={sizingPolicyActions}
					icon={ThemeIcon.fromId('symbol-ruler')}
					label={activePolicyLabel}
					tooltip={sizingPolicyTooltip}
				/>
			),
			overflowContextMenuSubmenu: {
				icon: 'symbol-ruler',
				label: sizingPolicyLabel,
				entries: sizingPolicyOverflowEntries
			}
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
				<ActionBarMenuButton
					actions={openInEditorActions}
					ariaLabel={openInEditorTab}
					dropdownAriaLabel={openInEditorDropdownLabel}
					dropdownIndicator='enabled-split'
					dropdownTooltip={openInEditorDropdownLabel}
					icon={ThemeIcon.fromId('go-to-file')}
					tooltip={openInEditorTab}
				/>
			),
			overflowContextMenuSubmenu: {
				icon: 'go-to-file',
				label: openInEditorLabel,
				entries: openInEditorOverflowEntries
			}
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
