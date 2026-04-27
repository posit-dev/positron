/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { createTestContainer } from '../../../../../../test/browser/positronTestContainer.js';
import { splitMarkdown, extractTranslatable, applyTranslated, reassemble } from '../../../../browser/contrib/translate/markdownProtection.js';

suite('markdownProtection', () => {
	createTestContainer().build();

	suite('splitMarkdown', () => {
		test('plain prose is fully translatable', () => {
			const segments = splitMarkdown('Hello, world!');
			assert.strictEqual(segments.length, 1);
			assert.strictEqual(segments[0].translatable, true);
			assert.strictEqual(segments[0].text, 'Hello, world!');
		});

		test('heading prefix is non-translatable', () => {
			const segments = splitMarkdown('### My heading');
			const nonTranslatable = segments.filter(s => !s.translatable);
			assert.ok(nonTranslatable.some(s => s.text === '### '));
			assert.strictEqual(reassemble(segments), '### My heading');
		});

		test('all heading levels are preserved', () => {
			const md = '# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6';
			const segments = splitMarkdown(md);
			assert.strictEqual(reassemble(segments), md);
			const headingPrefixes = segments.filter(s => !s.translatable && /^#{1,6}\s$/.test(s.text));
			assert.strictEqual(headingPrefixes.length, 6);
		});

		test('list markers are non-translatable', () => {
			const md = '- item one\n* item two\n1. item three';
			const segments = splitMarkdown(md);
			assert.strictEqual(reassemble(segments), md);
			const markers = segments.filter(s => !s.translatable && /^\s*[-*+]|\d+[.)]/.test(s.text.trim()));
			assert.strictEqual(markers.length, 3);
		});

		test('fenced code blocks are non-translatable', () => {
			const md = '# Title\n\n```python\nprint("hello")\n```\n\nSome text.';
			const segments = splitMarkdown(md);
			assert.strictEqual(reassemble(segments), md);
			const codeSegments = segments.filter(s => !s.translatable && s.text.includes('print'));
			assert.ok(codeSegments.length > 0);
		});

		test('inline code is non-translatable', () => {
			const md = 'Use `console.log()` to debug.';
			const segments = splitMarkdown(md);
			assert.strictEqual(reassemble(segments), md);
			const codeSegments = segments.filter(s => !s.translatable && s.text.includes('console.log'));
			assert.ok(codeSegments.length > 0);
		});

		test('inline math is non-translatable', () => {
			const md = 'Einstein showed that $E = mc^2$ is fundamental.';
			const segments = splitMarkdown(md);
			assert.strictEqual(reassemble(segments), md);
			const mathSegments = segments.filter(s => !s.translatable && s.text.includes('E = mc^2'));
			assert.ok(mathSegments.length > 0);
		});

		test('block math is non-translatable', () => {
			const md = 'The integral:\n\n$$\\int_0^1 x^2 dx$$\n\nis one-third.';
			const segments = splitMarkdown(md);
			assert.strictEqual(reassemble(segments), md);
			const mathSegments = segments.filter(s => !s.translatable && s.text.includes('\\int'));
			assert.ok(mathSegments.length > 0);
		});

		test('LaTeX environments are non-translatable', () => {
			const md = 'Consider:\n\n\\begin{equation}\na^2 + b^2 = c^2\n\\end{equation}\n\nwhich is Pythagoras.';
			const segments = splitMarkdown(md);
			assert.strictEqual(reassemble(segments), md);
		});

		test('image references are non-translatable', () => {
			const md = 'See the diagram: ![alt text](images/figure1.png)';
			const segments = splitMarkdown(md);
			assert.strictEqual(reassemble(segments), md);
		});

		test('link URLs are non-translatable', () => {
			const md = 'Visit [our docs](https://example.com/docs) for more info.';
			const segments = splitMarkdown(md);
			assert.strictEqual(reassemble(segments), md);
			const urlSegments = segments.filter(s => !s.translatable && s.text.includes('https://example.com'));
			assert.ok(urlSegments.length > 0);
		});

		test('bare URLs are non-translatable', () => {
			const md = 'Check out https://example.com for details.';
			const segments = splitMarkdown(md);
			assert.strictEqual(reassemble(segments), md);
		});

		test('empty string round-trips', () => {
			const segments = splitMarkdown('');
			assert.strictEqual(reassemble(segments), '');
		});

		test('whitespace-only text round-trips', () => {
			const md = '   \n\n   ';
			const segments = splitMarkdown(md);
			assert.strictEqual(reassemble(segments), md);
		});

		test('heading with inline code round-trips', () => {
			const md = '# Title with `code`';
			const segments = splitMarkdown(md);
			assert.strictEqual(reassemble(segments), md);
			assert.ok(segments.some(s => !s.translatable && s.text === '# '));
			assert.ok(segments.some(s => !s.translatable && s.text === '`code`'));
		});

		test('unicode text round-trips', () => {
			const md = 'Hello world. 你好世界.';
			const segments = splitMarkdown(md);
			assert.strictEqual(reassemble(segments), md);
		});
	});

	suite('round-trip', () => {
		test('reassemble always reproduces original', () => {
			const md = [
				'# Analysis',
				'',
				'The formula $E = mc^2$ is well-known.',
				'',
				'```python',
				'result = compute()',
				'```',
				'',
				'- first item',
				'- second item',
				'',
				'See [docs](https://example.com) for more.',
			].join('\n');

			const segments = splitMarkdown(md);
			assert.strictEqual(reassemble(segments), md);
		});

		test('extract and apply preserves non-translatable content', () => {
			const md = '### Title\n\nSome prose here.\n\n`code block`';
			const segments = splitMarkdown(md);
			const { text, indices } = extractTranslatable(segments);

			const translated = text.toUpperCase();
			const result = applyTranslated(segments, translated, indices);
			const output = reassemble(result);

			assert.ok(output.startsWith('### '));
			assert.ok(output.includes('`code block`'));
			assert.ok(output.includes('TITLE') || output.includes('SOME PROSE HERE'));
		});

		test('complex document with all features round-trips', () => {
			const md = [
				'# Main Title',
				'',
				'Some introductory text with `inline code` and a [link](https://example.com).',
				'',
				'## Section with Math',
				'',
				'The formula $E = mc^2$ shows that:',
				'',
				'$$\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}$$',
				'',
				'### List of Items',
				'',
				'- first item with `code`',
				'- second item',
				'* third item',
				'1. numbered item',
				'',
				'```python',
				'import numpy as np',
				'result = np.sqrt(2)',
				'```',
				'',
				'Final paragraph with https://example.com and ![image](img.png).',
			].join('\n');

			const segments = splitMarkdown(md);
			assert.strictEqual(reassemble(segments), md);
		});
	});

	suite('extractTranslatable', () => {
		test('skips empty translatable segments', () => {
			const md = '# Title\n\n\n\nSome text.';
			const segments = splitMarkdown(md);
			const { indices } = extractTranslatable(segments);
			const texts = indices.map(i => segments[i].text);
			assert.ok(texts.every(t => t.trim().length > 0));
		});

		test('returns empty indices for non-translatable-only input', () => {
			const md = '```python\nprint("hello")\n```';
			const segments = splitMarkdown(md);
			const { text, indices } = extractTranslatable(segments);
			assert.strictEqual(indices.length, 0);
			assert.strictEqual(text, '');
		});
	});

	suite('applyTranslated edge cases', () => {
		test('handles fewer translated parts than indices', () => {
			const segments = splitMarkdown('Hello\nWorld\nTest');
			const { indices } = extractTranslatable(segments);
			const result = applyTranslated(segments, 'Hola', indices);
			const output = reassemble(result);
			assert.ok(output.includes('Hola'));
		});

		test('handles more translated parts than indices', () => {
			const segments = splitMarkdown('Hello');
			const { indices } = extractTranslatable(segments);
			const result = applyTranslated(segments, 'Hola\nExtra\nMore', indices);
			reassemble(result);
		});

		test('handles empty translated text', () => {
			const segments = splitMarkdown('Hello');
			const { indices } = extractTranslatable(segments);
			const result = applyTranslated(segments, '', indices);
			reassemble(result);
		});
	});
});
