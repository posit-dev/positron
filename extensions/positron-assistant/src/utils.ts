/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as ai from 'ai';
import { JSONTree } from '@vscode/prompt-tsx';
import { LanguageModelCacheBreakpoint, LanguageModelCacheBreakpointType, LanguageModelDataPartMimeType, PositronAssistantToolName, PromptInstructionsReference, RuntimeSessionReference } from './types.js';
import { log } from './extension.js';

/**
 * Convert messages from VSCode Language Model format to Vercel AI format.
 *
 * @param messages The messages to convert.
 * @param toolResultExperimentalContent Whether to use experimental content for tool results.
 * @param bedrockCacheBreakpoint Whether to use Bedrock cache breakpoints.
 */
export function toAIMessage(
	messages: vscode.LanguageModelChatMessage2[],
	toolResultExperimentalContent: boolean = false,
	bedrockCacheBreakpoint: boolean = false
): ai.CoreMessage[] {
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
	const systemContent: string[] = [];
	for (const message of messages) {
		if (message.role === vscode.LanguageModelChatMessageRole.User) {
			// VSCode expects tool results to be user messages but
			// Vercel AI expects them to have a special 'tool' role.
			// Split this message into separate 'user' and 'tool'
			// messages.

			// Add the user messages.
			const userContent: ai.UserContent = [];
			let cacheBreakpoint = false;
			for (const part of message.content) {
				if (part instanceof vscode.LanguageModelTextPart) {
					userContent.push({ type: 'text', text: part.value });
				} else if (part instanceof vscode.LanguageModelDataPart) {
					if (isChatImagePart(part)) {
						userContent.push({ type: 'image', image: part.data, mimeType: part.mimeType });
					} else if (part.mimeType === LanguageModelDataPartMimeType.CacheControl) {
						cacheBreakpoint = true;
					}
				}
			}
			if (userContent.length > 0) {
				const messageContent: ai.CoreUserMessage = {
					role: 'user',
					content: userContent
				};

				// If this is a cache breakpoint, note it in the message
				// content. This is only used by the Bedrock provider.
				if (cacheBreakpoint && bedrockCacheBreakpoint) {
					cacheBreakpoint = false;
					markBedrockCacheBreakpoint(messageContent);
				}
				aiMessages.push(messageContent);
			}

			// Add the tool messages.
			for (const part of message.content) {
				if (part instanceof vscode.LanguageModelToolResultPart || part instanceof vscode.LanguageModelToolResultPart2) {
					if (toolResultExperimentalContent) {
						const toolCall = toolCalls[part.callId];
						const toolMessage = convertToolResultToAiMessageExperimentalContent(part, toolCall);
						if (cacheBreakpoint && bedrockCacheBreakpoint) {
							cacheBreakpoint = false;
							markBedrockCacheBreakpoint(toolMessage);
						}
						aiMessages.push(toolMessage);
					} else {
						// Note that we don't need to check for cache
						// breakpoints here since Anthropic models that support
						// caching use the experimental content format above.
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
			}

		} else if (message.role === vscode.LanguageModelChatMessageRole.Assistant) {
			const content: ai.AssistantContent = [];
			let cacheBreakpoint = false;
			for (const part of message.content) {
				if (part instanceof vscode.LanguageModelTextPart) {
					content.push({ type: 'text', text: part.value });
				} else if (part instanceof vscode.LanguageModelDataPart) {
					if (isCacheBreakpointPart(part)) {
						cacheBreakpoint = true;
					}
				} else if (part instanceof vscode.LanguageModelToolCallPart) {
					if (
						!toolResultExperimentalContent &&
						part.name === PositronAssistantToolName.GetPlot
					) {
						// Vercel AI does not yet support image tool results,
						// so replace getPlot tool calls with text asking for the plot.
						// The corresponding tool result will be replaced with a user
						// message containing the plot image.
						content.push({
							type: 'text',
							text: 'Please provide the current active plot.'
						});
					}
					content.push({
						type: 'tool-call',
						toolCallId: part.callId,
						toolName: part.name,
						args: part.input,
					});
				} else if (part instanceof vscode.LanguageModelPromptTsxPart) {
					// Convert PromptTSX parts to text
					const text = promptTsxPartToString(part);
					content.push({ type: 'text', text });
				} else {
					// Skip unknown parts.
					log.warn(`[vercel] Skipping unsupported part type in assistant message: ${part.constructor.name}`);
				}
			}
			const aiMessage: ai.CoreAssistantMessage = {
				role: 'assistant',
				content,
			};

			// If this is a cache breakpoint, note it in the message
			// content. This is only used by the Bedrock provider.
			if (cacheBreakpoint && bedrockCacheBreakpoint) {
				cacheBreakpoint = false;
				markBedrockCacheBreakpoint(aiMessage);
			}
			aiMessages.push(aiMessage);
		} else if (message.role === vscode.LanguageModelChatMessageRole.System) {
			for (const part of message.content) {
				if (part instanceof vscode.LanguageModelTextPart) {
					systemContent.push(part.value);
				} else if (part instanceof vscode.LanguageModelPromptTsxPart) {
					// Convert PromptTSX parts to text
					const text = promptTsxPartToString(part);
					systemContent.push(text);
				} else {
					// Skip unknown parts.
					log.warn(`[vercel] Skipping unsupported part type in system message: ${part.constructor.name}`);
				}
			}
		}
	}

	if (systemContent.length > 0) {
		// Not all providers support multiple system messages, so we consolidate.
		const systemMessage: ai.CoreSystemMessage = {
			role: 'system',
			content: systemContent.join('\n'),
		};

		// Add a cache breakpoint for our combined system prompt.
		// This is only used by the Bedrock provider.
		if (bedrockCacheBreakpoint) {
			markBedrockCacheBreakpoint(systemMessage);
		}

		aiMessages.unshift(systemMessage);
	}

	// Remove empty messages to keep certain LLM providers happy
	return aiMessages.filter((message) => message.content.length > 0);
}

export function markBedrockCacheBreakpoint(message: ai.CoreMessage): ai.CoreMessage {
	log.trace(`[vercel] Marking ${message.role} message as a Bedrock cache breakpoint`);
	message.providerOptions = {
		bedrock: {
			cachePoint: {
				type: 'default',
			}
		}
	};
	return message;
}

/**
 * Convert a tool result into a Vercel AI message with experimental content.
 * This is useful for tool results that contain images.
 */
function convertToolResultToAiMessageExperimentalContent(
	part: vscode.LanguageModelToolResultPart,
	toolCall: vscode.LanguageModelToolCallPart,
): ai.CoreToolMessage {
	// If experimental content is enabled for tool calls,
	// that means tool results can contain images.

	const toolMessage: ai.CoreToolMessage = {
		role: 'tool',
		content: [
			{
				type: 'tool-result',
				toolCallId: part.callId,
				toolName: toolCall.name,
				result: '',
			},
		],
	};

	// If there's 0 or 1 parts and that part is text, we can just return a
	// normal CoreToolMessage object with a `result` field.
	if (
		part.content.length <= 1 &&
		part.content.every(
			(content) => content instanceof vscode.LanguageModelTextPart
		)
	) {
		toolMessage.content[0].result = part.content;
	} else {
		// This is a multi-part tool result, and may contain images. We can
		// convert it to a Vercel AI message with experimental_content.
		const toolResultContent: ToolResultContent = part.content.map(
			(content): ToolResultContent[number] => {
				if (content instanceof vscode.LanguageModelTextPart) {
					return {
						type: 'text',
						text: content.value,
					};
				} else if (content instanceof vscode.LanguageModelDataPart && isChatImagePart(content)) {
					return {
						type: 'image',
						data: Buffer.from(content.data).toString('base64'),
						mimeType: content.mimeType,
					};
				} else if (content instanceof vscode.LanguageModelPromptTsxPart) {
					return {
						type: 'text',
						text: promptTsxPartToString(content),
					};
				} else {
					throw new Error(
						`Unsupported part type on tool result message: ${(content as any).constructor?.name ?? typeof content}`
					);
				}
			}
		);
		toolMessage.content[0].result = toolResultContent;
		toolMessage.content[0].experimental_content = toolResultContent;
	}

	return toolMessage;
}

/**
 * Convert a getPlot tool result into a Vercel AI message.
 */
function getPlotToolResultToAiMessage(part: vscode.LanguageModelToolResultPart2): ai.CoreToolMessage {
	const isImageDataPart = (content: unknown): content is vscode.LanguageModelDataPart => {
		return content instanceof vscode.LanguageModelDataPart && isChatImagePart(content);
	};
	const imageParts = part.content.filter(isImageDataPart);
	if (imageParts.length > 1) {
		log.warn('More than one plot image was provided. Only the first image will be provided as a result.');
	}

	const imagePart = imageParts[0];
	const imageContent = {
		type: 'image',
		data: Buffer.from(imagePart.data).toString('base64'),
		mimeType: imagePart.mimeType
	};
	return {
		role: 'tool',
		content: [
			{
				type: 'tool-result',
				toolCallId: part.callId,
				toolName: PositronAssistantToolName.GetPlot,
				result: imageContent,
			},
		],
	};
}

/**
 * Convert chat participant history into an array of VSCode language model messages.
 */
export function toLanguageModelChatMessage(turns: vscode.ChatContext['history']): vscode.LanguageModelChatMessage2[] {
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
				} else if (content instanceof vscode.ChatResponseAnchorPart) {
					return acc + `\n\nAnchor: ${content.title ? `${content.title} ` : ''}${JSON.stringify(content.value2)}\n\n`;
				} else {
					// TODO: Lower more history entry types to text.
					throw new Error(`Unsupported response kind when lowering chat agent response: ${content.constructor.name}`);
				}
			}, '');
			return textValue === '' ? null : vscode.LanguageModelChatMessage.Assistant(textValue);
		}
	}).filter((message) => !!message);
}

