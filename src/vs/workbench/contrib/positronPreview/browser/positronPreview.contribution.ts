/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
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
import { PositronPreviewViewPane } from 'vs/workbench/contrib/positronPreview/browser/positronPreviewView';
import { IPositronPreviewService, POSITRON_PREVIEW_VIEW_ID } from 'vs/workbench/contrib/positronPreview/browser/positronPreviewSevice';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions, IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { ViewContainer, IViewContainersRegistry, ViewContainerLocation, Extensions as ViewContainerExtensions, IViewsRegistry } from 'vs/workbench/common/views';
import { registerAction2 } from 'vs/platform/actions/common/actions';
import { PositronOpenUrlInViewerAction } from 'vs/workbench/contrib/positronPreview/browser/positronPreviewActions';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions, ConfigurationScope, } from 'vs/platform/configuration/common/configurationRegistry';

// The Positron preview view icon.
const positronPreviewViewIcon = registerIcon('positron-preview-view-icon', Codicon.positronPreviewView, nls.localize('positronPreviewViewIcon', 'View icon of the Positron preview view.'));

export const POSITRON_PREVIEW_PLOTS_IN_VIEWER = 'positron.viewer.interactivePlotsInViewer';

// Register the Positron preview container.
const VIEW_CONTAINER: ViewContainer = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).registerViewContainer({
	id: POSITRON_PREVIEW_VIEW_ID,
	title: {
		value: nls.localize('positron.viewer', "Viewer"),
		original: 'Viewer'
	},
	icon: positronPreviewViewIcon,
	order: 3,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [POSITRON_PREVIEW_VIEW_ID, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: POSITRON_PREVIEW_VIEW_ID,
	hideIfEmpty: true,
}, ViewContainerLocation.AuxiliaryBar, { doNotRegisterOpenCommand: true, isDefault: false });

Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).registerViews([{
	id: POSITRON_PREVIEW_VIEW_ID,
	name: {
		value: nls.localize('positron.viewer', "Viewer"),
		original: 'Viewer'
	},
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
		order: 3
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
		registerAction2(PositronOpenUrlInViewerAction);
	}
}

// Register configuration options for the preview service
const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
configurationRegistry.registerConfiguration({
	id: 'positron',
	properties: {
		[POSITRON_PREVIEW_PLOTS_IN_VIEWER]: {
			scope: ConfigurationScope.MACHINE,
			type: 'boolean',
			default: false,
			description: nls.localize('positron.viewer.interactivePlotsInViewer', "When enabled, interactive HTML plots are shown in the Viewer pane rather than in the Plots pane.")
		},
	}
});


Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(PositronPreviewContribution, LifecyclePhase.Restored);
