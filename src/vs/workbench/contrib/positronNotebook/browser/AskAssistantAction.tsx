/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { IChatEditingService } from '../../chat/common/editing/chatEditingService.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IHeadlessLanguageModelService } from '../../../services/positronHeadlessLanguageModel/common/headlessLanguageModelService.js';
import { POSITRON_NOTEBOOK_EDITOR_ID } from '../common/positronNotebookCommon.js';
import { AI_ENABLED_KEY } from '../../positronAssistant/common/positronAIConfiguration.js';
import { PositronModalDialogReactRenderer } from '../../../../base/browser/positronModalDialogReactRenderer.js';
import { AssistantPanel } from './AssistantPanel/AssistantPanel.js';
import { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';
import { IPreferencesService } from '../../../services/preferences/common/preferences.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { getNotebookInstanceFromActiveEditorPane, waitForNotebook } from './notebookUtils.js';
import { CancelablePromise } from '../../../../base/common/async.js';
import { IPositronNotebookInstance } from './IPositronNotebookInstance.js';

const ASK_ASSISTANT_ACTION_ID = 'positronNotebook.askAssistant';

// Command exposed by the Posit Assistant extension to start/continue a chat.
const POSIT_NEW_CHAT_COMMAND = 'posit-assistant.newChat';

/**
 * Send a query to Posit Assistant. Routes through the standalone assistant's
 * posit-assistant.newChat command rather than the built-in chat, which has no
 * Posit Assistant agent behind it and so does nothing. newChat opens the
 * assistant in whichever surface the user configured (sidebar or editor panel).
 *
 * Exported so the command routing can be unit tested without the modal.
 */
export async function openAssistantChat(
	commandService: ICommandService,
	notificationService: INotificationService,
	logService: ILogService,
	query: string,
): Promise<void> {
	try {
		await commandService.executeCommand(POSIT_NEW_CHAT_COMMAND, {
			prompt: query,
			target: 'new',
			behavior: 'submit',
		});
	} catch (error) {
		logService.error('Failed to open Posit Assistant chat', error);
		notificationService.error(
			localize(
				'positronNotebook.assistant.unavailable',
				"Posit Assistant is not available. Make sure the Posit Assistant extension is installed and enabled."
			)
		);
	}
}

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
			// Gate the command palette entry and command execution on the AI main switch.
			// The menu `when` below hides the toolbar button; precondition covers the rest.
			precondition: ContextKeyExpr.has(`config.${AI_ENABLED_KEY}`),
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
					ContextKeyExpr.has(`config.${AI_ENABLED_KEY}`),
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
		const headlessLmService = accessor.get(IHeadlessLanguageModelService);

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
		const renderer = new PositronModalDialogReactRenderer({
			container: layoutService.activeContainer,
			onDisposed: () => {
				notebookPromise?.cancel();
			}
		});

		// Handle action selection - send the query to Posit Assistant (see openAssistantChat).
		const handleActionSelected = (query: string) =>
			openAssistantChat(commandService, notificationService, logService, query);

		// Render the assistant panel immediately (optimistic loading)
		// Pass the notebook directly if available, otherwise pass the promise
		renderer.render(
			<AssistantPanel
				chatEditingService={chatEditingService}
				commandService={commandService}
				configurationService={configurationService}
				dialogService={dialogService}
				headlessLmService={headlessLmService}
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
