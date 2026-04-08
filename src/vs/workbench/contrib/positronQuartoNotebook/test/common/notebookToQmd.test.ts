/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { CellKind, ICellDto2 } from '../../../notebook/common/notebookCommon.js';
import { notebookToQmd } from '../../common/notebookToQmd.js';

suite('notebookToQmd', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

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

	suite('Basic serialization', () => {

		test('should serialize code cell to fenced code block', () => {
			const result = notebookToQmd(notebook([codeCell('print("hello")', 'python')]));

			assert.strictEqual(result, '```{python}\nprint("hello")\n```\n');
		});

		test('should serialize markdown cell as-is', () => {
			const result = notebookToQmd(notebook([markdownCell('# Title\n\nSome paragraph text.')]));

			assert.strictEqual(result, '# Title\n\nSome paragraph text.\n');
		});

		test('should serialize R code cell', () => {
			const result = notebookToQmd(notebook([codeCell('plot(x)', 'r')]));

			assert.strictEqual(result, '```{r}\nplot(x)\n```\n');
		});

		test('should serialize Julia code cell', () => {
			const result = notebookToQmd(notebook([codeCell('println("hi")', 'julia')]));

			assert.strictEqual(result, '```{julia}\nprintln("hi")\n```\n');
		});

		test('should serialize plain code block without braces', () => {
			const result = notebookToQmd(notebook([codeCell('some code', 'text')]));

			assert.strictEqual(result, '```{text}\nsome code\n```\n');
		});

		test('should preserve multiline code content exactly', () => {
			const code = 'def foo():\n    return 42\n\nprint(foo())';
			const result = notebookToQmd(notebook([codeCell(code, 'python')]));

			assert.ok(result.includes(code));
		});

		test('should handle code cell with execution options in content', () => {
			const code = '#| echo: false\n#| eval: true\nprint("hello")';
			const result = notebookToQmd(notebook([codeCell(code, 'python')]));

			assert.ok(result.includes('#| echo: false'));
			assert.ok(result.includes('#| eval: true'));
		});

		test('should preserve Quarto div syntax in markdown', () => {
			const content = '::: {.callout-note}\nThis is a callout.\n:::';
			const result = notebookToQmd(notebook([markdownCell(content)]));

			assert.ok(result.includes('::: {.callout-note}'));
			assert.ok(result.includes(':::'));
		});

	});

	suite('Cell markers', () => {

		test('should insert <!-- cell --> between consecutive markdown cells', () => {
			const result = notebookToQmd(notebook([
				markdownCell('# Cell 1'),
				markdownCell('# Cell 2'),
			]));

			assert.strictEqual(result, '# Cell 1\n\n<!-- cell -->\n\n# Cell 2\n');
		});

		test('should not insert marker between markdown and code cells', () => {
			const result = notebookToQmd(notebook([
				markdownCell('# Intro'),
				codeCell('x = 1', 'python'),
			]));

			assert.ok(!result.includes('<!-- cell -->'));
			assert.strictEqual(result, '# Intro\n\n```{python}\nx = 1\n```\n');
		});

		test('should not insert marker between code and markdown cells', () => {
			const result = notebookToQmd(notebook([
				codeCell('x = 1', 'python'),
				markdownCell('# Results'),
			]));

			assert.ok(!result.includes('<!-- cell -->'));
		});

		test('should not insert marker between consecutive code cells', () => {
			const result = notebookToQmd(notebook([
				codeCell('x = 1', 'python'),
				codeCell('y = 2', 'r'),
			]));

			assert.ok(!result.includes('<!-- cell -->'));
		});

		test('should handle three consecutive markdown cells', () => {
			const result = notebookToQmd(notebook([
				markdownCell('# One'),
				markdownCell('# Two'),
				markdownCell('# Three'),
			]));

			const markers = (result.match(/<!-- cell -->/g) || []).length;
			assert.strictEqual(markers, 2, 'Should have 2 markers for 3 consecutive markdown cells');
		});

		test('should preserve empty markdown cells', () => {
			const result = notebookToQmd(notebook([
				markdownCell('# Title'),
				markdownCell(''),
				markdownCell('# Another'),
			]));

			const markers = (result.match(/<!-- cell -->/g) || []).length;
			assert.strictEqual(markers, 2);
		});

	});

	suite('Mixed content', () => {

		test('should interleave markdown and code cells correctly', () => {
			const result = notebookToQmd(notebook([
				markdownCell('# Intro'),
				codeCell('x = 1', 'python'),
				markdownCell('## Results'),
				codeCell('plot(x)', 'r'),
			]));

			assert.ok(result.includes('# Intro'));
			assert.ok(result.includes('```{python}'));
			assert.ok(result.includes('## Results'));
			assert.ok(result.includes('```{r}'));
			assert.ok(!result.includes('<!-- cell -->'));
		});

	});

	suite('Frontmatter', () => {

		test('should serialize frontmatter cell', () => {
			const result = notebookToQmd(notebook([frontmatterCell('---\ntitle: Test Document\nauthor: Test Author\n---'), markdownCell('# Content')]));

			assert.ok(result.startsWith('---\n'));
			assert.ok(result.includes('title: Test Document'));
			assert.ok(result.includes('author: Test Author'));
		});

		test('should not emit empty frontmatter cell', () => {
			const result = notebookToQmd(notebook([frontmatterCell(''), markdownCell('# Content')]));

			assert.strictEqual(result, '\n\n# Content\n');
		});

	});

});
