/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { parseQmdToNotebookCells } from '../../common/quartoNotebookParser.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { isFrontmatterCell } from '../../../positronQuarto/common/quartoConstants.js';

suite('QMD to NotebookData Converter', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('should convert CodeBlock to code cell', () => {
		const cells = parseQmdToNotebookCells('```{python}\nprint("hello")\n```');

		assert.strictEqual(cells.length, 1);
		assert.strictEqual(cells[0].cellKind, CellKind.Code);
		assert.strictEqual(cells[0].language, 'python');
		assert.strictEqual(cells[0].source, 'print("hello")');
	});

	test('should merge consecutive markdown blocks', () => {
		const cells = parseQmdToNotebookCells('# Title\n\nSome paragraph text.');

		assert.strictEqual(cells.length, 1);
		assert.strictEqual(cells[0].cellKind, CellKind.Markup);
		assert.strictEqual(cells[0].source, '# Title\n\nSome paragraph text.');
	});

	test('should convert RawBlock to code cell with format as language', () => {
		const cells = parseQmdToNotebookCells('```{=latex}\n\\frac{1}{2}\n```');

		assert.strictEqual(cells.length, 1);
		assert.strictEqual(cells[0].cellKind, CellKind.Code);
		assert.strictEqual(cells[0].language, 'latex');
	});

	test('should treat bare fence as markdown (non-executable)', () => {
		const cells = parseQmdToNotebookCells('```\nsome code\n```');

		assert.strictEqual(cells[0].cellKind, CellKind.Markup);
		assert.strictEqual(cells[0].language, 'markdown');
	});

	test('should map ojs to javascript', () => {
		const cells = parseQmdToNotebookCells('```{ojs}\n1 + 1\n```');

		assert.strictEqual(cells[0].language, 'javascript');
	});

	test('should extract frontmatter to first cell', () => {
		const cells = parseQmdToNotebookCells('---\ntitle: Test\nauthor: User\n---\n\n# Content');

		// First cell should be frontmatter
		assert.strictEqual(cells[0].cellKind, CellKind.Code);
		assert.strictEqual(cells[0].language, 'yaml');
		assert.ok(isFrontmatterCell(cells[0].metadata));
		assert.ok(cells[0].source.includes('title: Test'));
		assert.ok(cells[0].source.includes('author: User'));
		// Should include --- delimiters
		assert.ok(cells[0].source.startsWith('---'));
		assert.ok(cells[0].source.endsWith('---'));
	});

	test('should preserve markdown content after front matter', () => {
		const cells = parseQmdToNotebookCells('---\ntitle: Test\n---\n\n# Heading\n\nParagraph text.');

		// First cell is frontmatter, second is markdown
		assert.strictEqual(cells.length, 2);
		assert.ok(isFrontmatterCell(cells[0].metadata));
		assert.strictEqual(cells[1].cellKind, CellKind.Markup);
		assert.strictEqual(cells[1].source, '# Heading\n\nParagraph text.');
	});

	test('should handle multi-byte UTF-8 characters correctly', () => {
		const cells = parseQmdToNotebookCells('# Pokémon\n\nI love Pokémon!');

		assert.strictEqual(cells.length, 1);
		assert.strictEqual(cells[0].cellKind, CellKind.Markup);
		assert.strictEqual(cells[0].source, '# Pokémon\n\nI love Pokémon!');
	});

	test('should handle multi-byte UTF-8 before code block', () => {
		const cells = parseQmdToNotebookCells('# Pokémon\n\n```{python}\nprint("hello")\n```');

		assert.strictEqual(cells.length, 2);
		assert.strictEqual(cells[0].cellKind, CellKind.Markup);
		assert.strictEqual(cells[0].source, '# Pokémon');
		assert.strictEqual(cells[1].cellKind, CellKind.Code);
		assert.strictEqual(cells[1].source, 'print("hello")');
	});

	test('should handle markdown after code with UTF-8', () => {
		const cells = parseQmdToNotebookCells('```{python}\nprint("Pokémon")\n```\n\n# Results');

		assert.strictEqual(cells.length, 2);
		assert.strictEqual(cells[0].cellKind, CellKind.Code);
		assert.strictEqual(cells[0].source, 'print("Pokémon")');
		assert.strictEqual(cells[1].cellKind, CellKind.Markup);
		assert.strictEqual(cells[1].source, '# Results');
	});

	test('should handle markdown after front matter with UTF-8', () => {
		const cells = parseQmdToNotebookCells('---\ntitle: Pokémon\n---\n\nThis');

		assert.strictEqual(cells.length, 2);
		assert.ok(isFrontmatterCell(cells[0].metadata));
		assert.ok(cells[0].source.includes('Pokémon'));
		assert.strictEqual(cells[1].cellKind, CellKind.Markup);
		assert.strictEqual(cells[1].source, 'This');
	});

	test('should handle Div blocks as markdown content', () => {
		const cells = parseQmdToNotebookCells('::: {.callout-note}\nThis is a callout.\n:::');

		assert.strictEqual(cells.length, 1);
		assert.strictEqual(cells[0].cellKind, CellKind.Markup);
		assert.ok(cells[0].source.includes('::: {.callout-note}'));
	});

	test('should interleave markdown and code cells correctly', () => {
		const cells = parseQmdToNotebookCells('# Intro\n\n```{python}\nx = 1\n```\n\n## Results\n\n```{r}\nplot(x)\n```');

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
		const cells = parseQmdToNotebookCells('```{r}\nplot(x)\n```');

		assert.strictEqual(cells[0].language, 'r');
	});

	test('should handle Julia language', () => {
		const cells = parseQmdToNotebookCells('```{julia}\nprintln("hi")\n```');

		assert.strictEqual(cells[0].language, 'julia');
	});

	test('should open empty document with no cells', () => {
		const cells = parseQmdToNotebookCells('');

		assert.strictEqual(cells.length, 0);
	});

	test('should handle document with only metadata', () => {
		const cells = parseQmdToNotebookCells('---\ntitle: Test\n---\n\n# Heading');

		assert.ok(isFrontmatterCell(cells[0].metadata));
		assert.ok(cells[0].source.includes('title: Test'));
	});

	test('should handle code cell with multiple execution options', () => {
		const cells = parseQmdToNotebookCells('```{python}\n#| echo: false\n#| eval: true\n#| output: asis\nprint("hello")\n```');

		assert.strictEqual(cells.length, 1);
		assert.strictEqual(cells[0].cellKind, CellKind.Code);
		assert.strictEqual(cells[0].language, 'python');
	});

	test('should preserve code content exactly', () => {
		const code = 'def foo():\n    return 42\n\nprint(foo())';
		const cells = parseQmdToNotebookCells('```{python}\n' + code + '\n```');

		assert.strictEqual(cells[0].source, code);
	});

	test('should handle multiple code blocks with different languages', () => {
		const cells = parseQmdToNotebookCells('```{python}\nx = 1\n```\n\n```{r}\ny <- 2\n```\n\n```{julia}\nz = 3\n```');

		assert.strictEqual(cells.length, 3);
		assert.strictEqual(cells[0].language, 'python');
		assert.strictEqual(cells[1].language, 'r');
		assert.strictEqual(cells[2].language, 'julia');
	});

	test('should handle HorizontalRule in markdown', () => {
		const cells = parseQmdToNotebookCells('# Before\n\n---\n\n# After');

		assert.strictEqual(cells.length, 1);
		assert.strictEqual(cells[0].cellKind, CellKind.Markup);
		assert.strictEqual(cells[0].source, '# Before\n\n---\n\n# After');
	});

	test('should handle HorizontalRule between code blocks', () => {
		const cells = parseQmdToNotebookCells('```{python}\nx = 1\n```\n\n---\n\n```{python}\ny = 2\n```');

		assert.strictEqual(cells.length, 3);
		assert.strictEqual(cells[0].cellKind, CellKind.Code);
		assert.strictEqual(cells[1].cellKind, CellKind.Markup);
		assert.strictEqual(cells[1].source, '---');
		assert.strictEqual(cells[2].cellKind, CellKind.Code);
	});

});