export function isChatImagePart(part: vscode.LanguageModelDataPart): boolean {
	return 'mimeType' in part && isChatImageMimeType(part.mimeType);
}

export enum ChatImageMimeType {
	PNG = 'image/png',
	JPEG = 'image/jpeg',
	GIF = 'image/gif',
	WEBP = 'image/webp',
	BMP = 'image/bmp',
}

export function isChatImageMimeType(mimeType: string): mimeType is ChatImageMimeType {
	return Object.values(ChatImageMimeType).includes(mimeType as ChatImageMimeType);
}

export const EMPTY_TOOL_RESULT_PLACEHOLDER = '';

/**
 * Processes a message to ensure it has non-empty tool result parts.
 * If a tool result part is empty, it replaces it with a placeholder.
 * This is a workaround for LLMs that don't handle empty tool result parts well.
 * @todo: We may be able to remove this handling in the future, to save on token count,
 * once LLMs are better at handling empty tool result parts.
 * @param message The message to process
 * @returns A new message with empty tool result parts replaced with a placeholder
 */
function processEmptyToolResults(message: vscode.LanguageModelChatMessage2) {
	let replacedEmptyToolResult = false;
	const updatedContent = message.content.map(part => {
		const isToolResult = part instanceof vscode.LanguageModelToolResultPart || part instanceof vscode.LanguageModelToolResultPart2;
		if (isToolResult && part.content.length === 0) {
			replacedEmptyToolResult = true;
			return new vscode.LanguageModelToolResultPart(
				part.callId,
				[new vscode.LanguageModelTextPart(EMPTY_TOOL_RESULT_PLACEHOLDER)],
			);
		}
		// For other parts, such as LanguageModelToolCallPart or LanguageModelDataPart,
		// just return them as is, as we expect them to be non-empty.
		return part;
	});

	if (!replacedEmptyToolResult) {
		// If no empty tool result parts were found, we can return the message as is.
		return message;
	}

	return new vscode.LanguageModelChatMessage2(
		message.role,
		updatedContent,
		message.name,
	);
}

