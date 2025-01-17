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
import { executeToolAdapter, getPlotToolAdapter, textEditToolAdapter } from './tools';
const mdDir = `${EXTENSION_ROOT_DIR}/src/md/`;

class PositronAssistantParticipant implements positron.ai.ChatParticipant {
	readonly id = 'positron.positron-assistant';
	readonly iconPath = new vscode.ThemeIcon('positron-posit-logo');
	readonly agentData: positron.ai.ChatAgentData = {
		id: this.id,
		name: 'positron-assistant',
		metadata: { isSticky: false },
		fullName: 'Positron Assistant',
		isDefault: true,
		slashCommands: [{
			name: 'execute',
			description: 'Execute code in the active console.'
		}],
		locations: ['panel', 'terminal', 'editor', 'notebook'],
		disambiguation: []
	};

	readonly _recieveFeedbackEventEmitter = new vscode.EventEmitter<vscode.ChatResultFeedback>();
	onDidReceiveFeedback: vscode.Event<vscode.ChatResultFeedback> = this._recieveFeedbackEventEmitter.event;

	readonly _performActionEventEmitter = new vscode.EventEmitter<vscode.ChatUserActionEvent>();
	onDidPerformAction: vscode.Event<vscode.ChatUserActionEvent> = this._performActionEventEmitter.event;

	readonly followupProvider: vscode.ChatFollowupProvider = {
		async provideFollowups(result: vscode.ChatResult, context: vscode.ChatContext, token: vscode.CancellationToken): Promise<vscode.ChatFollowup[]> {
			const system: string = await fs.promises.readFile(`${mdDir}/prompts/followups.md`, 'utf8');
			const messages: vscode.LanguageModelChatMessage[] = toLanguageModelChatMessage(context.history);
			messages.push(vscode.LanguageModelChatMessage.User('Summarise and suggest follow-ups.'));

			const models = await vscode.lm.selectChatModels({ id: result.metadata?.modelId });
			if (models.length === 0) {
				throw new Error('Selected model not available.');
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
		async provideWelcomeMessage(token: vscode.CancellationToken) {
			let welcomeText = await fs.promises.readFile(`${mdDir}/welcome.md`, 'utf8');

			// Show an extra configuration link if there are no configured models yet
			if (getStoredModels().length === 0) {
				const commandUri = vscode.Uri.parse('command:positron.assistant.addModelConfiguration');
				welcomeText += `\n\n[Add a Language Model](${commandUri})`;
			}

			const message = new vscode.MarkdownString(welcomeText);
			message.isTrusted = true;

			return {
				icon: new vscode.ThemeIcon('positron-posit-logo'),
				title: 'Positron Assistant',
				message,
			};
		}
	};

	async requestHandler(request: vscode.ChatRequest, context: vscode.ChatContext, response: vscode.ChatResponseStream, token: vscode.CancellationToken) {
		// System prompt
		let system: string = await fs.promises.readFile(`${mdDir}/prompts/default.md`, 'utf8');

		// Tools
		const tools: vscode.LanguageModelChatTool[] = [];
		const toolOptions: Record<string, any> = {};

		// Add getPlot tool
		tools.push(getPlotToolAdapter.lmTool);

		// Language model chat history
		const messages: vscode.LanguageModelChatMessage[] = toLanguageModelChatMessage(context.history);

		// Add Positron specific context
		const positronContext = await positron.ai.getPositronChatContext(request);
		messages.push(...[
			vscode.LanguageModelChatMessage.User(JSON.stringify(positronContext)),
			vscode.LanguageModelChatMessage.Assistant('Acknowledged.'),
		]);

		// If the user has explicitly attached files as context, add them to the message thread
		if (request.references.length > 0) {
			let referencesText = await fs.promises.readFile(`${mdDir}/prompts/attachments.md`, 'utf8');

			for (const reference of request.references) {
				const value = reference.value as vscode.Uri | vscode.Location;
				if ('uri' in value) {
					const location = (reference.value as vscode.Location);
					const description = reference.modelDescription;
					const document = await vscode.workspace.openTextDocument(location.uri);
					const selectionText = document.getText(location.range);
					const ref = {
						id: reference.id,
						name: reference.name,
						description,
						selectionText,
					};
					referencesText += `\n\n${JSON.stringify(ref)}`;
				} else if (reference.id.startsWith('file://')) {
					const uri = (reference.value as vscode.Uri);
					const document = await vscode.workspace.openTextDocument(uri);
					const documentText = document.getText();
					const ref = { id: reference.id, name: reference.name, documentText };
					referencesText += `\n\n${JSON.stringify(ref)}`;
				}

			}
			messages.push(...[
				vscode.LanguageModelChatMessage.User(referencesText),
				vscode.LanguageModelChatMessage.Assistant('Acknowledged.'),
			]);
		}

		// When asked via slash command, execute R code in the console.
		if (request.command === 'execute') {
			system += '\n\nExecute code in the active console using `execute`. The console output will not be returned.\n\n';
			tools.push(executeToolAdapter.lmTool);
		}

		// When invoked from the editor, add selection context and editor tool
		if (request.location2 instanceof vscode.ChatRequestEditorData) {
			system += await fs.promises.readFile(`${mdDir}/prompts/editor.md`, 'utf8');
			const document = request.location2.document;
			const selection = request.location2.selection;
			const selectedText = document.getText(selection);
			messages.push(...[
				vscode.LanguageModelChatMessage.User(`The user has selected the following text: ${selectedText}`),
				vscode.LanguageModelChatMessage.Assistant('Acknowledged.'),
			]);

			// Add tool to output text edits
			tools.push(textEditToolAdapter.lmTool);
			toolOptions[textEditToolAdapter.name] = { document, selection };
		}

		// When invoked from the terminal, add additional instructions.
		if (request.location === vscode.ChatLocation.Terminal) {
			system += await fs.promises.readFile(`${mdDir}/prompts/terminal.md`, 'utf8');
		}

		// User prompt
		messages.push(vscode.LanguageModelChatMessage.User(request.prompt));

		if (!request.model) {
			const commandUri = vscode.Uri.parse('command:positron.assistant.addModelConfiguration');
			const message = new vscode.MarkdownString(
				`No language models are available. [Click here to add one.](${commandUri})`
			);
			message.isTrusted = { enabledCommands: ['positron.assistant.addModelConfiguration'] };
			response.warning(message);
			return;
		}

		// Send messages to selected langauge model and stream back response
		const modelResponse = await request.model.sendRequest(messages, {
			tools,
			modelOptions: {
				toolInvocationToken: request.toolInvocationToken,
				toolOptions,
				system
			},
		}, token);

		for await (const fragment of modelResponse.text) {
			if (token.isCancellationRequested) {
				break;
			}
			response.markdown(fragment);
		}

		return {
			metadata: {
				modelId: request.model.id
			},
		};
	}

	dispose(): void {
		throw new Error('Method not implemented.');
	}
}

const participants: Record<string, positron.ai.ChatParticipant> = {
	'positron-assistant': new PositronAssistantParticipant(),
};
export default participants;
