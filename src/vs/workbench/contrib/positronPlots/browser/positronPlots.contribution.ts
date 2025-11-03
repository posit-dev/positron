/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from '../../../../nls.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { PositronPlotsViewPane } from './positronPlotsView.js';
import { PositronPlotsService } from './positronPlotsService.js';
import { IPositronPlotsService, POSITRON_PLOTS_VIEW_ID } from '../../../services/positronPlots/common/positronPlots.js';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions, IWorkbenchContribution } from '../../../common/contributions.js';
import { Extensions as ViewContainerExtensions, IViewsRegistry } from '../../../common/views.js';
import { MenuRegistry, registerAction2, MenuId, ISubmenuItem } from '../../../../platform/actions/common/actions.js';
import { PlotsActiveEditorCopyAction, PlotsActiveEditorSaveAction, PlotsClearAction, PlotsEditorZoomAction, PlotsCopyAction, PlotsEditorAction, PlotsGalleryInNewWindowAction, PlotsNextAction, PlotsPopoutAction, PlotsPreviousAction, PlotsRefreshAction, PlotsSaveAction, PlotsSizingPolicyAction, ZoomFiftyAction, ZoomOneHundredAction, ZoomSeventyFiveAction, ZoomToFitAction, ZoomTwoHundredAction } from './positronPlotsActions.js';
import { POSITRON_SESSION_CONTAINER } from '../../positronSession/browser/positronSessionContainer.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { localize, localize2 } from '../../../../nls.js';
import { OldFreezeSlowPlotsConfigKey, FreezeSlowPlotsConfigKey } from '../../../services/languageRuntime/common/languageRuntimePlotClient.js';
import { PLOT_IS_ACTIVE_EDITOR } from '../../positronPlotsEditor/browser/positronPlotsEditor.contribution.js';

// Register the Positron plots service.
registerSingleton(IPositronPlotsService, PositronPlotsService, InstantiationType.Delayed);

// The Positron plots view icon.
const positronPlotViewIcon = registerIcon('positron-plot-view-icon', Codicon.positronPlotView, nls.localize('positronPlotViewIcon', 'View icon of the Positron plot view.'));

// Register the Positron plots view.
Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).registerViews(
	[
		{
			id: POSITRON_PLOTS_VIEW_ID,
			name: {
				value: nls.localize('positron.plots', "Plots"),
				original: 'Plots'
			},
			ctorDescriptor: new SyncDescriptor(PositronPlotsViewPane),
			collapsed: false,
			canToggleVisibility: false,
			canMoveView: true,
			containerIcon: positronPlotViewIcon,
			openCommandActionDescriptor: {
				id: 'workbench.action.positron.togglePlots',
				mnemonicTitle: nls.localize({ key: 'miTogglePlots', comment: ['&& denotes a mnemonic'] }, "&&Plots"),
				keybindings: {},
				order: 1,
			}
		}
	],
	POSITRON_SESSION_CONTAINER
);

class PositronPlotsContribution extends Disposable implements IWorkbenchContribution {
	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IPositronPlotsService positronPlotsService: IPositronPlotsService,
	) {
		super();
		this.registerActions();
	}

	private registerActions(): void {
		registerAction2(PlotsRefreshAction);
		registerAction2(PlotsSaveAction);
		registerAction2(PlotsCopyAction);
		registerAction2(PlotsNextAction);
		registerAction2(PlotsPreviousAction);
		registerAction2(PlotsClearAction);
		registerAction2(PlotsPopoutAction);
		registerAction2(PlotsEditorAction);
		registerAction2(PlotsGalleryInNewWindowAction);
		registerAction2(PlotsActiveEditorCopyAction);
		registerAction2(PlotsActiveEditorSaveAction);
		registerAction2(PlotsSizingPolicyAction);
		this.registerEditorZoomSubMenu();
	}

	private registerEditorZoomSubMenu(): void {
		// Register the main submenu for the editor action bar
		const zoomSubmenu: ISubmenuItem = {
			title: localize2('positronPlots.zoomSubMenuTitle', 'Set the plot zoom'),
			submenu: PlotsEditorZoomAction.SUBMENU_ID,
			when: PLOT_IS_ACTIVE_EDITOR,
			group: 'navigation',
			order: 3,
			icon: Codicon.positronSizeToFit
		};
		MenuRegistry.appendMenuItem(MenuId.EditorActionsLeft, zoomSubmenu);

		// Register all the zoom actions
		registerAction2(ZoomToFitAction);
		registerAction2(ZoomFiftyAction);
		registerAction2(ZoomSeventyFiveAction);
		registerAction2(ZoomOneHundredAction);
		registerAction2(ZoomTwoHundredAction);
	}
}

