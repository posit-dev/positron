/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
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
	}

	// Match ^text^ for superscript. Text cannot contain ^ or newlines or spaces at boundaries.
	const superscriptRule = /^\^(?!\^)(\S(?:[^^]*?\S)?)\^(?!\^)/;

	// Match ~text~ for subscript. Text cannot contain ~ or newlines or spaces at boundaries.
	// Must not match ~~text~~ (which is strikethrough).
	const subscriptRule = /^~(?!~)(\S(?:[^~]*?\S)?)~(?!~)/;

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
			tokenizer(src: string) {
				const match = src.match(superscriptRule);
				if (match) {
					return {
						type: 'superscript',
						raw: match[0],
						text: match[1],
					};
				}
				return undefined;
			},
			renderer(token: marked.Tokens.Generic) {
				return `<sup>${token.text}</sup>`;
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
			tokenizer(src: string) {
				const match = src.match(subscriptRule);
				if (match) {
					return {
						type: 'subscript',
						raw: match[0],
						text: match[1],
					};
				}
				return undefined;
			},
			renderer(token: marked.Tokens.Generic) {
				return `<sub>${token.text}</sub>`;
			},
		};
	}
}
