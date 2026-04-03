/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { kernelToLanguageId, parseQuarto } from '../../common/quartoParser.js';
import { QuartoCodeBlock, QuartoNodeType, QuartoRawBlock } from '../../common/quartoTypes.js';

describe('parseQuartoDocument', () => {

	describe('Empty and minimal documents', () => {
		it('empty string returns no blocks', () => {
			const result = parseQuarto('');
			expect(result.blocks.length).toBe(0);
			expect(result.frontmatter).toBe(undefined);
		});

		it('markdown-only document returns no blocks', () => {
			// NOTE: markdown blocks are not currently supported
			const result = parseQuarto('# Hello\n\nSome text here.\n');
			expect(result.blocks.length).toBe(0);
			expect(result.frontmatter).toBe(undefined);
		});

		it('frontmatter-only document returns no blocks', () => {
			const result = parseQuarto('---\ntitle: Test\n---\n');
			expect(result.blocks.length).toBe(0);
			expect(result.frontmatter).toBeTruthy();
			expect(result.frontmatter!.rawContent).toBe('---\ntitle: Test\n---');
		});
	});

	describe('Frontmatter', () => {
		it('extracts raw frontmatter content including delimiters', () => {
			const content = '---\ntitle: Test\nauthor: Someone\n---\n\nBody text.';
			const result = parseQuarto(content);
			expect(result.frontmatter).toBeTruthy();
			expect(result.frontmatter!.rawContent).toBe('---\ntitle: Test\nauthor: Someone\n---');
		});

		it('extracts simple jupyter kernel', () => {
			const content = '---\njupyter: python3\n---\n';
			const result = parseQuarto(content);
			expect(result.frontmatter).toBeTruthy();
			expect(result.frontmatter!.jupyterKernel).toBe('python3');
		});

		it('extracts complex jupyter kernel', () => {
			const content = '---\njupyter:\n  kernelspec:\n    name: ir\n---\n';
			const result = parseQuarto(content);
			expect(result.frontmatter).toBeTruthy();
			expect(result.frontmatter!.jupyterKernel).toBe('ir');
		});

		it('location is correct', () => {
			const content = '---\ntitle: Test\n---\n\n```{python}\nx = 1\n```\n';
			const result = parseQuarto(content);
			expect(result.frontmatter).toBeTruthy();
			expect(result.frontmatter!.location).toEqual({ begin: { line: 0 }, end: { line: 2 } });
		});

		it('frontmatter with no jupyter key has no kernel', () => {
			const content = '---\ntitle: Test\nformat: html\n---\n';
			const result = parseQuarto(content);
			expect(result.frontmatter).toBeTruthy();
			expect(result.frontmatter!.jupyterKernel).toBe(undefined);
		});
	});

	describe('kernelToLanguageId', () => {
		it('maps python3 to python', () => {
			expect(kernelToLanguageId('python3')).toBe('python');
		});

		it('maps ir to r', () => {
			expect(kernelToLanguageId('ir')).toBe('r');
		});

		it('maps ark to r', () => {
			expect(kernelToLanguageId('ark')).toBe('r');
		});

		it('maps r to r', () => {
			expect(kernelToLanguageId('r')).toBe('r');
		});

		it('returns undefined for unknown kernel', () => {
			expect(kernelToLanguageId('unknown')).toBe(undefined);
		});
	});

	describe('Code blocks', () => {
		it('parses a single code block', () => {
			const content = '```{python}\nx = 1\n```\n';
			const result = parseQuarto(content);
			expect(result.blocks.length).toBe(1);
			const block = result.blocks[0] as QuartoCodeBlock;
			expect(block.type).toBe(QuartoNodeType.CodeBlock);
			expect(block.language).toBe('python');
			expect(block.location.begin.line).toBe(0);
			expect(block.location.end.line).toBe(2);
			expect(block.content).toBe('x = 1');
		});

		it('parses multiple code blocks', () => {
			const content = '```{python}\nx = 1\n```\n\n```{r}\ny <- 2\n```\n';
			const result = parseQuarto(content);
			expect(result.blocks.length).toBe(2);

			const block0 = result.blocks[0] as QuartoCodeBlock;
			expect(block0.type).toBe(QuartoNodeType.CodeBlock);
			expect(block0.language).toBe('python');

			const block1 = result.blocks[1] as QuartoCodeBlock;
			expect(block1.type).toBe(QuartoNodeType.CodeBlock);
			expect(block1.language).toBe('r');
		});

		it('language is lowercased', () => {
			const content = '```{Python}\nx = 1\n```\n';
			const result = parseQuarto(content);
			const block = result.blocks[0] as QuartoCodeBlock;
			expect(block.language).toBe('python');
		});

		it('multiline code block has correct line numbers', () => {
			const content = 'Some text\n\n```{python}\nline1\nline2\nline3\n```\n';
			const result = parseQuarto(content);
			expect(result.blocks.length).toBe(1);
			const block = result.blocks[0] as QuartoCodeBlock;
			expect(block.location.begin.line).toBe(2);
			expect(block.location.end.line).toBe(6);
			expect(block.content).toBe('line1\nline2\nline3');
		});

		it('empty code block has empty content', () => {
			const content = '```{python}\n```\n';
			const result = parseQuarto(content);
			expect(result.blocks.length).toBe(1);
			const block = result.blocks[0] as QuartoCodeBlock;
			expect(block.location.begin.line).toBe(0);
			expect(block.location.end.line).toBe(1);
			expect(block.content).toBe('');
		});

		it('code block after frontmatter has correct line numbers', () => {
			const content = '---\ntitle: Test\n---\n\n```{python}\nx = 1\n```\n';
			const result = parseQuarto(content);
			expect(result.blocks.length).toBe(1);
			const block = result.blocks[0] as QuartoCodeBlock;
			expect(block.location.begin.line).toBe(4);
			expect(block.location.end.line).toBe(6);
		});
	});

	describe('Options and labels', () => {
		it('extracts options string', () => {
			const content = '```{python echo=FALSE, eval=TRUE}\nx = 1\n```\n';
			const result = parseQuarto(content);
			const block = result.blocks[0] as QuartoCodeBlock;
			expect(block.options).toBe('echo=FALSE, eval=TRUE');
		});

		it('extracts label from first option without =', () => {
			const content = '```{python setup}\nx = 1\n```\n';
			const result = parseQuarto(content);
			const block = result.blocks[0] as QuartoCodeBlock;
			expect(block.label).toBe('setup');
			expect(block.options).toBe('setup');
		});

		it('label with comma-separated options', () => {
			const content = '```{python my-label, echo=FALSE}\nx = 1\n```\n';
			const result = parseQuarto(content);
			const block = result.blocks[0] as QuartoCodeBlock;
			expect(block.label).toBe('my-label');
		});

		it('no label when first option contains =', () => {
			const content = '```{python echo=FALSE}\nx = 1\n```\n';
			const result = parseQuarto(content);
			const block = result.blocks[0] as QuartoCodeBlock;
			expect(block.label).toBe(undefined);
		});

		it('empty options when none provided', () => {
			const content = '```{python}\nx = 1\n```\n';
			const result = parseQuarto(content);
			const block = result.blocks[0] as QuartoCodeBlock;
			expect(block.options).toBe('');
			expect(block.label).toBe(undefined);
		});
	});

	describe('Raw blocks', () => {
		it('parses a raw block', () => {
			const content = '```{=html}\n<b>bold</b>\n```\n';
			const result = parseQuarto(content);
			expect(result.blocks.length).toBe(1);
			const block = result.blocks[0] as QuartoRawBlock;
			expect(block.type).toBe(QuartoNodeType.RawBlock);
			expect(block.format).toBe('html');
			expect(block.location.begin.line).toBe(0);
			expect(block.location.end.line).toBe(2);
			expect(block.content).toBe('<b>bold</b>');
		});

		it('raw block format is lowercased', () => {
			const content = '```{=LaTeX}\n\\textbf{bold}\n```\n';
			const result = parseQuarto(content);
			const block = result.blocks[0] as QuartoRawBlock;
			expect(block.format).toBe('latex');
		});

	});

	describe('Mixed code and raw blocks', () => {
		it('code and raw blocks interleaved', () => {
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

			const result = parseQuarto(content);
			expect(result.blocks.length).toBe(3);
			expect(result.blocks[0].type).toBe(QuartoNodeType.CodeBlock);
			expect(result.blocks[1].type).toBe(QuartoNodeType.RawBlock);
			expect(result.blocks[2].type).toBe(QuartoNodeType.CodeBlock);
		});
	});

	describe('Plain fences', () => {
		it('plain fence is not parsed as a block', () => {
			const content = '```\nsome code\n```\n';
			const result = parseQuarto(content);
			expect(result.blocks.length).toBe(0);
		});

		it('plain fence with language is not parsed as a block', () => {
			const content = '```python\nsome code\n```\n';
			const result = parseQuarto(content);
			expect(result.blocks.length).toBe(0);
		});

		it('plain fence does not interfere with executable code blocks', () => {
			const content = [
				'```python',
				'# this is just markdown',
				'```',
				'',
				'```{python}',
				'x = 1',
				'```',
			].join('\n');

			const result = parseQuarto(content);
			expect(result.blocks.length).toBe(1);
			const block = result.blocks[0] as QuartoCodeBlock;
			expect(block.language).toBe('python');
			expect(block.location.begin.line).toBe(4);
		});
	});

	describe('Lines array', () => {
		it('returns split lines', () => {
			const content = 'line1\nline2\nline3';
			const result = parseQuarto(content);
			expect(result.lines.length).toBe(3);
			expect(result.lines[0]).toBe('line1');
			expect(result.lines[1]).toBe('line2');
			expect(result.lines[2]).toBe('line3');
		});

		it('content at line ranges matches block content', () => {
			const content = '# Title\n\n```{python}\nfoo\nbar\n```\n\nEnd.\n';
			const result = parseQuarto(content);
			const block = result.blocks[0] as QuartoCodeBlock;
			expect(block.content).toBe('foo\nbar');
		});
	});

	describe('Unclosed fences', () => {
		it('unclosed code block is ignored', () => {
			const content = '```{python}\nx = 1\ny = 2';
			const result = parseQuarto(content);
			expect(result.blocks.length).toBe(0);
		});

		it('unclosed raw block is ignored', () => {
			const content = '```{=html}\n<b>bold</b>';
			const result = parseQuarto(content);
			expect(result.blocks.length).toBe(0);
		});
	});
});
