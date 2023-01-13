/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
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
import { PositronPreviewViewPane } from 'vs/workbench/contrib/positronPreview/browser/positronPreviewView';
import { PositronPreviewService } from 'vs/workbench/contrib/positronPreview/browser/positronPreviewService';
import { IPositronPreviewService, POSITRON_PREVIEW_VIEW_ID } from 'vs/workbench/services/positronPreview/common/positronPreview';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions, IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { ViewContainer, IViewContainersRegistry, ViewContainerLocation, Extensions as ViewContainerExtensions, IViewsRegistry } from 'vs/workbench/common/views';

// Register the Positron preview service.
registerSingleton(IPositronPreviewService, PositronPreviewService, InstantiationType.Delayed);

// Register the Positron preview container.
const positronPreviewViewIcon = registerIcon('positron-preview-view-icon', Codicon.positronPreviewView, nls.localize('positronPreviewViewIcon', 'View icon of the Positron preview view.'));
const VIEW_CONTAINER: ViewContainer = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).registerViewContainer({
	id: POSITRON_PREVIEW_VIEW_ID,
	title: nls.localize('positron.preview', "Preview"),
	icon: positronPreviewViewIcon,
	order: 2,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [POSITRON_PREVIEW_VIEW_ID, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: POSITRON_PREVIEW_VIEW_ID,
	hideIfEmpty: true,
}, ViewContainerLocation.AuxiliaryBar, { doNotRegisterOpenCommand: true });

Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).registerViews([{
	id: POSITRON_PREVIEW_VIEW_ID,
	name: nls.localize('positron.preview', "Preview"),
	containerIcon: positronPreviewViewIcon,
	canMoveView: true,
	canToggleVisibility: false,
	ctorDescriptor: new SyncDescriptor(PositronPreviewViewPane),
	openCommandActionDescriptor: {
		id: 'workbench.action.positron.togglePreview',
		mnemonicTitle: nls.localize({ key: 'miTogglePreview', comment: ['&& denotes a mnemonic'] }, "&&Preview"),
		keybindings: {
			primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyH,
		},
		order: 2,
	}
}], VIEW_CONTAINER);

class PositronPreviewContribution extends Disposable implements IWorkbenchContribution {
	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IPositronPreviewService positronPreviewService: IPositronPreviewService,
	) {
		super();
		this.registerActions();
	}

	private registerActions(): void {
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(PositronPreviewContribution, LifecyclePhase.Restored);
