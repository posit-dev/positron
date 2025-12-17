/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as ai from 'ai';
import * as vscode from 'vscode';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
	UnifiedStreamResult,
	UnifiedStreamPart,
	UnifiedToolCall,
	UnifiedUsage,
} from './llm-api.js';
import { log } from './extension.js';

// -----------------------------------------------------------------
// Message Conversion (AI SDK → vscode.lm)
// -----------------------------------------------------------------

/**
 * Convert AI SDK messages to vscode.lm format.
 *
 * Note: This uses VS Code proposed APIs (LanguageModelChatMessage2, etc.)
 * which are enabled via "enabledApiProposals" in package.json.
 */
export function toVSCodeMessages(messages: ai.ModelMessage[]): vscode.LanguageModelChatMessage[] {
	const result: vscode.LanguageModelChatMessage[] = [];

	for (const msg of messages) {
		switch (msg.role) {
			case 'system':
				// vscode.lm doesn't have a System helper in the standard API;
				// use User with system context prefix
				result.push(vscode.LanguageModelChatMessage.User(
					`[System Instructions]\n${msg.content}`
				));
				break;

			case 'user':
				result.push(toVSCodeUserMessage(msg));
				break;

			case 'assistant':
				result.push(toVSCodeAssistantMessage(msg));
				break;

			case 'tool':
				// Tool results: add as user messages with tool result content
				for (const part of msg.content) {
					result.push(toVSCodeToolResultMessage(part));
				}
				break;
		}
	}

	return result;
}

function toVSCodeUserMessage(msg: ai.UserModelMessage): vscode.LanguageModelChatMessage {
	if (typeof msg.content === 'string') {
		return vscode.LanguageModelChatMessage.User(msg.content);
	}

	// Multi-part content: extract text parts, log warning for unsupported types
	const textParts = msg.content
		.filter((part): part is ai.TextPart => part.type === 'text')
		.map(part => part.text);

	const hasUnsupported = msg.content.some(part => part.type !== 'text');
	if (hasUnsupported) {
		log.warn('[copilot-adapter] Non-text parts in user message are not supported by Copilot');
	}

	return vscode.LanguageModelChatMessage.User(textParts.join('\n'));
}

function toVSCodeAssistantMessage(msg: ai.AssistantModelMessage): vscode.LanguageModelChatMessage {
	if (typeof msg.content === 'string') {
		return vscode.LanguageModelChatMessage.Assistant(msg.content);
	}

	// Extract text content; tool calls are handled separately in the conversation flow
	const textParts = msg.content
		.filter((part): part is ai.TextPart => part.type === 'text')
		.map(part => part.text);

	return vscode.LanguageModelChatMessage.Assistant(textParts.join('\n'));
}

function toVSCodeToolResultMessage(part: ai.ToolResultPart): vscode.LanguageModelChatMessage {
	// Format tool result as a user message (vscode.lm convention)
	const resultStr = typeof part.output === 'string'
		? part.output
		: JSON.stringify(part.output);

	return vscode.LanguageModelChatMessage.User(
		`[Tool Result: ${part.toolName}]\n${resultStr}`
	);
}

// -----------------------------------------------------------------
// Tool Conversion (AI SDK → vscode.lm)
// -----------------------------------------------------------------

/**
 * Convert AI SDK tools to vscode.lm format.
 *
 * AI SDK tools created with ai.tool({ inputSchema: z.object(...) }) store
 * Zod schemas. This converts them to JSON Schema for vscode.lm.
 */
export function toVSCodeTools(tools: Record<string, ai.Tool>): vscode.LanguageModelChatTool[] {
	return Object.entries(tools).map(([name, tool]) => {
		let inputSchema: Record<string, unknown>;

		// AI SDK v5 tools use inputSchema property
		const toolSchema = (tool as any).inputSchema;

		// Check if inputSchema is a Zod schema (has _def property)
		if (toolSchema && '_def' in toolSchema) {
			// Convert Zod schema to JSON Schema
			inputSchema = zodToJsonSchema(toolSchema) as Record<string, unknown>;
		} else if (toolSchema) {
			// Already JSON Schema or plain object
			inputSchema = toolSchema as Record<string, unknown>;
		} else {
			// Default empty schema
			inputSchema = {
				type: 'object',
				properties: {},
			};
		}

		return {
			name,
			description: tool.description ?? '',
			inputSchema,
		};
	});
}

// -----------------------------------------------------------------
// Response Wrapping (vscode.lm → Unified format)
// -----------------------------------------------------------------

/**
 * Wrap a vscode.lm response as UnifiedStreamResult with TRUE streaming.
 *
 * Unlike a buffered approach, this yields parts as they arrive from
 * the underlying response stream.
 */
