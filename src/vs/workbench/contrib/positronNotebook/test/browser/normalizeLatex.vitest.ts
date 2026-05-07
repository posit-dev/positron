/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { normalizeLatex } from '../../browser/notebookCells/normalizeLatex.js';

describe('normalizeLatex', () => {
	it('strips outer $...$ delimiters', () => {
		expect(normalizeLatex('$E = mc^2$')).toBe('E = mc^2');
	});

	it('strips outer $$...$$ delimiters', () => {
		expect(normalizeLatex('$$\\int_0^1 x\\,dx$$')).toBe('\\int_0^1 x\\,dx');
	});

	it('strips outer \\(...\\) delimiters', () => {
		expect(normalizeLatex('\\(E = mc^2\\)')).toBe('E = mc^2');
	});

	it('strips outer \\[...\\] delimiters', () => {
		expect(normalizeLatex('\\[\\sum_{i=1}^n i\\]')).toBe('\\sum_{i=1}^n i');
	});

	it('trims whitespace around content', () => {
		expect(normalizeLatex('  $$ x^2 $$  ')).toBe('x^2');
	});

	it('preserves raw LaTeX environments without delimiters', () => {
		const env = '\\begin{align}\na &= b \\\\\nc &= d\n\\end{align}';
		expect(normalizeLatex(env)).toBe(env.trim());
	});

	it('strips embedded $ delimiters from mimebundle content', () => {
		expect(normalizeLatex('$E = mc^2$ \\quad \\Rightarrow \\quad m = \\frac{E}{c^2}'))
			.toBe('E = mc^2 \\quad \\Rightarrow \\quad m = \\frac{E}{c^2}');
	});

	it('handles IPython.display.Math output (\\displaystyle with single $)', () => {
		expect(normalizeLatex('$\\displaystyle \\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}$'))
			.toBe('\\displaystyle \\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}');
	});

	it('preserves escaped \\$ (literal dollar signs)', () => {
		expect(normalizeLatex('\\$5 + \\$10 = \\$15')).toBe('\\$5 + \\$10 = \\$15');
	});

	it('strips unescaped $ but preserves escaped \\$ in mixed content', () => {
		expect(normalizeLatex('$\\text{costs \\$5}$')).toBe('\\text{costs \\$5}');
	});

	it('handles empty content', () => {
		expect(normalizeLatex('')).toBe('');
	});

	it('handles whitespace-only content', () => {
		expect(normalizeLatex('   ')).toBe('');
	});
});
