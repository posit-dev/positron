/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	renderPrompt,
	PromptElementCtor,
	BasePromptElementProps,
	IChatEndpointInfo,
	renderElementJSON,
	RenderPromptResult
} from '@vscode/prompt-tsx';
import * as vscode from 'vscode';

/**
 * Simple stringify function for PromptElementJSON
 */
function stringifyPromptElementJSON(element: any): string {
	if (!element || !element.node) {
		return '';
	}

	const strs: string[] = [];
	stringifyPromptNodeJSON(element.node, strs);
	return strs.join('');
}

function stringifyPromptNodeJSON(node: any, strs: string[]): void {
	if (node.type === 2) { // Text node
		if (node.lineBreakBefore) {
			strs.push('\n');
		}
		if (typeof node.text === 'string') {
			strs.push(node.text);
		}
	} else if (node.ctor === 3) { // Image message
		strs.push('<image>');
	} else if (node.ctor === 1 || node.ctor === 2) { // Base chat message or other
		if (node.children) {
			for (const child of node.children) {
				stringifyPromptNodeJSON(child, strs);
			}
		}
	}
}

/**
 * Central utility for rendering prompt-tsx components to strings or messages.
 * Handles caching and error management for prompt rendering.
 */
export class PromptRenderer {
	private static cache = new Map<string, string>();
	private static messageCache = new Map<string, vscode.LanguageModelChatMessage[]>();

	/**
	 * Render a prompt-tsx component to a string.
	 *
	 * @param ctor The JSX component constructor to render
	 * @param props The props for the component
	 * @param model Optional language model for advanced rendering
	 * @param cacheKey Optional cache key for performance optimization
	 * @returns Promise resolving to the rendered string
	 */
	static async render<P extends BasePromptElementProps>(
		ctor: PromptElementCtor<P, any>,
		props: P,
		model?: vscode.LanguageModelChat,
		cacheKey?: string
	): Promise<string> {
		if (cacheKey && this.cache.has(cacheKey)) {
			return this.cache.get(cacheKey)!;
		}

		try {
			let rendered: string;

			if (model) {
				// Use full renderPrompt with model
				const endpoint: IChatEndpointInfo = {
					modelMaxPromptTokens: 128000 // Default reasonable limit
				};

				const tokenSource = new vscode.CancellationTokenSource();
				const result = await renderPrompt(
					ctor,
					props,
					endpoint,
					model,
					undefined, // progress
					tokenSource.token
				);

				// Convert messages to string
				rendered = result.messages.map(msg => {
					if ('content' in msg) {
						return typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
					}
					return JSON.stringify(msg);
				}).join('\n');
			} else {
				// Use simpler renderElementJSON approach
				const tokenSource = new vscode.CancellationTokenSource();
				const result = await renderElementJSON(
					ctor,
					props,
					undefined, // No token budget for now
					tokenSource.token
				);

				// Convert JSON result to string representation
				rendered = stringifyPromptElementJSON(result);
			}

			if (cacheKey) {
				this.cache.set(cacheKey, rendered);
			}

			return rendered;
		} catch (error) {
			console.error('Error rendering prompt:', error);
			throw new Error(`Failed to render prompt: ${error}`);
		}
	}

	/**
	 * Render a prompt-tsx component to language model messages.
	 *
	 * @param ctor The JSX component constructor to render
	 * @param props The props for the component
	 * @param model Language model for rendering
	 * @param cacheKey Optional cache key for performance optimization
	 * @returns Promise resolving to an array of language model messages
	 */
	static async renderToMessages<P extends BasePromptElementProps>(
		ctor: PromptElementCtor<P, any>,
		props: P,
		model: vscode.LanguageModelChat,
		cacheKey?: string
	): Promise<vscode.LanguageModelChatMessage[]> {
		if (cacheKey && this.messageCache.has(cacheKey)) {
			return this.messageCache.get(cacheKey)!;
		}

		try {
			const endpoint: IChatEndpointInfo = {
				modelMaxPromptTokens: 128000 // Default reasonable limit
			};

			const tokenSource = new vscode.CancellationTokenSource();
			const result = await renderPrompt(
				ctor,
				props,
				endpoint,
				model,
				undefined, // progress
				tokenSource.token
			);

			// Convert the result messages to VS Code LanguageModelChatMessage format
			const messages = result.messages
				.filter((msg: any) => msg && typeof msg === 'object')
				.map(msg => this.convertToVSCodeMessage(msg));

			if (cacheKey) {
				this.messageCache.set(cacheKey, messages);
			}

			return messages;
		} catch (error) {
			console.error('Error rendering prompt to messages:', error);
			throw new Error(`Failed to render prompt to messages: ${error}`);
		}
	}