export function wrapVSCodeStreamAsUnified(
	response: vscode.LanguageModelChatResponse
): UnifiedStreamResult {
	// Shared state updated as we stream
	let accumulatedText = '';
	const toolCalls: UnifiedToolCall[] = [];
	let streamConsumed = false;

	// Promise resolvers for final values
	let resolveText!: (value: string) => void;
	let resolveToolCalls!: (value: UnifiedToolCall[]) => void;
	let resolveUsage!: (value: UnifiedUsage) => void;
	let rejectAll!: (error: unknown) => void;

	const textPromise = new Promise<string>((resolve, reject) => {
		resolveText = resolve;
		rejectAll = reject;
	});
	const toolCallsPromise = new Promise<UnifiedToolCall[]>((resolve) => {
		resolveToolCalls = resolve;
	});
	const usagePromise = new Promise<UnifiedUsage>((resolve) => {
		resolveUsage = resolve;
	});

	// Create the fullStream generator that processes the vscode.lm stream
	async function* createFullStream(): AsyncGenerator<UnifiedStreamPart> {
		if (streamConsumed) {
			throw new Error('Stream has already been consumed. Create a new request to stream again.');
		}
		streamConsumed = true;

		try {
			for await (const part of response.stream) {
				if (part instanceof vscode.LanguageModelTextPart) {
					accumulatedText += part.value;
					yield { type: 'text-delta', textDelta: part.value };
				} else if (part instanceof vscode.LanguageModelToolCallPart) {
					const toolCall: UnifiedToolCall = {
						toolCallId: part.callId,
						toolName: part.name,
						args: part.input,
					};
					toolCalls.push(toolCall);
					yield {
						type: 'tool-call',
						toolCallId: toolCall.toolCallId,
						toolName: toolCall.toolName,
						args: toolCall.args,
					};
				}
				// Note: vscode.lm may have other part types; ignore unknown ones
			}

			// Stream completed successfully
			// Emit finish event
			const usage: UnifiedUsage = {
				inputTokens: 0,  // vscode.lm doesn't expose token counts
				outputTokens: 0,
			};
			yield { type: 'finish', finishReason: 'stop', usage };

			// Resolve all promises
			resolveText(accumulatedText);
			resolveToolCalls(toolCalls);
			resolveUsage(usage);

		} catch (error) {
			yield { type: 'error', error };
			rejectAll(error);
			throw error;
		}
	}

	// The fullStream is a shared generator - we need to handle both
	// fullStream and textStream potentially being consumed
	let fullStreamGenerator: AsyncGenerator<UnifiedStreamPart> | null = null;
	const bufferedParts: UnifiedStreamPart[] = [];
	let streamStarted = false;
	let streamEnded = false;
	let fullStreamIteratorCreated = false;
	let textStreamIteratorCreated = false;

	// Create a function to ensure the stream is running and buffer parts
	async function ensureStreamStarted(): Promise<void> {
		if (streamStarted) {
			return;
		}
		streamStarted = true;
		fullStreamGenerator = createFullStream();

		// Consume the generator and buffer all parts
		try {
			for await (const part of fullStreamGenerator) {
				bufferedParts.push(part);
			}
		} catch (error) {
			// Error already handled in generator
		}
		streamEnded = true;
	}

	// Create async iterable that yields from buffer or waits for new parts
	function createBufferedFullStream(): AsyncIterable<UnifiedStreamPart> {
		return {
			[Symbol.asyncIterator](): AsyncIterator<UnifiedStreamPart> {
				if (fullStreamIteratorCreated && textStreamIteratorCreated) {
					throw new Error('Stream has already been fully consumed.');
				}
				fullStreamIteratorCreated = true;

				let index = 0;

				return {
					async next(): Promise<IteratorResult<UnifiedStreamPart>> {
						// Ensure stream is started
						if (!streamStarted) {
							// Start consuming the stream in background
							ensureStreamStarted();
						}

						// Wait for parts to be available
						while (index >= bufferedParts.length && !streamEnded) {
							await new Promise(resolve => setTimeout(resolve, 10));
						}

						if (index < bufferedParts.length) {
							return { value: bufferedParts[index++], done: false };
						}

						return { value: undefined as any, done: true };
					}
				};
			}
		};
	}

	// Create textStream that filters to just text deltas
	function createBufferedTextStream(): AsyncIterable<string> {
		return {
			[Symbol.asyncIterator](): AsyncIterator<string> {
				if (fullStreamIteratorCreated && textStreamIteratorCreated) {
					throw new Error('Stream has already been fully consumed.');
				}
				textStreamIteratorCreated = true;

				let index = 0;

				return {
					async next(): Promise<IteratorResult<string>> {
						// Ensure stream is started
						if (!streamStarted) {
							ensureStreamStarted();
						}

						// Find next text-delta part
						while (true) {
							// Wait for parts to be available
							while (index >= bufferedParts.length && !streamEnded) {
								await new Promise(resolve => setTimeout(resolve, 10));
							}

							if (index >= bufferedParts.length) {
								return { value: undefined as any, done: true };
							}

							const part = bufferedParts[index++];
							if (part.type === 'text-delta') {
								return { value: part.textDelta, done: false };
							}
							// Skip non-text parts
						}
					}
				};
			}
		};
	}

	return {
		fullStream: createBufferedFullStream(),
		textStream: createBufferedTextStream(),
		text: textPromise,
		toolCalls: toolCallsPromise,
		usage: usagePromise,
	};
}
