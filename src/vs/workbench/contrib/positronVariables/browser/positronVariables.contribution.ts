/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Disposable } from 'vs/base/common/lifecycle';
import { KeyMod, KeyCode } from 'vs/base/common/keyCodes';
import { Registry } from 'vs/platform/registry/common/platform';
import { registerAction2 } from 'vs/platform/actions/common/actions';
import { PositronVariablesFocused } from 'vs/workbench/common/contextkeys';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { PositronVariablesViewPane } from 'vs/workbench/contrib/positronVariables/browser/positronVariablesView';
import { PositronVariablesRefreshAction } from 'vs/workbench/contrib/positronVariables/browser/positronVariablesActions';
import { IPositronVariablesService } from 'vs/workbench/services/positronVariables/common/interfaces/positronVariablesService';
import { ICommandAndKeybindingRule, KeybindingWeight, KeybindingsRegistry } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions, IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { Extensions as ViewContainerExtensions, IViewsRegistry } from 'vs/workbench/common/views';
import { POSITRON_VARIABLES_COLLAPSE, POSITRON_VARIABLES_COPY_AS_HTML, POSITRON_VARIABLES_COPY_AS_TEXT, POSITRON_VARIABLES_EXPAND } from 'vs/workbench/contrib/positronVariables/browser/positronVariablesIdentifiers';
import { POSITRON_SESSION_CONTAINER, positronSessionViewIcon } from 'vs/workbench/contrib/positronSession/browser/positronSessionContainer';

// The Positron variables view identifier.
export const POSITRON_VARIABLES_VIEW_ID = 'workbench.panel.positronVariables';

// Register the Positron variables view.
Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).registerViews(
	[
		{
			id: POSITRON_VARIABLES_VIEW_ID,
			name: {
				value: nls.localize('positron.variables', "Variables"),
				original: 'Variables'
			},
			ctorDescriptor: new SyncDescriptor(PositronVariablesViewPane),
			canToggleVisibility: false,
			canMoveView: true,
			containerIcon: positronSessionViewIcon,
			openCommandActionDescriptor: {
				id: 'workbench.action.positron.toggleVariables',
				mnemonicTitle: nls.localize({ key: 'miToggleVariables', comment: ['&& denotes a mnemonic'] }, "&&Variables"),
				keybindings: {
					primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyH,
				},
				order: 1,
			}
		}
	],
	POSITRON_SESSION_CONTAINER
);

/**
 * PositronVariablesContribution class.
 */
class PositronVariablesContribution extends Disposable implements IWorkbenchContribution {
	/**
	 * Constructor.
	 * @param instantiationService The instantiation service.
	 * @param positronVariablesService The Positron variables service.
	 */
	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IPositronVariablesService positronVariablesService: IPositronVariablesService,
	) {
		super();
		this.registerActions();
	}

	/**
	 * Registers actions.
	 */
	private registerActions(): void {
		registerAction2(PositronVariablesRefreshAction);
	}
}

// Register keybinding rule for expand.
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: POSITRON_VARIABLES_EXPAND,
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyCode.RightArrow,
	when: PositronVariablesFocused,
	handler: () => { }
} satisfies ICommandAndKeybindingRule);

// Register keybinding rule for collapse.
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: POSITRON_VARIABLES_COLLAPSE,
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyCode.LeftArrow,
	when: PositronVariablesFocused,
	handler: () => { }
} satisfies ICommandAndKeybindingRule);

// Register keybinding rule for copy as text.
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: POSITRON_VARIABLES_COPY_AS_TEXT,
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyMod.CtrlCmd | KeyCode.KeyC,
	when: PositronVariablesFocused,
	handler: accessor => { }
} satisfies ICommandAndKeybindingRule);

// Register keybinding rule for copy as HTML.
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: POSITRON_VARIABLES_COPY_AS_HTML,
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyMod.Shift | KeyMod.CtrlCmd | KeyCode.KeyC,
	when: PositronVariablesFocused,
	handler: () => { }
} satisfies ICommandAndKeybindingRule);

// Register the contribution.
Registry.
	as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).
	registerWorkbenchContribution(PositronVariablesContribution, LifecyclePhase.Restored);

// ---------------- Deferred for internal preview ----------------
// // Register the variables configuration.
// Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
// 	id: 'variables',
// 	order: 10,
// 	type: 'object',
// 	title: nls.localize('variablesConfigurationTitle', "Variables"),
// 	scope: ConfigurationScope.APPLICATION,
// 	properties: {
// 		'variables.fixedWidthFont': {
// 			type: 'boolean',
// 			default: false,
// 			scope: ConfigurationScope.APPLICATION,
// 			markdownDescription: nls.localize('variables.fixedWidthFont', "Controls whether Variables is rendered using a fixed-width font."),
// 		}
// 	}
// });

// /**
//  * Configuration options.
//  */
// export interface IVariablesOptions {
// 	/**
// 	 * Gets a value which indicates whether to render Variables with a fixed-width font.
// 	 */
// 	readonly fixedWidthFont?: boolean;
// }
