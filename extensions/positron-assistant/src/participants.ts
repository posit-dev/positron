/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import * as fs from 'fs';

import { EXTENSION_ROOT_DIR } from './constants';
import { toLanguageModelChatMessage } from './utils';
import { getStoredModels } from './config';
import { QUARTO_COMMAND, QUARTO_DESCRIPTION, quartoHandler } from './commands/quarto';
import { defaultHandler } from './commands/default';

const mdDir = `${EXTENSION_ROOT_DIR}/src/md/`;

class PositronAssistantParticipant implements positron.ai.ChatParticipant {
	readonly _context: vscode.ExtensionContext;
	constructor(context: vscode.ExtensionContext) {
		this._context = context;
	}
	readonly id = 'positron.positron-assistant';
	readonly iconPath = new vscode.ThemeIcon('positron-assistant');
	readonly agentData: positron.ai.ChatAgentData = {
		id: this.id,
		name: 'positron-assistant',
		metadata: { isSticky: false },
		fullName: 'Positron Assistant',
		isDefault: true,
		slashCommands: [{
			name: QUARTO_COMMAND,
			description: QUARTO_DESCRIPTION,
		}],
		locations: [
			positron.PositronChatAgentLocation.Panel,
			positron.PositronChatAgentLocation.Terminal,
			positron.PositronChatAgentLocation.Editor,
			positron.PositronChatAgentLocation.Notebook,
			positron.PositronChatAgentLocation.EditingSession,
		],
		disambiguation: []
	};

	readonly _receiveFeedbackEventEmitter = new vscode.EventEmitter<vscode.ChatResultFeedback>();
	onDidReceiveFeedback: vscode.Event<vscode.ChatResultFeedback> = this._receiveFeedbackEventEmitter.event;

	readonly _performActionEventEmitter = new vscode.EventEmitter<vscode.ChatUserActionEvent>();
	onDidPerformAction: vscode.Event<vscode.ChatUserActionEvent> = this._performActionEventEmitter.event;

	readonly _pauseStateEventEmitter = new vscode.EventEmitter<vscode.ChatParticipantPauseStateEvent>();
	onDidChangePauseState: vscode.Event<vscode.ChatParticipantPauseStateEvent> = this._pauseStateEventEmitter.event;

	readonly followupProvider: vscode.ChatFollowupProvider = {
		async provideFollowups(result: vscode.ChatResult, context: vscode.ChatContext, token: vscode.CancellationToken): Promise<vscode.ChatFollowup[]> {
			const system: string = await fs.promises.readFile(`${mdDir}/prompts/chat/followups.md`, 'utf8');
			const messages: vscode.LanguageModelChatMessage[] = toLanguageModelChatMessage(context.history);
			messages.push(vscode.LanguageModelChatMessage.User('Summarise and suggest follow-ups.'));

			const models = await vscode.lm.selectChatModels({ id: result.metadata?.modelId });
			if (models.length === 0) {
				throw new Error(vscode.l10n.t('Selected model not available.'));
			}

			const response = await models[0].sendRequest(messages, { modelOptions: { system } }, token);

			let json = '';
			for await (const fragment of response.text) {
				json += fragment;
				if (token.isCancellationRequested) {
					break;
				}
			}

			try {
				return (JSON.parse(json) as 'string'[]).map((p) => ({ prompt: p }));
			} catch (e) {
				return [];
			}
		}
	};

	readonly welcomeMessageProvider = {
		provideWelcomeMessage: async (token: vscode.CancellationToken) => {
			let welcomeText;
			const addLanguageModelMessage = vscode.l10n.t('Add a Language Model.');

			// Show an extra configuration link if there are no configured models yet
			if (getStoredModels(this._context).length === 0) {
				welcomeText = await fs.promises.readFile(`${mdDir}/welcome.md`, 'utf8');
				const commandUri = vscode.Uri.parse('command:positron-assistant.addModelConfiguration');
				welcomeText += `\n\n[${addLanguageModelMessage}](${commandUri})`;
			} else {
				welcomeText = await fs.promises.readFile(`${mdDir}/welcomeready.md`, 'utf8');
				// TODO: Replace with guide link once it has been created
				const guideLink = vscode.Uri.parse('https://positron.posit.co');
				welcomeText = welcomeText.replace('{guide-link}', `[${vscode.l10n.t('Positron Assistant User Guide')}](${guideLink})`);
			}

			const message = new vscode.MarkdownString(welcomeText, true);
			message.isTrusted = true;

			return {
				icon: new vscode.ThemeIcon('positron-assistant'),
				title: 'Positron Assistant',
				message,
			};
		}
	};

	async requestHandler(request: vscode.ChatRequest, context: vscode.ChatContext, response: vscode.ChatResponseStream, token: vscode.CancellationToken) {
		// Select request handler based on the command issued by the user for this request
		switch (request.command) {
			case 'quarto':
				return quartoHandler(request, context, response, token);
			default:
				return defaultHandler(request, context, response, token);
		}
	}

	dispose(): void { }
}

export function createParticipants(context: vscode.ExtensionContext): Record<string, positron.ai.ChatParticipant> {
	return {
		'positron-assistant': new PositronAssistantParticipant(context),
	};
}

