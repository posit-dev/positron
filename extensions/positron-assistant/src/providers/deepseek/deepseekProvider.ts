/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as ai from 'ai';
import { createDeepSeek, DeepSeekProvider } from '@ai-sdk/deepseek';
import { ModelProvider } from '../base/modelProvider';
import { ModelConfig } from '../../configTypes.js';
import { createOpenAICompatibleFetch } from '../../openai-fetch-utils';
import { createModelInfo, markDefaultModel } from '../../modelResolutionHelpers';
import { DEFAULT_MAX_TOKEN_INPUT, DEFAULT_MAX_TOKEN_OUTPUT } from '../../constants';
import { applyModelFilters } from '../../modelFilters';
import { PROVIDER_METADATA } from '../../providerMetadata.js';
import { getProviderTimeoutMs } from '../../providerConfig.js';
import { processMessages, toAIMessage } from '../../utils';

/**
 * DeepSeek model provider implementation.
 *
 * Uses @ai-sdk/deepseek for message conversion and direct API calls for
 * chat responses to support LanguageModelV3 (DeepSeek v4) which isn't
 * compatible with AI SDK 5's v2-only streamText/generateText.
 *
 * **Configuration:**
 * - Provider ID: `deepseek`
 * - Required: API key from DeepSeek Platform
 * - Optional: Base URL (for custom deployments), model selection
 * - Supports: Dynamic model listing from API
 *
 * @example
 * ```typescript
 * const config: ModelConfig = {
 *   id: 'deepseek-v4-pro',
 *   name: 'DeepSeek V4 Pro',
 *   provider: 'deepseek',
 *   apiKey: 'sk-...',
 *   model: 'deepseek-v4-pro',
 *   baseUrl: 'https://api.deepseek.com'
 * };
 * const provider = new DeepSeekModelProvider(config, context);
 * ```
 *
 * @see {@link ModelProvider} for base class documentation
 */
export class DeepSeekModelProvider extends ModelProvider implements positron.ai.LanguageModelChatProvider {
	/**
	 * The DeepSeek provider instance from Vercel AI SDK.
	 * Used for message conversion utilities.
	 */
	protected deepSeekProvider: DeepSeekProvider;

	/**
	 * Stores the reasoning_content from the last streaming response.
	 * Required for DeepSeek thinking mode when tool calls are used.
	 */
	private lastReasoningContent: string | undefined;

	/**
	 * Model name patterns to filter out (case-insensitive).
	 */
	public static readonly FILTERED_MODEL_PATTERNS = [
		'audio',
		'image',
		'moderation',
		'realtime',
		'search',
		'transcribe',
		'dall-e',
	] as const;

	static source: positron.ai.LanguageModelSource = {
		type: positron.PositronLanguageModelType.Chat,
		provider: PROVIDER_METADATA.deepseek,
		supportedOptions: ['apiKey', 'baseUrl', 'toolCalls'],
		defaults: {
			name: 'DeepSeek',
			model: 'deepseek-v4-pro',
			baseUrl: 'https://api.deepseek.com',
			toolCalls: true
		},
	};

	/**
	 * Creates a new DeepSeek provider instance.
	 */
	constructor(_config: ModelConfig, _context?: vscode.ExtensionContext) {
		super(_config, _context);
		this.initializeProvider();
	}

	/**
	 * Initializes the DeepSeek provider using the Vercel AI SDK.
	 */
	protected initializeProvider() {
		this.deepSeekProvider = createDeepSeek({
			apiKey: this._config.apiKey,
			baseURL: this.baseUrl,
			fetch: createOpenAICompatibleFetch(this.providerName, this._config.apiKey)
		});
	}

	/**
	 * Gets the base URL for the DeepSeek API.
	 */
	get baseUrl() {
		return (this._config.baseUrl ?? DeepSeekModelProvider.source.defaults.baseUrl)?.replace(/\/+$/, '');
	}

