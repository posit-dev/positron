/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Codicon } from 'vs/base/common/codicons';
import { Disposable } from 'vs/base/common/lifecycle';
import { KeyMod, KeyCode } from 'vs/base/common/keyCodes';
import { Registry } from 'vs/platform/registry/common/platform';
import { registerAction2 } from 'vs/platform/actions/common/actions';
import { registerIcon } from 'vs/platform/theme/common/iconRegistry';
import { PositronEnvironmentFocused } from 'vs/workbench/common/contextkeys';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ViewPaneContainer } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { EnvironmentRefreshAction } from 'vs/workbench/contrib/positronEnvironment/browser/positronEnvironmentActions';
import { PositronEnvironmentViewPane } from 'vs/workbench/contrib/positronEnvironment/browser/positronEnvironmentView';
import { ICommandAndKeybindingRule, KeybindingWeight, KeybindingsRegistry } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { IPositronEnvironmentService } from 'vs/workbench/services/positronEnvironment/common/interfaces/positronEnvironmentService';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions, IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { ViewContainer, IViewContainersRegistry, ViewContainerLocation, Extensions as ViewContainerExtensions, IViewsRegistry } from 'vs/workbench/common/views';
import { POSITRON_ENVIRONMENT_COLLAPSE, POSITRON_ENVIRONMENT_COPY_AS_HTML, POSITRON_ENVIRONMENT_COPY_AS_TEXT, POSITRON_ENVIRONMENT_EXPAND } from 'vs/workbench/contrib/positronEnvironment/browser/positronEnvironmentIdentifiers';

// The Positron environment view identifier.
export const POSITRON_ENVIRONMENT_VIEW_ID = 'workbench.panel.positronEnvironment';

// The Positron environment view icon.
const positronEnvironmentViewIcon = registerIcon(
	'positron-environment-view-icon',
	Codicon.positronEnvironmentView,
	nls.localize('positronEnvironmentViewIcon', 'View icon of the Positron environment view.')
);

// Register the Positron environment view container.
export const VIEW_CONTAINER: ViewContainer = Registry.as<IViewContainersRegistry>(
	ViewContainerExtensions.ViewContainersRegistry
).registerViewContainer(
	{
		id: POSITRON_ENVIRONMENT_VIEW_ID,
		title: nls.localize('positron.session', "Session"),
		icon: positronEnvironmentViewIcon,
		order: 1,
		ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [POSITRON_ENVIRONMENT_VIEW_ID, { mergeViewWithContainerWhenSingleView: true }]),
		storageId: POSITRON_ENVIRONMENT_VIEW_ID,
		hideIfEmpty: false,
	},
	ViewContainerLocation.AuxiliaryBar,
	{
		doNotRegisterOpenCommand: true
	}
);

// Register the Positron environment view.
Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).registerViews(
	[
		{
			id: POSITRON_ENVIRONMENT_VIEW_ID,
			name: nls.localize('positron.environment', "Environment"),
			ctorDescriptor: new SyncDescriptor(PositronEnvironmentViewPane),
			canToggleVisibility: false,
			canMoveView: true,
			containerIcon: positronEnvironmentViewIcon,
			openCommandActionDescriptor: {
				id: 'workbench.action.positron.toggleEnvironment',
				mnemonicTitle: nls.localize({ key: 'miToggleEnvironment', comment: ['&& denotes a mnemonic'] }, "&&Environment"),
				keybindings: {
					primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyH,
				},
				order: 1,
			}
		}
	],
	VIEW_CONTAINER
);

/**
 * PositronEnvironmentContribution class.
 */
class PositronEnvironmentContribution extends Disposable implements IWorkbenchContribution {
	/**
	 * Constructor.
	 * @param instantiationService The instantiation service.
	 * @param positronEnvironmentService The Positron environment service.
	 */
	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IPositronEnvironmentService positronEnvironmentService: IPositronEnvironmentService,
	) {
		super();
		this.registerActions();
	}

	/**
	 * Registers actions.
	 */
	private registerActions(): void {
		registerAction2(EnvironmentRefreshAction);
	}
}

// Register keybinding rule for expand.
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: POSITRON_ENVIRONMENT_EXPAND,
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyCode.RightArrow,
	when: PositronEnvironmentFocused,
	handler: () => { }
} satisfies ICommandAndKeybindingRule);

// Register keybinding rule for collapse.
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: POSITRON_ENVIRONMENT_COLLAPSE,
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyCode.LeftArrow,
	when: PositronEnvironmentFocused,
	handler: () => { }
} satisfies ICommandAndKeybindingRule);

// Register keybinding rule for copy as text.
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: POSITRON_ENVIRONMENT_COPY_AS_TEXT,
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyMod.CtrlCmd | KeyCode.KeyC,
	when: PositronEnvironmentFocused,
	handler: accessor => { }
} satisfies ICommandAndKeybindingRule);

// Register keybinding rule for copy as HTML.
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: POSITRON_ENVIRONMENT_COPY_AS_HTML,
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyMod.Shift | KeyMod.CtrlCmd | KeyCode.KeyC,
	when: PositronEnvironmentFocused,
	handler: () => { }
} satisfies ICommandAndKeybindingRule);

// Register the contribution.
Registry.
	as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).
	registerWorkbenchContribution(PositronEnvironmentContribution, LifecyclePhase.Restored);

// ---------------- Deferred for internal preview ----------------
// // Register the environment configuration.
// Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
// 	id: 'environment',
// 	order: 10,
// 	type: 'object',
// 	title: nls.localize('environmentConfigurationTitle', "Environment"),
// 	scope: ConfigurationScope.APPLICATION,
// 	properties: {
// 		'environment.fixedWidthFont': {
// 			type: 'boolean',
// 			default: false,
// 			scope: ConfigurationScope.APPLICATION,
// 			markdownDescription: nls.localize('environment.fixedWidthFont', "Controls whether the Environment is rendered using a fixed-width font."),
// 		}
// 	}
// });

// /**
//  * Configuration options for the environment.
//  */
// export interface IEnvironmentOptions {
// 	/**
// 	 * Gets a value which indicates whether to render the environment with a fixed-width font.
// 	 */
// 	readonly fixedWidthFont?: boolean;
// }
