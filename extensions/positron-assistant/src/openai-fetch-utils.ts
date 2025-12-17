/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { log } from './extension.js';
import type { OpenAI } from 'openai';

/**
 * Types representing potentially malformed ChatCompletionChunk responses from OpenAI-compatible
 * providers. These types relax the strict OpenAI SDK types to accept known deviations that
 * cause validation errors in the AI SDK.
 *
 * Known issues from providers (e.g., Snowflake Cortex):
 *
 * 1. Empty role field:
 *    - Expected: `{ "role": "assistant" }`
 *    - Broken:   `{ "role": "" }`
 *
 * 2. Empty tool arguments for no-parameter tools:
 *    - Expected: `{ "arguments": "{}" }`
 *    - Broken:   `{ "arguments": "" }`
 */

/**
 * Relaxed tool call function type.
 * - `arguments` is optional (may be missing or empty string instead of valid JSON)
 */
type PossiblyBrokenToolCallFunction = Omit<OpenAI.ChatCompletionChunk.Choice.Delta.ToolCall.Function, 'arguments'> & {
	arguments?: string;
};

/**
 * Relaxed tool call type.
 * - `function` uses the relaxed PossiblyBrokenToolCallFunction type
 */
type PossiblyBrokenToolCall = Omit<OpenAI.ChatCompletionChunk.Choice.Delta.ToolCall, 'function'> & {
	function: PossiblyBrokenToolCallFunction;
};

/**
 * Relaxed delta type.
 * - `role` accepts empty string '' (some providers send `"role": ""` instead of `"assistant"`)
 * - `tool_calls` uses relaxed PossiblyBrokenToolCall type
 */
type PossiblyBrokenDelta = Omit<OpenAI.ChatCompletionChunk.Choice.Delta, 'role' | 'tool_calls'> & {
	role?: OpenAI.ChatCompletionChunk.Choice.Delta['role'] | '';
	tool_calls?: Array<PossiblyBrokenToolCall>;
};

/**
 * Relaxed ChatCompletionChunk type that uses PossiblyBrokenDelta for choices.
 */
export type PossiblyBrokenChatCompletionChunk = Omit<OpenAI.ChatCompletionChunk, 'choices'> & {
	choices: Array<Omit<OpenAI.ChatCompletionChunk.Choice, 'delta'> & {
		delta: PossiblyBrokenDelta;
	}>;
};


/**
 * Fixes a possibly broken ChatCompletionChunk by ensuring all required fields exist
 * with valid types. This converts a PossiblyBrokenChatCompletionChunk into a proper OpenAI.ChatCompletionChunk.
 * @param chunk The possibly broken chunk to fix
 * @returns A properly typed OpenAI.ChatCompletionChunk with all required fields populated
 */
export function fixPossiblyBrokenChatCompletionChunk(
	chunk: PossiblyBrokenChatCompletionChunk,
	noArgTools: string[] = [],
	providerName?: string): OpenAI.ChatCompletionChunk {

	const choices: OpenAI.ChatCompletionChunk.Choice[] = chunk.choices.map((choice) => {
		// Fix empty tool arguments: some providers return '' for no-parameter tools,
		// but the AI SDK expects valid JSON '{}'
		const fixedToolCalls = choice.delta.tool_calls?.map((toolCall) => {
			const { name, arguments: args } = toolCall.function;
			const isNoArgTool = name && noArgTools.includes(name);
			const hasEmptyArgs = args === '';

			if (isNoArgTool && hasEmptyArgs) {
				log.debug(`[${providerName}] Converting empty tool arguments to '{}' for tool: ${name}`);
				return { ...toolCall, function: { ...toolCall.function, arguments: '{}' } };
			}
			return toolCall;
		});

		return {
			...choice,
			delta: {
				...choice.delta,
				// Fix empty role: some providers return '' but AI SDK expects 'assistant'
				role: choice.delta.role || 'assistant',
				...(fixedToolCalls && { tool_calls: fixedToolCalls }),
			},
		};
	});



	return {
		id: chunk.id,
		choices,
		created: chunk.created,
		model: chunk.model,
		object: 'chat.completion.chunk',
		service_tier: chunk.service_tier,
		system_fingerprint: chunk.system_fingerprint,
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
		'id' in obj &&
		'created' in obj &&
		'model' in obj &&
		'choices' in obj &&
		Array.isArray(obj.choices) &&
		'object' in obj &&
		obj.object === 'chat.completion.chunk'
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
					const fixedChunk = fixPossiblyBrokenChatCompletionChunk(data, noArgTools, providerName);
					transformedLines.push(`data: ${JSON.stringify(fixedChunk)}`);
				} else {
					transformedLines.push(line);
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
