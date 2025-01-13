/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../../base/common/codicons.js';
import { KeyCode, KeyMod } from '../../../../../base/common/keyCodes.js';
import { localize2 } from '../../../../../nls.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { KeybindingWeight } from '../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { AbstractInlineChatAction } from '../../../inlineChat/browser/inlineChatActions.js';
import { isDetachedTerminalInstance } from '../../../terminal/browser/terminal.js';
import { registerActiveXtermAction } from '../../../terminal/browser/terminalActions.js';
import { TerminalContextKeys } from '../../../terminal/common/terminalContextKey.js';
import { MENU_TERMINAL_CHAT_WIDGET_STATUS, TerminalChatCommandId, TerminalChatContextKeys } from './terminalChat.js';
import { TerminalChatController } from './terminalChatController.js';

registerActiveXtermAction({
	id: TerminalChatCommandId.Start,
	title: localize2('startChat', 'Terminal Inline Chat'),
	category: AbstractInlineChatAction.category,
	keybinding: {
		primary: KeyMod.CtrlCmd | KeyCode.KeyI,
		when: ContextKeyExpr.and(TerminalContextKeys.focusInAny),
		// HACK: Force weight to be higher than the extension contributed keybinding to override it until it gets replaced
		weight: KeybindingWeight.ExternalExtension + 1, // KeybindingWeight.WorkbenchContrib,
	},
	f1: true,
	precondition: ContextKeyExpr.and(
		ContextKeyExpr.or(TerminalContextKeys.processSupported, TerminalContextKeys.terminalHasBeenCreated),
		TerminalChatContextKeys.hasChatAgent
	),
	run: (_xterm, _accessor, activeInstance, opts?: unknown) => {
		if (isDetachedTerminalInstance(activeInstance)) {
			return;
		}

		const contr = TerminalChatController.activeChatController || TerminalChatController.get(activeInstance);

		if (opts) {
			opts = typeof opts === 'string' ? { query: opts } : opts;
			if (typeof opts === 'object' && opts !== null && 'query' in opts && typeof opts.query === 'string') {
				contr?.updateInput(opts.query, false);
				if (!('isPartialQuery' in opts && opts.isPartialQuery)) {
					contr?.terminalChatWidget?.acceptInput();
				}
			}

		}

		contr?.terminalChatWidget?.reveal();
	}
});

registerActiveXtermAction({
	id: TerminalChatCommandId.Close,
	title: localize2('closeChat', 'Close'),
	category: AbstractInlineChatAction.category,
	keybinding: {
		primary: KeyCode.Escape,
		when: ContextKeyExpr.and(
			ContextKeyExpr.or(TerminalContextKeys.focus, TerminalChatContextKeys.focused),
			TerminalChatContextKeys.visible
		),
		weight: KeybindingWeight.WorkbenchContrib,
	},
	menu: [{
		id: MENU_TERMINAL_CHAT_WIDGET_STATUS,
		group: '0_main',
		order: 2,
		when: TerminalChatContextKeys.responseContainsCodeBlock
	}],
	icon: Codicon.close,
	f1: true,
	precondition: TerminalChatContextKeys.visible,
	run: (_xterm, _accessor, activeInstance) => {
		if (isDetachedTerminalInstance(activeInstance)) {
			return;
		}
		const contr = TerminalChatController.activeChatController || TerminalChatController.get(activeInstance);
		contr?.terminalChatWidget?.clear();
	}
});

registerActiveXtermAction({
	id: TerminalChatCommandId.RunCommand,
	title: localize2('runCommand', 'Run Chat Command'),
	shortTitle: localize2('run', 'Run'),
	category: AbstractInlineChatAction.category,
	precondition: ContextKeyExpr.and(
		ContextKeyExpr.or(TerminalContextKeys.processSupported, TerminalContextKeys.terminalHasBeenCreated),
		TerminalChatContextKeys.requestActive.negate(),
		TerminalChatContextKeys.responseContainsCodeBlock,
		TerminalChatContextKeys.responseContainsMultipleCodeBlocks.negate()
	),
	icon: Codicon.play,
	keybinding: {
		when: TerminalChatContextKeys.requestActive.negate(),
		weight: KeybindingWeight.WorkbenchContrib,
		primary: KeyMod.CtrlCmd | KeyCode.Enter,
	},
	menu: {
		id: MENU_TERMINAL_CHAT_WIDGET_STATUS,
		group: '0_main',
		order: 0,
		when: ContextKeyExpr.and(TerminalChatContextKeys.responseContainsCodeBlock, TerminalChatContextKeys.responseContainsMultipleCodeBlocks.negate(), TerminalChatContextKeys.requestActive.negate())
	},
	run: (_xterm, _accessor, activeInstance) => {
		if (isDetachedTerminalInstance(activeInstance)) {
			return;
		}
		const contr = TerminalChatController.activeChatController || TerminalChatController.get(activeInstance);
		contr?.terminalChatWidget?.acceptCommand(true);
	}
});

