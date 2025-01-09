/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export interface AIMessage {
	role: 'user' | 'assistant';
	content: string;
}

function toRole(role: vscode.LanguageModelChatMessageRole): 'user' | 'assistant' {
	switch (role) {
		case vscode.LanguageModelChatMessageRole.User:
			return 'user';
		case vscode.LanguageModelChatMessageRole.Assistant:
			return 'assistant';
		default:
			throw new Error('Unknown chat message role');
	}
}

export function toAIMessage(messages: vscode.LanguageModelChatMessage[]): AIMessage[] {
	return messages.map((message) => {
		return {
			role: toRole(message.role),
			content: message.content.reduce((acc, cur) => {
				if (cur instanceof vscode.LanguageModelTextPart) {
					return acc + cur.value;
				}
				throw new Error('Unsupported message content part type');
			}, ''),
		};
	}).filter((message) => !!message.content);
}

export function toLanguageModelChatMessage(turns: vscode.ChatContext['history']): vscode.LanguageModelChatMessage[] {
	return turns.map((turn) => {
		if (turn instanceof vscode.ChatRequestTurn) {
			return vscode.LanguageModelChatMessage.User(turn.prompt);
		} else if (turn.result.errorDetails) {
			return vscode.LanguageModelChatMessage.Assistant(`ERROR MESSAGE: "${turn.result.errorDetails.message}"`);
		} else {
			const textValue = turn.response.reduce((acc, content) => {
				if (content instanceof vscode.ChatResponseMarkdownPart) {
					return acc + content.value.value;
				} else if (content instanceof vscode.ChatResponseTextEditPart) {
					return acc + `\n\nSuggested text edits: ${JSON.stringify(content.edits)}\n\n`;
				} else {
					// TODO: Lower more history entry types to text.
					throw new Error('Unsupported response kind when lowering chat agent response');
				}
			}, '');
			return vscode.LanguageModelChatMessage.Assistant(textValue);
		}
	});
}

export function padBase64String(base64: string): string {
	const padding = 4 - (base64.length % 4);
	if (padding === 4) {
		return base64;
	}
	return base64 + '='.repeat(padding);
}
