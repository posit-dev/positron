/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
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
import { PositronHistoryViewPane } from 'vs/workbench/contrib/positronHistory/browser/positronHistoryView';
import { PositronHistoryService } from 'vs/workbench/contrib/positronHistory/browser/positronHistoryService';
import { IPositronHistoryService, POSITRON_HISTORY_VIEW_ID } from 'vs/workbench/services/positronHistory/common/positronHistory';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions, IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { ViewContainer, IViewContainersRegistry, ViewContainerLocation, Extensions as ViewContainerExtensions, IViewsRegistry } from 'vs/workbench/common/views';

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
