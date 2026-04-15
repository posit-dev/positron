/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as marked from '../../../../base/common/marked/marked.js';

/**
 * Marked extension for footnote syntax.
 *
 * References: `[^id]` renders as a superscript link to the footnote definition.
 * Definitions: `[^id]: text` are collected and rendered as a numbered list at the
 * end of the document.
 */
export namespace MarkedFootnoteExtension {

	export interface FootnoteRefToken {
		type: 'footnoteRef';
		raw: string;
		/** The footnote identifier, e.g. "1" in [^1] */
		id: string;
	}

	export interface FootnoteDefinitionToken {
		type: 'footnoteDefinition';
		raw: string;
		/** The footnote identifier, e.g. "1" in [^1]: text */
		id: string;
		/** The raw text content of the footnote definition */
		text: string;
		/** Tokenized inline content of the definition */
		tokens: marked.Token[];
	}

	export type FootnoteToken = FootnoteRefToken | FootnoteDefinitionToken;

	// Match [^id] inline references. The id is one or more word characters.
	// Must not be followed by a colon (that would be a definition).
	const footnoteRefRule = /^\[\^([^\]]+)\](?!:)/;

	// Match [^id]: text on a single line, with optional indented continuation lines.
	// Continuation lines must start with at least two spaces or a tab (may be empty).
	const footnoteDefinitionRule = /^\[\^([^\]]+)\]:[ \t]+([^\n]+(?:\n(?:[ \t]{2,}|\t)[^\n]*)*)/;

	/** Escapes a string for safe use in HTML attributes. */
	function escapeHtmlAttr(s: string): string {
		return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}

	export function extension(): marked.MarkedExtension {
		return {
			extensions: [
				footnoteRef(),
				footnoteDefinition(),
			],
		};
	}

	function footnoteRef(): marked.TokenizerAndRendererExtension {
		return {
			name: 'footnoteRef',
			level: 'inline',
			start(src: string) {
				return src.indexOf('[^');
			},
			tokenizer(src: string) {
				const match = src.match(footnoteRefRule);
				if (match) {
					return {
						type: 'footnoteRef',
						raw: match[0],
						id: match[1],
					};
				}
				return undefined;
			},
			renderer(token: marked.Tokens.Generic) {
				// Placeholder -- actual rendering is handled by the React renderer
				// in markdownRenderer.tsx which has access to footnote numbering context.
				const safeId = escapeHtmlAttr(token.id);
				return `<sup class="footnote-ref"><a href="#fn-${safeId}" id="fnref-${safeId}">${safeId}</a></sup>`;
			},
		};
	}

	function footnoteDefinition(): marked.TokenizerAndRendererExtension {
		return {
			name: 'footnoteDefinition',
			level: 'block',
			start(src: string) {
				return src.match(/^\[\^/m)?.index;
			},
			tokenizer(this: { lexer: marked.Lexer }, src: string) {
				const match = src.match(footnoteDefinitionRule);
				if (match) {
					const token: FootnoteDefinitionToken = {
						type: 'footnoteDefinition',
						raw: match[0],
						id: match[1],
						text: match[2].trim(),
						tokens: [],
					};
					this.lexer.inline(token.text, token.tokens);
					return token;
				}
				return undefined;
			},
			childTokens: ['tokens'],
			renderer(token: marked.Tokens.Generic) {
				// Placeholder -- actual rendering handled by the React renderer.
				return '';
			},
		};
	}
}
