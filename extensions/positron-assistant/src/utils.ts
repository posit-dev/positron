/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as ai from 'ai';

export function toAIMessage(messages: vscode.LanguageModelChatMessage[]): ai.CoreMessage[] {
	// Gather all tool call references
	const toolCalls = messages.reduce<Record<string, vscode.LanguageModelToolCallPart>>((acc, message) => {
		for (const part of message.content) {
			if (part instanceof vscode.LanguageModelToolCallPart) {
				acc[part.callId] = part;
			}
		}
		return acc;
	}, {});

	// Convert messages from vscode to ai format
	const aiMessages: ai.CoreMessage[] = [];
	for (const message of messages) {
		if (message.role === vscode.LanguageModelChatMessageRole.User) {
			const textParts = message.content.filter((part) => part instanceof vscode.LanguageModelTextPart);
			const toolParts = message.content.filter((part) => part instanceof vscode.LanguageModelToolResultPart);
			if (textParts.length > 0) {
				aiMessages.push({
					role: 'user',
					content: textParts.map((part) => {
						const binaryMatch = /<<referenceBinary:(\w+)>>/;
						if (part.value.match(binaryMatch)) {
							return { type: 'text', text: part.value };
						}
						return { type: 'text', text: part.value };
					}),
				});
			}
			if (toolParts.length > 0) {
				aiMessages.push({
					role: 'tool',
					content: toolParts.map((part) => ({
						type: 'tool-result',
						toolCallId: part.callId,
						toolName: toolCalls[part.callId].name,
						result: part.content,
					})),
				});
			}
		} else if (message.role === vscode.LanguageModelChatMessageRole.Assistant) {
			aiMessages.push({
				role: 'assistant',
				content: message.content.map((part) => {
					if (part instanceof vscode.LanguageModelTextPart) {
						return { type: 'text', text: part.value };
					} else if (part instanceof vscode.LanguageModelToolCallPart) {
						return {
							type: 'tool-call',
							toolCallId: part.callId,
							toolName: part.name,
							args: part.input,
						};
					} else {
						throw new Error(`Unsupported part type on assistant message`);
					}
				}),
			});
		}
	}
	return aiMessages.filter((message) => message.content.length > 0);
}

export type BinaryMessageReferences = Record<string, { mimeType: string; data: string }>;

export function replaceBinaryMessageParts(messages: ai.CoreMessage[], references: BinaryMessageReferences): ai.CoreMessage[] {
	const binaryMatch = /<<referenceBinary:(\w+)>>/;

	return messages.map((message): ai.CoreMessage => {
		if (typeof message.content === 'string' || message.role !== 'user') {
			return message;
		}

		const content = message.content.map((part) => {
			if (part.type === 'text') {
				const match = part.text.match(binaryMatch);
				if (match) {
					const id = match[1];
					const ref = references[id];
					switch (ref.mimeType) {
						case 'image/jpeg':
						case 'image/png':
						case 'image/gif':
						case 'image/webp':
							return { type: 'image' as const, image: ref.data, mimeType: ref.mimeType };
						default:
							return { type: 'file' as const, data: ref.data, mimeType: ref.mimeType };
					}
				}
			}
			return part;
		});

		return { ...message, content };
	});
}

export function toLanguageModelChatMessage(turns: vscode.ChatContext['history']): vscode.LanguageModelChatMessage[] {
	return turns.map((turn) => {
		if (turn instanceof vscode.ChatRequestTurn) {
			let textValue = turn.prompt;
			if (turn.command) {
				textValue = `${turn.command} ${turn.prompt}`;
			}
			return vscode.LanguageModelChatMessage.User(textValue);
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
			return textValue === '' ? null : vscode.LanguageModelChatMessage.Assistant(textValue);
		}
	}).filter((message) => !!message);
}

export function padBase64String(base64: string): string {
	const padding = 4 - (base64.length % 4);
	if (padding === 4) {
		return base64;
	}
	return base64 + '='.repeat(padding);
}

export function arrayBufferToBase64(array: ArrayBufferLike): string {
	const uint8Array = new Uint8Array(array);
	let binary = '';
	const len = array.byteLength;
	for (let i = 0; i < len; i++) {
		binary += String.fromCharCode(uint8Array[i]);
	}
	return btoa(binary);
}
