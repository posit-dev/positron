/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as marked from '../../../../../base/common/marked/marked.js';
import { MarkedKatexExtension } from '../../common/markedKatexExtension.js';

function createMarkedInstance() {
	const fakeKatex: { renderToString(text: string, options: unknown): string } = {
		renderToString: (text: string, _options: unknown) => {
			return `<span class="katex">${text}</span>`;
		},
	};

	const extension = MarkedKatexExtension.extension(
		fakeKatex as typeof import('katex').default,
		{}
	);
	return new marked.Marked().use(extension);
}

function collectKatexTokens(tokens: marked.Token[]): MarkedKatexExtension.KatexToken[] {
	const result: MarkedKatexExtension.KatexToken[] = [];
	for (const token of tokens) {
		if (token.type === 'blockKatex' || token.type === 'inlineKatex') {
			result.push(token as MarkedKatexExtension.KatexToken);
		}
		const generic = token as marked.Tokens.Generic;
		if (Array.isArray(generic.tokens)) {
			result.push(...collectKatexTokens(generic.tokens));
		}
	}
	return result;
}

describe('MarkedKatexExtension - bare block environments', () => {
	const markedInstance = createMarkedInstance();

	it('tokenizes \\begin{equation}...\\end{equation} as a block', () => {
		const input = '\\begin{equation}\nx = \\frac{-b}{2a}\n\\end{equation}\n';
		const tokens = markedInstance.lexer(input);
		const katexTokens = collectKatexTokens(tokens);

		const blockTokens = katexTokens.filter(t => t.displayMode);
		expect(blockTokens).toHaveLength(1);
		expect(blockTokens[0].text).toContain('\\begin{equation}');
		expect(blockTokens[0].text).toContain('\\end{equation}');
		expect(blockTokens[0].displayMode).toBe(true);
	});

	it('tokenizes \\begin{align*}...\\end{align*}', () => {
		const input = '\\begin{align*}\na &= b\n\\end{align*}\n';
		const tokens = markedInstance.lexer(input);
		const katexTokens = collectKatexTokens(tokens);

		const blockTokens = katexTokens.filter(t => t.displayMode);
		expect(blockTokens).toHaveLength(1);
		expect(blockTokens[0].text).toContain('\\begin{align*}');
	});

	it('handles nested environments', () => {
		const input = [
			'\\begin{equation}',
			'\\begin{pmatrix}',
			'a & b \\\\',
			'c & d',
			'\\end{pmatrix}',
			'\\end{equation}',
			'',
		].join('\n');
		const tokens = markedInstance.lexer(input);
		const katexTokens = collectKatexTokens(tokens);

		const blockTokens = katexTokens.filter(t => t.displayMode);
		expect(blockTokens).toHaveLength(1);
		expect(blockTokens[0].text).toContain('\\begin{pmatrix}');
		expect(blockTokens[0].text).toContain('\\end{pmatrix}');
		expect(blockTokens[0].text).toContain('\\end{equation}');
	});

	it('does not tokenize unbalanced environments', () => {
		const input = '\\begin{equation}\nx = 1\n';
		const tokens = markedInstance.lexer(input);
		const katexTokens = collectKatexTokens(tokens);

		const blockTokens = katexTokens.filter(t => t.displayMode);
		expect(blockTokens).toHaveLength(0);
	});

	it('does not tokenize mismatched environments', () => {
		const input = '\\begin{equation}\nx = 1\n\\end{align}\n';
		const tokens = markedInstance.lexer(input);
		const katexTokens = collectKatexTokens(tokens);

		const blockTokens = katexTokens.filter(t => t.displayMode);
		expect(blockTokens).toHaveLength(0);
	});

	it('tokenizes bare block within paragraph text (inline level)', () => {
		const input = 'The formula is \\begin{equation}x=1\\end{equation} as shown.';
		const tokens = markedInstance.lexer(input);
		const katexTokens = collectKatexTokens(tokens);

		const blockTokens = katexTokens.filter(t => t.displayMode);
		expect(blockTokens).toHaveLength(1);
		expect(blockTokens[0].text).toContain('\\begin{equation}');
		expect(blockTokens[0].text).not.toContain('as shown');
	});

	it('handles multiple bare blocks in sequence', () => {
		const input = [
			'\\begin{equation}',
			'a = 1',
			'\\end{equation}',
			'',
			'\\begin{equation}',
			'b = 2',
			'\\end{equation}',
			'',
		].join('\n');
		const tokens = markedInstance.lexer(input);
		const katexTokens = collectKatexTokens(tokens);

		const blockTokens = katexTokens.filter(t => t.displayMode);
		expect(blockTokens).toHaveLength(2);
	});
});
