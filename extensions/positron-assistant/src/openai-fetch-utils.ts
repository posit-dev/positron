/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { log } from './extension.js';

/**
 * Creates a custom fetch function for OpenAI-compatible providers that handles:
 * 1. Request body transformations (max_tokens -> max_completion_tokens, temperature removal)
 *     - This is a stop-gap solution until we update to AI SDK v5, which addresses these issues.
 * 2. Response transformations (empty role fields -> "assistant")
 */
export function createOpenAICompatibleFetch(providerName: string): (input: RequestInfo, init?: RequestInit) => Promise<Response> {
	return async (input: RequestInfo, init?: RequestInit): Promise<Response> => {
		// Handle request body transformations
		if (init?.method === 'POST' && init?.body) {
			init = transformRequestBody(init, providerName);
		}

		log.debug(`[${providerName}] [DEBUG] Making request to: ${input}`);
		const response = await fetch(input, init);
		log.debug(`[${providerName}] [DEBUG] Response status: ${response.status} ${response.statusText}`);

		// Handle response transformations for streaming responses
		return transformStreamingResponse(response, providerName);
	};
}

/**
 * Transforms the request body to handle OpenAI API deprecations and compatibility issues
 */
function transformRequestBody(init: RequestInit, providerName: string): RequestInit {
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

		// Remove temperature parameter, as the default 0 value is not supported by some models.
		// `temperature` is no longer set to 0 by default in AI SDK v5.
		// Example error message without this fix:
		// [OpenAI] [gpt-5]' Error in chat response: {"error":{"message":"Unsupported value: 'temperature' does not support 0 with this model. Only the default (1) value is supported.","type":"invalid_request_error","param":"temperature","code":"unsupported_value"}}
		if (requestBody.temperature !== undefined) {
			log.debug(`[${providerName}] [DEBUG] Removing temperature parameter to avoid unsupported value error`);
			delete requestBody.temperature;
			bodyModified = true;
		}

		if (bodyModified) {
			log.debug(`[${providerName}] [DEBUG] Final request body:`, JSON.stringify(requestBody, null, 2));
			return {
				...init,
				body: JSON.stringify(requestBody)
			};
		}
	} catch (error) {
		// If we can't parse the body, just proceed with the original request
		log.warn(`[${providerName}] Failed to parse request body for parameter handling: ${error}`);
	}

	return init;
}

/**
 * Transforms streaming responses to fix OpenAI-compatible provider issues
 */
function transformStreamingResponse(response: Response, providerName: string): Response {
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
				const transformedText = transformServerSentEvents(text, providerName);
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
 * Transforms Server-Sent Events text by properly parsing JSON and fixing empty role fields
 */
function transformServerSentEvents(text: string, providerName: string): string {
	const lines = text.split('\n');
	const transformedLines: string[] = [];

	for (const line of lines) {
		// Only process data lines that contain JSON (skip empty lines, comments, [DONE], etc.)
		if (line.startsWith('data: ') && !line.includes('[DONE]')) {
			try {
				const jsonStr = line.slice(6); // Remove 'data: ' prefix
				const data = JSON.parse(jsonStr);

				// Fix empty role fields in delta objects within choices array
				if (data.choices && Array.isArray(data.choices)) {
					for (const choice of data.choices) {
						if (choice.delta && typeof choice.delta === 'object' && choice.delta.role === '') {
							choice.delta.role = 'assistant';
						}
					}
				}

				transformedLines.push(`data: ${JSON.stringify(data)}`);
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
