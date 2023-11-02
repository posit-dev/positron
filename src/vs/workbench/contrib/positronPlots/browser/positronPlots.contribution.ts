/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Codicon } from 'vs/base/common/codicons';
import { Disposable } from 'vs/base/common/lifecycle';
import { Registry } from 'vs/platform/registry/common/platform';
import { registerIcon } from 'vs/platform/theme/common/iconRegistry';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { PositronPlotsViewPane } from 'vs/workbench/contrib/positronPlots/browser/positronPlotsView';
import { PositronPlotsService } from 'vs/workbench/contrib/positronPlots/browser/positronPlotsService';
import { IPositronPlotsService, POSITRON_PLOTS_VIEW_ID } from 'vs/workbench/services/positronPlots/common/positronPlots';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions, IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { Extensions as ViewContainerExtensions, IViewsRegistry } from 'vs/workbench/common/views';
import { registerAction2 } from 'vs/platform/actions/common/actions';
import { PlotsRefreshAction } from 'vs/workbench/contrib/positronPlots/browser/positronPlotsActions';
import { VIEW_CONTAINER } from 'vs/workbench/contrib/positronEnvironment/browser/positronEnvironment.contribution';

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
	VIEW_CONTAINER
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
	}
}

Registry.
	as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).
	registerWorkbenchContribution(PositronPlotsContribution, LifecyclePhase.Restored);
