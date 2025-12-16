/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { log } from './extension.js';
import type { OpenAI } from 'openai';

/**
 * A "possibly broken" ChatCompletionChunk type that represents what we might receive
 * from OpenAI-compatible providers before validation. All fields are optional or loosely typed
 * to allow for malformed responses.
 */
export interface PossiblyBrokenChatCompletionChunk {
	id?: unknown;
	choices?: unknown;
	created?: unknown;
	model?: unknown;
	object?: unknown;
	service_tier?: unknown;
	system_fingerprint?: unknown;
	usage?: unknown;
}

/**
 * Fixes a possibly broken ChatCompletionChunk by ensuring all required fields exist
 * with valid types. This converts a PossiblyBrokenChatCompletionChunk into a proper OpenAI.ChatCompletionChunk.
 * @param chunk The possibly broken chunk to fix
 * @returns A properly typed OpenAI.ChatCompletionChunk with all required fields populated
 */
export function fixPossiblyBrokenChatCompletionChunk(chunk: PossiblyBrokenChatCompletionChunk, noArgTools: string[] = []): OpenAI.ChatCompletionChunk {
	// Fix id - ensure it's a string
	const id = typeof chunk.id === 'string' ? chunk.id : '';

	// Fix created - ensure it's a number
	const created = typeof chunk.created === 'number' ? chunk.created : 0;

	// Fix model - ensure it's a string
	const model = typeof chunk.model === 'string' ? chunk.model : '';

	// Fix service_tier - ensure it's a valid service tier or undefined
	const service_tier = (chunk.service_tier === 'scale' || chunk.service_tier === 'default' || chunk.service_tier === 'auto' || chunk.service_tier === 'flex')
		? chunk.service_tier
		: undefined;

	// Fix system_fingerprint - ensure it's a string or undefined
	const system_fingerprint = typeof chunk.system_fingerprint === 'string' ? chunk.system_fingerprint : undefined;

	// Fix choices - ensure it's an array with proper structure
	const choices: OpenAI.ChatCompletionChunk.Choice[] = [];
	if (Array.isArray(chunk.choices)) {
		for (const choice of chunk.choices) {
			if (typeof choice === 'object' && choice !== null) {
				const c = choice as Record<string, unknown>;
				const delta = typeof c.delta === 'object' && c.delta !== null
					? c.delta as Record<string, unknown>
					: {};

				// Fix empty role field - AI SDK expects 'assistant'
				const fixedRole: 'assistant' | 'developer' | 'system' | 'user' | 'tool' =
					(delta.role === '' || delta.role === undefined) ? 'assistant' :
						(delta.role === 'assistant' || delta.role === 'developer' || delta.role === 'system' || delta.role === 'user' || delta.role === 'tool') ? delta.role :
							'assistant';

				// Build the delta
				const fixedDelta: OpenAI.ChatCompletionChunk.Choice.Delta = {
					content: typeof delta.content === 'string' ? delta.content : (delta.content === null ? null : undefined),
					refusal: typeof delta.refusal === 'string' ? delta.refusal : (delta.refusal === null ? null : undefined),
					role: fixedRole,
				};

				// Fix tool_calls if present
				if (Array.isArray(delta.tool_calls)) {
					fixedDelta.tool_calls = delta.tool_calls.map((tc: unknown): OpenAI.ChatCompletionChunk.Choice.Delta.ToolCall => {
						if (typeof tc === 'object' && tc !== null) {
							const toolCall = tc as Record<string, unknown>;
							const fn = typeof toolCall.function === 'object' && toolCall.function !== null
								? toolCall.function as Record<string, unknown>
								: undefined;

							// Fix empty type field - AI SDK expects 'function'
							const fixedType: 'function' | undefined = toolCall.type === '' ? 'function' : (toolCall.type === 'function' ? 'function' : undefined);

							// Fix empty arguments - AI SDK's isParsableJson check will fail for empty strings
							// Only fix if the tool is known to take no arguments, to avoid breaking streaming arguments
							const toolName = fn?.name;
							const isNoArgTool = typeof toolName === 'string' && noArgTools.includes(toolName);
							const fixedArguments = fn && typeof fn.arguments === 'string'
								? (fn.arguments === '' && isNoArgTool ? '{}' : fn.arguments)
								: undefined;

							return {
								index: typeof toolCall.index === 'number' ? toolCall.index : 0,
								id: typeof toolCall.id === 'string' ? toolCall.id : undefined,
								type: fixedType,
								function: fn ? {
									name: typeof fn.name === 'string' ? fn.name : undefined,
									arguments: fixedArguments,
								} : undefined,
							};
						}
						return { index: 0 };
					});
				}

				// Fix finish_reason
				const finishReason = c.finish_reason;
				const validFinishReasons = ['stop', 'length', 'tool_calls', 'content_filter', 'function_call'];
				const fixedFinishReason = (typeof finishReason === 'string' && validFinishReasons.includes(finishReason))
					? finishReason as OpenAI.ChatCompletionChunk.Choice['finish_reason']
					: null;

				// Build the fixed choice
				const fixedChoice: OpenAI.ChatCompletionChunk.Choice = {
					index: typeof c.index === 'number' ? c.index : 0,
					delta: fixedDelta,
					finish_reason: fixedFinishReason,
					logprobs: c.logprobs as OpenAI.ChatCompletionChunk.Choice['logprobs'],
				};

				choices.push(fixedChoice);
			}
		}
	}

	return {
		id,
		choices,
		created,
		model,
		object: 'chat.completion.chunk',
		service_tier,
		system_fingerprint,
		usage: chunk.usage as OpenAI.CompletionUsage | undefined,
	};
}

