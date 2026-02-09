/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { parseQuartoDocument } from '../../common/quartoDocumentParser.js';
import { QuartoCodeBlock, QuartoNodeType, QuartoRawBlock } from '../../common/quartoTypes.js';

suite('parseQuartoDocument', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	// --- Empty / minimal documents ---

	suite('Empty and minimal documents', () => {
		test('empty string returns no blocks', () => {
			const result = parseQuartoDocument('');
			assert.strictEqual(result.blocks.length, 0);
			assert.strictEqual(result.frontmatter, undefined);
		});

		test('markdown-only document returns no blocks', () => {
			const result = parseQuartoDocument('# Hello\n\nSome text here.\n');
			assert.strictEqual(result.blocks.length, 0);
			assert.strictEqual(result.frontmatter, undefined);
		});

		test('frontmatter-only document returns no blocks', () => {
			const result = parseQuartoDocument('---\ntitle: Test\n---\n');
			assert.strictEqual(result.blocks.length, 0);
			assert.ok(result.frontmatter);
			assert.strictEqual(result.frontmatter.rawContent, '---\ntitle: Test\n---');
		});
	});

	// --- Frontmatter ---

	suite('Frontmatter', () => {
		test('extracts raw frontmatter content including delimiters', () => {
			const content = '---\ntitle: Test\nauthor: Someone\n---\n\nBody text.';
			const result = parseQuartoDocument(content);
			assert.ok(result.frontmatter);
			assert.strictEqual(result.frontmatter.rawContent, '---\ntitle: Test\nauthor: Someone\n---');
		});

		test('extracts simple jupyter kernel', () => {
			const content = '---\njupyter: python3\n---\n';
			const result = parseQuartoDocument(content);
			assert.ok(result.frontmatter);
			assert.strictEqual(result.frontmatter.jupyterKernel, 'python3');
		});

		test('extracts complex jupyter kernel', () => {
			const content = '---\njupyter:\n  kernelspec:\n    name: ir\n---\n';
			const result = parseQuartoDocument(content);
			assert.ok(result.frontmatter);
			assert.strictEqual(result.frontmatter.jupyterKernel, 'ir');
		});

		test('location is correct', () => {
			const content = '---\ntitle: Test\n---\n\n```{python}\nx = 1\n```\n';
			const result = parseQuartoDocument(content);
			assert.ok(result.frontmatter);
			assert.deepStrictEqual(result.frontmatter.location, { begin: { line: 1 }, end: { line: 3 } });
		});

		test('frontmatter with no jupyter key has no kernel', () => {
			const content = '---\ntitle: Test\nformat: html\n---\n';
			const result = parseQuartoDocument(content);
			assert.ok(result.frontmatter);
			assert.strictEqual(result.frontmatter.jupyterKernel, undefined);
		});
	});

	// --- Code blocks ---

	suite('Code blocks', () => {
		test('parses a single code block', () => {
			const content = '```{python}\nx = 1\n```\n';
			const result = parseQuartoDocument(content);
			assert.strictEqual(result.blocks.length, 1);
			const block = result.blocks[0] as QuartoCodeBlock;
			assert.strictEqual(block.type, QuartoNodeType.CodeBlock);
			assert.strictEqual(block.language, 'python');
			assert.strictEqual(block.location.begin.line, 1);
			assert.strictEqual(block.location.end.line, 3);
			assert.strictEqual(block.content, 'x = 1');
		});

		test('parses multiple code blocks', () => {
			const content = '```{python}\nx = 1\n```\n\n```{r}\ny <- 2\n```\n';
			const result = parseQuartoDocument(content);
			assert.strictEqual(result.blocks.length, 2);

			const block0 = result.blocks[0] as QuartoCodeBlock;
			assert.strictEqual(block0.type, QuartoNodeType.CodeBlock);
			assert.strictEqual(block0.language, 'python');

			const block1 = result.blocks[1] as QuartoCodeBlock;
			assert.strictEqual(block1.type, QuartoNodeType.CodeBlock);
			assert.strictEqual(block1.language, 'r');
		});

		test('language is lowercased', () => {
			const content = '```{Python}\nx = 1\n```\n';
			const result = parseQuartoDocument(content);
			const block = result.blocks[0] as QuartoCodeBlock;
			assert.strictEqual(block.language, 'python');
		});

		test('multiline code block has correct line numbers', () => {
			const content = 'Some text\n\n```{python}\nline1\nline2\nline3\n```\n';
			const result = parseQuartoDocument(content);
			assert.strictEqual(result.blocks.length, 1);
			const block = result.blocks[0] as QuartoCodeBlock;
			assert.strictEqual(block.location.begin.line, 3);
			assert.strictEqual(block.location.end.line, 7);
			assert.strictEqual(block.content, 'line1\nline2\nline3');
		});

		test('empty code block has empty content', () => {
			const content = '```{python}\n```\n';
			const result = parseQuartoDocument(content);
			assert.strictEqual(result.blocks.length, 1);
			const block = result.blocks[0] as QuartoCodeBlock;
			assert.strictEqual(block.location.begin.line, 1);
			assert.strictEqual(block.location.end.line, 2);
			assert.strictEqual(block.content, '');
		});

		test('code block after frontmatter has correct line numbers', () => {
			const content = '---\ntitle: Test\n---\n\n```{python}\nx = 1\n```\n';
			const result = parseQuartoDocument(content);
			assert.strictEqual(result.blocks.length, 1);
			const block = result.blocks[0] as QuartoCodeBlock;
			assert.strictEqual(block.location.begin.line, 5);
			assert.strictEqual(block.location.end.line, 7);
		});
	});

	// --- Options and labels ---

	suite('Options and labels', () => {
		test('extracts options string', () => {
			const content = '```{python echo=FALSE, eval=TRUE}\nx = 1\n```\n';
			const result = parseQuartoDocument(content);
			const block = result.blocks[0] as QuartoCodeBlock;
			assert.strictEqual(block.options, 'echo=FALSE, eval=TRUE');
		});

		test('extracts label from first option without =', () => {
			const content = '```{python setup}\nx = 1\n```\n';
			const result = parseQuartoDocument(content);
			const block = result.blocks[0] as QuartoCodeBlock;
			assert.strictEqual(block.label, 'setup');
			assert.strictEqual(block.options, 'setup');
		});

		test('label with comma-separated options', () => {
			const content = '```{python my-label, echo=FALSE}\nx = 1\n```\n';
			const result = parseQuartoDocument(content);
			const block = result.blocks[0] as QuartoCodeBlock;
			assert.strictEqual(block.label, 'my-label');
		});

		test('no label when first option contains =', () => {
			const content = '```{python echo=FALSE}\nx = 1\n```\n';
			const result = parseQuartoDocument(content);
			const block = result.blocks[0] as QuartoCodeBlock;
			assert.strictEqual(block.label, undefined);
		});

		test('empty options when none provided', () => {
			const content = '```{python}\nx = 1\n```\n';
			const result = parseQuartoDocument(content);
			const block = result.blocks[0] as QuartoCodeBlock;
			assert.strictEqual(block.options, '');
			assert.strictEqual(block.label, undefined);
		});
	});

	// --- Raw blocks ---

	suite('Raw blocks', () => {
		test('parses a raw block', () => {
			const content = '```{=html}\n<b>bold</b>\n```\n';
			const result = parseQuartoDocument(content);
			assert.strictEqual(result.blocks.length, 1);
			const block = result.blocks[0] as QuartoRawBlock;
			assert.strictEqual(block.type, QuartoNodeType.RawBlock);
			assert.strictEqual(block.format, 'html');
			assert.strictEqual(block.location.begin.line, 1);
			assert.strictEqual(block.location.end.line, 3);
			assert.strictEqual(block.content, '<b>bold</b>');
		});

		test('raw block format is lowercased', () => {
			const content = '```{=LaTeX}\n\\textbf{bold}\n```\n';
			const result = parseQuartoDocument(content);
			const block = result.blocks[0] as QuartoRawBlock;
			assert.strictEqual(block.format, 'latex');
		});

	});

	// --- Mixed blocks ---

	suite('Mixed code and raw blocks', () => {
		test('code and raw blocks interleaved', () => {
			const content = [
				'# Title',
				'',
				'```{python}',
				'x = 1',
				'```',
				'',
				'```{=html}',
				'<b>bold</b>',
				'```',
				'',
				'```{r}',
				'y <- 2',
				'```',
			].join('\n');

			const result = parseQuartoDocument(content);
			assert.strictEqual(result.blocks.length, 3);
			assert.strictEqual(result.blocks[0].type, QuartoNodeType.CodeBlock);
			assert.strictEqual(result.blocks[1].type, QuartoNodeType.RawBlock);
			assert.strictEqual(result.blocks[2].type, QuartoNodeType.CodeBlock);
		});
	});

	// --- Plain fences (should NOT become blocks) ---

	suite('Plain fences', () => {
		test('plain fence is not parsed as a block', () => {
			const content = '```\nsome code\n```\n';
			const result = parseQuartoDocument(content);
			assert.strictEqual(result.blocks.length, 0);
		});

		test('plain fence with language is not parsed as a block', () => {
			const content = '```python\nsome code\n```\n';
			const result = parseQuartoDocument(content);
			assert.strictEqual(result.blocks.length, 0);
		});

		test('plain fence does not interfere with Quarto code blocks', () => {
			const content = [
				'```python',
				'# this is just markdown',
				'```',
				'',
				'```{python}',
				'x = 1',
				'```',
			].join('\n');

			const result = parseQuartoDocument(content);
			assert.strictEqual(result.blocks.length, 1);
			const block = result.blocks[0] as QuartoCodeBlock;
			assert.strictEqual(block.language, 'python');
			assert.strictEqual(block.location.begin.line, 5);
		});
	});

	// --- Lines array ---

	suite('Lines array', () => {
		test('returns split lines', () => {
			const content = 'line1\nline2\nline3';
			const result = parseQuartoDocument(content);
			assert.strictEqual(result.lines.length, 3);
			assert.strictEqual(result.lines[0], 'line1');
			assert.strictEqual(result.lines[1], 'line2');
			assert.strictEqual(result.lines[2], 'line3');
		});

		test('content at line ranges matches block content', () => {
			const content = '# Title\n\n```{python}\nfoo\nbar\n```\n\nEnd.\n';
			const result = parseQuartoDocument(content);
			const block = result.blocks[0] as QuartoCodeBlock;
			assert.strictEqual(block.content, 'foo\nbar');
		});
	});

	// --- Unclosed fences ---

	suite('Unclosed fences', () => {
		test('unclosed code block is ignored', () => {
			const content = '```{python}\nx = 1\ny = 2';
			const result = parseQuartoDocument(content);
			assert.strictEqual(result.blocks.length, 0);
		});

		test('unclosed raw block is ignored', () => {
			const content = '```{=html}\n<b>bold</b>';
			const result = parseQuartoDocument(content);
			assert.strictEqual(result.blocks.length, 0);
		});
	});
});