registerActiveXtermAction({
	id: TerminalChatCommandId.RunFirstCommand,
	title: localize2('runFirstCommand', 'Run First Chat Command'),
	shortTitle: localize2('runFirst', 'Run First'),
	category: AbstractInlineChatAction.category,
	precondition: ContextKeyExpr.and(
		ContextKeyExpr.or(TerminalContextKeys.processSupported, TerminalContextKeys.terminalHasBeenCreated),
		TerminalChatContextKeys.requestActive.negate(),
		TerminalChatContextKeys.responseContainsMultipleCodeBlocks
	),
	icon: Codicon.play,
	keybinding: {
		when: TerminalChatContextKeys.requestActive.negate(),
		weight: KeybindingWeight.WorkbenchContrib,
		primary: KeyMod.CtrlCmd | KeyCode.Enter,
	},
	menu: {
		id: MENU_TERMINAL_CHAT_WIDGET_STATUS,
		group: '0_main',
		order: 0,
		when: ContextKeyExpr.and(TerminalChatContextKeys.responseContainsMultipleCodeBlocks, TerminalChatContextKeys.requestActive.negate())
	},
	run: (_xterm, _accessor, activeInstance) => {
		if (isDetachedTerminalInstance(activeInstance)) {
			return;
		}
		const contr = TerminalChatController.activeChatController || TerminalChatController.get(activeInstance);
		contr?.terminalChatWidget?.acceptCommand(true);
	}
});

registerActiveXtermAction({
	id: TerminalChatCommandId.InsertCommand,
	title: localize2('insertCommand', 'Insert Chat Command'),
	shortTitle: localize2('insert', 'Insert'),
	category: AbstractInlineChatAction.category,
	icon: Codicon.insert,
	precondition: ContextKeyExpr.and(
		ContextKeyExpr.or(TerminalContextKeys.processSupported, TerminalContextKeys.terminalHasBeenCreated),
		TerminalChatContextKeys.requestActive.negate(),
		TerminalChatContextKeys.responseContainsCodeBlock,
		TerminalChatContextKeys.responseContainsMultipleCodeBlocks.negate()
	),
	keybinding: {
		when: TerminalChatContextKeys.requestActive.negate(),
		weight: KeybindingWeight.WorkbenchContrib,
		primary: KeyMod.Alt | KeyCode.Enter,
		secondary: [KeyMod.CtrlCmd | KeyCode.Enter | KeyMod.Alt]
	},
	menu: {
		id: MENU_TERMINAL_CHAT_WIDGET_STATUS,
		group: '0_main',
		order: 1,
		when: ContextKeyExpr.and(TerminalChatContextKeys.responseContainsCodeBlock, TerminalChatContextKeys.responseContainsMultipleCodeBlocks.negate(), TerminalChatContextKeys.requestActive.negate())
	},
	run: (_xterm, _accessor, activeInstance) => {
		if (isDetachedTerminalInstance(activeInstance)) {
			return;
		}
		const contr = TerminalChatController.activeChatController || TerminalChatController.get(activeInstance);
		contr?.terminalChatWidget?.acceptCommand(false);
	}
});

registerActiveXtermAction({
	id: TerminalChatCommandId.InsertFirstCommand,
	title: localize2('insertFirstCommand', 'Insert First Chat Command'),
	shortTitle: localize2('insertFirst', 'Insert First'),
	category: AbstractInlineChatAction.category,
	precondition: ContextKeyExpr.and(
		ContextKeyExpr.or(TerminalContextKeys.processSupported, TerminalContextKeys.terminalHasBeenCreated),
		TerminalChatContextKeys.requestActive.negate(),
		TerminalChatContextKeys.responseContainsMultipleCodeBlocks
	),
	keybinding: {
		when: TerminalChatContextKeys.requestActive.negate(),
		weight: KeybindingWeight.WorkbenchContrib,
		primary: KeyMod.Alt | KeyCode.Enter,
		secondary: [KeyMod.CtrlCmd | KeyCode.Enter | KeyMod.Alt]
	},
	menu: {
		id: MENU_TERMINAL_CHAT_WIDGET_STATUS,
		group: '0_main',
		order: 1,
		when: ContextKeyExpr.and(TerminalChatContextKeys.responseContainsMultipleCodeBlocks, TerminalChatContextKeys.requestActive.negate())
	},
	run: (_xterm, _accessor, activeInstance) => {
		if (isDetachedTerminalInstance(activeInstance)) {
			return;
		}
		const contr = TerminalChatController.activeChatController || TerminalChatController.get(activeInstance);
		contr?.terminalChatWidget?.acceptCommand(false);
	}
});

registerActiveXtermAction({
	id: TerminalChatCommandId.ViewInChat,
	title: localize2('viewInChat', 'View in Chat'),
	category: AbstractInlineChatAction.category,
	precondition: ContextKeyExpr.and(
		ContextKeyExpr.or(TerminalContextKeys.processSupported, TerminalContextKeys.terminalHasBeenCreated),
		TerminalChatContextKeys.requestActive.negate(),
	),
	icon: Codicon.commentDiscussion,
	menu: [{
		id: MENU_TERMINAL_CHAT_WIDGET_STATUS,
		group: 'zzz',
		order: 1,
		isHiddenByDefault: true,
		when: ContextKeyExpr.and(TerminalChatContextKeys.responseContainsCodeBlock, TerminalChatContextKeys.requestActive.negate()),
	}],
	run: (_xterm, _accessor, activeInstance) => {
		if (isDetachedTerminalInstance(activeInstance)) {
			return;
		}
		const contr = TerminalChatController.activeChatController || TerminalChatController.get(activeInstance);
		contr?.viewInChat();
	}
});