/**
 * Type guard to check if an object might be a ChatCompletionChunk, even if malformed.
 * This is a permissive check that only verifies the object has the basic shape
 * of a chat completion chunk (has 'object' field equal to 'chat.completion.chunk').
 * @param obj The object to check
 * @returns True if the object appears to be a ChatCompletionChunk (possibly malformed)
 */
function isChatCompletionChunk(obj: unknown): obj is PossiblyBrokenChatCompletionChunk {
	return (
		typeof obj === 'object' &&
		obj !== null &&
		Array.isArray((obj as OpenAI.ChatCompletionChunk).choices) &&
		(obj as OpenAI.ChatCompletionChunk).object === 'chat.completion.chunk'
	);
}

/**
 * Creates a custom fetch function for OpenAI-compatible providers that handles:
 * 1. Request body transformations (max_tokens -> max_completion_tokens for Snowflake compatibility)
 * 2. Response transformations (empty role fields -> "assistant")
 */
export function createOpenAICompatibleFetch(providerName: string): (input: RequestInfo, init?: RequestInit) => Promise<Response> {
	return async (input: RequestInfo, init?: RequestInit): Promise<Response> => {
		log.debug(`[${providerName}] [DEBUG] Making request to: ${input}`);

		let noArgTools: string[] = [];

		// Transform the request body if needed
		const transformedInit = transformRequestBody(init, providerName, (tools) => {
			noArgTools = tools;
		});

		const response = await fetch(input, transformedInit);
		log.debug(`[${providerName}] [DEBUG] Response status: ${response.status} ${response.statusText}`);

		// Handle response transformations for streaming responses
		return transformStreamingResponse(response, providerName, noArgTools);
	};
}

/**
 * Transforms the request body to fix OpenAI-compatible provider issues.
 * Specifically, converts max_tokens to max_completion_tokens for providers like Snowflake
 * that require the newer parameter name.
 */
function transformRequestBody(init: RequestInit | undefined, providerName: string, onNoArgToolsFound?: (noArgTools: string[]) => void): RequestInit | undefined {
	if (!init?.body || typeof init.body !== 'string') {
		return init;
	}

	try {
		const bodyStr = typeof init.body === 'string' ? init.body : JSON.stringify(init.body);
		const requestBody = JSON.parse(bodyStr);

		log.debug(`[${providerName}] [DEBUG] Original request body:`, JSON.stringify(requestBody, null, 2));

		let bodyModified = false;

		// If max_tokens is present, rename it to max_completion_tokens, as max_tokens
		// is deprecated for models such as GPT-5.
		// This property is now called max_completion_tokens in the AI SDK v5.
		// Example error message without this fix:
		// [OpenAI] [gpt-5]' Error in chat response: {"error":{"message":"Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.","type":"invalid_request_error","param":"max_tokens","code":"unsupported_parameter"}}
		if (requestBody.max_tokens !== undefined) {
			log.debug(`[${providerName}] [DEBUG] Converting max_tokens (${requestBody.max_tokens}) to max_completion_tokens`);
			requestBody.max_completion_tokens = requestBody.max_tokens;
			delete requestBody.max_tokens;
			bodyModified = true;
		}

		// Transform tools to be compatible with OpenAI-compatible providers
		// Some providers don't support the 'strict' field in tool function definitions
		if (requestBody.tools && Array.isArray(requestBody.tools)) {
			log.debug(`[${providerName}] Request contains ${requestBody.tools.length} tools: ${requestBody.tools.map((t: any) => t.function?.name || t.name).join(', ')}`);

			// Identify tools that take no arguments
			// These tools will have their empty argument strings fixed in the response transformer
			const noArgTools = requestBody.tools
				.filter((t: any) => {
					const params = t.function?.parameters;
					// Check if parameters is empty or has no properties
					return !params || !params.properties || Object.keys(params.properties).length === 0;
				})
				.map((t: any) => t.function?.name);

			if (onNoArgToolsFound && noArgTools.length > 0) {
				onNoArgToolsFound(noArgTools);
			}

			for (const tool of requestBody.tools) {
				if (tool.function && tool.function.strict !== undefined) {
					delete tool.function.strict;
					log.debug(`[${providerName}] Removed 'strict' field from tool: ${tool.function.name}`);
				}
			}
			log.trace(`[${providerName}] Tools payload: ${JSON.stringify(requestBody.tools)}`);
		}

		return {
			...init,
			body: JSON.stringify(requestBody)
		};
	} catch (parseError) {
		// If we can't parse the body, return unchanged
		log.debug(`[${providerName}] Could not parse request body for transformation`);
		return init;
	}
}

