/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { qmdToNotebook } from '../../common/qmdToNotebook.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { isFrontmatterCell } from '../../common/notebookToQmd.js';

suite('qmdToNotebook', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	suite('Basic conversion', () => {

		test('should convert CodeBlock to code cell', () => {
			const { cells } = qmdToNotebook('```{python}\nprint("hello")\n```');

			assert.strictEqual(cells.length, 1);
			assert.strictEqual(cells[0].cellKind, CellKind.Code);
			assert.strictEqual(cells[0].language, 'python');
			assert.strictEqual(cells[0].source, 'print("hello")');
		});

		test('should merge consecutive markdown blocks', () => {
			const { cells } = qmdToNotebook('# Title\n\nSome paragraph text.');

			assert.strictEqual(cells.length, 1);
			assert.strictEqual(cells[0].cellKind, CellKind.Markup);
			assert.strictEqual(cells[0].source, '# Title\n\nSome paragraph text.');
		});

		test('should convert RawBlock to code cell with format as language', () => {
			const { cells } = qmdToNotebook('```{=latex}\n\\frac{1}{2}\n```');

			assert.strictEqual(cells.length, 1);
			assert.strictEqual(cells[0].cellKind, CellKind.Code);
			assert.strictEqual(cells[0].language, 'raw');
		});

		test('should treat bare fence as markdown (non-executable)', () => {
			const { cells } = qmdToNotebook('```\nsome code\n```');

			assert.strictEqual(cells[0].cellKind, CellKind.Markup);
			assert.strictEqual(cells[0].language, 'markdown');
		});

		test('should extract frontmatter to first cell', () => {
			const { cells } = qmdToNotebook('---\ntitle: Test\nauthor: User\n---\n\n# Content');

			// First cell should be frontmatter
			assert.strictEqual(cells[0].cellKind, CellKind.Code);
			assert.strictEqual(cells[0].language, 'raw');
			assert.ok(isFrontmatterCell(cells[0]));
			assert.ok(cells[0].source.includes('title: Test'));
			assert.ok(cells[0].source.includes('author: User'));
			// Should include --- delimiters
			assert.ok(cells[0].source.startsWith('---'));
			assert.ok(cells[0].source.endsWith('---'));
		});

		test('should preserve markdown content after front matter', () => {
			const { cells } = qmdToNotebook('---\ntitle: Test\n---\n\n# Heading\n\nParagraph text.');

			// First cell is frontmatter, second is markdown
			assert.strictEqual(cells.length, 2);
			assert.ok(isFrontmatterCell(cells[0]));
			assert.strictEqual(cells[1].cellKind, CellKind.Markup);
			assert.strictEqual(cells[1].source, '# Heading\n\nParagraph text.');
		});

		test('should handle multi-byte UTF-8 characters correctly', () => {
			const { cells } = qmdToNotebook('# Pokémon\n\nI love Pokémon!');

			assert.strictEqual(cells.length, 1);
			assert.strictEqual(cells[0].cellKind, CellKind.Markup);
			assert.strictEqual(cells[0].source, '# Pokémon\n\nI love Pokémon!');
		});

		test('should handle multi-byte UTF-8 before code block', () => {
			const { cells } = qmdToNotebook('# Pokémon\n\n```{python}\nprint("hello")\n```');

			assert.strictEqual(cells.length, 2);
			assert.strictEqual(cells[0].cellKind, CellKind.Markup);
			assert.strictEqual(cells[0].source, '# Pokémon');
			assert.strictEqual(cells[1].cellKind, CellKind.Code);
			assert.strictEqual(cells[1].source, 'print("hello")');
		});

		test('should handle markdown after code with UTF-8', () => {
			const { cells } = qmdToNotebook('```{python}\nprint("Pokémon")\n```\n\n# Results');

			assert.strictEqual(cells.length, 2);
			assert.strictEqual(cells[0].cellKind, CellKind.Code);
			assert.strictEqual(cells[0].source, 'print("Pokémon")');
			assert.strictEqual(cells[1].cellKind, CellKind.Markup);
			assert.strictEqual(cells[1].source, '# Results');
		});

		test('should handle markdown after front matter with UTF-8', () => {
			const { cells } = qmdToNotebook('---\ntitle: Pokémon\n---\n\nThis');

			assert.strictEqual(cells.length, 2);
			assert.ok(isFrontmatterCell(cells[0]));
			assert.ok(cells[0].source.includes('Pokémon'));
			assert.strictEqual(cells[1].cellKind, CellKind.Markup);
			assert.strictEqual(cells[1].source, 'This');
		});

		test('should handle Div blocks as markdown content', () => {
			const { cells } = qmdToNotebook('::: {.callout-note}\nThis is a callout.\n:::');

			assert.strictEqual(cells.length, 1);
			assert.strictEqual(cells[0].cellKind, CellKind.Markup);
			assert.ok(cells[0].source.includes('::: {.callout-note}'));
		});

		test('should interleave markdown and code cells correctly', () => {
			const { cells } = qmdToNotebook('# Intro\n\n```{python}\nx = 1\n```\n\n## Results\n\n```{r}\nplot(x)\n```');

			assert.strictEqual(cells.length, 4);
			assert.strictEqual(cells[0].cellKind, CellKind.Markup);
			assert.strictEqual(cells[1].cellKind, CellKind.Code);
			assert.strictEqual(cells[1].language, 'python');
			assert.strictEqual(cells[2].cellKind, CellKind.Markup);
			assert.strictEqual(cells[3].cellKind, CellKind.Code);
			assert.strictEqual(cells[3].language, 'r');
			assert.strictEqual(cells[0].source, '# Intro');
			assert.strictEqual(cells[2].source, '## Results');
		});

		test('should handle R language', () => {
			const { cells } = qmdToNotebook('```{r}\nplot(x)\n```');

			assert.strictEqual(cells[0].language, 'r');
		});

		test('should handle Julia language', () => {
			const { cells } = qmdToNotebook('```{julia}\nprintln("hi")\n```');

			assert.strictEqual(cells[0].language, 'julia');
		});

		test('should open empty document with no cells', () => {
			const { cells } = qmdToNotebook('');

			assert.strictEqual(cells.length, 0);
		});

		test('should handle document with only metadata', () => {
			const { cells } = qmdToNotebook('---\ntitle: Test\n---\n\n# Heading');

			assert.ok(isFrontmatterCell(cells[0]));
			assert.ok(cells[0].source.includes('title: Test'));
		});

		test('should handle code cell with multiple execution options', () => {
			const { cells } = qmdToNotebook('```{python}\n#| echo: false\n#| eval: true\n#| output: asis\nprint("hello")\n```');

			assert.strictEqual(cells.length, 1);
			assert.strictEqual(cells[0].cellKind, CellKind.Code);
			assert.strictEqual(cells[0].language, 'python');
		});

		test('should preserve code content exactly', () => {
			const code = 'def foo():\n    return 42\n\nprint(foo())';
			const { cells } = qmdToNotebook('```{python}\n' + code + '\n```');

			assert.strictEqual(cells[0].source, code);
		});

		test('should handle multiple code blocks with different languages', () => {
			const { cells } = qmdToNotebook('```{python}\nx = 1\n```\n\n```{r}\ny <- 2\n```\n\n```{julia}\nz = 3\n```');

			assert.strictEqual(cells.length, 3);
			assert.strictEqual(cells[0].language, 'python');
			assert.strictEqual(cells[1].language, 'r');
			assert.strictEqual(cells[2].language, 'julia');
		});

		test('should handle HorizontalRule in markdown', () => {
			const { cells } = qmdToNotebook('# Before\n\n---\n\n# After');

			assert.strictEqual(cells.length, 1);
			assert.strictEqual(cells[0].cellKind, CellKind.Markup);
			assert.strictEqual(cells[0].source, '# Before\n\n---\n\n# After');
		});

		test('should handle HorizontalRule between code blocks', () => {
			const { cells } = qmdToNotebook('```{python}\nx = 1\n```\n\n---\n\n```{python}\ny = 2\n```');

			assert.strictEqual(cells.length, 3);
			assert.strictEqual(cells[0].cellKind, CellKind.Code);
			assert.strictEqual(cells[1].cellKind, CellKind.Markup);
			assert.strictEqual(cells[1].source, '---');
			assert.strictEqual(cells[2].cellKind, CellKind.Code);
		});

	});

	suite('Cell markers', () => {

		test('should split markdown at <!-- cell --> marker', () => {
			const { cells } = qmdToNotebook('# Cell 1\n\n<!-- cell -->\n\n# Cell 2');

			assert.strictEqual(cells.length, 2);
			assert.strictEqual(cells[0].cellKind, CellKind.Markup);
			assert.strictEqual(cells[1].cellKind, CellKind.Markup);
			assert.strictEqual(cells[0].source.trim(), '# Cell 1');
			assert.strictEqual(cells[1].source.trim(), '# Cell 2');
		});

		test('should handle multiple cell markers', () => {
			const { cells } = qmdToNotebook('# One\n\n<!-- cell -->\n\n# Two\n\n<!-- cell -->\n\n# Three');

			assert.strictEqual(cells.length, 3);
		});

		test('should not include marker content in cells', () => {
			const { cells } = qmdToNotebook('# Cell 1\n\n<!-- cell -->\n\n# Cell 2');

			assert.ok(!cells[0].source.includes('<!-- cell -->'));
			assert.ok(!cells[1].source.includes('<!-- cell -->'));
		});

		test('should handle marker between code blocks', () => {
			const { cells } = qmdToNotebook('```{python}\nx = 1\n```\n\n<!-- cell -->\n\n```{r}\ny = 2\n```');

			// Should have 2 code cells (marker is ignored between code blocks since
			// the markdown region between them is just the marker, which splits into empty parts)
			const codeCells = cells.filter(c => c.cellKind === CellKind.Code);
			assert.ok(codeCells.some(c => c.language === 'python'));
			assert.ok(codeCells.some(c => c.language === 'r'));
		});

		test('should handle marker at document start', () => {
			const { cells } = qmdToNotebook('<!-- cell -->\n\n# Content');

			assert.strictEqual(cells.length, 2);
			assert.strictEqual(cells[0].source, '');
			assert.strictEqual(cells[1].source, '# Content');
		});

		test('should handle marker at document end', () => {
			const { cells } = qmdToNotebook('# Content\n\n<!-- cell -->');

			assert.strictEqual(cells.length, 2);
			assert.strictEqual(cells[0].source, '# Content');
			assert.strictEqual(cells[1].source, '');
		});

	});

	suite('Markdown cells', () => {

		test('should skip multiple blank lines between code blocks', () => {
			const { cells } = qmdToNotebook('```{python}\nx = 1\n```\n\n\n\n```{python}\ny = 2\n```');

			assert.strictEqual(cells.length, 2);
			assert.strictEqual(cells[0].source, 'x = 1');
			assert.strictEqual(cells[1].source, 'y = 2');
		});

		test('should handle no blank lines between code blocks', () => {
			const { cells } = qmdToNotebook('```{python}\nx = 1\n```\n```{python}\ny = 2\n```');

			assert.strictEqual(cells.length, 2);
			assert.strictEqual(cells[0].source, 'x = 1');
			assert.strictEqual(cells[1].source, 'y = 2');
		});

		test('should skip multiple blank lines after frontmatter', () => {
			const { cells } = qmdToNotebook('---\ntitle: Test\n---\n\n\n\n# Content');

			assert.strictEqual(cells.length, 2);
			assert.ok(isFrontmatterCell(cells[0]));
			assert.strictEqual(cells[1].cellKind, CellKind.Markup);
			assert.strictEqual(cells[1].source, '# Content');
		});

		test('should not produce empty markdown cell from trailing blank lines', () => {
			const { cells } = qmdToNotebook('```{python}\nx = 1\n```\n\n\n');

			assert.strictEqual(cells.length, 1);
			assert.strictEqual(cells[0].source, 'x = 1');
		});

		test('should not produce cells from document of only blank lines', () => {
			const { cells } = qmdToNotebook('\n\n\n');

			// All blank lines — either 0 cells or at most an empty-ish markup cell
			const nonEmpty = cells.filter(c => c.source.trim() !== '');
			assert.strictEqual(nonEmpty.length, 0);
		});

		test('should skip blank lines between code block and end of document', () => {
			const { cells } = qmdToNotebook('# Intro\n\n```{python}\nx = 1\n```\n\n\n\n');

			assert.strictEqual(cells.length, 2);
			assert.strictEqual(cells[0].cellKind, CellKind.Markup);
			assert.strictEqual(cells[0].source, '# Intro');
			assert.strictEqual(cells[1].cellKind, CellKind.Code);
			assert.strictEqual(cells[1].source, 'x = 1');
		});

		test('should handle markdown between code blocks with multiple blank lines', () => {
			const { cells } = qmdToNotebook('```{python}\nx = 1\n```\n\n\n\n# Middle\n\n\n\n```{python}\ny = 2\n```');

			assert.strictEqual(cells.length, 3);
			assert.strictEqual(cells[0].source, 'x = 1');
			assert.strictEqual(cells[1].cellKind, CellKind.Markup);
			assert.strictEqual(cells[1].source, '# Middle');
			assert.strictEqual(cells[2].source, 'y = 2');
		});

	});

});
