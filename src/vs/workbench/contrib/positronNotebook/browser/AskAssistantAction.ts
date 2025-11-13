/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { CHAT_OPEN_ACTION_ID } from '../../chat/browser/actions/chatActions.js';
import { ChatModeKind } from '../../chat/common/constants.js';
import { POSITRON_NOTEBOOK_EDITOR_ID } from '../common/positronNotebookCommon.js';
import { getNotebookInstanceFromActiveEditorPane } from './notebookUtils.js';

const ASK_ASSISTANT_ACTION_ID = 'positronNotebook.askAssistant';

/**
 * Interface for quick pick items that represent assistant prompt options
 */
interface PromptQuickPickItem extends IQuickPickItem {
	query: string;
	mode: ChatModeKind;
}

/**
 * Predefined prompt options for the assistant quick pick
 */
const ASSISTANT_PREDEFINED_ACTIONS: PromptQuickPickItem[] = [
	{
		label: localize('positronNotebook.assistant.prompt.describe', 'Describe the notebook'),
		detail: localize('positronNotebook.assistant.prompt.describe.detail', 'Get an overview of the notebook\'s contents and structure'),
		query: 'Can you describe the open notebook for me?',
		mode: ChatModeKind.Ask,
		iconClass: ThemeIcon.asClassName(Codicon.book)
	},
	{
		label: localize('positronNotebook.assistant.prompt.comments', 'Add inline comments'),
		detail: localize('positronNotebook.assistant.prompt.comments.detail', 'Add explanatory comments to the selected cell(s)'),
		query: 'Can you add inline comments to the selected cell(s)?',
		mode: ChatModeKind.Edit,
		iconClass: ThemeIcon.asClassName(Codicon.commentAdd)
	},
	{
		label: localize('positronNotebook.assistant.prompt.suggest', 'Suggest next steps'),
		detail: localize('positronNotebook.assistant.prompt.suggest.detail', 'Get recommendations for what to do next with this notebook'),
		query: 'Can you suggest next steps for this notebook?',
		mode: ChatModeKind.Ask,
		iconClass: ThemeIcon.asClassName(Codicon.lightbulb)
	}
];

/**
 * Action that opens the assistant chat with predefined prompt options for the notebook.
 * Users can select a predefined prompt or type their own custom prompt.
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
				when: ContextKeyExpr.equals('activeEditor', POSITRON_NOTEBOOK_EDITOR_ID)
			}
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const commandService = accessor.get(ICommandService);
		const quickInputService = accessor.get(IQuickInputService);
		const notificationService = accessor.get(INotificationService);
		const editorService = accessor.get(IEditorService);

		// Get the active notebook instance
		const activeNotebook = getNotebookInstanceFromActiveEditorPane(editorService);
		if (!activeNotebook) {
			return;
		}

		// Create and configure the quick pick
		const quickPick = quickInputService.createQuickPick<PromptQuickPickItem>();
		quickPick.title = localize('positronNotebook.assistant.quickPick.title', 'Assistant');
		quickPick.description = localize(
			'positronNotebook.assistant.quickPick.description',
			'Type your own prompt or select one of the options below.'
		);
		quickPick.placeholder = localize('positronNotebook.assistant.quickPick.placeholder', 'Type your prompt...');
		quickPick.items = ASSISTANT_PREDEFINED_ACTIONS;
		quickPick.canSelectMany = false;

		// Wait for user selection or custom input
		const result = await new Promise<PromptQuickPickItem | undefined>((resolve) => {
			quickPick.onDidAccept(() => {
				// Check if a predefined item was selected
				const selected = quickPick.selectedItems[0];
				const customValue = quickPick.value.trim();

				if (selected) {
					// User selected a predefined prompt item
					resolve(selected);
				} else if (customValue) {
					// User typed a custom prompt - create a temporary item with their input
					// Default to 'agent' mode for custom prompts
					const customItem: PromptQuickPickItem = {
						label: customValue,
						query: customValue,
						mode: ChatModeKind.Agent
					};
					resolve(customItem);
				} else {
					// No selection and no input
					resolve(undefined);
				}
				quickPick.dispose();
			});

			quickPick.show();

			quickPick.onDidHide(() => {
				quickPick.dispose();
				resolve(undefined);
			});
		});

		// If user selected an item or typed a custom prompt, execute the chat command
		if (result) {
			try {
				await commandService.executeCommand(CHAT_OPEN_ACTION_ID, {
					query: result.query,
					mode: result.mode
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
		}
	}
}

registerAction2(AskAssistantAction);

