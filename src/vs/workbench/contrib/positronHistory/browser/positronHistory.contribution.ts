/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
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
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { PositronHistoryViewPane } from './positronHistoryView.js';
import { PositronHistoryService } from './positronHistoryService.js';
import { IPositronHistoryService, POSITRON_HISTORY_VIEW_ID } from '../../../services/positronHistory/common/positronHistory.js';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions, IWorkbenchContribution } from '../../../common/contributions.js';
import { ViewContainer, IViewContainersRegistry, ViewContainerLocation, Extensions as ViewContainerExtensions, IViewsRegistry } from '../../../common/views.js';

// Register the Positron history service.
registerSingleton(IPositronHistoryService, PositronHistoryService, InstantiationType.Delayed);

// The Positron history view icon.
// TODO@softwarenerd - Replace Codicon.positronPreviewView with Codicon.positronHistoryView.
const positronHistoryViewIcon = registerIcon('positron-history-icon', Codicon.positronPreviewView, nls.localize('positronHistoryViewIcon', 'View icon of the Positron history view.'));

// Register the Positron history container.
const VIEW_CONTAINER: ViewContainer = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).registerViewContainer({
	id: POSITRON_HISTORY_VIEW_ID,
	title: {
		value: nls.localize('positron.history', "History"),
		original: 'History'
	},
	icon: positronHistoryViewIcon,
	order: 2,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [POSITRON_HISTORY_VIEW_ID, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: POSITRON_HISTORY_VIEW_ID,
	hideIfEmpty: true,
}, ViewContainerLocation.AuxiliaryBar, { doNotRegisterOpenCommand: true });

Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).registerViews([{
	id: POSITRON_HISTORY_VIEW_ID,
	name: {
		value: nls.localize('positron.history', "History"),
		original: 'History'
	},
	containerIcon: positronHistoryViewIcon,
	canMoveView: true,
	canToggleVisibility: false,
	ctorDescriptor: new SyncDescriptor(PositronHistoryViewPane),
	openCommandActionDescriptor: {
		id: 'workbench.action.positron.toggleHistory',
		mnemonicTitle: nls.localize({ key: 'miToggleHistory', comment: ['&& denotes a mnemonic'] }, "&&History"),
		keybindings: {},
		order: 2,
	}
}], VIEW_CONTAINER);

class PositronHistoryContribution extends Disposable implements IWorkbenchContribution {
	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IPositronHistoryService positronHistoryService: IPositronHistoryService,
	) {
		super();
		this.registerActions();
	}

	private registerActions(): void {
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(PositronHistoryContribution, LifecyclePhase.Restored);