	/**
	 * Convert a prompt-tsx message to a VS Code LanguageModelChatMessage.
	 */
	private static convertToVSCodeMessage(msg: any): vscode.LanguageModelChatMessage {
		// Ensure msg is defined and has a role
		if (!msg || typeof msg !== 'object' || !msg.role) {
			console.warn('convertToVSCodeMessage received invalid message:', msg);
			const fallbackContent = msg ? JSON.stringify(msg) : '[Invalid message]';
			return vscode.LanguageModelChatMessage.User([new vscode.LanguageModelTextPart(fallbackContent)]);
		}

		// Handle user messages
		if (msg.role === 'user') {
			const parts: vscode.LanguageModelTextPart[] = [];

			if (typeof msg.content === 'string') {
				parts.push(new vscode.LanguageModelTextPart(msg.content));
			} else if (Array.isArray(msg.content)) {
				for (const part of msg.content) {
					if (part.type === 'text') {
						parts.push(new vscode.LanguageModelTextPart(part.text));
					} else if (part.type === 'image_url') {
						// Handle image parts if needed
						parts.push(new vscode.LanguageModelTextPart(`[Image: ${part.image_url?.url || 'unknown'}]`));
					}
				}
			}

			return vscode.LanguageModelChatMessage.User(parts);
		}

		// Handle assistant messages
		if (msg.role === 'assistant') {
			const content = typeof msg.content === 'string' ? msg.content :
				Array.isArray(msg.content) ? msg.content.map((part: any) =>
					part.type === 'text' ? part.text : JSON.stringify(part)
				).join('') : JSON.stringify(msg.content);
			return vscode.LanguageModelChatMessage.Assistant([new vscode.LanguageModelTextPart(content)]);
		}

		// Handle system messages - these will be filtered out since VSCode handles them separately
		if (msg.role === 'system') {
			// We don't return system messages as chat messages since VSCode expects them in modelOptions.system
			const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
			return vscode.LanguageModelChatMessage.User([new vscode.LanguageModelTextPart(`[System: ${content}]`)]);
		}

		// Fallback for unknown message types
		const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
		return vscode.LanguageModelChatMessage.User([new vscode.LanguageModelTextPart(content)]);
	}

	/**
	 * Extract system messages from a prompt-tsx render result.
	 *
	 * @param ctor The JSX component constructor to render
	 * @param props The props for the component
	 * @param model Language model for rendering
	 * @param cacheKey Optional cache key for performance optimization
	 * @returns Promise resolving to the system prompt string
	 */
	static async renderSystemPrompt<P extends BasePromptElementProps>(
		ctor: PromptElementCtor<P, any>,
		props: P,
		model: vscode.LanguageModelChat,
		cacheKey?: string
	): Promise<string> {
		const cacheKeySystem = cacheKey ? `${cacheKey}-system` : undefined;
		if (cacheKeySystem && this.cache.has(cacheKeySystem)) {
			return this.cache.get(cacheKeySystem)!;
		}

		try {
			// Temporary: try with a minimal fallback first
			try {
				const endpoint: IChatEndpointInfo = {
					modelMaxPromptTokens: 128000 // Default reasonable limit
				};

				const tokenSource = new vscode.CancellationTokenSource();
				
				// Add some debugging to catch the issue before it hits the tokenizer
				console.log('About to call renderPrompt with:', { ctor: ctor.name, props });
				
				const result = await renderPrompt(
					ctor,
					props,
					endpoint,
					model,
					undefined, // progress
					tokenSource.token
				);

				console.log('renderPrompt completed successfully. Messages:', result.messages);

				// Extract system messages and combine them
				const systemMessages = result.messages
					.filter((msg: any) => msg && typeof msg === 'object' && msg.role === 'system')
					.map((msg: any) => {
						if (typeof msg.content === 'string') {
							return msg.content;
						} else if (Array.isArray(msg.content)) {
							return msg.content.map((part: any) => 
								part && part.type === 'text' ? part.text : JSON.stringify(part)
							).join('');
						}
						return JSON.stringify(msg.content);
					});

				const systemPrompt = systemMessages.join('\n\n');
				
				if (cacheKeySystem) {
					this.cache.set(cacheKeySystem, systemPrompt);
				}

				return systemPrompt;
			} catch (renderError) {
				console.error('renderPrompt failed, falling back to renderElementJSON:', renderError);
				
				// Fallback to renderElementJSON
				const tokenSource = new vscode.CancellationTokenSource();
				const result = await renderElementJSON(
					ctor,
					props,
					undefined,
					tokenSource.token
				);

				const systemPrompt = stringifyPromptElementJSON(result);
				
				if (cacheKeySystem) {
					this.cache.set(cacheKeySystem, systemPrompt);
				}

				return systemPrompt;
			}
		} catch (error) {
			console.error('Error rendering system prompt:', error);
			throw new Error(`Failed to render system prompt: ${error}`);
		}
	}