suite('Deserialize with cell markers', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('should split markdown at <!-- cell --> marker', () => {
		const cells = parseQmdToNotebookCells('# Cell 1\n\n<!-- cell -->\n\n# Cell 2');

		assert.strictEqual(cells.length, 2);
		assert.strictEqual(cells[0].cellKind, CellKind.Markup);
		assert.strictEqual(cells[1].cellKind, CellKind.Markup);
		assert.strictEqual(cells[0].source.trim(), '# Cell 1');
		assert.strictEqual(cells[1].source.trim(), '# Cell 2');
	});

	test('should handle multiple cell markers', () => {
		const cells = parseQmdToNotebookCells('# One\n\n<!-- cell -->\n\n# Two\n\n<!-- cell -->\n\n# Three');

		assert.strictEqual(cells.length, 3);
	});

	test('should not include marker content in cells', () => {
		const cells = parseQmdToNotebookCells('# Cell 1\n\n<!-- cell -->\n\n# Cell 2');

		assert.ok(!cells[0].source.includes('<!-- cell -->'));
		assert.ok(!cells[1].source.includes('<!-- cell -->'));
	});

	test('should handle marker between code blocks', () => {
		const cells = parseQmdToNotebookCells('```{python}\nx = 1\n```\n\n<!-- cell -->\n\n```{r}\ny = 2\n```');

		// Should have 2 code cells (marker is ignored between code blocks since
		// the markdown region between them is just the marker, which splits into empty parts)
		const codeCells = cells.filter(c => c.cellKind === CellKind.Code);
		assert.ok(codeCells.some(c => c.language === 'python'));
		assert.ok(codeCells.some(c => c.language === 'r'));
	});

	test('should handle marker at document start', () => {
		const cells = parseQmdToNotebookCells('<!-- cell -->\n\n# Content');

		assert.strictEqual(cells.length, 2);
		assert.strictEqual(cells[0].source, '');
		assert.strictEqual(cells[1].source, '# Content');
	});

	test('should handle marker at document end', () => {
		const cells = parseQmdToNotebookCells('# Content\n\n<!-- cell -->');

		assert.strictEqual(cells.length, 2);
		assert.strictEqual(cells[0].source, '# Content');
		assert.strictEqual(cells[1].source, '');
	});
});
