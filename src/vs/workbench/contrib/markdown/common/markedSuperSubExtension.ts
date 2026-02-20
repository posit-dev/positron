/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as marked from '../../../../base/common/marked/marked.js';

/**
 * Marked extension for superscript (^text^) and subscript (~text~) syntax.
 *
 * Superscript: `^text^` renders as <sup>text</sup>
 * Subscript: `~text~` renders as <sub>text</sub>
 *
 * Note: Single `~text~` is subscript, while double `~~text~~` remains strikethrough (del).
 */
export namespace MarkedSuperSubExtension {

	export interface SuperSubToken {
		type: 'superscript' | 'subscript';
		raw: string;
		text: string;
		tokens: marked.Token[];
	}

	// Match ^text^ for superscript. Text cannot contain ^, newlines, or spaces at boundaries.
	const superscriptRule = /^\^(?!\^)(\S(?:[^^\n]*?\S)?)\^(?!\^)/;

	// Match ~text~ for subscript. Text cannot contain ~, newlines, or spaces at boundaries.
	// Must not match ~~text~~ (which is strikethrough).
	const subscriptRule = /^~(?!~)(\S(?:[^~\n]*?\S)?)~(?!~)/;

	export function extension(): marked.MarkedExtension {
		return {
			extensions: [
				superscript(),
				subscript(),
			],
		};
	}

	function superscript(): marked.TokenizerAndRendererExtension {
		return {
			name: 'superscript',
			level: 'inline',
			start(src: string) {
				return src.indexOf('^');
			},
			tokenizer(this: { lexer: marked.Lexer }, src: string) {
				const match = src.match(superscriptRule);
				if (match) {
					const token: SuperSubToken = {
						type: 'superscript',
						raw: match[0],
						text: match[1],
						tokens: [],
					};
					this.lexer.inline(token.text, token.tokens);
					return token;
				}
				return undefined;
			},
			childTokens: ['tokens'],
			renderer(token: marked.Tokens.Generic) {
				return `<sup>${this.parser.parseInline(token.tokens ?? [])}</sup>`;
			},
		};
	}

	function subscript(): marked.TokenizerAndRendererExtension {
		return {
			name: 'subscript',
			level: 'inline',
			start(src: string) {
				// Find a single ~ that is not part of ~~ (strikethrough)
				let index = 0;
				while (index < src.length) {
					const pos = src.indexOf('~', index);
					if (pos === -1) {
						return -1;
					}
					// Skip ~~ (strikethrough)
					if (src[pos + 1] === '~') {
						index = pos + 2;
						continue;
					}
					return pos;
				}
				return -1;
			},
			tokenizer(this: { lexer: marked.Lexer }, src: string) {
				const match = src.match(subscriptRule);
				if (match) {
					const token: SuperSubToken = {
						type: 'subscript',
						raw: match[0],
						text: match[1],
						tokens: [],
					};
					this.lexer.inline(token.text, token.tokens);
					return token;
				}
				return undefined;
			},
			childTokens: ['tokens'],
			renderer(token: marked.Tokens.Generic) {
				return `<sub>${this.parser.parseInline(token.tokens ?? [])}</sub>`;
			},
		};
	}
}
