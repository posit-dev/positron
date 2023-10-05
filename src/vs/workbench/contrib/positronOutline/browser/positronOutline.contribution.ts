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
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { PositronOutlineViewPane } from 'vs/workbench/contrib/positronOutline/browser/positronOutlineView';
import { PositronOutlineService } from 'vs/workbench/contrib/positronOutline/browser/positronOutlineService';
import { IPositronOutlineService, POSITRON_OUTLINE_VIEW_ID } from 'vs/workbench/services/positronOutline/common/positronOutline';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions, IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { ViewContainer, IViewContainersRegistry, ViewContainerLocation, Extensions as ViewContainerExtensions, IViewsRegistry } from 'vs/workbench/common/views';

// Register the Positron outline service.
registerSingleton(IPositronOutlineService, PositronOutlineService, InstantiationType.Delayed);

// The Positron outline view icon.
const positronOutlineViewIcon = registerIcon('positron-outline-view-icon', Codicon.positronOutlineView, nls.localize('positronOutlineViewIcon', 'View icon of the Positron outline view.'));

// Register the Positron outline container.
const VIEW_CONTAINER: ViewContainer = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).registerViewContainer({
	id: POSITRON_OUTLINE_VIEW_ID,
	title: {
		value: nls.localize('positron.outline', "Outline"),
		original: 'Outline'
	},
	icon: positronOutlineViewIcon,
	order: 4,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [POSITRON_OUTLINE_VIEW_ID, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: POSITRON_OUTLINE_VIEW_ID,
	hideIfEmpty: true,
}, ViewContainerLocation.AuxiliaryBar, { doNotRegisterOpenCommand: true });

Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).registerViews([{
	id: POSITRON_OUTLINE_VIEW_ID,
	name: nls.localize('positron.outline', "Outline"),
	containerIcon: positronOutlineViewIcon,
	canMoveView: true,
	canToggleVisibility: false,
	ctorDescriptor: new SyncDescriptor(PositronOutlineViewPane),
	openCommandActionDescriptor: {
		id: 'workbench.action.positron.toggleOutline',
		mnemonicTitle: nls.localize({ key: 'miToggleOutline', comment: ['&& denotes a mnemonic'] }, "&&Outline"),
		keybindings: {
			primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyH,
		},
		order: 4,
	}
}], VIEW_CONTAINER);

class PositronOutlineContribution extends Disposable implements IWorkbenchContribution {
	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IPositronOutlineService positronOutlineService: IPositronOutlineService,
	) {
		super();
		this.registerActions();
	}

	private registerActions(): void {
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(PositronOutlineContribution, LifecyclePhase.Restored);
