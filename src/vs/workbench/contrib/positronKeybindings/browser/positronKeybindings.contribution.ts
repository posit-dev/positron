/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ConfigurationScope, Extensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import * as nls from '../../../../nls.js';
import { positronConfigurationNodeBase } from '../../../services/languageRuntime/common/languageRuntime.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { KeybindingsRegistry, KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { EditorContextKeys } from '../../../../editor/common/editorContextKeys.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';

const configurationRegistry = Registry.as<IConfigurationRegistry>(
	Extensions.Configuration
);
configurationRegistry.registerConfiguration({
	...positronConfigurationNodeBase,
	properties: {
		'workbench.keybindings.rstudioKeybindings': {
			scope: ConfigurationScope.MACHINE,
			type: 'boolean',
			default: false,
			description: nls.localize('keybindings.rstudioKeybindings', "Enable RStudio keybindings (requires restart)"),
		},
	}
});

class PositronKeybindingsContribution extends Disposable {

	static readonly ID = 'workbench.contrib.positronKeybindings';

	private readonly _registrations: DisposableStore = new DisposableStore();

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService
	) {
		super();

		this._register(this._registrations);

		// If the configuration setting is enabled, register the RStudio key mappings
		const rstudioKeybindingsEnabled =
			this._configurationService.getValue('workbench.keybindings.rstudioKeybindings');
		if (rstudioKeybindingsEnabled) {
			this.registerRStudioKeybindings();
		}

		// Listen for changes to the configuration setting.
		//
		// In practice it appears that updating the registry doesn't take effect
		// until the next startup, so unfortunately this doesn't enable us to
		// dynamically toggle the setting within a single Positron session.
		this._register(
			this._configurationService.onDidChangeConfiguration((e) => {
				if (e.affectsConfiguration('workbench.keybindings.rstudioKeybindings')) {
					// Handle the change in configuration
					const rstudioKeybindingsEnabled =
						this._configurationService.getValue('workbench.keybindings.rstudioKeybindings');
					if (rstudioKeybindingsEnabled) {
						// Register the key mappings
						this.registerRStudioKeybindings();
					} else {
						// Unregister the key mappings by clearing the registrations
						this._registrations.clear();
					}
				}
			})
		);
	}

	/**
	 * Registers the RStudio key mappings with the keybinding registry.
	 *
	 * Even though this is a workbench contribution, its key mappings are
	 * registered with the BuiltinExtension weight, since they need to take
	 * precedence over other WorkbenchContrib keybindings.
	 */
	private registerRStudioKeybindings() {
		// Create new R file
		this._registrations.add(KeybindingsRegistry.registerKeybindingRule({
			id: 'r.createNewFile',
			weight: KeybindingWeight.BuiltinExtension,
			primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyN
		}));

		// Go to/reveal definition
		this._registrations.add(KeybindingsRegistry.registerKeybindingRule({
			id: 'editor.action.revealDefinition',
			weight: KeybindingWeight.BuiltinExtension,
			when: EditorContextKeys.editorTextFocus,
			primary: KeyCode.F2
		}));

		// Focus "Source pane" (active editor group)
		this._registrations.add(KeybindingsRegistry.registerKeybindingRule({
			id: 'workbench.action.focusActiveEditorGroup',
			weight: KeybindingWeight.BuiltinExtension,
			mac: {
				primary: KeyMod.CtrlCmd | KeyCode.Digit1,
				secondary: [KeyMod.WinCtrl | KeyCode.Digit1]
			},
			primary: KeyMod.CtrlCmd | KeyCode.Digit1
		}));

		// Focus "Console pane" (the Console)
		this._registrations.add(KeybindingsRegistry.registerKeybindingRule({
			id: 'workbench.action.positronConsole.focusConsole',
			weight: KeybindingWeight.BuiltinExtension,
			mac: {
				primary: KeyMod.CtrlCmd | KeyCode.Digit2,
				secondary: [KeyMod.WinCtrl | KeyCode.Digit2]
			},
			primary: KeyMod.CtrlCmd | KeyCode.Digit2
		}));

		// Run from document beginning to current line
		this._registrations.add(KeybindingsRegistry.registerKeybindingRule({
			id: 'workbench.action.positronConsole.executeCodeBeforeCursor',
			weight: KeybindingWeight.BuiltinExtension,
			primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyB
		}));

		// Run from current line to document end
		this._registrations.add(KeybindingsRegistry.registerKeybindingRule({
			id: 'workbench.action.positronConsole.executeCodeAfterCursor',
			weight: KeybindingWeight.BuiltinExtension,
			primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyE
		}));

		// Rename symbol
		this._registrations.add(KeybindingsRegistry.registerKeybindingRule({
			id: 'editor.action.rename',
			weight: KeybindingWeight.BuiltinExtension,
			when: EditorContextKeys.editorTextFocus,
			primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyMod.Shift | KeyCode.KeyM
		}));

		// Comment line
		this._registrations.add(KeybindingsRegistry.registerKeybindingRule({
			id: 'editor.action.commentLine',
			weight: KeybindingWeight.BuiltinExtension,
			when: EditorContextKeys.editorTextFocus,
			primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyC
		}));

		// Show all symbols
		this._registrations.add(KeybindingsRegistry.registerKeybindingRule({
			id: 'workbench.action.showAllSymbols',
			weight: KeybindingWeight.BuiltinExtension,
			mac: {
				primary: KeyMod.CtrlCmd | KeyCode.Period,
				secondary: [KeyMod.WinCtrl | KeyCode.Period]
			},
			primary: KeyMod.CtrlCmd | KeyCode.Period
		}));

		// Open keybindings
		this._registrations.add(KeybindingsRegistry.registerKeybindingRule({
			id: 'workbench.action.openGlobalKeybindings',
			weight: KeybindingWeight.BuiltinExtension,
			primary: KeyMod.Shift | KeyMod.Alt | KeyCode.KeyK
		}));

		// Insert code cell
		this._registrations.add(KeybindingsRegistry.registerKeybindingRule({
			id: 'quarto.insertCodeCell',
			weight: KeybindingWeight.BuiltinExtension,
			when: ContextKeyExpr.and(
				EditorContextKeys.editorTextFocus,
				ContextKeyExpr.equals(EditorContextKeys.languageId.key, 'quarto')),
			primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyI
		}));

		// Run current

		this._registrations.add(KeybindingsRegistry.registerKeybindingRule({
			id: 'quarto.runCurrent',
			weight: KeybindingWeight.BuiltinExtension,
			when: ContextKeyExpr.and(
				EditorContextKeys.editorTextFocus,
				ContextKeyExpr.equals(EditorContextKeys.languageId.key, 'quarto'),
				ContextKeyExpr.not('findInputFocussed'),
				ContextKeyExpr.not('replaceInputFocussed')
			),
			mac: {
				primary: KeyMod.CtrlCmd | KeyCode.Enter,
				secondary: [KeyMod.WinCtrl | KeyCode.Enter]
			},
			primary: KeyMod.CtrlCmd | KeyCode.Enter
		}));

		// Run current cell
		this._registrations.add(KeybindingsRegistry.registerKeybindingRule({
			id: 'quarto.runCurrentCell',
			weight: KeybindingWeight.BuiltinExtension,
			when: ContextKeyExpr.and(
				EditorContextKeys.editorTextFocus,
				ContextKeyExpr.equals(EditorContextKeys.languageId.key, 'quarto'),
				ContextKeyExpr.not('findInputFocussed'),
				ContextKeyExpr.not('replaceInputFocussed')
			),
			mac: {
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Enter,
				secondary: [KeyMod.WinCtrl | KeyMod.Shift | KeyCode.Enter]
			},
			primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Enter
		}));

		// Reindent selected lines. We only bind this if Assistant is not enabled,
		// since this binding is used to invoke inline chat with Assistant.
		const positronAssistantEnabled =
			this._configurationService.getValue('positron.assistant.enable');
		if (!positronAssistantEnabled) {
			this._registrations.add(KeybindingsRegistry.registerKeybindingRule({
				id: 'editor.action.reindentselectedlines',
				weight: KeybindingWeight.BuiltinExtension,
				when: EditorContextKeys.editorTextFocus,
				primary: KeyMod.CtrlCmd | KeyCode.KeyI
			}));
		}

		// Format selection
		this._registrations.add(KeybindingsRegistry.registerKeybindingRule({
			id: 'editor.action.formatSelection',
			weight: KeybindingWeight.BuiltinExtension,
			when: EditorContextKeys.editorTextFocus,
			primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyA
		}));

		// Delete lines
		this._registrations.add(KeybindingsRegistry.registerKeybindingRule({
			id: 'editor.action.deleteLines',
			weight: KeybindingWeight.BuiltinExtension,
			when: EditorContextKeys.editorTextFocus,
			primary: KeyMod.CtrlCmd | KeyCode.KeyD
		}));

		// Insert section
		this._registrations.add(KeybindingsRegistry.registerKeybindingRule({
			id: 'r.insertSection',
			weight: KeybindingWeight.BuiltinExtension,
			when: ContextKeyExpr.and(
				EditorContextKeys.editorTextFocus,
				ContextKeyExpr.equals(EditorContextKeys.languageId.key, 'r')),
			primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyR
		}));

		// Source current file
		this._registrations.add(KeybindingsRegistry.registerKeybindingRule({
			id: 'r.sourceCurrentFile',
			weight: KeybindingWeight.BuiltinExtension,
			when: ContextKeyExpr.and(
				EditorContextKeys.editorTextFocus,
				ContextKeyExpr.equals(EditorContextKeys.languageId.key, 'r')),
			primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyS
		}));

		// Source current file with echo
		this._registrations.add(KeybindingsRegistry.registerKeybindingRule({
			id: 'r.sourceCurrentFileWithEcho',
			weight: KeybindingWeight.BuiltinExtension,
			when: ContextKeyExpr.and(
				EditorContextKeys.editorTextFocus,
				ContextKeyExpr.equals(EditorContextKeys.languageId.key, 'r')),
			primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Enter
		}));

		// Previous editor in group
		this._registrations.add(KeybindingsRegistry.registerKeybindingRule({
			id: 'workbench.action.previousEditorInGroup',
			weight: KeybindingWeight.BuiltinExtension,
			mac: {
				primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.LeftArrow,
				secondary: [KeyMod.WinCtrl | KeyMod.Alt | KeyCode.LeftArrow]
			},
			primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.LeftArrow
		}));

		// Next editor in group
		this._registrations.add(KeybindingsRegistry.registerKeybindingRule({
			id: 'workbench.action.nextEditorInGroup',
			weight: KeybindingWeight.BuiltinExtension,
			mac: {
				primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.RightArrow,
				secondary: [KeyMod.WinCtrl | KeyMod.Alt | KeyCode.RightArrow]
			},
			primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.RightArrow
		}));

		// Open SCM view
		this._registrations.add(KeybindingsRegistry.registerKeybindingRule({
			id: 'workbench.view.scm',
			weight: KeybindingWeight.BuiltinExtension,
			mac: {
				primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyM,
				secondary: [KeyMod.WinCtrl | KeyMod.Alt | KeyCode.KeyM]
			},
			primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KeyM
		}));

		// Go to Working Directory
		this._registrations.add(KeybindingsRegistry.registerKeybindingRule({
			id: 'workbench.action.setWorkingDirectory',
			weight: KeybindingWeight.BuiltinExtension,
			primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyH
		}));
	}
}

registerWorkbenchContribution2(PositronKeybindingsContribution.ID, PositronKeybindingsContribution, WorkbenchPhase.BlockRestore);
