/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
/// <reference types="vitest/globals" />

import { CellKind, ICellDto2 } from '../../../notebook/common/notebookCommon.js';
import { notebookToQmd } from '../../common/notebookToQmd.js';

describe('notebookToQmd', () => {

	function codeCell(code: string, language: string, metadata?: Record<string, unknown>): ICellDto2 {
		return { cellKind: CellKind.Code, source: code, language, mime: undefined, outputs: [], metadata };
	}

	function markdownCell(content: string): ICellDto2 {
		return { cellKind: CellKind.Markup, source: content, language: 'markdown', mime: undefined, outputs: [] };
	}

	function frontmatterCell(content: string): ICellDto2 {
		return codeCell(content, 'raw', { quarto: { type: 'frontmatter' } });
	}

	function notebook(cells: ICellDto2[]) {
		return { cells, metadata: {} };
	}

	describe('Basic serialization', () => {

		it('should serialize code cell to fenced code block', () => {
			const result = notebookToQmd(notebook([codeCell('print("hello")', 'python')]));

			expect(result).toBe('```{python}\nprint("hello")\n```\n');
		});

		it('should serialize markdown cell as-is', () => {
			const result = notebookToQmd(notebook([markdownCell('# Title\n\nSome paragraph text.')]));

			expect(result).toBe('# Title\n\nSome paragraph text.\n');
		});

		it('should serialize R code cell', () => {
			const result = notebookToQmd(notebook([codeCell('plot(x)', 'r')]));

			expect(result).toBe('```{r}\nplot(x)\n```\n');
		});

		it('should serialize Julia code cell', () => {
			const result = notebookToQmd(notebook([codeCell('println("hi")', 'julia')]));

			expect(result).toBe('```{julia}\nprintln("hi")\n```\n');
		});

		it('should serialize plain code block without braces', () => {
			const result = notebookToQmd(notebook([codeCell('some code', 'text')]));

			expect(result).toBe('```{text}\nsome code\n```\n');
		});

		it('should preserve multiline code content exactly', () => {
			const code = 'def foo():\n    return 42\n\nprint(foo())';
			const result = notebookToQmd(notebook([codeCell(code, 'python')]));

			expect(result.includes(code)).toBeTruthy();
		});

		it('should handle code cell with execution options in content', () => {
			const code = '#| echo: false\n#| eval: true\nprint("hello")';
			const result = notebookToQmd(notebook([codeCell(code, 'python')]));

			expect(result.includes('#| echo: false')).toBeTruthy();
			expect(result.includes('#| eval: true')).toBeTruthy();
		});

		it('should preserve Quarto div syntax in markdown', () => {
			const content = '::: {.callout-note}\nThis is a callout.\n:::';
			const result = notebookToQmd(notebook([markdownCell(content)]));

			expect(result.includes('::: {.callout-note}')).toBeTruthy();
			expect(result.includes(':::')).toBeTruthy();
		});

	});

	describe('Cell markers', () => {

		it('should insert <!-- cell --> between consecutive markdown cells', () => {
			const result = notebookToQmd(notebook([
				markdownCell('# Cell 1'),
				markdownCell('# Cell 2'),
			]));

			expect(result).toBe('# Cell 1\n\n<!-- cell -->\n\n# Cell 2\n');
		});

		it('should not insert marker between markdown and code cells', () => {
			const result = notebookToQmd(notebook([
				markdownCell('# Intro'),
				codeCell('x = 1', 'python'),
			]));

			expect(!result.includes('<!-- cell -->')).toBeTruthy();
			expect(result).toBe('# Intro\n\n```{python}\nx = 1\n```\n');
		});

		it('should not insert marker between code and markdown cells', () => {
			const result = notebookToQmd(notebook([
				codeCell('x = 1', 'python'),
				markdownCell('# Results'),
			]));

			expect(!result.includes('<!-- cell -->')).toBeTruthy();
		});

		it('should not insert marker between consecutive code cells', () => {
			const result = notebookToQmd(notebook([
				codeCell('x = 1', 'python'),
				codeCell('y = 2', 'r'),
			]));

			expect(!result.includes('<!-- cell -->')).toBeTruthy();
		});

		it('should handle three consecutive markdown cells', () => {
			const result = notebookToQmd(notebook([
				markdownCell('# One'),
				markdownCell('# Two'),
				markdownCell('# Three'),
			]));

			const markers = (result.match(/<!-- cell -->/g) || []).length;
			expect(markers).toBe(2);
		});

		it('should preserve empty markdown cells', () => {
			const result = notebookToQmd(notebook([
				markdownCell('# Title'),
				markdownCell(''),
				markdownCell('# Another'),
			]));

			const markers = (result.match(/<!-- cell -->/g) || []).length;
			expect(markers).toBe(2);
		});

	});

	describe('Mixed content', () => {

		it('should interleave markdown and code cells correctly', () => {
			const result = notebookToQmd(notebook([
				markdownCell('# Intro'),
				codeCell('x = 1', 'python'),
				markdownCell('## Results'),
				codeCell('plot(x)', 'r'),
			]));

			expect(result.includes('# Intro')).toBeTruthy();
			expect(result.includes('```{python}')).toBeTruthy();
			expect(result.includes('## Results')).toBeTruthy();
			expect(result.includes('```{r}')).toBeTruthy();
			expect(!result.includes('<!-- cell -->')).toBeTruthy();
		});

	});

	describe('Frontmatter', () => {

		it('should serialize frontmatter cell', () => {
			const result = notebookToQmd(notebook([frontmatterCell('---\ntitle: Test Document\nauthor: Test Author\n---'), markdownCell('# Content')]));

			expect(result.startsWith('---\n')).toBeTruthy();
			expect(result.includes('title: Test Document')).toBeTruthy();
			expect(result.includes('author: Test Author')).toBeTruthy();
		});

		it('should not emit empty frontmatter cell', () => {
			const result = notebookToQmd(notebook([frontmatterCell(''), markdownCell('# Content')]));

			expect(result).toBe('\n\n# Content\n');
		});

	});

});
