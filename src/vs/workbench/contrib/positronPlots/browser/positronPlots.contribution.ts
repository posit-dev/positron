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
import { registerAction2 } from '../../../../platform/actions/common/actions.js';
import { PlotsActiveEditorCopyAction, PlotsActiveEditorSaveAction, PlotsClearAction, PlotsCopyAction, PlotsEditorAction, PlotsNextAction, PlotsPopoutAction, PlotsPreviousAction, PlotsRefreshAction, PlotsSaveAction, PlotsSizingPolicyAction } from './positronPlotsActions.js';
import { POSITRON_SESSION_CONTAINER } from '../../positronSession/browser/positronSessionContainer.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { localize } from '../../../../nls.js';

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
		registerAction2(PlotsActiveEditorCopyAction);
		registerAction2(PlotsActiveEditorSaveAction);
		registerAction2(PlotsSizingPolicyAction);
	}
}

// Register the configuration setting
Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration)
	.registerConfiguration({
		properties: {
			'positron.plots.darkFilter': {
				type: 'string',
				default: 'auto',
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
			}
		}
	});

Registry.
	as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).
	registerWorkbenchContribution(PositronPlotsContribution, LifecyclePhase.Restored);