	/**
	 * Render a prompt-tsx component to content text for embedding in user messages.
	 * This method extracts just the text content, avoiding the JSON->string conversion.
	 *
	 * @param ctor The JSX component constructor to render
	 * @param props The props for the component
	 * @param model Optional language model for rendering
	 * @param cacheKey Optional cache key for performance optimization
	 * @returns Promise resolving to the content text
	 */
	static async renderToContent<P extends BasePromptElementProps>(
		ctor: PromptElementCtor<P, any>,
		props: P,
		model?: vscode.LanguageModelChat,
		cacheKey?: string
	): Promise<string> {
		if (cacheKey && this.cache.has(cacheKey)) {
			return this.cache.get(cacheKey)!;
		}

		try {
			let content: string;

			if (model) {
				const endpoint: IChatEndpointInfo = {
					modelMaxPromptTokens: 128000 // Default reasonable limit
				};

				const tokenSource = new vscode.CancellationTokenSource();
				const result = await renderPrompt(
					ctor,
					props,
					endpoint,
					model,
					undefined, // progress
					tokenSource.token
				);

				// Extract text content from all messages, preserving structure
				content = result.messages.map((msg: any) => {
					if (typeof msg.content === 'string') {
						return msg.content;
					} else if (Array.isArray(msg.content)) {
						return msg.content.map((part: any) =>
							part.type === 'text' ? part.text : JSON.stringify(part)
						).join('');
					}
					return JSON.stringify(msg.content);
				}).join('\n\n');
			} else {
				// Use simpler renderElementJSON approach
				const tokenSource = new vscode.CancellationTokenSource();
				const result = await renderElementJSON(
					ctor,
					props,
					undefined, // No token budget for now
					tokenSource.token
				);

				// Convert JSON result to string representation
				content = stringifyPromptElementJSON(result);
			}

			if (cacheKey) {
				this.cache.set(cacheKey, content);
			}

			return content;
		} catch (error) {
			console.error('Error rendering prompt to content:', error);
			throw new Error(`Failed to render prompt to content: ${error}`);
		}
	}

	/**
	 * Render a prompt-tsx component and return separated system prompt and user messages.
	 *
	 * @param ctor The JSX component constructor to render
	 * @param props The props for the component
	 * @param model Language model for rendering
	 * @param cacheKey Optional cache key for performance optimization
	 * @returns Promise resolving to system prompt string and user/assistant messages
	 */
	static async renderToSystemAndMessages<P extends BasePromptElementProps>(
		ctor: PromptElementCtor<P, any>,
		props: P,
		model: vscode.LanguageModelChat,
		cacheKey?: string
	): Promise<{ systemPrompt: string; messages: vscode.LanguageModelChatMessage[] }> {
		try {
			const endpoint: IChatEndpointInfo = {
				modelMaxPromptTokens: 128000 // Default reasonable limit
			};

			const tokenSource = new vscode.CancellationTokenSource();
			const result = await renderPrompt(
				ctor,
				props,
				endpoint,
				model,
				undefined, // progress
				tokenSource.token
			);

			// Separate system messages from other messages
			const systemMessages: any[] = [];
			const otherMessages: any[] = [];

			for (const msg of result.messages) {
				if (!msg || typeof msg !== 'object') {
					console.warn('renderToSystemAndMessages: skipping invalid message:', msg);
					continue;
				}
				
				if ((msg as any).role === 'system') {
					systemMessages.push(msg);
				} else {
					otherMessages.push(msg);
				}
			}

			// Convert system messages to string
			const systemPrompt = systemMessages
				.map((msg: any) => typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content))
				.join('\n\n');

			// Convert other messages to VS Code format
			const messages = otherMessages.map(msg => this.convertToVSCodeMessage(msg));

			return { systemPrompt, messages };
		} catch (error) {
			console.error('Error rendering prompt to system and messages:', error);
			throw new Error(`Failed to render prompt to system and messages: ${error}`);
		}
	}

	/**
	 * Clear all caches.
	 */
	static clearCache(): void {
		this.cache.clear();
		this.messageCache.clear();
	}

	/**
	 * Get cache statistics for debugging.
	 */
	static getCacheStats(): { stringCache: { size: number; keys: string[] }, messageCache: { size: number; keys: string[] } } {
		return {
			stringCache: {
				size: this.cache.size,
				keys: Array.from(this.cache.keys())
			},
			messageCache: {
				size: this.messageCache.size,
				keys: Array.from(this.messageCache.keys())
			}
		};
	}
}
