/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

import { localize, localize2 } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { CHAT_OPEN_ACTION_ID } from '../../chat/browser/actions/chatActions.js';
import { ChatModeKind } from '../../chat/common/constants.js';
import { IChatEditingService } from '../../chat/common/chatEditingService.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { POSITRON_NOTEBOOK_EDITOR_ID } from '../common/positronNotebookCommon.js';
import { PositronModalReactRenderer } from '../../../../base/browser/positronModalReactRenderer.js';
import { AssistantPanel } from './AssistantPanel/AssistantPanel.js';
import { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';
import { IPreferencesService } from '../../../services/preferences/common/preferences.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { getNotebookInstanceFromActiveEditorPane, waitForNotebook } from './notebookUtils.js';
import { CancelablePromise } from '../../../../base/common/async.js';
import { IPositronNotebookInstance } from './IPositronNotebookInstance.js';

const ASK_ASSISTANT_ACTION_ID = 'positronNotebook.askAssistant';

/**
 * Action that opens the assistant panel with predefined prompt options for the notebook.
 * Users can select a predefined prompt, type their own custom prompt, or generate AI suggestions.
 * The panel shows as a centered modal dialog.
 */
export class AskAssistantAction extends Action2 {
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
				)
			}
		});
	}

	override async run(accessor: ServicesAccessor, ...args: unknown[]): Promise<void> {
		// Extract all services upfront - accessor is only valid during this synchronous call
		const editorService = accessor.get(IEditorService);
		const commandService = accessor.get(ICommandService);
		const configurationService = accessor.get(IConfigurationService);
		const notificationService = accessor.get(INotificationService);
		const logService = accessor.get(ILogService);
		const preferencesService = accessor.get(IPreferencesService);
		const layoutService = accessor.get(ILayoutService);
		const chatEditingService = accessor.get(IChatEditingService);
		const dialogService = accessor.get(IDialogService);

		// Get the initial notebook instance (may be undefined during the timing gap
		// between editor activation and setInput() completion)
		const initialNotebook = getNotebookInstanceFromActiveEditorPane(editorService);

		// Create a cancelable promise to wait for the notebook if not immediately available
		let notebookPromise: CancelablePromise<IPositronNotebookInstance> | undefined;
		if (!initialNotebook) {
			notebookPromise = waitForNotebook(editorService);
		}

		// Create the modal renderer for a centered dialog
		// Hook up cancellation so polling stops if the modal is closed early
		const renderer = new PositronModalReactRenderer({
			container: layoutService.activeContainer,
			onDisposed: () => {
				notebookPromise?.cancel();
			}
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

		// Render the assistant panel immediately (optimistic loading)
		// Pass the notebook directly if available, otherwise pass the promise
		renderer.render(
			<AssistantPanel
				chatEditingService={chatEditingService}
				commandService={commandService}
				configurationService={configurationService}
				dialogService={dialogService}
				initialNotebook={initialNotebook}
				logService={logService}
				notebookPromise={notebookPromise}
				notificationService={notificationService}
				preferencesService={preferencesService}
				renderer={renderer}
				onActionSelected={handleActionSelected}
			/>
		);
	}
}

registerAction2(AskAssistantAction);
