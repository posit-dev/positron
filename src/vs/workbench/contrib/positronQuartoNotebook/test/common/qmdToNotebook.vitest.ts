/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, it } from 'vitest';
import { expect } from 'vitest';
import { qmdToNotebook } from '../../common/qmdToNotebook.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { isFrontmatterCell } from '../../common/notebookToQmd.js';

describe('qmdToNotebook', () => {

	describe('Basic conversion', () => {

		it('should convert CodeBlock to code cell', () => {
			const { cells } = qmdToNotebook('```{python}\nprint("hello")\n```');

			expect(cells.length).toBe(1);
			expect(cells[0].cellKind).toBe(CellKind.Code);
			expect(cells[0].language).toBe('python');
			expect(cells[0].source).toBe('print("hello")');
		});

		it('should merge consecutive markdown blocks', () => {
			const { cells } = qmdToNotebook('# Title\n\nSome paragraph text.');

			expect(cells.length).toBe(1);
			expect(cells[0].cellKind).toBe(CellKind.Markup);
			expect(cells[0].source).toBe('# Title\n\nSome paragraph text.');
		});

		it('should convert RawBlock to code cell with format as language', () => {
			const { cells } = qmdToNotebook('```{=latex}\n\\frac{1}{2}\n```');

			expect(cells.length).toBe(1);
			expect(cells[0].cellKind).toBe(CellKind.Code);
			expect(cells[0].language).toBe('raw');
		});

		it('should treat bare fence as markdown (non-executable)', () => {
			const { cells } = qmdToNotebook('```\nsome code\n```');

			expect(cells[0].cellKind).toBe(CellKind.Markup);
			expect(cells[0].language).toBe('markdown');
		});

		it('should extract frontmatter to first cell', () => {
			const { cells } = qmdToNotebook('---\ntitle: Test\nauthor: User\n---\n\n# Content');

			// First cell should be frontmatter
			expect(cells[0].cellKind).toBe(CellKind.Code);
			expect(cells[0].language).toBe('raw');
			expect(isFrontmatterCell(cells[0])).toBeTruthy();
			expect(cells[0].source.includes('title: Test')).toBeTruthy();
			expect(cells[0].source.includes('author: User')).toBeTruthy();
			// Should include --- delimiters
			expect(cells[0].source.startsWith('---')).toBeTruthy();
			expect(cells[0].source.endsWith('---')).toBeTruthy();
		});

		it('should preserve markdown content after front matter', () => {
			const { cells } = qmdToNotebook('---\ntitle: Test\n---\n\n# Heading\n\nParagraph text.');

			// First cell is frontmatter, second is markdown
			expect(cells.length).toBe(2);
			expect(isFrontmatterCell(cells[0])).toBeTruthy();
			expect(cells[1].cellKind).toBe(CellKind.Markup);
			expect(cells[1].source).toBe('# Heading\n\nParagraph text.');
		});

		it('should handle multi-byte UTF-8 characters correctly', () => {
			const { cells } = qmdToNotebook('# Pok\u00e9mon\n\nI love Pok\u00e9mon!');

			expect(cells.length).toBe(1);
			expect(cells[0].cellKind).toBe(CellKind.Markup);
			expect(cells[0].source).toBe('# Pok\u00e9mon\n\nI love Pok\u00e9mon!');
		});

		it('should handle multi-byte UTF-8 before code block', () => {
			const { cells } = qmdToNotebook('# Pok\u00e9mon\n\n```{python}\nprint("hello")\n```');

			expect(cells.length).toBe(2);
			expect(cells[0].cellKind).toBe(CellKind.Markup);
			expect(cells[0].source).toBe('# Pok\u00e9mon');
			expect(cells[1].cellKind).toBe(CellKind.Code);
			expect(cells[1].source).toBe('print("hello")');
		});

		it('should handle markdown after code with UTF-8', () => {
			const { cells } = qmdToNotebook('```{python}\nprint("Pok\u00e9mon")\n```\n\n# Results');

			expect(cells.length).toBe(2);
			expect(cells[0].cellKind).toBe(CellKind.Code);
			expect(cells[0].source).toBe('print("Pok\u00e9mon")');
			expect(cells[1].cellKind).toBe(CellKind.Markup);
			expect(cells[1].source).toBe('# Results');
		});

		it('should handle markdown after front matter with UTF-8', () => {
			const { cells } = qmdToNotebook('---\ntitle: Pok\u00e9mon\n---\n\nThis');

			expect(cells.length).toBe(2);
			expect(isFrontmatterCell(cells[0])).toBeTruthy();
			expect(cells[0].source.includes('Pok\u00e9mon')).toBeTruthy();
			expect(cells[1].cellKind).toBe(CellKind.Markup);
			expect(cells[1].source).toBe('This');
		});

		it('should handle Div blocks as markdown content', () => {
			const { cells } = qmdToNotebook('::: {.callout-note}\nThis is a callout.\n:::');

			expect(cells.length).toBe(1);
			expect(cells[0].cellKind).toBe(CellKind.Markup);
			expect(cells[0].source.includes('::: {.callout-note}')).toBeTruthy();
		});

		it('should interleave markdown and code cells correctly', () => {
			const { cells } = qmdToNotebook('# Intro\n\n```{python}\nx = 1\n```\n\n## Results\n\n```{r}\nplot(x)\n```');

			expect(cells.length).toBe(4);
			expect(cells[0].cellKind).toBe(CellKind.Markup);
			expect(cells[1].cellKind).toBe(CellKind.Code);
			expect(cells[1].language).toBe('python');
			expect(cells[2].cellKind).toBe(CellKind.Markup);
			expect(cells[3].cellKind).toBe(CellKind.Code);
			expect(cells[3].language).toBe('r');
			expect(cells[0].source).toBe('# Intro');
			expect(cells[2].source).toBe('## Results');
		});

		it('should handle R language', () => {
			const { cells } = qmdToNotebook('```{r}\nplot(x)\n```');

			expect(cells[0].language).toBe('r');
		});

		it('should handle Julia language', () => {
			const { cells } = qmdToNotebook('```{julia}\nprintln("hi")\n```');

			expect(cells[0].language).toBe('julia');
		});

		it('should open empty document with no cells', () => {
			const { cells } = qmdToNotebook('');

			expect(cells.length).toBe(0);
		});

		it('should handle document with only metadata', () => {
			const { cells } = qmdToNotebook('---\ntitle: Test\n---\n\n# Heading');

			expect(isFrontmatterCell(cells[0])).toBeTruthy();
			expect(cells[0].source.includes('title: Test')).toBeTruthy();
		});

		it('should handle code cell with multiple execution options', () => {
			const { cells } = qmdToNotebook('```{python}\n#| echo: false\n#| eval: true\n#| output: asis\nprint("hello")\n```');

			expect(cells.length).toBe(1);
			expect(cells[0].cellKind).toBe(CellKind.Code);
			expect(cells[0].language).toBe('python');
		});

		it('should preserve code content exactly', () => {
			const code = 'def foo():\n    return 42\n\nprint(foo())';
			const { cells } = qmdToNotebook('```{python}\n' + code + '\n```');

			expect(cells[0].source).toBe(code);
		});

		it('should handle multiple code blocks with different languages', () => {
			const { cells } = qmdToNotebook('```{python}\nx = 1\n```\n\n```{r}\ny <- 2\n```\n\n```{julia}\nz = 3\n```');

			expect(cells.length).toBe(3);
			expect(cells[0].language).toBe('python');
			expect(cells[1].language).toBe('r');
			expect(cells[2].language).toBe('julia');
		});

		it('should handle HorizontalRule in markdown', () => {
			const { cells } = qmdToNotebook('# Before\n\n---\n\n# After');

			expect(cells.length).toBe(1);
			expect(cells[0].cellKind).toBe(CellKind.Markup);
			expect(cells[0].source).toBe('# Before\n\n---\n\n# After');
		});

		it('should handle HorizontalRule between code blocks', () => {
			const { cells } = qmdToNotebook('```{python}\nx = 1\n```\n\n---\n\n```{python}\ny = 2\n```');

			expect(cells.length).toBe(3);
			expect(cells[0].cellKind).toBe(CellKind.Code);
			expect(cells[1].cellKind).toBe(CellKind.Markup);
			expect(cells[1].source).toBe('---');
			expect(cells[2].cellKind).toBe(CellKind.Code);
		});

		it('should not create frontmatter cell when document has none', () => {
			const { cells } = qmdToNotebook('# Just content\n\n```{python}\nx = 1\n```\n');

			expect(!isFrontmatterCell(cells[0])).toBeTruthy();
			expect(cells[0].cellKind).toBe(CellKind.Markup);
		});

	});

	describe('Cell markers', () => {

		it('should split markdown at <!-- cell --> marker', () => {
			const { cells } = qmdToNotebook('# Cell 1\n\n<!-- cell -->\n\n# Cell 2');

			expect(cells.length).toBe(2);
			expect(cells[0].cellKind).toBe(CellKind.Markup);
			expect(cells[1].cellKind).toBe(CellKind.Markup);
			expect(cells[0].source.trim()).toBe('# Cell 1');
			expect(cells[1].source.trim()).toBe('# Cell 2');
		});

		it('should handle multiple cell markers', () => {
			const { cells } = qmdToNotebook('# One\n\n<!-- cell -->\n\n# Two\n\n<!-- cell -->\n\n# Three');

			expect(cells.length).toBe(3);
		});

		it('should not include marker content in cells', () => {
			const { cells } = qmdToNotebook('# Cell 1\n\n<!-- cell -->\n\n# Cell 2');

			expect(!cells[0].source.includes('<!-- cell -->')).toBeTruthy();
			expect(!cells[1].source.includes('<!-- cell -->')).toBeTruthy();
		});

		it('should handle marker between code blocks', () => {
			const { cells } = qmdToNotebook('```{python}\nx = 1\n```\n\n<!-- cell -->\n\n```{r}\ny = 2\n```');

			// Should have 2 code cells (marker is ignored between code blocks since
			// the markdown region between them is just the marker, which splits into empty parts)
			const codeCells = cells.filter(c => c.cellKind === CellKind.Code);
			expect(codeCells.some(c => c.language === 'python')).toBeTruthy();
			expect(codeCells.some(c => c.language === 'r')).toBeTruthy();
		});

		it('should handle marker at document start', () => {
			const { cells } = qmdToNotebook('<!-- cell -->\n\n# Content');

			expect(cells.length).toBe(2);
			expect(cells[0].source).toBe('');
			expect(cells[1].source).toBe('# Content');
		});

		it('should handle marker at document end', () => {
			const { cells } = qmdToNotebook('# Content\n\n<!-- cell -->');

			expect(cells.length).toBe(2);
			expect(cells[0].source).toBe('# Content');
			expect(cells[1].source).toBe('');
		});

	});

	describe('Markdown cells', () => {

		it('should skip multiple blank lines between code blocks', () => {
			const { cells } = qmdToNotebook('```{python}\nx = 1\n```\n\n\n\n```{python}\ny = 2\n```');

			expect(cells.length).toBe(2);
			expect(cells[0].source).toBe('x = 1');
			expect(cells[1].source).toBe('y = 2');
		});

		it('should handle no blank lines between code blocks', () => {
			const { cells } = qmdToNotebook('```{python}\nx = 1\n```\n```{python}\ny = 2\n```');

			expect(cells.length).toBe(2);
			expect(cells[0].source).toBe('x = 1');
			expect(cells[1].source).toBe('y = 2');
		});

		it('should skip multiple blank lines after frontmatter', () => {
			const { cells } = qmdToNotebook('---\ntitle: Test\n---\n\n\n\n# Content');

			expect(cells.length).toBe(2);
			expect(isFrontmatterCell(cells[0])).toBeTruthy();
			expect(cells[1].cellKind).toBe(CellKind.Markup);
			expect(cells[1].source).toBe('# Content');
		});

		it('should not produce empty markdown cell from trailing blank lines', () => {
			const { cells } = qmdToNotebook('```{python}\nx = 1\n```\n\n\n');

			expect(cells.length).toBe(1);
			expect(cells[0].source).toBe('x = 1');
		});

		it('should not produce cells from document of only blank lines', () => {
			const { cells } = qmdToNotebook('\n\n\n');

			// All blank lines - either 0 cells or at most an empty-ish markup cell
			const nonEmpty = cells.filter(c => c.source.trim() !== '');
			expect(nonEmpty.length).toBe(0);
		});

		it('should skip blank lines between code block and end of document', () => {
			const { cells } = qmdToNotebook('# Intro\n\n```{python}\nx = 1\n```\n\n\n\n');

			expect(cells.length).toBe(2);
			expect(cells[0].cellKind).toBe(CellKind.Markup);
			expect(cells[0].source).toBe('# Intro');
			expect(cells[1].cellKind).toBe(CellKind.Code);
			expect(cells[1].source).toBe('x = 1');
		});

		it('should handle markdown between code blocks with multiple blank lines', () => {
			const { cells } = qmdToNotebook('```{python}\nx = 1\n```\n\n\n\n# Middle\n\n\n\n```{python}\ny = 2\n```');

			expect(cells.length).toBe(3);
			expect(cells[0].source).toBe('x = 1');
			expect(cells[1].cellKind).toBe(CellKind.Markup);
			expect(cells[1].source).toBe('# Middle');
			expect(cells[2].source).toBe('y = 2');
		});

	});

});
