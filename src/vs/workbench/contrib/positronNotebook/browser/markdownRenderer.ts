/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { escape } from '../../../../base/common/strings.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { tokenizeToString } from '../../../../editor/common/languages/textToHtmlTokenizer.js';
import * as marked from '../../../../base/common/marked/marked.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { slugify } from '../../markdown/browser/markedGfmHeadingIdPlugin.js';

/**
 * Renders markdown with theme-aware syntax highlighting for Positron notebooks.
 * Unlike renderMarkdownDocument, this doesn't sanitize aggressively since notebook
 * content is trusted and needs to support local image paths.
 *
 * Also adds slugified IDs to heading elements to support anchor link navigation.
 */
export async function renderNotebookMarkdown(
	content: string,
	extensionService: IExtensionService,
	languageService: ILanguageService
): Promise<string> {
	// Track slug counts for duplicate heading handling
	// This is scoped to each render call to ensure fresh state
	const slugCounter = new Map<string, number>();

	const m = new marked.Marked()
		.use(markedHighlight({
			async: true,
			async highlight(code: string, lang: string): Promise<string> {
				if (!lang) {
					return escape(code);
				}

				await extensionService.whenInstalledExtensionsRegistered();

				const languageId = languageService.getLanguageIdByLanguageName(lang)
					?? languageService.getLanguageIdByLanguageName(lang.split(/\s+|:|,|(?!^)\{|\?]/, 1)[0]);

				return tokenizeToString(languageService, code, languageId);
			}
		}))
		.use({
			renderer: {
				heading(this: marked.Renderer, { tokens, depth }: marked.Tokens.Heading): string {
					// Extract heading text from tokens
					const headingText = extractTextFromTokens(tokens);
					let slug = slugify(headingText);

					// Handle duplicate headings by appending numbers
					const existingCount = slugCounter.get(slug);
					if (existingCount !== undefined) {
						slugCounter.set(slug, existingCount + 1);
						slug = slug + '-' + (existingCount + 1);
					} else {
						slugCounter.set(slug, 0);
					}

					// Render heading with ID attribute
					const idAttr = slug ? ` id="${escape(slug)}"` : '';
					return `<h${depth}${idAttr}>${this.parser.parseInline(tokens)}</h${depth}>\n`;
				}
			}
		});

	return await m.parse(content, { async: true });
}

/**
 * Helper for marked.js syntax highlighting integration.
 *
 * NOTE: This code is duplicated from markdownDocumentRenderer.ts (MarkedHighlight namespace)
 * which itself copied it from https://github.com/markedjs/marked-highlight.
 *
 * We duplicate it here rather than modifying upstream code to avoid merge conflicts.
 * The MarkedHighlight namespace is private in upstream, so we can't import it.
 *
 * If VSCode upstream exports this utility in the future, we should use that instead.
 */
function markedHighlight(options: marked.MarkedOptions & {
	highlight: (code: string, lang: string) => string | Promise<string>;
	async?: boolean;
}): marked.MarkedExtension {
	if (!options || typeof options.highlight !== 'function') {
		throw new Error('Must provide highlight function');
	}

	return {
		async: !!options.async,
		walkTokens(token: marked.Token): Promise<void> | void {
			if (!isCodeToken(token)) {
				return;
			}

			if (options.async) {
				return Promise.resolve(options.highlight(token.text, token.lang || '')).then(updateToken(token));
			}

			const code = options.highlight(token.text, token.lang || '');
			if (code instanceof Promise) {
				throw new Error('markedHighlight is not set to async but the highlight function is async.');
			}
			updateToken(token)(code);
		},
		renderer: {
			code({ text, lang, escaped }: marked.Tokens.Code) {
				const classAttr = lang ? ` class="language-${escape(lang)}"` : '';
				text = text.replace(/\n$/, '');
				return `<pre><code${classAttr}>${escaped ? text : escape(text)}\n</code></pre>`;
			},
		},
	};
}


function updateToken(token: marked.Tokens.Code) {
	return (code: string) => {
		if (typeof code === 'string' && code !== token.text) {
			token.escaped = true;
			token.text = code;
		}
	};
}

/**
 * Type guard to check if a token is a Text token.
 * @param token The token to check
 * @returns True if the token is a Text token
 */
function isTextToken(token: marked.Token): token is Extract<marked.Token, { type: 'text' }> {
	return token.type === 'text';
}

/**
 * Type guard to check if a token is a Code token.
 * @param token The token to check
 * @returns True if the token is a Code token
 */
function isCodeToken(token: marked.Token): token is Extract<marked.Token, { type: 'code' }> {
	return token.type === 'code';
}

/**
 * Token types with a required nested tokens array.
 * Extracted from marked.Token for type safety.
 */
type TokenWithRequiredNestedTokens = Extract<marked.Token, { tokens: marked.Token[] }>;

/**
 * String literal union of token types with required nested tokens.
 */
type RequiredNestedTokenType = TokenWithRequiredNestedTokens['type'];

/**
 * Set of token types that have nested tokens.
 * The `satisfies` ensures compile-time validation - if marked adds/removes
 * token types, the compiler will catch mismatches.
 */
const NESTED_TOKEN_TYPES = new Set([
	'heading',
	'blockquote',
	'paragraph',
	'list_item',
	'link',
	'strong',
	'em',
	'del'
] as const satisfies readonly RequiredNestedTokenType[]);

/**
 * Type guard to check if a token has nested tokens by checking token type.
 * Uses type discriminator properties instead of the 'in' operator.
 * @param token The token to check
 * @returns True if the token is a type that has nested tokens
 */
function hasNestedTokens(token: marked.Token): token is Extract<marked.Token, { tokens?: marked.Token[] }> {
	if (NESTED_TOKEN_TYPES.has(token.type as RequiredNestedTokenType)) {
		return true;
	}
	// For Generic tokens or other tokens, check if tokens property exists using hasOwnProperty
	// This avoids using the 'in' operator while still checking for the property
	if (Object.prototype.hasOwnProperty.call(token, 'tokens')) {
		const genericToken = token as marked.Tokens.Generic;
		return Array.isArray(genericToken.tokens);
	}
	return false;
}

/**
 * Extracts plain text from a token array (used for headings).
 * Recursively processes tokens to extract their text content.
 * @param tokens Array of tokens to extract text from
 * @returns Plain text string extracted from tokens
 */
function extractTextFromTokens(tokens: marked.Token[]): string {
	const parts: string[] = [];
	for (const token of tokens) {
		if (isTextToken(token)) {
			parts.push(token.text);
		} else if (isCodeToken(token)) {
			parts.push(token.text);
		} else if (hasNestedTokens(token) && token.tokens !== undefined) {
			// Recursively process nested tokens
			parts.push(extractTextFromTokens(token.tokens));
		}
	}
	return parts.join('');
}