/**
 * Removes empty text parts from a message.
 * This should only be used if the message has other non-empty content,
 * as it will remove all text parts that are empty or contain only whitespace.
 * @param message The message to process
 * @returns The message with empty text parts removed or the original message if no empty text parts were found.
 */
function removeEmptyTextParts(message: vscode.LanguageModelChatMessage2) {
	const updatedContent = message.content.filter(part => {
		if (part instanceof vscode.LanguageModelTextPart) {
			return part.value.trim() !== '';
		}
		return true;
	});

	if (updatedContent.length === message.content.length) {
		return message;
	}

	return new vscode.LanguageModelChatMessage2(
		message.role,
		updatedContent,
		message.name,
	);
}

/**
 * Checks if a message has content.
 * A message is considered to have non-empty content if it contains at one least item
 * in its content array that is not an empty/whitespace LanguageModelTextPart.
 * @param message The message to check
 * @returns Whether the message has non-empty content
 */
function hasContent(message: vscode.LanguageModelChatMessage2) {
	return message.content.length > 0 &&
		!message.content.every(
			part => (part instanceof vscode.LanguageModelTextPart && part.value.trim() === '') ||
				// If the only other parts are cache breakpoints, consider the message to have no content.
				isCacheBreakpointPart(part)
		);
}

