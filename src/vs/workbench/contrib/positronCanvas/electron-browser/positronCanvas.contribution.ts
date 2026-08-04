/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { localize2 } from '../../../../nls.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { AI_ENABLED_KEY } from '../../positronAssistant/common/positronAIConfiguration.js';
import { registerCanvasCommandLockdown } from '../browser/positronCanvasCommandLockdown.js';
import { CANVAS_EXIT_COMMAND_ID, CANVAS_WEBVIEW_VIEW_TYPE, PositronCanvasModeActiveContext } from '../common/positronCanvasMode.js';
import { IPositronCanvasService, PositronCanvasService } from './positronCanvasService.js';

registerSingleton(IPositronCanvasService, PositronCanvasService, InstantiationType.Delayed);

/**
 * Enters Canvas mode from the Canvas editor's action bar. The assistant owns
 * palette discovery, so Positron stays dormant when the installed assistant
 * does not provide Canvas. Both entry points land on the same service call;
 * this action adds the presentation of not getting in.
 */
class OpenCanvasAction extends Action2 {

	static readonly ID = 'positron.canvas.open';

	constructor() {
		super({
			id: OpenCanvasAction.ID,
			title: localize2('positron.canvas.open', "Open Canvas"),
			category: Categories.View,
			f1: false,
			precondition: ContextKeyExpr.has(`config.${AI_ENABLED_KEY}`),
			icon: Codicon.screenFull,
			menu: [{
				// Shown where the active editor is a Canvas panel, in place of
				// the standard move-into-new-window button, which is suppressed
				// for Canvas (editorActionBarFactory.tsx).
				id: MenuId.EditorActionsRight,
				group: 'navigation',
				when: ContextKeyExpr.and(
					ContextKeyExpr.equals('activeWebviewPanelId', CANVAS_WEBVIEW_VIEW_TYPE),
					ContextKeyExpr.has(`config.${AI_ENABLED_KEY}`)
				)
			}]
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const canvasService = accessor.get(IPositronCanvasService);
		const notificationService = accessor.get(INotificationService);
		const outcome = await canvasService.enter();
		if (!outcome.entered) {
			// A notification: the user asked from inside a working IDE.
			notificationService.error(outcome.message);
		}
	}
}

/**
 * Leaves Canvas mode for the full IDE. Deliberately unbound: Escape is pressed
 * constantly in a chat UI, and a chord that swaps the whole product surface is
 * worse than no shortcut. The way out is Canvas's own "Open Positron" control.
 */
class ExitCanvasModeAction extends Action2 {

	static readonly ID = CANVAS_EXIT_COMMAND_ID;

	constructor() {
		super({
			id: ExitCanvasModeAction.ID,
			title: localize2('positron.canvas.exit', "Exit Canvas to the Positron IDE"),
			category: Categories.View,
			f1: true,
			precondition: PositronCanvasModeActiveContext
		});
	}

	override run(accessor: ServicesAccessor): Promise<boolean> {
		return accessor.get(IPositronCanvasService).exit();
	}
}

registerAction2(OpenCanvasAction);
registerAction2(ExitCanvasModeAction);
registerCanvasCommandLockdown();

/**
 * Posit Assistant's way into Canvas mode. A plain command: it returns the
 * entry outcome and never notifies, so the caller decides the presentation.
 */
CommandsRegistry.registerCommand('positron.canvas.enter', (accessor: ServicesAccessor) => {
	return accessor.get(IPositronCanvasService).enter();
});

/**
 * Whether Canvas is being shown as the whole product; gates the Canvas UI's
 * "Open Positron" control.
 */
CommandsRegistry.registerCommand('positron.canvas.isActive', (accessor: ServicesAccessor): boolean => {
	return accessor.get(IPositronCanvasService).isActive;
});
