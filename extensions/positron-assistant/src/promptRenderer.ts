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
} from '@vscode/prompt-tsx';
import * as vscode from 'vscode';
import { log } from './extension.js';

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
			const msg = `Failed to render ${ctor.name} with props ${JSON.stringify(props)}: ${error}`;
			log.error(msg);
			throw new Error(msg);
		}
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
				log.trace('About to call renderPrompt with:', { ctor: ctor.name, props });

				const result = await renderPrompt(
					ctor,
					props,
					endpoint,
					model,
					undefined, // progress
					tokenSource.token
				);

				log.trace('renderPrompt completed successfully. Messages:', result.messages);

				// Debug logging to identify problematic messages
				if (result.messages && Array.isArray(result.messages)) {
					result.messages.forEach((msg: any, index: number) => {
						if (!msg || typeof msg !== 'object' || typeof msg.role !== 'string') {
							log.warn(`Message at index ${index} has unexpected structure:`, msg);
						}
					});
				}

				// Extract system messages and combine them
				const systemMessages = result.messages
					.filter((msg: any) => msg && typeof msg === 'object' && typeof msg.role === 'string' && msg.role === 'system')
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
				log.error('renderPrompt failed, falling back to renderElementJSON:', renderError);

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
			const msg = `Failed to render system prompt ${ctor.name} with props ${JSON.stringify(props)}: ${error}`;
			log.error(msg);
			throw new Error(msg);
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
			log.error('Error rendering prompt to content:', error);
			throw new Error(`Failed to render prompt to content: ${error}`);
		}
	}

	/**
	 * Clear all caches.
	 */
	static clearCache(): void {
		this.cache.clear();
	}

	/**
	 * Get cache statistics for debugging.
	 */
	static getCacheStats(): { stringCache: { size: number; keys: string[] } } {
		return {
			stringCache: {
				size: this.cache.size,
				keys: Array.from(this.cache.keys())
			}
		};
	}
}
