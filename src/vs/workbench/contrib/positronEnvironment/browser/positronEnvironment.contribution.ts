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
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { ViewPaneContainer } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { PositronEnvironmentViewPane } from 'vs/workbench/contrib/positronEnvironment/browser/positronEnvironmentView';
import { PositronEnvironmentService } from 'vs/workbench/contrib/positronEnvironment/browser/positronEnvironmentService';
import { IPositronEnvironmentService, POSITRON_ENVIRONMENT_VIEW_ID } from 'vs/workbench/services/positronEnvironment/common/positronEnvironment';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions, IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { ViewContainer, IViewContainersRegistry, ViewContainerLocation, Extensions as ViewContainerExtensions, IViewsRegistry } from 'vs/workbench/common/views';
import { Action2, registerAction2 } from 'vs/platform/actions/common/actions';
import { ILocalizedString } from 'vs/platform/action/common/action';

// Register the Positron environment service.
registerSingleton(IPositronEnvironmentService, PositronEnvironmentService, InstantiationType.Delayed);

// The Positron environment view icon.
const positronEnvironmentViewIcon = registerIcon('positron-environment-view-icon', Codicon.positronEnvironmentView, nls.localize('positronEnvironmentViewIcon', 'View icon of the Positron environment view.'));

// Register the Positron environment container.
const VIEW_CONTAINER: ViewContainer = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).registerViewContainer({
	id: POSITRON_ENVIRONMENT_VIEW_ID,
	title: nls.localize('positron.environment', "Environment"),
	icon: positronEnvironmentViewIcon,
	order: 1,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [POSITRON_ENVIRONMENT_VIEW_ID, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: POSITRON_ENVIRONMENT_VIEW_ID,
	hideIfEmpty: true,
}, ViewContainerLocation.AuxiliaryBar, { doNotRegisterOpenCommand: true });

Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).registerViews([{
	id: POSITRON_ENVIRONMENT_VIEW_ID,
	name: nls.localize('positron.environment', "Environment"),
	containerIcon: positronEnvironmentViewIcon,
	canMoveView: true,
	canToggleVisibility: false,
	ctorDescriptor: new SyncDescriptor(PositronEnvironmentViewPane),
	openCommandActionDescriptor: {
		id: 'workbench.action.positron.toggleEnvironment',
		mnemonicTitle: nls.localize({ key: 'miToggleEnvironment', comment: ['&& denotes a mnemonic'] }, "&&Environment"),
		keybindings: {
			primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyH,
		},
		order: 1,
	}
}], VIEW_CONTAINER);

export const POSITRON_ENVIRONMENT_ACTION_CATEGORY = nls.localize('positronEnvironmentCategory', "Environment");
const category: ILocalizedString = { value: POSITRON_ENVIRONMENT_ACTION_CATEGORY, original: 'Environment' };

class PositronEnvironmentContribution extends Disposable implements IWorkbenchContribution {
	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IPositronEnvironmentService positronEnvironmentService: IPositronEnvironmentService,
	) {
		super();
		this.registerActions();
	}

	private registerActions(): void {
		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: 'workbench.action.positronEnvironment.refresh',
					title: { value: 'Refresh Environment', original: 'Refresh Environment' },
					f1: true,
					category,
					description: {
						description: 'Refresh the list of variables and values in the Environment view.',
						args: [{
							name: 'options',
							schema: {
								type: 'object'
							}
						}]
					}
				});
			}

			/**
			 * Runs the action and refreshes the environment.
			 *
			 * @param accessor The service accessor.
			 */
			async run(accessor: ServicesAccessor) {
			}
		});
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(PositronEnvironmentContribution, LifecyclePhase.Restored);