/**
 * Transforms streaming responses to fix OpenAI-compatible provider issues
 */
function transformStreamingResponse(response: Response, providerName: string, noArgTools: string[] = []): Response {
	// Only process streaming responses
	const contentType = response.headers.get('content-type');
	if (!contentType?.includes('text/event-stream')) {
		return response;
	}

	// Fix empty role fields in streaming responses - some providers (like Snowflake Cortex)
	// return empty role fields, but the AI SDK expects "assistant".
	// Example error message without this fix:
	// [Snowflake Cortex] [GPT-5]' Error in chat response: { "name": "AI_TypeValidationError", "cause": { "issues": [ { "code": "invalid_union", "unionErrors": [ { "issues": [ { "received": "", "code": "invalid_enum_value", "options": [ "assistant" ], "path": [ "choices", 0, "delta", "role" ], "message": "Invalid enum value. Expected 'assistant', received ''" } ], "name": "ZodError" }, { "issues": [ { "code": "invalid_type", "expected": "object", "received": "undefined", "path": [ "error" ], "message": "Required" } ], "name": "ZodError" } ], "path": [], "message": "Invalid input" } ], "name": "ZodError" }, "value": { "choices": [ { "delta": { "content": "Hi", "refusal": "", "role": "", "tool_calls": null }, "index": 0, "logprobs": { "content": null, "refusal": null } } ], "created": 1763996710, "id": "chatcmpl-CfSPmojQUpCNSwEMdoKfgxjEF9rnS", "model": "openai-gpt-5", "object": "chat.completion.chunk", "service_tier": "", "system_fingerprint": "" } }
	const transformedStream = response.body?.pipeThrough(
		new TransformStream({
			transform(chunk, controller) {
				const text = new TextDecoder().decode(chunk);
				const transformedText = transformServerSentEvents(text, providerName, noArgTools);
				controller.enqueue(new TextEncoder().encode(transformedText));
			}
		})
	);

	return new Response(transformedStream, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers
	});
}

/**
 * Transforms Server-Sent Events text by properly parsing JSON and fixing ChatCompletionChunks
 */
function transformServerSentEvents(text: string, providerName: string, noArgTools: string[] = []): string {
	const lines = text.split('\n');
	const transformedLines: string[] = [];

	for (const line of lines) {
		// Only process data lines that contain JSON (skip empty lines, comments, [DONE], etc.)
		if (line.startsWith('data: ') && !line.includes('[DONE]')) {
			try {
				const jsonStr = line.slice(6); // Remove 'data: ' prefix
				const data = JSON.parse(jsonStr);
				// Check if it's a possibly broken chunk and fix it
				// Otherwise, keep the original line
				if (isChatCompletionChunk(data)) {
					const fixedChunk = fixPossiblyBrokenChatCompletionChunk(data, noArgTools);
					transformedLines.push(`data: ${JSON.stringify(fixedChunk)}`);
				} else {
					transformedLines.push(`data: ${JSON.stringify(data)}`);
				}

			} catch (parseError) {
				// If we can't parse the JSON, keep the original line
				// This handles malformed JSON or non-JSON data lines gracefully
				transformedLines.push(line);
			}
		} else {
			// Keep non-data lines as-is (empty lines, comments, [DONE], etc.)
			transformedLines.push(line);
		}
	}

	return transformedLines.join('\n');
}
