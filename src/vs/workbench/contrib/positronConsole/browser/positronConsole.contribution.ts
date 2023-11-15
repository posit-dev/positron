/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Codicon } from 'vs/base/common/codicons';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { Registry } from 'vs/platform/registry/common/platform';
import { registerIcon } from 'vs/platform/theme/common/iconRegistry';
import { PositronConsoleFocused } from 'vs/workbench/common/contextkeys';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { ViewPaneContainer } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { PositronConsoleViewPane } from 'vs/workbench/contrib/positronConsole/browser/positronConsoleView';
import { registerPositronConsoleActions } from 'vs/workbench/contrib/positronConsole/browser/positronConsoleActions';
import { POSITRON_CONSOLE_VIEW_ID } from 'vs/workbench/services/positronConsole/browser/interfaces/positronConsoleService';
import { ICommandAndKeybindingRule, KeybindingWeight, KeybindingsRegistry } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { ViewContainer, IViewContainersRegistry, ViewContainerLocation, Extensions as ViewContainerExtensions, IViewsRegistry } from 'vs/workbench/common/views';
import { POSITRON_CONSOLE_COPY, POSITRON_CONSOLE_CUT, POSITRON_CONSOLE_PASTE, POSITRON_CONSOLE_SELECT_ALL } from 'vs/workbench/contrib/positronConsole/browser/positronConsoleIdentifiers';

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

// Register keybinding rule for cut.
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: POSITRON_CONSOLE_CUT,
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyMod.CtrlCmd | KeyCode.KeyX,
	when: PositronConsoleFocused,
	handler: accessor => { }
} satisfies ICommandAndKeybindingRule);

// Register keybinding rule for copy.
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: POSITRON_CONSOLE_COPY,
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyMod.CtrlCmd | KeyCode.KeyC,
	when: PositronConsoleFocused,
	handler: accessor => { }
} satisfies ICommandAndKeybindingRule);

// Register keybinding rule for paste.
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: POSITRON_CONSOLE_PASTE,
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyMod.CtrlCmd | KeyCode.KeyV,
	when: PositronConsoleFocused,
	handler: accessor => { }
} satisfies ICommandAndKeybindingRule);

// Register keybinding rule for select all.
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: POSITRON_CONSOLE_SELECT_ALL,
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyMod.CtrlCmd | KeyCode.KeyA,
	when: PositronConsoleFocused,
	handler: accessor => { }
} satisfies ICommandAndKeybindingRule);

// Register all the Positron console actions.
registerPositronConsoleActions();