// Old configuration with `positron` in name
Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration)
	.registerConfiguration({
		properties: {
			'positron.plots.darkFilter': {
				type: 'string',
				default: 'off',
				enum: [
					'on',
					'off',
					'auto'
				],
				enumDescriptions: [
					localize('positron.plots.darkFilterOn', 'Always apply the dark filter'),
					localize('positron.plots.darkFilterOff', 'Never apply the dark filter'),
					localize('positron.plots.darkFilterAuto', 'Apply the dark filter when Positron is using a dark theme')
				],
				description: localize('positron.plots.darkFilterSetting', "Use a color filter to make light plots appear dark."),
				deprecationMessage: localize('positron.plots.darkFilter.deprecated', "This setting is deprecated. Please use 'plots.darkFilter' instead."),
			},
			[OldFreezeSlowPlotsConfigKey]: {
				type: 'boolean',
				default: true,
				description: localize('positron.plots.frozenSlowPlotsSetting', "Freeze slow to generate plots at a fixed size to avoid re-rendering on viewport changes, improving responsiveness of the IDE when working with complex charts."),
				deprecationMessage: localize('positron.plots.freezeSlowPlots.deprecated', "This setting is deprecated. Please use 'plots.freezeSlowPlots' instead."),
			}
		}
	});

// New configuration
Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration)
	.registerConfiguration({
		id: 'plots',
		order: 100,
		title: localize('plotsConfigurationTitle', "Plots"),
		type: 'object',
		properties: {
			'plots.darkFilter': {
				type: 'string',
				default: 'off',
				enum: [
					'on',
					'off',
					'auto'
				],
				enumDescriptions: [
					localize('plots.darkFilterOn', 'Always apply the dark filter'),
					localize('plots.darkFilterOff', 'Never apply the dark filter'),
					localize('plots.darkFilterAuto', 'Apply the dark filter when Positron is using a dark theme')
				],
				description: localize('plots.darkFilterSetting', "Use a color filter to make light plots appear dark."),
			},
			'plots.defaultSizingPolicy': {
				type: 'string',
				default: 'auto',
				enum: [
					'auto',
					'fill',
					'intrinsic',
					'landscape',
					'portrait',
					'square'
				],
				enumDescriptions: [
					localize('plots.defaultSizingPolicyAuto', 'Automatically size the plot'),
					localize('plots.defaultSizingPolicyFill', 'Fill the entire available space with the plot'),
					localize('plots.defaultSizingPolicyIntrinsic', 'Use the plot\'s intrinsic size when available'),
					localize('plots.defaultSizingPolicyLandscape', 'Use 4:3 landscape aspect ratio'),
					localize('plots.defaultSizingPolicyPortrait', 'Use 3:4 portrait aspect ratio'),
					localize('plots.defaultSizingPolicySquare', 'Use 1:1 square aspect ratio')
				],
				description: localize('plots.defaultSizingPolicySetting', "The default sizing policy to use for newly created plots."),
			},
			[FreezeSlowPlotsConfigKey]: {
				type: 'boolean',
				default: true,
				description: localize('plots.frozenSlowPlotsSetting', "Freeze slow to generate plots at a fixed size to avoid re-rendering on viewport changes, improving responsiveness of the IDE when working with complex charts."),
			}
		}
	});

Registry.
	as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).
	registerWorkbenchContribution(PositronPlotsContribution, LifecyclePhase.Restored);
