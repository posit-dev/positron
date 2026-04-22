/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from '../../../../nls.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { PositronConsoleFocused, PositronConsoleFindInputFocused, PositronConsoleFindVisible } from '../../../common/contextkeys.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { PositronConsoleViewPane } from './positronConsoleView.js';
import { registerPositronConsoleActions } from './positronConsoleActions.js';
import { IConsoleFindWidgetFactory, IPositronConsoleService, POSITRON_CONSOLE_VIEW_ID } from '../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { ICommandAndKeybindingRule, KeybindingWeight, KeybindingsRegistry } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { ViewContainer, IViewContainersRegistry, ViewContainerLocation, Extensions as ViewContainerExtensions, IViewsRegistry } from '../../../common/views.js';
import { POSITRON_CONSOLE_COPY, POSITRON_CONSOLE_PASTE, POSITRON_CONSOLE_SELECT_ALL } from './positronConsoleIdentifiers.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { ContextKeyExpr, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { localize2 } from '../../../../nls.js';
import { ConsoleFindWidgetFactory, PositronConsoleFindCommandId } from './positronConsoleFind.js';

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
	when: ContextKeyExpr.and(PositronConsoleFocused, PositronConsoleFindInputFocused.negate()),
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
	when: ContextKeyExpr.and(PositronConsoleFocused, PositronConsoleFindInputFocused.negate()),
	handler: async accessor => {
		const consoleService = accessor.get(IPositronConsoleService);
		return consoleService.activePositronConsoleInstance?.selectAll();
	}
} satisfies ICommandAndKeybindingRule);

// Register keybinding rule for hiding find (Escape).
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: PositronConsoleFindCommandId.FindHide,
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyCode.Escape,
	secondary: [KeyMod.Shift | KeyCode.Escape],
	when: ContextKeyExpr.and(PositronConsoleFocused, PositronConsoleFindVisible),
	handler: accessor => {
		accessor.get(IPositronConsoleService).hideFindWidget();
	}
} satisfies ICommandAndKeybindingRule);

// Register keybinding rule for find next.
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: PositronConsoleFindCommandId.FindNext,
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyCode.F3,
	mac: { primary: KeyMod.CtrlCmd | KeyCode.KeyG, secondary: [KeyCode.F3] },
	when: ContextKeyExpr.and(PositronConsoleFocused, PositronConsoleFindVisible),
	handler: accessor => {
		accessor.get(IPositronConsoleService).findNext();
	}
} satisfies ICommandAndKeybindingRule);

// Register keybinding rule for find next from within the find input (Shift+Enter).
// In the console, "next" navigates downward (toward newer output).
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: `${PositronConsoleFindCommandId.FindNext}.fromInput`,
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyMod.Shift | KeyCode.Enter,
	when: PositronConsoleFindInputFocused,
	handler: accessor => {
		accessor.get(IPositronConsoleService).findNext();
	}
} satisfies ICommandAndKeybindingRule);

// Register keybinding rule for find previous.
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: PositronConsoleFindCommandId.FindPrevious,
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyMod.Shift | KeyCode.F3,
	mac: { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyG, secondary: [KeyMod.Shift | KeyCode.F3] },
	when: ContextKeyExpr.and(PositronConsoleFocused, PositronConsoleFindVisible),
	handler: accessor => {
		accessor.get(IPositronConsoleService).findPrevious();
	}
} satisfies ICommandAndKeybindingRule);

// Register keybinding rule for find previous from within the find input (Enter).
// In the console, "previous" navigates upward (toward older output), so Enter
// searches backward which is the natural direction for console history.
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: `${PositronConsoleFindCommandId.FindPrevious}.fromInput`,
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyCode.Enter,
	when: PositronConsoleFindInputFocused,
	handler: accessor => {
		accessor.get(IPositronConsoleService).findPrevious();
	}
} satisfies ICommandAndKeybindingRule);

// Register command palette action for Console: Find.
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: PositronConsoleFindCommandId.FindFocus,
			title: localize2('positronConsole.find', 'Console: Find'),
			f1: true,
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyCode.KeyF,
				when: PositronConsoleFocused,
				weight: KeybindingWeight.WorkbenchContrib,
			},
		});
	}
	run(accessor: ServicesAccessor) {
		accessor.get(IPositronConsoleService).revealFindWidget();
	}
});

// Register all the Positron console actions.
registerPositronConsoleActions();

// Singleton to allow service layers to instantiate a find widget.
registerSingleton(IConsoleFindWidgetFactory, ConsoleFindWidgetFactory, InstantiationType.Delayed);