/**
 * Processes an array of messages to ensure they have non-empty content,
 * filtering out any messages that do not meet this criteria and filling in
 * placeholders for empty tool result parts.
 * @param messages The messages to process
 * @returns
 */
export function processMessages(messages: vscode.LanguageModelChatMessage2[]) {
	return messages
		// Remove messages that have no content
		.filter(hasContent)
		// Remove empty text parts from messages that have other non-empty content
		.map(removeEmptyTextParts)
		// Process empty tool results, replacing them with a placeholder
		.map(processEmptyToolResults);
}

/**
 * Convert a LanguageModelPromptTsxPart to a string representation.
 *
 * This is used to render the result of some Copilot tools (which return Prompt
 * TSX) parts into strings we can pass to other providers
 *
 * @param part The PromptTSX part to convert
 * @returns A string representation of the PromptTSX part
 */
export function promptTsxPartToString(part: vscode.LanguageModelPromptTsxPart): string {
	let text: string;
	try {
		// Try to convert the PromptElementJSON to a string
		if (part.value && typeof part.value === 'object' && 'node' in part.value) {
			// This is a PromptElementJSON structure
			const element = part.value as JSONTree.PromptElementJSON;
			text = stringifyPromptElementJSON(element);
		} else {
			// Fallback to JSON stringify for other structures
			text = JSON.stringify(part.value, null, 2);
		}
	} catch (error) {
		log.warn(`Failed to convert PromptTsxPart to string: ${error}`);
		text = '[PromptTsxPart could not be rendered]';
	}

	log.trace(`Converted PromptTsxPart to string: ${text}`);
	return text;
}

/**
 * Simple implementation of stringifyPromptElementJSON for converting PromptTSX
 * to text.
 *
 * @param element The PromptElementJSON to stringify
 * @returns A string representation of the element
 */
function stringifyPromptElementJSON(element: JSONTree.PromptElementJSON): string {
	const strs: string[] = [];
	stringifyPromptNodeJSON(element.node, strs);
	return strs.join('');
}

/**
 * Recursively stringify a PromptNodeJSON into an array of strings.
 *
 * @param node The PromptNodeJSON to stringify
 * @param strs The array to append strings to
 */
function stringifyPromptNodeJSON(node: JSONTree.PromptNodeJSON, strs: string[]): void {
	if (node.type === JSONTree.PromptNodeType.Text) {
		if (node.lineBreakBefore) {
			strs.push('\n');
		}
		if (typeof node.text === 'string') {
			strs.push(node.text);
		}
	} else if (node.type === JSONTree.PromptNodeType.Piece) {
		if (node.ctor === JSONTree.PieceCtorKind.ImageChatMessage) {
			strs.push('<image>');
		} else if (node.ctor === JSONTree.PieceCtorKind.BaseChatMessage || node.ctor === JSONTree.PieceCtorKind.Other) {
			for (const child of node.children) {
				stringifyPromptNodeJSON(child, strs);
			}
		}
	} else if (node.type === JSONTree.PromptNodeType.Opaque) {
		// For opaque nodes, try to convert the value to string
		const opaqueNode = node as JSONTree.OpaqueJSON;
		if (typeof opaqueNode.value === 'string') {
			strs.push(opaqueNode.value);
		} else if (opaqueNode.value) {
			strs.push(JSON.stringify(opaqueNode.value));
		}
	} else {
		// Should not happen since all node types are handled, but as a fallback
		// just stringify the whole node and shove it in the array
		const content = JSON.stringify(node);
		log.warn(`Unexpected node in Prompt TSX; using raw content: ${content}`);
		strs.push(content);
	}
}

// This type definition is from Vercel AI, but the type is not exported.
type ToolResultContent = Array<
	| {
		type: 'text';
		text: string;
	}
	| {
		type: 'image';
		data: string;
		mimeType?: string;
	}
>;

/** Whether a chat request is from an inline editor context. */
export function isTextEditRequest(request: vscode.ChatRequest):
	request is vscode.ChatRequest & { location2: vscode.ChatRequestEditorData } {
	return request.location2 instanceof vscode.ChatRequestEditorData;
}

/**
 * Convert a URI to a string suitable for language models.
 *
 * Currently, file URIs are converted to workspace-relative paths and
 * other URIs are converted to their string representation.
 */
export function uriToString(uri: vscode.Uri): string {
	if (uri.scheme === 'file') {
		return vscode.workspace.asRelativePath(uri);
	}
	return uri.toString();
}

