/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { escape } from '../../../../base/common/strings.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { tokenizeToString } from '../../../../editor/common/languages/textToHtmlTokenizer.js';
import * as marked from '../../../../base/common/marked/marked.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';

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
					if (slugCounter.has(slug)) {
						const count = slugCounter.get(slug)!;
						slugCounter.set(slug, count + 1);
						slug = slugify(slug + '-' + (count + 1));
					} else {
						slugCounter.set(slug, 0);
					}

					// Render heading with ID attribute
					const idAttr = slug ? ` id="${escape(slug)}"` : '';
					return `<h${depth}${idAttr}>${this.parser.parseInline(tokens)}</h${depth}>\n`;
				}
			}
		});

	// Reset slug counter before parsing
	slugCounter.clear();
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
			if (token.type !== 'code') {
				return;
			}

			// TypeScript doesn't narrow the type across function calls, so we assert here
			// after verifying token.type === 'code'
			const codeToken = assertCodeToken(token);

			if (options.async) {
				return Promise.resolve(options.highlight(codeToken.text, codeToken.lang || '')).then(updateToken(codeToken));
			}

			const code = options.highlight(codeToken.text, codeToken.lang || '');
			if (code instanceof Promise) {
				throw new Error('markedHighlight is not set to async but the highlight function is async.');
			}
			updateToken(codeToken)(code);
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

/**
 * Type assertion function to assert that a token is a Code token.
 * Validates at runtime that the token is actually a Code token.
 * @param token The token to assert as Code
 * @returns The token typed as marked.Tokens.Code
 * @throws Error if the token is not a Code token
 */
function assertCodeToken(token: marked.Token): marked.Tokens.Code {
	if (token.type !== 'code') {
		throw new Error(`Expected Code token, but got token type: ${token.type}`);
	}
	return token as marked.Tokens.Code;
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
 * Type guard to check if a token has nested tokens by checking token type.
 * Uses type discriminator properties instead of the 'in' operator.
 * @param token The token to check
 * @returns True if the token is a type that has nested tokens
 */
function hasNestedTokens(token: marked.Token): token is marked.Tokens.Heading | marked.Tokens.Blockquote | marked.Tokens.Paragraph | marked.Tokens.ListItem | marked.Tokens.Link | marked.Tokens.Strong | marked.Tokens.Em | marked.Tokens.Del | marked.Tokens.Generic {
	const tokenTypesWithNestedTokens = ['heading', 'blockquote', 'paragraph', 'list_item', 'link', 'strong', 'em', 'del'];
	if (tokenTypesWithNestedTokens.includes(token.type)) {
		return true;
	}
	// For Generic tokens or other tokens, check if tokens property exists using hasOwnProperty
	// This avoids using the 'in' operator while still checking for the property
	return Object.prototype.hasOwnProperty.call(token, 'tokens') && Array.isArray((token as marked.Tokens.Generic).tokens);
}

/**
 * Extracts plain text from a token array (used for headings).
 * Recursively processes tokens to extract their text content.
 * @param tokens Array of tokens to extract text from
 * @returns Plain text string extracted from tokens
 */
function extractTextFromTokens(tokens: marked.Token[]): string {
	return tokens.reduce<string>((acc, token) => {
		if (token.type === 'text') {
			return acc + (token as marked.Tokens.Text).text;
		} else if (token.type === 'code') {
			return acc + (token as marked.Tokens.Code).text;
		} else if (hasNestedTokens(token) && token.tokens !== undefined) {
			// Recursively process nested tokens
			return acc + extractTextFromTokens(token.tokens);
		}
		return acc;
	}, '');
}

/**
 * Slugifies text to create URL-safe IDs for headings.
 * Converts text to lowercase, replaces spaces with hyphens, and removes
 * punctuation characters. Based on the same logic used in VS Code's
 * markdown notebook extension.
 * @param text Text to slugify
 * @returns URL-safe slug string
 */
function slugify(text: string): string {
	const slugifiedHeading = encodeURI(
		text.trim()
			.toLowerCase()
			.replace(/\s+/g, '-') // Replace whitespace with -
			// allow-any-unicode-next-line
			.replace(/[\]\[\!\/\'\"\#\$\%\&\(\)\*\+\,\.\/\:\;\<\=\>\?\@\\\^\{\|\}\~\`。，、；：？！…—·ˉ¨''""々～‖∶＂＇｀｜〃〔〕〈〉《》「」『』．〖〗【】（）［］｛｝]/g, '') // Remove known punctuators
			.replace(/^\-+/, '') // Remove leading -
			.replace(/\-+$/, '') // Remove trailing -
	);
	return slugifiedHeading;
}
