/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as ai from 'ai';
import { PositronAssistantToolName } from './tools.js';
import { isLanguageModelImagePart } from './languageModelParts.js';

/**
 * Convert messages from VSCode Language Model format to Vercel AI format.
 */
export function toAIMessage(messages: vscode.LanguageModelChatMessage2[]): ai.CoreMessage[] {
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

			// Add the user messages.
			const userContent: ai.UserContent = [];
			for (const part of message.content) {
				if (part instanceof vscode.LanguageModelTextPart) {
					userContent.push({ type: 'text', text: part.value });
				} else if (part instanceof vscode.LanguageModelDataPart) {
					if (isChatImagePart(part.value)) {
						userContent.push({ type: 'image', image: part.value.data, mimeType: part.value.mimeType });
					}
				}
			}
			if (userContent.length > 0) {
				aiMessages.push({
					role: 'user',
					content: userContent
				});
			}

			// Add the tool messages.
			for (const part of message.content) {
				if (part instanceof vscode.LanguageModelToolResultPart) {
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
				}
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
function getPlotToolResultToAiMessage(part: vscode.LanguageModelToolResultPart): ai.CoreUserMessage {
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

export function isChatImagePart(part: vscode.LanguageModelDataPart['value']): part is vscode.ChatImagePart {
	return 'mimeType' in part && isChatImageMimeType(part.mimeType);
}

export function isChatImageMimeType(mimeType: string): mimeType is vscode.ChatImageMimeType {
	return Object.values(vscode.ChatImageMimeType).includes(mimeType as vscode.ChatImageMimeType);
}