/**
 * Checks if there is an open workspace folder.
 * This is useful to determine if certain tools can be used, as they require an open workspace folder.
 * @returns Whether there is an open workspace folder.
 */
export function isWorkspaceOpen(): boolean {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	return !!workspaceFolders && workspaceFolders.length > 0;
}

/**
 * Checks if a given language model part defines a cache breakpoint.
 */
export function isCacheBreakpointPart(part: unknown): part is vscode.LanguageModelDataPart & { mimeType: LanguageModelDataPartMimeType.CacheControl } {
	return part instanceof vscode.LanguageModelDataPart &&
		part.mimeType === LanguageModelDataPartMimeType.CacheControl;
}

/**
 * Parses a LanguageModelDataPart representing a cache breakpoint.
 *
 * @param part The LanguageModelDataPart to parse.
 * @returns The parsed cache breakpoint.
 * @throws Will throw an error if the part's mimeType is not JSON, if the JSON parsing fails,
 *   or if the parsed data does not match the expected schema.
 */
export function parseCacheBreakpoint(part: vscode.LanguageModelDataPart): LanguageModelCacheBreakpoint {
	if (part.mimeType !== LanguageModelDataPartMimeType.CacheControl) {
		throw new Error(`Expected LanguageModelDataPart with mimeType ${LanguageModelDataPartMimeType.CacheControl}, but got ${part.mimeType}`);
	}

	// By matching the Copilot extension, other extensions that use models from either Copilot
	// or Positron Assistant can set cache breakpoints with the same schema.
	// See: https://github.com/microsoft/vscode-copilot-chat/blob/6aeac371813be9037e74395186ec5b5b94089245/src/extension/byok/vscode-node/anthropicMessageConverter.ts#L22
	const type = part.data.toString();
	if (!(type === LanguageModelCacheBreakpointType.Ephemeral)) {
		throw new Error(`Expected LanguageModelDataPart to contain a LanguageModelCacheBreakpoint, but got: ${type}`);
	}

	return { type };
}

/**
 * Create a language model part that represents a cache control point.
 * @returns A language model part representing the cache control point.
 */
export function languageModelCacheBreakpointPart(): vscode.LanguageModelDataPart {
	// By matching the Copilot extension, other extensions that use models from either Copilot
	// or Positron Assistant can set cache breakpoints with the same schema.
	// See: https://github.com/microsoft/vscode-copilot-chat/blob/6aeac371813be9037e74395186ec5b5b94089245/src/extension/byok/vscode-node/anthropicMessageConverter.ts#L22
	return vscode.LanguageModelDataPart.text(LanguageModelCacheBreakpointType.Ephemeral, LanguageModelDataPartMimeType.CacheControl);
}

/**
 * Type guard to check if a reference is a RuntimeSessionReference.
 *
 * This function validates that the reference object has the expected structure
 * of a RuntimeSessionReference.
 */
export function isRuntimeSessionReference(value: unknown): value is RuntimeSessionReference {
	return typeof value === 'object' && value !== null &&
		'activeSession' in value &&
		'variables' in value &&
		Array.isArray(value.variables);
}

/**
 * Type guard to check if a reference is a prompt instructions file
 */
export function isPromptInstructionsReference(reference: unknown): reference is PromptInstructionsReference {
	return typeof reference === 'object' && reference !== null &&
		'modelDescription' in reference &&
		'name' in reference &&
		'id' in reference && typeof reference.id === 'string' &&
		'value' in reference && reference.value instanceof vscode.Uri &&
		reference.id.includes('vscode.prompt.instructions');
}

/**
 * Checks if an error is an authorization error (401/403).
 * @param error The error object to check.
 * @returns True if the error is an authorization error.
 */
export function isAuthorizationError(error: any): boolean {
	// Check for AI SDK APICallError with 401/403 status codes
	if (ai.APICallError.isInstance(error)) {
		const statusCode = error.statusCode;
		return statusCode === 401 || statusCode === 403;
	}

	// Check for fetch/network errors with status codes
	if (error?.status === 401 || error?.status === 403) {
		return true;
	}

	// Check error message for common authorization patterns
	const message = error?.message || '';
	const authPatterns = [
		'unauthorized',
		'authentication failed',
		'invalid token',
		'access denied',
		'forbidden',
		'401',
		'403'
	];

	return authPatterns.some(pattern =>
		message.toLowerCase().includes(pattern.toLowerCase())
	);
}
