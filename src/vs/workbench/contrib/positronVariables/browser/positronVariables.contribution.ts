/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from '../../../../nls.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { KeyMod, KeyCode, KeyChord } from '../../../../base/common/keyCodes.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerAction2 } from '../../../../platform/actions/common/actions.js';
import { PositronVariablesFocused } from '../../../common/contextkeys.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { PositronVariablesViewPane } from './positronVariablesView.js';
import { PositronVariablesRefreshAction } from './positronVariablesActions.js';
import { IPositronVariablesService } from '../../../services/positronVariables/common/interfaces/positronVariablesService.js';
import { ICommandAndKeybindingRule, KeybindingWeight, KeybindingsRegistry } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions, IWorkbenchContribution } from '../../../common/contributions.js';
import { Extensions as ViewContainerExtensions, IViewsRegistry } from '../../../common/views.js';
import { POSITRON_VARIABLES_COLLAPSE, POSITRON_VARIABLES_COPY_AS_HTML, POSITRON_VARIABLES_COPY_AS_TEXT, POSITRON_VARIABLES_EXPAND } from './positronVariablesIdentifiers.js';
import { POSITRON_SESSION_CONTAINER, positronSessionViewIcon } from '../../positronSession/browser/positronSessionContainer.js';

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
			},
			focusCommand: {
				id: 'positronVariables.focus',
				keybindings: {
					primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyCode.KeyV),
				}
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
