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
		/** Tokenized block content of the definition */
		tokens: marked.Token[];
	}

	export type FootnoteToken = FootnoteRefToken | FootnoteDefinitionToken;

	// Match [^id] inline references. The id is one or more word characters.
	// Must not be followed by a colon (that would be a definition).
	const footnoteRefRule = /^\[\^([^\]]+)\](?!:)/;

	// Match [^id]: with optional same-line text and optional indented continuation lines.
	// Continuation lines must start with at least two spaces or a tab (may be empty).
	// The first-line body may be empty (e.g. [^1]:\n  continuation).
	// Limitation: blank-line-separated multi-paragraph definitions (CommonMark-style)
	// are not supported; the match ends at the first line without indentation.
	const footnoteDefinitionRule = /^\[\^([^\]]+)\]:[ \t]*((?:[^\n]+)?(?:\n(?:[ \t]{2,}|\t)[^\n]*)*)/;

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
			renderer() {
				// Unused: the React renderer in markdownRenderer.tsx produces
				// footnote output since it has cross-token numbering context.
				return '';
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
					const rawBody = match[2];
					// Strip the leading indentation (2+ spaces or tab) from continuation lines
					// so the block parser sees them at the correct nesting level.
					const body = rawBody.replace(/\n(?:  |\t)/g, '\n').trim();
					const token: FootnoteDefinitionToken = {
						type: 'footnoteDefinition',
						raw: match[0],
						id: match[1],
						text: body,
						tokens: [],
					};
					this.lexer.blockTokens(token.text, token.tokens);
					return token;
				}
				return undefined;
			},
			childTokens: ['tokens'],
			renderer() {
				// Unused: the React renderer groups definitions into a footnote
				// section; see footnoteRef's renderer for the full rationale.
				return '';
			},
		};
	}
}
