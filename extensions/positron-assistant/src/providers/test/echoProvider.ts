/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as ai from 'ai';
import { ModelConfig, SecretStorage } from '../../config';
import { DEFAULT_MAX_TOKEN_INPUT, DEFAULT_MAX_TOKEN_OUTPUT, DEFAULT_MODEL_CAPABILITIES } from '../../constants';
import { recordTokenUsage, recordRequestTokenUsage } from '../../extension';
import { toAIMessage } from '../../utils';
import { ModelProvider } from '../base/modelProvider';

/**
 * Test provider that echoes back user input.
 * Useful for testing chat functionality without making API calls.
 */
export class EchoModelProvider extends ModelProvider {
	readonly maxInputTokens = DEFAULT_MAX_TOKEN_INPUT;
	readonly maxOutputTokens = DEFAULT_MAX_TOKEN_OUTPUT;

	constructor(
		_config: ModelConfig,
		_context?: vscode.ExtensionContext,
		_storage?: SecretStorage,
	) {
		super(_config, _context, _storage);
	}

	static source = {
		type: positron.PositronLanguageModelType.Chat,
		signedIn: false,
		provider: {
			id: 'echo',
			displayName: 'Echo',
		},
		supportedOptions: [],
		defaults: {
			name: 'Echo Language Model',
			model: 'echo',
		},
	};

	capabilities = DEFAULT_MODEL_CAPABILITIES;

	/**
	 * Sends a test message to verify connectivity.
	 * For the echo provider, this always succeeds.
	 */
	protected async sendTestMessage(modelId: string): Promise<any> {
		return Promise.resolve({ text: 'echo' });
	}

	/**
	 * Provides a chat response by echoing back the user's input.
	 * Special commands:
	 * - 'Send Python Code' - Returns Python code snippet
	 * - 'Send R Code' - Returns R code snippet
	 * - 'Return model' - Returns the model ID
	 */
	async provideLanguageModelChatResponse(
		model: vscode.LanguageModelChatInformation,
		messages: vscode.LanguageModelChatMessage2[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
		token: vscode.CancellationToken
	): Promise<void> {
		const _messages = toAIMessage(messages);
		const message = this.getUserPrompt(_messages);

		if (!message) {
			throw new Error(`[${this.providerName}] No user prompt provided to echo language model.`);
		}

		if (typeof message.content === 'string') {
			message.content = [{ type: 'text', text: message.content }];
		}

		if (message.content[0].type !== 'text') {
			throw new Error(`[${this.providerName}] Echo language model only supports text messages.`);
		}

		const inputText = message.content[0].text;
		let response: string;

		// Check for known test commands and respond accordingly
		if (inputText === 'Send Python Code') {
			response = '```python\nfoo = 100\n```';
		}
		else if (inputText === 'Send R Code') {
			response = '```r\nfoo <- 200\n```';
		}
		else if (inputText === 'Return model') {
			response = model.id;
		}
		else {
			// Default case: echo back the input message
			response = inputText;
		}

		let tokenUsage;

		// Record token usage if context is available
		if (this._context) {
			const inputTokens = await this.provideTokenCount(model, inputText, token);
			const outputTokens = await this.provideTokenCount(model, response, token);
			tokenUsage = { inputTokens, outputTokens, cachedTokens: 0 };
			recordTokenUsage(this._context, this.providerId, tokenUsage);
			// Also record token usage by request ID if available
			const requestId = (options.modelOptions as any)?.requestId;
			if (requestId) {
				recordRequestTokenUsage(requestId, this.providerId, tokenUsage);
			}
		}

		// Output the response character by character
		for await (const i of response.split('')) {
			await new Promise(resolve => setTimeout(resolve, 10));
			progress.report(new vscode.LanguageModelTextPart(i));
			if (token.isCancellationRequested) {
				return;
			}
		}
	}

	/**
	 * Provides token count for the given text.
	 */
	async provideTokenCount(model: vscode.LanguageModelChatInformation, text: string | vscode.LanguageModelChatMessage, token: vscode.CancellationToken): Promise<number> {
		if (typeof text === 'string') {
			return text.length;
		} else {
			const _text = toAIMessage([text]);
			return _text.length > 0 ? _text[0].content.length : 0;
		}
	}

	/**
	 * Resolves available models for the echo provider.
	 */
	async resolveModels(token: vscode.CancellationToken): Promise<vscode.LanguageModelChatInformation[] | undefined> {
		const models = [{
			id: this.id,
			name: this.displayName,
			family: this.providerId,
			version: '1.0.0',
			maxInputTokens: this.maxInputTokens,
			maxOutputTokens: this.maxOutputTokens,
			capabilities: this.capabilities,
			isDefault: true,
			isUserSelectable: true,
		}, {
			id: 'echo-language-model-v2',
			name: 'Echo Language Model v2',
			family: this.providerId,
			version: '1.0.0',
			maxInputTokens: this.maxInputTokens,
			maxOutputTokens: this.maxOutputTokens,
			capabilities: this.capabilities,
			isUserSelectable: true,
		}];
		this.modelListing = models;
		return models;
	}

	/**
	 * Extracts the user prompt from the messages.
	 */
	private getUserPrompt(messages: ai.CoreMessage[]): ai.CoreMessage | undefined {
		if (messages.length === 0) {
			return undefined;
		}
		if (messages.length === 1) {
			return messages[0];
		}
		// If there are multiple messages, the last message is the user message.
		// See defaultRequestHandler in extensions/positron-assistant/src/participants.ts for the message ordering.
		const userPrompt = messages[messages.length - 1];
		if (userPrompt.role !== 'user') {
			return undefined;
		}
		return userPrompt;
	}
}
