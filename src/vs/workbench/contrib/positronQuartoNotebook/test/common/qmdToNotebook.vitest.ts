/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { qmdToNotebook } from '../../common/qmdToNotebook.js';
import { CellKind, ICellDto2 } from '../../../notebook/common/notebookCommon.js';

/** Project a cell to a minimal shape for snapshot comparison. */
function project(cell: ICellDto2) {
	return {
		kind: cell.cellKind === CellKind.Code ? 'Code' : 'Markup',
		language: cell.language,
		source: cell.source,
		metadata: cell.metadata,
	};
}

describe('qmdToNotebook', () => {
	describe('empty and minimal input', () => {
		it('returns an empty notebook for an empty string', () => {
			const result = qmdToNotebook('');
			expect(result.cells).toEqual([]);
			expect(result.metadata).toEqual({});
		});

		it('produces no non-empty cells for a document of only blank lines', () => {
			const { cells } = qmdToNotebook('\n\n\n');
			const nonEmpty = cells.filter(c => c.source.trim() !== '');
			expect(nonEmpty).toEqual([]);
		});
	});

	describe('code blocks', () => {
		it('converts a fenced code block with a language to a Code cell', () => {
			const { cells } = qmdToNotebook('```{python}\nprint("hello")\n```');
			expect(cells).toHaveLength(1);
			expect(cells[0].cellKind).toBe(CellKind.Code);
			expect(cells[0].language).toBe('python');
			expect(cells[0].source).toBe('print("hello")');
		});

		it('handles R, Julia, and Python languages', () => {
			const { cells } = qmdToNotebook(
				'```{python}\nx = 1\n```\n\n```{r}\ny <- 2\n```\n\n```{julia}\nz = 3\n```'
			);
			expect(cells.map(c => c.language)).toEqual(['python', 'r', 'julia']);
		});

		it('treats a bare fence (no language) as markdown, not code', () => {
			const { cells } = qmdToNotebook('```\nsome code\n```');
			expect(cells[0].cellKind).toBe(CellKind.Markup);
			expect(cells[0].language).toBe('markdown');
		});

		it('preserves code content exactly, including execution-option comments', () => {
			const { cells } = qmdToNotebook(
				'```{python}\n#| echo: false\n#| eval: true\n#| output: asis\ndef foo():\n    return 42\n\nprint(foo())\n```'
			);
			expect(cells).toHaveLength(1);
			expect(cells[0].source).toMatchInlineSnapshot(`
				"#| echo: false
				#| eval: true
				#| output: asis
				def foo():
				    return 42

				print(foo())"
			`);
		});

		it('converts a raw block (=latex) to a raw-language Code cell', () => {
			const { cells } = qmdToNotebook('```{=latex}\n\\frac{1}{2}\n```');
			expect(cells).toHaveLength(1);
			expect(cells[0].cellKind).toBe(CellKind.Code);
			expect(cells[0].language).toBe('raw');
			expect(cells[0].source).toBe('\\frac{1}{2}');
		});
	});

	describe('markdown blocks', () => {
		it('merges consecutive markdown into a single Markup cell', () => {
			const { cells } = qmdToNotebook('# Title\n\nSome paragraph text.');
			expect(cells).toHaveLength(1);
			expect(cells[0].cellKind).toBe(CellKind.Markup);
			expect(cells[0].source).toBe('# Title\n\nSome paragraph text.');
		});

		it('treats Div blocks and horizontal rules as markdown content', () => {
			const divResult = qmdToNotebook('::: {.callout-note}\nThis is a callout.\n:::');
			expect(divResult.cells).toHaveLength(1);
			expect(divResult.cells[0].cellKind).toBe(CellKind.Markup);
			expect(divResult.cells[0].source).toContain('::: {.callout-note}');

			const hrResult = qmdToNotebook('# Before\n\n---\n\n# After');
			expect(hrResult.cells).toHaveLength(1);
			expect(hrResult.cells[0].cellKind).toBe(CellKind.Markup);
			expect(hrResult.cells[0].source).toBe('# Before\n\n---\n\n# After');
		});

		it('preserves multi-byte UTF-8 characters', () => {
			const { cells } = qmdToNotebook('# Pokémon\n\n```{python}\nprint("Pokémon")\n```\n\n# Résumé');
			expect(cells.map(project)).toMatchInlineSnapshot(`
				[
				  {
				    "kind": "Markup",
				    "language": "markdown",
				    "metadata": undefined,
				    "source": "# Pokémon",
				  },
				  {
				    "kind": "Code",
				    "language": "python",
				    "metadata": undefined,
				    "source": "print("Pokémon")",
				  },
				  {
				    "kind": "Markup",
				    "language": "markdown",
				    "metadata": undefined,
				    "source": "# Résumé",
				  },
				]
			`);
		});
	});

	describe('frontmatter', () => {
		it('extracts YAML frontmatter to a raw Code cell with quarto.type metadata and --- delimiters intact', () => {
			const { cells } = qmdToNotebook('---\ntitle: Test\nauthor: User\n---');
			expect(project(cells[0])).toMatchInlineSnapshot(`
				{
				  "kind": "Code",
				  "language": "raw",
				  "metadata": {
				    "quarto": {
				      "type": "frontmatter",
				    },
				  },
				  "source": "---
				title: Test
				author: User
				---",
				}
			`);
		});

		it('preserves markdown that follows the frontmatter', () => {
			const { cells } = qmdToNotebook('---\ntitle: Test\n---\n\n# Heading\n\nParagraph text.');
			expect(cells.map(project)).toMatchInlineSnapshot(`
				[
				  {
				    "kind": "Code",
				    "language": "raw",
				    "metadata": {
				      "quarto": {
				        "type": "frontmatter",
				      },
				    },
				    "source": "---
				title: Test
				---",
				  },
				  {
				    "kind": "Markup",
				    "language": "markdown",
				    "metadata": undefined,
				    "source": "# Heading

				Paragraph text.",
				  },
				]
			`);
		});

		it('does not create a frontmatter cell when absent', () => {
			const { cells } = qmdToNotebook('# Just content\n\n```{python}\nx = 1\n```');
			expect(cells[0].metadata?.quarto).toBeUndefined();
			expect(cells[0].cellKind).toBe(CellKind.Markup);
		});
	});

	describe('cell boundary markers', () => {
		it('splits markdown at a marker into separate Markup cells with marker content stripped', () => {
			const { cells } = qmdToNotebook('# Cell 1\n\n<!-- cell -->\n\n# Cell 2');
			expect(cells).toHaveLength(2);
			expect(cells.every(c => c.cellKind === CellKind.Markup)).toBe(true);
			expect(cells[0].source).toBe('# Cell 1');
			expect(cells[1].source).toBe('# Cell 2');
			expect(cells.some(c => c.source.includes('<!-- cell -->'))).toBe(false);
		});

		it('supports markers at document start and end, producing empty-source cells', () => {
			const atStart = qmdToNotebook('<!-- cell -->\n\n# Content');
			expect(atStart.cells).toHaveLength(2);
			expect(atStart.cells[0].source).toBe('');
			expect(atStart.cells[1].source).toBe('# Content');

			const atEnd = qmdToNotebook('# Content\n\n<!-- cell -->');
			expect(atEnd.cells).toHaveLength(2);
			expect(atEnd.cells[0].source).toBe('# Content');
			expect(atEnd.cells[1].source).toBe('');
		});

		it('handles multiple markers in sequence', () => {
			const { cells } = qmdToNotebook('# One\n\n<!-- cell -->\n\n# Two\n\n<!-- cell -->\n\n# Three');
			expect(cells).toHaveLength(3);
			expect(cells.map(c => c.source)).toEqual(['# One', '# Two', '# Three']);
		});
	});

	describe('interleaving and blank-line handling', () => {
		it('interleaves markdown and code cells in source order', () => {
			const { cells } = qmdToNotebook('# Intro\n\n```{python}\nx = 1\n```\n\n## Results\n\n```{r}\nplot(x)\n```');
			expect(cells.map(project)).toMatchInlineSnapshot(`
				[
				  {
				    "kind": "Markup",
				    "language": "markdown",
				    "metadata": undefined,
				    "source": "# Intro",
				  },
				  {
				    "kind": "Code",
				    "language": "python",
				    "metadata": undefined,
				    "source": "x = 1",
				  },
				  {
				    "kind": "Markup",
				    "language": "markdown",
				    "metadata": undefined,
				    "source": "## Results",
				  },
				  {
				    "kind": "Code",
				    "language": "r",
				    "metadata": undefined,
				    "source": "plot(x)",
				  },
				]
			`);
		});

		it('collapses multiple blank lines between code blocks and after frontmatter', () => {
			const betweenCode = qmdToNotebook('```{python}\nx = 1\n```\n\n\n\n```{python}\ny = 2\n```');
			expect(betweenCode.cells).toHaveLength(2);
			expect(betweenCode.cells.map(c => c.source)).toEqual(['x = 1', 'y = 2']);

			const afterFrontmatter = qmdToNotebook('---\ntitle: Test\n---\n\n\n\n# Content');
			expect(afterFrontmatter.cells).toHaveLength(2);
			expect(afterFrontmatter.cells[1].source).toBe('# Content');
		});

		it('does not emit an empty markdown cell from trailing blank lines', () => {
			const { cells } = qmdToNotebook('```{python}\nx = 1\n```\n\n\n');
			expect(cells).toHaveLength(1);
			expect(cells[0].source).toBe('x = 1');
		});
	});
});
