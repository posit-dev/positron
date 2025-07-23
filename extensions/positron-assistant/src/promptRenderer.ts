/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	renderPrompt,
	PromptElementCtor,
	BasePromptElementProps,
	IChatEndpointInfo,
	renderElementJSON
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
 * Central utility for rendering prompt-tsx components to strings.
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
			console.error('Error rendering prompt:', error);
			throw new Error(`Failed to render prompt: ${error}`);
		}
	}

	/**
	 * Clear the rendering cache.
	 */
	static clearCache(): void {
		this.cache.clear();
	}

	/**
	 * Get cache statistics for debugging.
	 */
	static getCacheStats(): { size: number; keys: string[] } {
		return {
			size: this.cache.size,
			keys: Array.from(this.cache.keys())
		};
	}
}
