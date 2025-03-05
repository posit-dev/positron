/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
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
import { PositronPreviewViewPane } from './positronPreviewView.js';
import { IPositronPreviewService, POSITRON_PREVIEW_VIEW_ID } from './positronPreviewSevice.js';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions, IWorkbenchContribution } from '../../../common/contributions.js';
import { ViewContainer, IViewContainersRegistry, ViewContainerLocation, Extensions as ViewContainerExtensions, IViewsRegistry } from '../../../common/views.js';
import { registerAction2 } from '../../../../platform/actions/common/actions.js';
import { PositronOpenUrlInViewerAction } from './positronPreviewActions.js';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions, ConfigurationScope, } from '../../../../platform/configuration/common/configurationRegistry.js';
import { POSITRON_PREVIEW_PLOTS_IN_VIEWER } from '../../../services/languageRuntime/common/languageRuntimeUiClient.js';
import { isWeb } from '../../../../base/common/platform.js';

// The Positron preview view icon.
const positronPreviewViewIcon = registerIcon('positron-preview-view-icon', Codicon.positronPreviewView, nls.localize('positronPreviewViewIcon', 'View icon of the Positron preview view.'));

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

if (!isWeb) {
	// In desktop mode, we can optionally show interactive plots in the Plots
	// pane. This maneuver requires Electron to generate screen captures to use
	// as thumbnails.
	//
	// In web mode, we can't do this, so we always show interactive plots in
	// the Viewer pane (i.e. we behave as though this option is always set to
	// true)
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
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(PositronPreviewContribution, LifecyclePhase.Restored);
