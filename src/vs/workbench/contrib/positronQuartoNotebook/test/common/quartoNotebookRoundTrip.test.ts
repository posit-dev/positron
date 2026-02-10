/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { qmdToNotebook } from '../../common/qmdToNotebook.js';
import { notebookToQmd, isFrontmatterCell } from '../../common/notebookToQmd.js';
import { CellKind, ICellDto2 } from '../../../notebook/common/notebookCommon.js';

suite('Round-trip serialization', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	function codeCell(code: string, language: string): ICellDto2 {
		return { cellKind: CellKind.Code, source: code, language, mime: undefined, outputs: [] };
	}

	function markdownCell(content: string): ICellDto2 {
		return { cellKind: CellKind.Markup, source: content, language: 'markdown', mime: undefined, outputs: [] };
	}

	function notebook(cells: ICellDto2[]) {
		return { cells, metadata: {} };
	}

	test('qmd -> notebook -> qmd should preserve exact content', () => {
		const original = '# Hello\n\n```{python}\nprint("world")\n```\n';
		const { cells } = qmdToNotebook(original);
		const serialized = notebookToQmd(notebook(cells));

		assert.strictEqual(serialized, original);
	});

	test('notebook -> qmd -> notebook should preserve exact content', () => {
		const cells: ICellDto2[] = [
			markdownCell('# Hello'),
			codeCell('print("world")', 'python'),
		];

		const serialized = notebookToQmd(notebook(cells));
		const { cells: roundTripped } = qmdToNotebook(serialized);

		assert.strictEqual(roundTripped.length, cells.length);
		for (let i = 0; i < cells.length; i++) {
			assert.strictEqual(roundTripped[i].cellKind, cells[i].cellKind);
			assert.strictEqual(roundTripped[i].source, cells[i].source);
			assert.strictEqual(roundTripped[i].language, cells[i].language);
		}
	});

	test('should round-trip document with consecutive markdown cells', () => {
		const cells: ICellDto2[] = [
			markdownCell('# Cell 1'),
			markdownCell('# Cell 2'),
			codeCell('x = 1', 'python'),
			markdownCell('# Cell 3'),
		];

		const serialized = notebookToQmd(notebook(cells));
		const { cells: roundTripped } = qmdToNotebook(serialized);

		assert.strictEqual(roundTripped.length, 4);
		assert.strictEqual(roundTripped[0].cellKind, CellKind.Markup);
		assert.strictEqual(roundTripped[1].cellKind, CellKind.Markup);
		assert.strictEqual(roundTripped[2].cellKind, CellKind.Code);
		assert.strictEqual(roundTripped[3].cellKind, CellKind.Markup);
		assert.strictEqual(roundTripped[0].source, '# Cell 1');
		assert.strictEqual(roundTripped[1].source, '# Cell 2');
		assert.strictEqual(roundTripped[2].source, 'x = 1');
		assert.strictEqual(roundTripped[3].source, '# Cell 3');
	});

	test('should round-trip code cell languages', () => {
		const cells: ICellDto2[] = [
			codeCell('x = 1', 'python'),
			codeCell('y <- 2', 'r'),
			codeCell('z = 3', 'julia'),
		];

		const serialized = notebookToQmd(notebook(cells));
		const { cells: roundTripped } = qmdToNotebook(serialized);

		assert.strictEqual(roundTripped[0].language, 'python');
		assert.strictEqual(roundTripped[1].language, 'r');
		assert.strictEqual(roundTripped[2].language, 'julia');
	});

	test('should round-trip code content exactly', () => {
		const code = 'def foo():\n    return 42\n\nprint(foo())';
		const cells: ICellDto2[] = [codeCell(code, 'python')];

		const serialized = notebookToQmd(notebook(cells));
		const { cells: roundTripped } = qmdToNotebook(serialized);

		assert.strictEqual(roundTripped[0].source, code);
	});

	test('should round-trip mixed content document', () => {
		const cells: ICellDto2[] = [
			markdownCell('# Introduction'),
			codeCell('import pandas as pd', 'python'),
			markdownCell('## Analysis'),
			markdownCell('Some notes about the analysis.'),
			codeCell('df.describe()', 'python'),
			markdownCell('# Conclusion'),
		];

		const serialized = notebookToQmd(notebook(cells));
		const { cells: roundTripped } = qmdToNotebook(serialized);

		assert.strictEqual(roundTripped.length, 6);
		assert.strictEqual(roundTripped[0].cellKind, CellKind.Markup);
		assert.strictEqual(roundTripped[1].cellKind, CellKind.Code);
		assert.strictEqual(roundTripped[2].cellKind, CellKind.Markup);
		assert.strictEqual(roundTripped[3].cellKind, CellKind.Markup);
		assert.strictEqual(roundTripped[4].cellKind, CellKind.Code);
		assert.strictEqual(roundTripped[5].cellKind, CellKind.Markup);
	});

	test('should round-trip document with frontmatter', () => {
		const original = '---\ntitle: Test Document\nauthor: Test Author\n---\n\n# Content\n\n```{python}\nprint("hello")\n```\n';
		const { cells } = qmdToNotebook(original);
		const serialized = notebookToQmd(notebook(cells));
		const { cells: roundTripped } = qmdToNotebook(serialized);

		assert.strictEqual(roundTripped.length, 3);
		assert.ok(isFrontmatterCell(roundTripped[0]));
		assert.ok(roundTripped[0].source.includes('title: Test Document'));
		assert.ok(roundTripped[0].source.includes('author: Test Author'));
		assert.strictEqual(roundTripped[1].cellKind, CellKind.Markup);
		assert.strictEqual(roundTripped[2].cellKind, CellKind.Code);
	});

	test('should preserve frontmatter formatting on round-trip', () => {
		const original = '---\n# Comment preserved\ntitle: "Test"\nitems:\n  - one\n  - two\n---\n\nContent';
		const { cells } = qmdToNotebook(original);
		const serialized = notebookToQmd(notebook(cells));

		assert.ok(serialized.includes('# Comment preserved'));
		assert.ok(serialized.includes('title: "Test"'));
		assert.ok(serialized.includes('items:'));
		assert.ok(serialized.includes('  - one'));
		assert.ok(serialized.includes('  - two'));
	});

	test('should not create frontmatter cell when document has none', () => {
		const original = '# Just content\n\n```{python}\nx = 1\n```\n';
		const { cells } = qmdToNotebook(original);

		assert.ok(!isFrontmatterCell(cells[0]));
		assert.strictEqual(cells[0].cellKind, CellKind.Markup);
	});

	test('should preserve extra newlines in markdown content', () => {
		const cells: ICellDto2[] = [
			markdownCell('# Title\n\n\n\nParagraph with extra newlines above.'),
		];

		const serialized = notebookToQmd(notebook(cells));
		const { cells: roundTripped } = qmdToNotebook(serialized);

		assert.strictEqual(roundTripped.length, 1);
		assert.strictEqual(roundTripped[0].source, '# Title\n\n\n\nParagraph with extra newlines above.');
	});

	test('should preserve plain fences (no braces) on round-trip', () => {
		// A plain fence like ```python (no braces) is non-executable documentation.
		// It must NOT become ```{python} (executable Quarto block) after round-trip.
		const original = '# Example\n\n```python\nprint("hello")\n```\n';
		const { cells } = qmdToNotebook(original);
		const serialized = notebookToQmd(notebook(cells));

		assert.strictEqual(serialized, original,
			'Plain fence ```python should not become executable ```{python} after round-trip');
	});

	test('should preserve leading whitespace in markdown content', () => {
		const cells: ICellDto2[] = [
			markdownCell('   Indented text'),
		];

		const serialized = notebookToQmd(notebook(cells));
		const { cells: roundTripped } = qmdToNotebook(serialized);

		assert.strictEqual(roundTripped.length, 1);
		assert.strictEqual(roundTripped[0].source, '   Indented text');
	});

	test('should preserve extra blank lines between cells on round-trip', () => {
		const original = '# Heading\n\n\n\n```{python}\nx = 1\n```\n';

		const { cells } = qmdToNotebook(original);
		const serialized = notebookToQmd(notebook(cells));

		assert.strictEqual(serialized, original);
	});
});
