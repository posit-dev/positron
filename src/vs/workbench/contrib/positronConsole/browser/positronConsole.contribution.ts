/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from '../../../../nls.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { PositronConsoleFocused } from '../../../common/contextkeys.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { PositronConsoleViewPane } from './positronConsoleView.js';
import { registerPositronConsoleActions } from './positronConsoleActions.js';
import { IPositronConsoleService, POSITRON_CONSOLE_VIEW_ID } from '../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { ICommandAndKeybindingRule, KeybindingWeight, KeybindingsRegistry } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { ViewContainer, IViewContainersRegistry, ViewContainerLocation, Extensions as ViewContainerExtensions, IViewsRegistry } from '../../../common/views.js';
import { POSITRON_CONSOLE_COPY, POSITRON_CONSOLE_PASTE, POSITRON_CONSOLE_SELECT_ALL } from './positronConsoleIdentifiers.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';

// The Positron console view icon.
const positronConsoleViewIcon = registerIcon(
	'positron-console-view-icon',
	Codicon.positronConsoleView,
	nls.localize('positronConsoleViewIcon', 'View icon of the Positron console view.')
);

// Register the Positron console view container.
const VIEW_CONTAINER: ViewContainer = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).registerViewContainer({
	id: POSITRON_CONSOLE_VIEW_ID,
	title: {
		value: nls.localize('positron.console', "Console"),
		original: 'Console'
	},
	icon: positronConsoleViewIcon,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [POSITRON_CONSOLE_VIEW_ID, {
		mergeViewWithContainerWhenSingleView: true
	}]),
	storageId: POSITRON_CONSOLE_VIEW_ID,
	hideIfEmpty: true,
	// --- Start Positron ---
	order: 1,
	// --- End Positron ---
}, ViewContainerLocation.Panel, {
	doNotRegisterOpenCommand: true,
	isDefault: true
});

Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).registerViews([{
	id: POSITRON_CONSOLE_VIEW_ID,
	name: {
		value: nls.localize('positron.console', "Console"),
		original: 'Console'
	},
	containerIcon: positronConsoleViewIcon,
	canMoveView: true,
	canToggleVisibility: false,
	ctorDescriptor: new SyncDescriptor(PositronConsoleViewPane),
	openCommandActionDescriptor: {
		id: 'workbench.action.positronConsole.open',
		mnemonicTitle: nls.localize({ key: 'miOpenConsole', comment: ['&& denotes a mnemonic'] }, "&&Console"),
		keybindings: {},
		order: 3,
	}
}], VIEW_CONTAINER);

// Below we define keybindings so we can refer to them in the console context
// menu and display the keybinding shortcut next to the menu action. We don't
// necessarily want to handle the keybinding instead of VS Code. In that case,
// we condition the keybinding handler on this context key that never activates.
const never = new RawContextKey<boolean>('never', false);

// Register keybinding rule for copy.
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: POSITRON_CONSOLE_COPY,
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyMod.CtrlCmd | KeyCode.KeyC,
	// We let the default command copy for us
	when: never,
	handler: accessor => { }
} satisfies ICommandAndKeybindingRule);

// Register keybinding rule for paste.
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: POSITRON_CONSOLE_PASTE,
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyMod.CtrlCmd | KeyCode.KeyV,
	when: PositronConsoleFocused,
	handler: async accessor => {
		const clipboardService = accessor.get(IClipboardService);
		const consoleService = accessor.get(IPositronConsoleService);
		const text = await clipboardService.readText();
		return consoleService.activePositronConsoleInstance?.pasteText(text);
	}
} satisfies ICommandAndKeybindingRule);

// Register keybinding rule for select all.
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: POSITRON_CONSOLE_SELECT_ALL,
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyMod.CtrlCmd | KeyCode.KeyA,
	when: PositronConsoleFocused,
	handler: async accessor => {
		const consoleService = accessor.get(IPositronConsoleService);
		return consoleService.activePositronConsoleInstance?.selectAll();
	}
} satisfies ICommandAndKeybindingRule);

// Register all the Positron console actions.
registerPositronConsoleActions();
