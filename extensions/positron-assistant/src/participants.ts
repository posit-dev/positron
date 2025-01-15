/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import * as ai from 'ai';
import * as fs from 'fs';

import { z } from 'zod';

import { EXTENSION_ROOT_DIR } from './constants';
import { padBase64String, toLanguageModelChatMessage } from './utils';
const promptsDir = `${EXTENSION_ROOT_DIR}/src/prompts/`;

class PositronAssistantParticipant implements positron.ai.ChatParticipant {
	readonly id = 'positron-assistant';
	readonly name = 'Positron Assistant';
	readonly fullName = 'Positron Assistant';
	readonly isDefault = true;
	readonly locations: vscode.ChatLocation[] = [
		vscode.ChatLocation.Panel,
		vscode.ChatLocation.Editor,
		vscode.ChatLocation.Notebook,
		vscode.ChatLocation.Terminal,
	];

	readonly metadata: positron.ai.ChatParticipantMetadata = {
		themeIcon: new vscode.ThemeIcon('positron-posit-logo'),
		isSticky: false,
	};

	async requestHandler(request: vscode.ChatRequest, context: positron.ai.ChatContext, response: vscode.ChatResponseStream, token: vscode.CancellationToken) {
		// System prompt
		let system: string = fs.readFileSync(`${promptsDir}/default/default.md`, 'utf8');

		// Tools
		const tools: Record<string, ai.CoreTool> = {
			getPlot: ai.tool({
				description: 'Get the current visible plot.',
				parameters: z.object({}),
				execute: async () => {
					response.progress('Getting the current plot...');
					const uri = await positron.ai.getCurrentPlotUri();
					const matches = uri?.match(/^data:([^;]+);base64,(.+)$/);
					if (!matches || !uri) {
						return 'No plot visible';
					}

					response.progress('Analysing the plot image data...');
					return {
						type: 'image' as const,
						mimeType: matches[1],
						data: padBase64String(matches[2]),
					};
				},
				experimental_toToolResultContent(result) {
					return typeof result === 'string'
						? [{ type: 'text', text: result }]
						: [result];
				},
			}),
		};

		// Language model chat history
		const messages: vscode.LanguageModelChatMessage[] = toLanguageModelChatMessage(context.history);

		// Add Positron specific context
		messages.push(...[
			vscode.LanguageModelChatMessage.User(JSON.stringify(context.positron.context)),
			vscode.LanguageModelChatMessage.Assistant('Acknowledged.'),
		]);

		// If the user has explicitly attached files as context, add them to the message thread
		if (request.references.length > 0) {
			let referencesText = fs.readFileSync(`${promptsDir}/default/attachments.md`, 'utf8');

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

		// When invoked from the editor, add selection context and editor tool
		if (request.location2 instanceof vscode.ChatRequestEditorData) {
			system += fs.readFileSync(`${promptsDir}/default/editor.md`, 'utf8');
			const document = request.location2.document;
			const selection = request.location2.selection;
			const selectedText = document.getText(selection);
			messages.push(...[
				vscode.LanguageModelChatMessage.User(`The user has selected the following text: ${selectedText}`),
				vscode.LanguageModelChatMessage.Assistant('Acknowledged.'),
			]);

			tools['textEdit'] = ai.tool({
				description: 'Output an edited version of the code selection.',
				parameters: z.object({
					code: z.string().describe('The entire edited code selection.'),
				}),
				execute: async ({ code }) => {
					response.textEdit(
						document.uri,
						vscode.TextEdit.replace(selection, code)
					);
				},
			});
		}

		// When invoked from the terminal, add additional instructions.
		if (request.location === vscode.ChatLocation.Terminal) {
			system += fs.readFileSync(`${promptsDir}/default/terminal.md`, 'utf8');
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
		const modelResponse = await positron.ai.sendLanguageModelRequest(
			request.model.id,
			messages,
			{
				modelOptions: { tools, system }
			},
			token);

		for await (const fragment of modelResponse.text) {
			response.markdown(fragment);
		}
	}
}

const participants: Record<string, positron.ai.ChatParticipant> = {
	'positron-assistant': new PositronAssistantParticipant(),
};
export default participants;