	/**
	 * Sends a test message using direct API calls instead of AI SDK.
	 *
	 * Overrides the base implementation because AI SDK 5's generateText
	 * doesn't support LanguageModelV3 (DeepSeek v4).
	 */
	protected override async sendTestMessage(modelId: string) {
		const url = `${this.baseUrl}/chat/completions`;
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		};
		if (this._config.apiKey) {
			headers['Authorization'] = `Bearer ${this._config.apiKey}`;
		}

		const response = await fetch(url, {
			method: 'POST',
			headers,
			body: JSON.stringify({
				model: modelId,
				messages: [{ role: 'user', content: 'Respond with just the word "hello".' }],
				max_tokens: 10,
				thinking: { type: 'disabled' },
			}),
			signal: AbortSignal.timeout(getProviderTimeoutMs()),
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`DeepSeek API error: ${response.status} ${response.statusText} - ${errorText}`);
		}

		const data = await response.json() as {
			choices?: Array<{
				message?: {
					content?: string | null;
					reasoning_content?: string | null;
				};
			}>;
		};
		// Prefer content for the answer, fall back to reasoning_content
		const message = data.choices?.[0]?.message;
		const content = message?.content ?? message?.reasoning_content;
		if (!content) {
			throw new Error(`Invalid response from DeepSeek API: ${JSON.stringify(data)}`);
		}

