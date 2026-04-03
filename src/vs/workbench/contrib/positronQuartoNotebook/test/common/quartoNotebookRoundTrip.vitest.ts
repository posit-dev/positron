/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { qmdToNotebook } from '../../common/qmdToNotebook.js';
import { notebookToQmd, isFrontmatterCell } from '../../common/notebookToQmd.js';
import { CellKind, ICellDto2 } from '../../../notebook/common/notebookCommon.js';

describe('Round-trip serialization', () => {

	function codeCell(code: string, language: string): ICellDto2 {
		return { cellKind: CellKind.Code, source: code, language, mime: undefined, outputs: [] };
	}

	function markdownCell(content: string): ICellDto2 {
		return { cellKind: CellKind.Markup, source: content, language: 'markdown', mime: undefined, outputs: [] };
	}

	function notebook(cells: ICellDto2[]) {
		return { cells, metadata: {} };
	}

	it('qmd -> notebook -> qmd should preserve exact content', () => {
		const original = '# Hello\n\n```{python}\nprint("world")\n```\n';
		const { cells } = qmdToNotebook(original);
		const serialized = notebookToQmd(notebook(cells));

		expect(serialized).toBe(original);
	});

	it('notebook -> qmd -> notebook should preserve exact content', () => {
		const cells: ICellDto2[] = [
			markdownCell('# Hello'),
			codeCell('print("world")', 'python'),
		];

		const serialized = notebookToQmd(notebook(cells));
		const { cells: roundTripped } = qmdToNotebook(serialized);

		expect(roundTripped.length).toBe(cells.length);
		for (let i = 0; i < cells.length; i++) {
			expect(roundTripped[i].cellKind).toBe(cells[i].cellKind);
			expect(roundTripped[i].source).toBe(cells[i].source);
			expect(roundTripped[i].language).toBe(cells[i].language);
		}
	});

	it('should round-trip document with frontmatter', () => {
		const original = '---\ntitle: Test Document\nauthor: Test Author\n---\n\n# Content\n\n```{python}\nprint("hello")\n```\n';
		const { cells } = qmdToNotebook(original);
		const serialized = notebookToQmd(notebook(cells));
		const { cells: roundTripped } = qmdToNotebook(serialized);

		expect(roundTripped.length).toBe(3);
		expect(isFrontmatterCell(roundTripped[0])).toBeTruthy();
		expect(roundTripped[0].source.includes('title: Test Document')).toBeTruthy();
		expect(roundTripped[0].source.includes('author: Test Author')).toBeTruthy();
		expect(roundTripped[1].cellKind).toBe(CellKind.Markup);
		expect(roundTripped[2].cellKind).toBe(CellKind.Code);
	});

	it('should preserve frontmatter formatting on round-trip', () => {
		const original = '---\n# Comment preserved\ntitle: "Test"\nitems:\n  - one\n  - two\n---\n\nContent';
		const { cells } = qmdToNotebook(original);
		const serialized = notebookToQmd(notebook(cells));

		expect(serialized.includes('# Comment preserved')).toBeTruthy();
		expect(serialized.includes('title: "Test"')).toBeTruthy();
		expect(serialized.includes('items:')).toBeTruthy();
		expect(serialized.includes('  - one')).toBeTruthy();
		expect(serialized.includes('  - two')).toBeTruthy();
	});

	it('should preserve extra newlines in markdown content', () => {
		const cells: ICellDto2[] = [
			markdownCell('# Title\n\n\n\nParagraph with extra newlines above.'),
		];

		const serialized = notebookToQmd(notebook(cells));
		const { cells: roundTripped } = qmdToNotebook(serialized);

		expect(roundTripped.length).toBe(1);
		expect(roundTripped[0].source).toBe('# Title\n\n\n\nParagraph with extra newlines above.');
	});

	it('should preserve plain fences (no braces) on round-trip', () => {
		// A plain fence like ```python (no braces) is non-executable documentation.
		// It must NOT become ```{python} (executable Quarto block) after round-trip.
		const original = '# Example\n\n```python\nprint("hello")\n```\n';
		const { cells } = qmdToNotebook(original);
		const serialized = notebookToQmd(notebook(cells));

		expect(serialized).toBe(original);
	});

	it('should preserve leading whitespace in markdown content', () => {
		const cells: ICellDto2[] = [
			markdownCell('   Indented text'),
		];

		const serialized = notebookToQmd(notebook(cells));
		const { cells: roundTripped } = qmdToNotebook(serialized);

		expect(roundTripped.length).toBe(1);
		expect(roundTripped[0].source).toBe('   Indented text');
	});

	it.skip('should preserve extra blank lines between cells on round-trip', () => {
		const original = '# Heading\n\n\n\n```{python}\nx = 1\n```\n';

		const { cells } = qmdToNotebook(original);
		const serialized = notebookToQmd(notebook(cells));

		expect(serialized).toBe(original);
	});
});
