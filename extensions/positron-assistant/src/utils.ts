/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as ai from 'ai';
import { isLanguageModelImagePart } from './languageModelParts.js';
import { PositronAssistantToolName } from './tools.js';

/**
 * Convert messages from VSCode Language Model format to Vercel AI format.
 */
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
			// VSCode expects tool results to be user messages but
			// Vercel AI expects them to have a special 'tool' role.
			// Split this message into separate 'user' and 'tool'
			// messages.
			const textParts = message.content.filter((part) => part instanceof vscode.LanguageModelTextPart);
			const toolParts = message.content.filter((part) => part instanceof vscode.LanguageModelToolResultPart);
			if (textParts.length > 0) {
				aiMessages.push({
					role: 'user',
					content: textParts.map((part) => {
						// TODO: Handle binary references.
						const binaryMatch = /<<referenceBinary:(\w+)>>/;
						if (part.value.match(binaryMatch)) {
							return { type: 'text', text: part.value };
						}
						return { type: 'text', text: part.value };
					}),
				});
			}
			if (toolParts.length > 0) {
				toolParts.forEach((part) => {
					const toolCall = toolCalls[part.callId];
					if (toolCall.name === PositronAssistantToolName.GetPlot) {
						aiMessages.push(getPlotToolResultToAiMessage(part));
					} else {
						aiMessages.push({
							role: 'tool',
							content: [
								{
									type: 'tool-result',
									toolCallId: part.callId,
									toolName: toolCall.name,
									result: part.content,
								},
							],
						});
					}
				});
			}
		} else if (message.role === vscode.LanguageModelChatMessageRole.Assistant) {
			aiMessages.push({
				role: 'assistant',
				content: message.content.map((part) => {
					if (part instanceof vscode.LanguageModelTextPart) {
						return { type: 'text', text: part.value };
					} else if (part instanceof vscode.LanguageModelToolCallPart) {
						if (part.name === PositronAssistantToolName.GetPlot) {
							// Vercel AI does not yet support image tool results,
							// so replace getPlot tool calls with text asking for the plot.
							// The corresponding tool result will be replaced with a user
							// message containing the plot image.
							return {
								type: 'text',
								text: 'Please provide the current active plot.'
							};
						}
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

	// Remove empty messages to keep certain LLM providers happy
	return aiMessages.filter((message) => message.content.length > 0);
}

/**
 * Convert a getPlot tool result into a Vercel AI message.
 */
function getPlotToolResultToAiMessage(part: vscode.LanguageModelToolResultPart): ai.CoreMessage {
	// Vercel AI doesn't support image tool results. Convert
	// an image result into a user message containing the image.
	const imageParts = part.content.filter((content) => isLanguageModelImagePart(content));
	if (imageParts.length > 0) {
		return {
			role: 'user',
			content: imageParts.flatMap((content) => ([
				{
					type: 'text',
					text: 'Here is the current active plot:',
				},
				{
					type: 'image',
					image: content.value.base64,
					mimeType: content.value.mimeType,
				}])),
		};
	}
	// If there was no image, forward the response as text.
	return {
		role: 'user',
		content: [
			{
				type: 'text',
				text: `Could not get the current active plot. Reason: ${JSON.stringify(part.content)}`,
			},
		],
	};
}

export type BinaryMessageReferences = Record<string, { mimeType: string; data: string }>;

/**
 * Replace embedded binary file references with specific vercel AI message part types.
 */
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

/**
 * Convert chat participant history into an array of VSCode language model messages.
 */
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
