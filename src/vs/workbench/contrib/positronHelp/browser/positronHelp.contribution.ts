/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Codicon } from 'vs/base/common/codicons';
import { Disposable } from 'vs/base/common/lifecycle';
import { KeyMod, KeyCode } from 'vs/base/common/keyCodes';
import { Registry } from 'vs/platform/registry/common/platform';
import { registerIcon } from 'vs/platform/theme/common/iconRegistry';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ViewPaneContainer } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { PositronHelpViewPane } from 'vs/workbench/contrib/positronHelp/browser/positronHelpView';
import { IPositronHelpService } from 'vs/workbench/services/positronHelp/common/interfaces/positronHelpService';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions, IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { ViewContainer, IViewContainersRegistry, ViewContainerLocation, Extensions as ViewContainerExtensions, IViewsRegistry } from 'vs/workbench/common/views';

/**
 * The Positron help view ID.
 */
const POSITRON_HELP_VIEW_ID = 'workbench.panel.positronHelp';

// The Positron help view icon.
const positronHelpViewIcon = registerIcon('positron-help-view-icon', Codicon.positronHelpView, nls.localize('positronHelpViewIcon', 'View icon of the Positron help view.'));

// Register the Positron help container.
const VIEW_CONTAINER: ViewContainer = Registry.as<IViewContainersRegistry>(
	ViewContainerExtensions.ViewContainersRegistry
).registerViewContainer(
	{
		id: POSITRON_HELP_VIEW_ID,
		title: nls.localize('positron.help', "Help"),
		icon: positronHelpViewIcon,
		order: 2,
		ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [POSITRON_HELP_VIEW_ID, { mergeViewWithContainerWhenSingleView: true }]),
		storageId: POSITRON_HELP_VIEW_ID,
		hideIfEmpty: true,
	},
	ViewContainerLocation.AuxiliaryBar,
	{
		doNotRegisterOpenCommand: false,
		isDefault: false
	}
);

Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).registerViews([{
	id: POSITRON_HELP_VIEW_ID,
	name: nls.localize('positron.help', "Help"),
	containerIcon: positronHelpViewIcon,
	canMoveView: true,
	canToggleVisibility: false,
	ctorDescriptor: new SyncDescriptor(PositronHelpViewPane),
	positronAlwaysOpenView: true,
	openCommandActionDescriptor: {
		id: 'workbench.action.positron.openHelp',
		keybindings: {
			primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyH,
		},
		order: 1,
	}
}], VIEW_CONTAINER);

class PositronHelpContribution extends Disposable implements IWorkbenchContribution {
	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IPositronHelpService positronHelpService: IPositronHelpService,
	) {
		super();
		this.registerActions();
	}

	private registerActions(): void {
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(PositronHelpContribution, LifecyclePhase.Restored);