		return { text: content };
	}

	/**
	 * Provides language model chat information for available models.
	 */
	override async provideLanguageModelChatInformation(options: { silent: boolean }, token: vscode.CancellationToken) {
		this.logger.debug('Preparing language model chat information...');
		const models = await this.resolveModels(token) ?? [];
		this.logger.debug(`Resolved ${models.length} models.`);
		return this.filterModels(models);
	}

	/**
	 * Resolves available models from configuration or API.
	 */
	override async resolveModels(token: vscode.CancellationToken) {
		const configuredModels = this.retrieveModelsFromConfig();
		if (configuredModels) {
			return configuredModels;
		}

		try {
			this.logger.info('No configured models found, attempting to fetch from API...');
			const data = await this.fetchModelsFromAPI();
			if (!data?.data || !Array.isArray(data.data)) {
				this.logger.info('Request was successful, but no models were returned.');
				return undefined;
			}
			this.logger.info(`Successfully fetched ${data.data.length} models.`);

			const models = data.data.map((model: any) =>
				createModelInfo({
					id: model.id,
					name: model.id,
					family: this.providerId,
					version: model.id,
					provider: this.providerId,
					providerName: this.providerName,
					capabilities: this.capabilities,
					defaultMaxInput: model.maxInputTokens ?? DEFAULT_MAX_TOKEN_INPUT,
					defaultMaxOutput: model.maxOutputTokens ?? DEFAULT_MAX_TOKEN_OUTPUT
				})
			);

			return markDefaultModel(models, this.providerId, this._config.model);
		} catch (error) {
			this.logger.warn('Failed to fetch models from API', error);
			return undefined;
		}
	}

	/**
	 * Filters models to remove incompatible ones.
	 */
	override filterModels(models: vscode.LanguageModelChatInformation[]) {
		const removedModels: string[] = [];
		const filteredModels = applyModelFilters(models, this.providerId, this.providerName)
			.filter((model: any) => {
				const modelName = model.id.toLowerCase();
				const shouldRemove = DeepSeekModelProvider.FILTERED_MODEL_PATTERNS.some(pattern => {
					const regex = new RegExp(`\\b${pattern.toLowerCase()}\\b`, 'i');
					return regex.test(modelName);
				});
				if (shouldRemove) {
					removedModels.push(model.id);
				}
				return !shouldRemove;
			});

		if (removedModels.length > 0) {
			this.logger.debug(`Removed ${removedModels.length} incompatible models: ${removedModels.join(', ')}`);
		}

		return filteredModels;
	}

	/**
	 * Sets up tools (function calling) for the chat request.
	 */
	protected setupTools(tools: vscode.LanguageModelChatTool[]): Record<string, { description: string; inputSchema: Record<string, any> }> {
		return tools.reduce((acc, tool: vscode.LanguageModelChatTool) => {
			const baseSchema = tool.inputSchema as Record<string, any> ?? {};
			const missingFields: string[] = [];

			if (!baseSchema.type) {
				missingFields.push('type');
			}
			if (!baseSchema.properties) {
				missingFields.push('properties');
			}
			if (!baseSchema.required) {
				missingFields.push('required');
			}

			if (missingFields.length > 0) {
				this.logger.debug(`Tool '${tool.name}' missing fields: ${missingFields.join(', ')}. Adding defaults.`);
			}

			// DeepSeek requires a plain JSON Schema with type: "object"
			const inputSchema: Record<string, any> = {
				...baseSchema,
				type: baseSchema.type ?? 'object',
				properties: baseSchema.properties ?? {},
				required: baseSchema.required ?? [],
			};

			acc[tool.name] = {
				description: tool.description || '',
				inputSchema,
			};
			return acc;
		}, {} as Record<string, { description: string; inputSchema: Record<string, any> }>);
	}

	/**
	 * Provides chat response using direct API calls.
	 *
	 * Bypasses AI SDK 5's v2 model validation to support DeepSeek v4 (v3 spec).
	 */
	override async provideLanguageModelChatResponse(
		model: vscode.LanguageModelChatInformation,
		messages: vscode.LanguageModelChatMessage2[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
		token: vscode.CancellationToken
	) {
		const modelId = model.id;
		const modelOptions = options.modelOptions ?? {};

		const controller = new AbortController();
		const signal = controller.signal;

		token.onCancellationRequested(() => {
			controller.abort();
		});

		// Ensure all messages have content
		const processedMessages = processMessages(messages);

		// Add system prompt from modelOptions.system, if provided
		if (modelOptions.system) {
			processedMessages.unshift(new vscode.LanguageModelChatMessage(
				vscode.LanguageModelChatMessageRole.System,
				modelOptions.system
			));
		}

		// Convert messages to AI SDK format
		const aiMessages: ai.ModelMessage[] = toAIMessage(processedMessages, true, undefined);

		// Set up tools if provided
		const toolsRecord = options.tools && options.tools.length > 0 && this._config.toolCalls
			? this.setupTools([...options.tools])
			: undefined;

		const requestId = modelOptions.requestId;
		this.logger.debug(`[deepseek] Start request ${requestId} to ${model.name} [${model.id}]: ${aiMessages.length} messages`);

		try {
			const requestBody: Record<string, any> = {
				model: modelId,
				messages: aiMessages.map(msg => this.toDeepSeekMessage(msg)),
				stream: true,
				// Keep thinking enabled for coding assistance
			};

			if (toolsRecord) {
				requestBody.tools = Object.entries(toolsRecord).map(([name, tool]) => ({
					type: 'function',
					function: {
						name,
						description: tool.description,
						parameters: tool.inputSchema,
					},
				}));
			}

			if (modelOptions.temperature !== undefined) {
				requestBody.temperature = modelOptions.temperature;
			}
			if (modelOptions.maxTokens !== undefined) {
				requestBody.max_tokens = modelOptions.maxTokens;
			}

			const url = `${this.baseUrl}/chat/completions`;
			const headers: Record<string, string> = {
				'Content-Type': 'application/json',
			};
			if (this._config.apiKey) {
				headers['Authorization'] = `Bearer ${this._config.apiKey}`;
			}

			const response = await fetch(url, {
				method: 'POST',
				headers,
				body: JSON.stringify(requestBody),
				signal,
			});

			this.logger.debug(`[deepseek] Response status: ${response.status}`);
			if (!response.ok) {
				const errorText = await response.text();
				this.logger.error(`[deepseek] Error response body: ${errorText}`);
				throw new Error(`DeepSeek API error: ${response.status} ${response.statusText} - ${errorText}`);
			}

			if (!response.body) {
				throw new Error('No response body from DeepSeek API');
			}

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			let chunkCount = 0;
			let bufferedToolCalls = new Map<string, { name: string; args: string }>();
			// Clear reasoning content from previous requests - will be populated during streaming
			this.lastReasoningContent = undefined;

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed || !trimmed.startsWith('data: ')) {
						continue;
					}

					const data = trimmed.slice(6);
					if (data === '[DONE]') {
						this.logger.debug(`[deepseek] Received [DONE]`);
						continue;
					}

					chunkCount++;

					try {
						const parsed = JSON.parse(data) as {
							choices?: Array<{
								delta?: {
									content?: string;
									reasoning_content?: string;
									tool_calls?: Array<{
										id?: string;
										function?: { name?: string; arguments?: string };
									}>;
								};
								finish_reason?: string;
							}>;
						};

						const choice = parsed.choices?.[0];
						if (!choice?.delta) continue;

						// Capture reasoning_content from streaming for use in follow-up requests
						if (choice.delta.reasoning_content) {
							this.lastReasoningContent = (this.lastReasoningContent ?? '') + choice.delta.reasoning_content;
						}

						// Handle tool calls - buffer them until arguments are complete
						// Tool calls can come in multiple chunks: first ID/name, then arguments
						if (choice.delta.tool_calls) {
							for (const toolCallDelta of choice.delta.tool_calls) {
								const id = toolCallDelta.id ?? '';
								const name = toolCallDelta.function?.name ?? '';
								const args = toolCallDelta.function?.arguments ?? '';

								if (id || name) {
									// New tool call or continuation with ID/name
									const existing = bufferedToolCalls.get(id) ?? { name: '', args: '' };
									bufferedToolCalls.set(id, {
										name: name || existing.name,
										args: existing.args + args
									});
								} else if (args) {
									// Just arguments - append to first buffered tool call
									for (const [existingId, tc] of bufferedToolCalls.entries()) {
										tc.args += args;
										bufferedToolCalls.set(existingId, tc);
										break;
									}
								}
							}

							// Try to report any tool calls that have complete data
							for (const [id, tc] of bufferedToolCalls.entries()) {
								if (tc.name && tc.args && tc.args.trim()) {
									try {
										const parsedArgs = JSON.parse(tc.args);
										this.logger.debug(`[deepseek] Reporting tool call: ${id} (${tc.name})`);
										progress.report(new vscode.LanguageModelToolCallPart(id, tc.name, parsedArgs));
										bufferedToolCalls.delete(id);
									} catch {
										// JSON not complete yet, keep buffering
									}
								}
							}
						}

						// Handle regular content
						if (choice.delta.content) {
							progress.report(new vscode.LanguageModelTextPart(choice.delta.content));
						}
					} catch {
						// Skip malformed JSON
					}
				}
			}

			this.logger.debug(`[deepseek] Finished streaming, ${chunkCount} chunks received`);

			// Log the complete reasoning content from thinking mode
			if (this.lastReasoningContent) {
				this.logger.trace(`[deepseek] Reasoning (complete): ${this.lastReasoningContent}`);
			}

			// Handle remaining buffer
			if (buffer.trim() && buffer.startsWith('data: ')) {
				const data = buffer.slice(6);
				if (data !== '[DONE]') {
					try {
						const parsed = JSON.parse(data);
						const choice = parsed.choices?.[0];
						if (choice?.delta?.content) {
							this.logger.debug(`[deepseek] Reporting remaining content: ${choice.delta.content}`);
							progress.report(new vscode.LanguageModelTextPart(choice.delta.content));
						}
					} catch {
						// Skip
					}
				}
			}
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') {
				throw new vscode.CancellationError();
			}
			throw error;
		}
	}

	/**
	 * Fetches models from the DeepSeek API.
	 */
	private async fetchModelsFromAPI(): Promise<any> {
		const modelsUrl = `${this.baseUrl}/models`;
		this.logger.info(`Fetching models from ${modelsUrl}...`);

		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		};
		if (this._config.apiKey) {
			headers['Authorization'] = `Bearer ${this._config.apiKey}`;
		}
		const response = await fetch(modelsUrl, {
			method: 'GET',
			headers,
		});

		const data = await response.json();

		if (!response.ok || data?.error) {
			this.logger.error(`Error fetching models: ${response.status} ${response.statusText} - ${JSON.stringify(data?.error?.code)}`);
			const errorMsg = `Error fetching models: ${response.status} ${response.statusText} - ${data?.error?.code || JSON.stringify(data?.error)}`;
			throw new Error(errorMsg);
		}

		return data;
	}

	/**
	 * Converts an AI SDK ModelMessage to DeepSeek API format.
	 */
	private toDeepSeekMessage(msg: ai.ModelMessage): Record<string, any> {
		const content = msg.content as any;

		if (msg.role === 'system') {
			return { role: 'system', content: this.extractTextContent(content) };
		}
		if (msg.role === 'user') {
			return { role: 'user', content: this.extractUserContent(content) };
		}
		if (msg.role === 'assistant') {
			const deepseekContent: any[] = [];
			const toolCalls: any[] = [];
			// Use the reasoning_content captured from the last streaming response
			const reasoningContent = this.lastReasoningContent;

			for (const part of content) {
				if (part.type === 'text') {
					deepseekContent.push({ type: 'text', text: part.text });
				} else if (part.type === 'tool-call') {
					// DeepSeek expects tool calls in a separate array, not in content
					toolCalls.push({
						id: part.toolCallId,
						type: 'function',
						function: {
							name: part.toolName,
							arguments: typeof part.input === 'string' ? part.input : JSON.stringify(part.input),
						},
					});
				}
			}

			const result: Record<string, any> = { role: 'assistant' };
			// DeepSeek requires content to be present (even if null or empty array)
			if (deepseekContent.length > 0) {
				result.content = deepseekContent;
			} else {
				result.content = null;
			}
			// Add tool_calls array if there are tool calls
			if (toolCalls.length > 0) {
				this.logger.debug(`[deepseek] Sending ${toolCalls.length} tool calls: ${toolCalls.map((tc: any) => tc.function.name).join(', ')}`);
				result.tool_calls = toolCalls;
			}
			// Pass back reasoning_content for DeepSeek thinking mode
			if (reasoningContent) {
				result.reasoning_content = reasoningContent;
			}
			return result;
		}
		if (msg.role === 'tool') {
			// AI SDK ToolModelMessage structure:
			// { role: 'tool', content: [{ type: 'tool-result', toolCallId: string, toolName: string, output: ... }] }
			const contentArray = Array.isArray(content) ? content : [];
			let toolCallId: string | undefined;
			let textContent = '';

			for (const part of contentArray) {
				if (part?.type === 'tool-result') {
					toolCallId = part.toolCallId;
					if (typeof part.output === 'string') {
						textContent = part.output;
					} else if (part.output?.value !== undefined) {
						textContent = String(part.output.value);
					} else if (part.output?.text !== undefined) {
						textContent = String(part.output.text);
					}
					break; // Use first tool result
				}
			}

			if (!toolCallId) {
				this.logger.error('[deepseek] Tool message missing toolCallId');
				return { role: 'tool', content: '', tool_call_id: 'unknown' };
			}

			this.logger.debug(`[deepseek] Sending tool result: ${toolCallId}, content length: ${textContent.length}`);

			return {
				role: 'tool',
				content: textContent,
				tool_call_id: toolCallId,
			};
		}
		// All other roles are handled above (system, user, assistant, tool)
		return { role: 'user', content: '' };
	}

	/**
	 * Extracts text content from AI SDK message parts.
	 */
	private extractTextContent(content: any): string {
		if (typeof content === 'string') {
			return content;
		}
		const parts = Array.isArray(content) ? content.filter((p: any) => p.type === 'text') : [];
		return parts.map((p: any) => p.text).join('');
	}

	/**
	 * Extracts text content from user content (which may include images).
	 */
	private extractUserContent(content: any): string {
		if (typeof content === 'string') {
			return content;
		}
		const parts = Array.isArray(content) ? content.filter((p: any) => p.type === 'text') : [];
		return parts.map((p: any) => p.text).join('');
	}
}
