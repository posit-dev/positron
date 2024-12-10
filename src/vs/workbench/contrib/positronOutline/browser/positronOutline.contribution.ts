/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from '../../../../nls.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { KeyMod, KeyCode } from '../../../../base/common/keyCodes.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { PositronOutlineViewPane } from './positronOutlineView.js';
import { PositronOutlineService } from './positronOutlineService.js';
import { IPositronOutlineService, POSITRON_OUTLINE_VIEW_ID } from '../../../services/positronOutline/common/positronOutline.js';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions, IWorkbenchContribution } from '../../../common/contributions.js';
import { ViewContainer, IViewContainersRegistry, ViewContainerLocation, Extensions as ViewContainerExtensions, IViewsRegistry } from '../../../common/views.js';

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
	name: {
		value: nls.localize('positron.outline', "Outline"),
		original: 'Outline'
	},
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
