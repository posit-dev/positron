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
import { ViewPaneContainer } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { PositronPlotsViewPane } from 'vs/workbench/contrib/positronPlots/browser/positronPlotsView';
import { PositronPlotsService } from 'vs/workbench/contrib/positronPlots/browser/positronPlotsService';
import { IPositronPlotsService, POSITRON_PLOTS_VIEW_ID } from 'vs/workbench/services/positronPlots/common/positronPlots';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions, IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { ViewContainer, IViewContainersRegistry, ViewContainerLocation, Extensions as ViewContainerExtensions, IViewsRegistry } from 'vs/workbench/common/views';
import { registerAction2 } from 'vs/platform/actions/common/actions';
import { PlotsRefreshAction } from 'vs/workbench/contrib/positronPlots/browser/positronPlotsActions';

// Register the Positron plots service.
registerSingleton(IPositronPlotsService, PositronPlotsService, InstantiationType.Delayed);

// The Positron plots view icon.
const positronPlotsViewIcon = registerIcon('positron-plots-view-icon', Codicon.positronPlotsView, nls.localize('positronPlotsViewIcon', 'View icon of the Positron plots view.'));

// Register the Positron plots container.
const VIEW_CONTAINER: ViewContainer = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).registerViewContainer({
	id: POSITRON_PLOTS_VIEW_ID,
	title: nls.localize('positron.plots', "Plots"),
	icon: positronPlotsViewIcon,
	order: 1,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [POSITRON_PLOTS_VIEW_ID, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: POSITRON_PLOTS_VIEW_ID,
	hideIfEmpty: true,
}, ViewContainerLocation.AuxiliaryBar, { doNotRegisterOpenCommand: true });

Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).registerViews([{
	id: POSITRON_PLOTS_VIEW_ID,
	name: nls.localize('positron.plots', "Plots"),
	containerIcon: positronPlotsViewIcon,
	canMoveView: true,
	canToggleVisibility: false,
	ctorDescriptor: new SyncDescriptor(PositronPlotsViewPane),
	openCommandActionDescriptor: {
		id: 'workbench.action.positron.togglePlots',
		mnemonicTitle: nls.localize({ key: 'miTogglePlots', comment: ['&& denotes a mnemonic'] }, "&&Plots"),
		keybindings: {},
		order: 1,
	}
}], VIEW_CONTAINER);

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

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(PositronPlotsContribution, LifecyclePhase.Restored);
