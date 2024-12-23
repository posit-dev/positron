/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import * as ai from 'ai';
import { z } from 'zod';
import { ModelConfig } from './config';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createOllama } from 'ollama-ai-provider';

export interface Assistant {
	name: string;
	identifier: string;
	chatResponseProvider: (request: positron.ai.ChatRequest, response: positron.ai.ChatResponse, token: vscode.CancellationToken) => Promise<void>;
	terminalResponseProvider: (request: positron.ai.ChatRequest, response: positron.ai.ChatResponse, token: vscode.CancellationToken) => Promise<void>;
	editorResponseProvider: (request: positron.ai.ChatRequest, response: positron.ai.ChatResponse, token: vscode.CancellationToken) => Promise<void>;
}

class ErrorAssistant implements Assistant {
	readonly name = 'Error Assistant';
	readonly identifier = 'error-assistant';

	async chatResponseProvider() {
		throw new Error('(chatResponseProvider) This assistant always throws an error message.');
	}

	async terminalResponseProvider(): Promise<void> {
		throw new Error('(terminalSuggestionProvider) This assistant always throws an error message.');
	}

	async editorResponseProvider(): Promise<void> {
		throw new Error('(terminalSuggestionProvider) This assistant always throws an error message.');
	}
}

class EchoAssistant implements Assistant {
	readonly name = 'Echo Assistant';
	readonly identifier = 'echo-assistant';

	async chatResponseProvider(request: positron.ai.ChatRequest, response: positron.ai.ChatResponse, token: vscode.CancellationToken) {
		for await (const i of request.message.split('')) {
			await new Promise(resolve => setTimeout(resolve, 10));
			response.write(i);
			if (token.isCancellationRequested) {
				return;
			}
		}
	}

	async terminalResponseProvider(request: positron.ai.ChatRequest, response: positron.ai.ChatResponse, token: vscode.CancellationToken) {
		for await (const i of request.message.split('')) {
			await new Promise(resolve => setTimeout(resolve, 10));
			response.write(i);
			if (token.isCancellationRequested) {
				return;
			}
		}
	}

	async editorResponseProvider(request: positron.ai.ChatRequest, response: positron.ai.ChatResponse, token: vscode.CancellationToken) {
		for await (const i of request.message.split('')) {
			await new Promise(resolve => setTimeout(resolve, 10));
			response.write(i);
			if (token.isCancellationRequested) {
				return;
			}
		}
	}
}

abstract class AIAssistant implements Assistant {
	public readonly name;
	public readonly identifier;
	protected abstract model: ai.LanguageModelV1;

	constructor(protected readonly _config: ModelConfig) {
		this.identifier = _config.name.toLowerCase().replace(/\s+/g, '-');
		this.name = _config.name;
	}

	async chatResponseProvider(request: positron.ai.ChatRequest, response: positron.ai.ChatResponse, token: vscode.CancellationToken) {
		const system = 'You are a helpful coding assistant. You are an expert in data analysis using R and Python. You know how to write Shiny for R and Shiny for Python apps.';
		const messages: ai.CoreMessage[] = [
			...request.history,
			{ role: 'user', content: JSON.stringify(request.context?.value) },
			{ role: 'assistant', content: 'Acknowledged. I won\t explicitly mention this context if it is irrelevant, but I will keep it in mind for my responses.' },
			{ role: 'user', content: request.message },
		];

		function padBase64String(base64: string): string {
			const padding = 4 - (base64.length % 4);
			if (padding === 4) {
				return base64;
			}
			return base64 + '='.repeat(padding);
		}

		const result = ai.streamText({
			model: this.model,
			system,
			messages,
			maxSteps: 5,
			tools: {
				getPlot: ai.tool({
					description: 'Get the current visible plot. A plot is only visible if the `isPlotVisible` context value is true.',
					parameters: z.object({}),
					execute: async () => {
						const uri = request.context?.additional.plotUri;
						const matches = uri?.match(/^data:([^;]+);base64,(.+)$/);
						if (!matches || !uri) {
							return 'No plot visible';
						}

						return {
							type: 'image' as const,
							mimeType: matches[1],
							data: padBase64String(matches[2]),
						};
					},
					experimental_toToolResultContent(result) {
						return typeof result === 'string'
							? [{ type: 'text', text: result }]
							: [result];
					},
				}),
			}
		});

		for await (const delta of result.textStream) {
			if (token.isCancellationRequested) {
				break;
			}
			response.write(delta);
		}
	}

