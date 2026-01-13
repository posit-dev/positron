/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

import { localize, localize2 } from '../../../../nls.js';
import { MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { CHAT_OPEN_ACTION_ID } from '../../chat/browser/actions/chatActions.js';
import { ChatModeKind } from '../../chat/common/constants.js';
import { POSITRON_NOTEBOOK_EDITOR_ID } from '../common/positronNotebookCommon.js';
import { IPositronNotebookInstance } from './IPositronNotebookInstance.js';
import { NotebookAction2 } from './NotebookAction2.js';
import { PositronModalReactRenderer } from '../../../../base/browser/positronModalReactRenderer.js';
import { AssistantPanel } from './AssistantPanel/AssistantPanel.js';
import { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';
import { IPreferencesService } from '../../../services/preferences/common/preferences.js';

const ASK_ASSISTANT_ACTION_ID = 'positronNotebook.askAssistant';

/**
 * Action that opens the assistant panel with predefined prompt options for the notebook.
 * Users can select a predefined prompt, type their own custom prompt, or generate AI suggestions.
 * The panel shows as a centered modal dialog.
 */
export class AskAssistantAction extends NotebookAction2 {
	constructor() {
		super({
			id: ASK_ASSISTANT_ACTION_ID,
			title: localize2('askAssistant', 'Ask Assistant'),
			tooltip: localize2('askAssistant.tooltip', 'Ask the assistant about this notebook'),
			icon: ThemeIcon.fromId('positron-assistant'),
			f1: true,
			category: localize2('positronNotebook.category', 'Notebook'),
			positronActionBarOptions: {
				controlType: 'button',
				displayTitle: false
			},
			menu: {
				id: MenuId.EditorActionsLeft,
				group: 'navigation',
				order: 50,
				when: ContextKeyExpr.and(
					ContextKeyExpr.equals('activeEditor', POSITRON_NOTEBOOK_EDITOR_ID),
					ContextKeyExpr.has('config.positron.assistant.enable'),
					ContextKeyExpr.has('config.positron.assistant.notebookMode.enable')
				)
			}
		});
	}

	override async runNotebookAction(notebook: IPositronNotebookInstance, accessor: ServicesAccessor, ...args: unknown[]): Promise<void> {
		// Extract all services upfront - accessor is only valid during this synchronous call
		const commandService = accessor.get(ICommandService);
		const notificationService = accessor.get(INotificationService);
		const logService = accessor.get(ILogService);
		const preferencesService = accessor.get(IPreferencesService);
		const layoutService = accessor.get(ILayoutService);

		// Create the modal renderer for a centered dialog
		const renderer = new PositronModalReactRenderer({
			container: layoutService.activeContainer
		});

		// Handle action selection - open the chat with the selected query
		const handleActionSelected = async (query: string, mode: ChatModeKind) => {
			try {
				await commandService.executeCommand(CHAT_OPEN_ACTION_ID, {
					query,
					mode
				});
			} catch (error) {
				notificationService.error(
					localize(
						'positronNotebook.assistant.error',
						'Failed to open assistant chat: {0}',
						error instanceof Error ? error.message : String(error)
					)
				);
			}
		};

		// Render the assistant panel as a centered modal dialog
		renderer.render(
			<AssistantPanel
				commandService={commandService}
				logService={logService}
				notebook={notebook}
				notificationService={notificationService}
				preferencesService={preferencesService}
				renderer={renderer}
				onActionSelected={handleActionSelected}
			/>
		);
	}
}

registerAction2(AskAssistantAction);