	async terminalResponseProvider(request: positron.ai.ChatRequest, response: positron.ai.ChatResponse, token: vscode.CancellationToken) {
		const system = 'You are an expert user of the terminal. You help users write terminal commands. The user will ask you to write a command, give a short explaination and then provide the command.';
		const messages: ai.CoreMessage[] = [
			...request.history,
			{ role: 'user', content: JSON.stringify(request.context?.value) },
			{ role: 'assistant', content: 'Acknowledged. I won\t explicitly mention this context if it is irrelevant, but I will keep it in mind for my responses.' },
			{ role: 'user', content: request.message },
		];

		const result = ai.streamText({
			model: this.model,
			system,
			messages,
		});

		for await (const delta of result.textStream) {
			if (token.isCancellationRequested) {
				break;
			}
			response.write(delta);
		}
	}

	async editorResponseProvider(request: positron.ai.ChatRequest, response: positron.ai.ChatResponse, token: vscode.CancellationToken) {
		const system = 'You are a helpful coding assistant. When you have finished responding, you can choose to output a revised version of the selection if it is required.';
		const messages: ai.CoreMessage[] = [
			...request.history,
			{ role: 'user', content: JSON.stringify(request.context?.value) },
			{ role: 'assistant', content: 'Acknowledged. I won\t explicitly mention this context if it is irrelevant, but I will keep it in mind for my responses.' },
			{ role: 'user', content: request.message },
		];

		// TODO: Should this be provided as part of the context?
		const activeEditor = vscode.window.activeTextEditor;

		const result = ai.streamText({
			model: this.model,
			system,
			messages,
			tools: {
				revise: ai.tool({
					description: 'Output a revised version of the code selection.',
					parameters: z.object({
						code: z.string().describe('The entire revised code selection.'),
					}),
					execute: async ({ code }) => {
						// TODO: Generate smaller and more targeted TextEdit instances to be applied
						//       over the entire document/workspace.
						response.writeTextEdit(
							activeEditor?.document.uri!,
							vscode.TextEdit.replace(activeEditor!.selection, code)
						);
					},
				}),
			},
		});

		for await (const delta of result.textStream) {
			if (token.isCancellationRequested) {
				break;
			}
			response.write(delta);
		}
	}
}

class AnthropicAssistant extends AIAssistant implements Assistant {
	protected model;
	constructor(_config: ModelConfig) {
		super(_config);
		this.model = createAnthropic({ apiKey: this._config.apiKey })(this._config.model);
	}
}

class OpenAIAssistant extends AIAssistant implements Assistant {
	protected model;
	constructor(_config: ModelConfig) {
		super(_config);
		this.model = createOpenAI({ apiKey: this._config.apiKey })(this._config.model);
	}
}

class OllamaAssistant extends AIAssistant implements Assistant {
	protected model;
	constructor(_config: ModelConfig) {
		super(_config);
		this.model = createOllama({ baseURL: this._config.baseUrl })(this._config.model);
	}
}

export function newAssistant(config: ModelConfig): Assistant {
	const providerClasses = {
		'echo': EchoAssistant,
		'error': ErrorAssistant,
		'openai': OpenAIAssistant,
		'anthropic': AnthropicAssistant,
		'ollama': OllamaAssistant,
	};

	if (!providerClasses[config.provider]) {
		throw new Error(`Unsupported provider: ${config.provider}`);
	}

	return new providerClasses[config.provider](config);
}
