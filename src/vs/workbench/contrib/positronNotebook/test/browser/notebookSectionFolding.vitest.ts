/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { createTestPositronNotebookInstance, TestCellInput, TestPositronNotebookInstance } from './testPositronNotebookInstance.js';
import { getCellHeadingLevel, computeSectionRanges } from '../../browser/notebookSectionFolding.js';
import { CellSelectionType, getActiveCell } from '../../browser/selectionMachine.js';
import { IPositronNotebookCell } from '../../browser/PositronNotebookCells/IPositronNotebookCell.js';

const md = (source: string): TestCellInput => [source, 'markdown', CellKind.Markup];
const code = (source: string): TestCellInput => [source, 'python', CellKind.Code];

describe('notebookSectionFolding', () => {
	const ctx = createTestContainer().withNotebookEditorServices().build();

	describe('getCellHeadingLevel', () => {
		it('detects heading levels 1 through 6', () => {
			expect(getCellHeadingLevel('# Title')).toBe(1);
			expect(getCellHeadingLevel('## Title')).toBe(2);
			expect(getCellHeadingLevel('###### Title')).toBe(6);
		});

		it('returns undefined for non-heading content', () => {
			expect(getCellHeadingLevel('just some text')).toBeUndefined();
			expect(getCellHeadingLevel('')).toBeUndefined();
		});

		it('returns the minimum depth when a cell has multiple headings', () => {
			expect(getCellHeadingLevel('### Sub\ntext\n# Top')).toBe(1);
		});

		it('ignores headings inside fenced code blocks', () => {
			expect(getCellHeadingLevel('```\n# not a heading\n```')).toBeUndefined();
		});

		it('detects headings after leading prose', () => {
			expect(getCellHeadingLevel('some intro\n\n## Heading')).toBe(2);
		});
	});

	describe('computeSectionRanges', () => {
		it('returns no ranges for a notebook without headings', () => {
			expect(computeSectionRanges([undefined, undefined])).toEqual([]);
		});

		it('extends a section to the end of the notebook', () => {
			// [# H, code, code]
			expect(computeSectionRanges([1, undefined, undefined])).toEqual([
				{ headerIndex: 0, level: 1, endIndex: 2 },
			]);
		});

		it('ends a section before the next same-level heading', () => {
			// [# A, code, # B, code]
			expect(computeSectionRanges([1, undefined, 1, undefined])).toEqual([
				{ headerIndex: 0, level: 1, endIndex: 1 },
				{ headerIndex: 2, level: 1, endIndex: 3 },
			]);
		});

		it('ends a section before a higher-level heading', () => {
			// [## A, code, # B, code]
			expect(computeSectionRanges([2, undefined, 1, undefined])).toEqual([
				{ headerIndex: 0, level: 2, endIndex: 1 },
				{ headerIndex: 2, level: 1, endIndex: 3 },
			]);
		});

		it('nests lower-level headings inside a section', () => {
			// [# A, code, ## B, code, # C]... section A spans through B's cells.
			expect(computeSectionRanges([1, undefined, 2, undefined, 1])).toEqual([
				{ headerIndex: 0, level: 1, endIndex: 3 },
				{ headerIndex: 2, level: 2, endIndex: 3 },
			]);
		});

		it('omits empty sections', () => {
			// [# A, # B, code] - section A has no content of its own.
			expect(computeSectionRanges([1, 1, undefined])).toEqual([
				{ headerIndex: 1, level: 1, endIndex: 2 },
			]);
			// Header as the last cell.
			expect(computeSectionRanges([undefined, 1])).toEqual([]);
		});
	});

	describe('NotebookSectionFoldingModel', () => {
		function createNotebook(cells: TestCellInput[]): TestPositronNotebookInstance {
			return createTestPositronNotebookInstance(cells, ctx);
		}

		function hiddenIndexes(notebook: TestPositronNotebookInstance): number[] {
			const hidden = notebook.sectionFolding.hiddenCellHandles.get();
			return notebook.cells.get()
				.map((cell, i) => ({ cell, i }))
				.filter(({ cell }) => hidden.has(cell.handle))
				.map(({ i }) => i);
		}

		it('exposes section ranges derived from cell content', () => {
			const notebook = createNotebook([md('# A'), code('1'), md('## B'), code('2')]);
			expect(notebook.sectionFolding.sectionRanges.get()).toEqual([
				{ headerIndex: 0, level: 1, endIndex: 3 },
				{ headerIndex: 2, level: 2, endIndex: 3 },
			]);
		});

		it('collapsing a section hides the cells under it', () => {
			const notebook = createNotebook([md('# A'), code('1'), md('# B'), code('2')]);
			const header = notebook.cells.get()[0];

			expect(hiddenIndexes(notebook)).toEqual([]);
			notebook.sectionFolding.toggleSectionCollapsed(header);
			expect(notebook.sectionFolding.isSectionCollapsed(header)).toBe(true);
			expect(hiddenIndexes(notebook)).toEqual([1]);

			notebook.sectionFolding.toggleSectionCollapsed(header);
			expect(notebook.sectionFolding.isSectionCollapsed(header)).toBe(false);
			expect(hiddenIndexes(notebook)).toEqual([]);
		});

		it('collapsing a non-header cell is a no-op', () => {
			const notebook = createNotebook([md('# A'), code('1')]);
			const codeCell = notebook.cells.get()[1];
			notebook.sectionFolding.toggleSectionCollapsed(codeCell);
			expect(hiddenIndexes(notebook)).toEqual([]);
		});

		it('a nested collapsed section stays collapsed when the outer section is expanded', () => {
			const notebook = createNotebook([md('# A'), md('## B'), code('1'), code('2')]);
			const [outer, inner] = notebook.cells.get();

			notebook.sectionFolding.setSectionCollapsed(inner, true);
			notebook.sectionFolding.setSectionCollapsed(outer, true);
			expect(hiddenIndexes(notebook)).toEqual([1, 2, 3]);

			notebook.sectionFolding.setSectionCollapsed(outer, false);
			expect(hiddenIndexes(notebook)).toEqual([2, 3]);
		});

		it('removing the heading from a collapsed header cell unhides its cells', () => {
			const notebook = createNotebook([md('# A'), code('1')]);
			const header = notebook.cells.get()[0];
			notebook.sectionFolding.setSectionCollapsed(header, true);
			expect(hiddenIndexes(notebook)).toEqual([1]);

			// Replace the heading with plain text; the section disappears.
			// applyEdits (rather than setValue) mutates the text buffer shared
			// with the cell model, matching how editor keystrokes flow.
			const textModel = header.model.textModel!;
			textModel.applyEdits([{ range: textModel.getFullModelRange(), text: 'no longer a heading' }]);
			expect(notebook.sectionFolding.sectionRanges.get()).toEqual([]);
			expect(hiddenIndexes(notebook)).toEqual([]);
		});

		it('revealCell expands every collapsed section containing the cell', () => {
			const notebook = createNotebook([md('# A'), md('## B'), code('1')]);
			const [outer, inner, codeCell] = notebook.cells.get();

			notebook.sectionFolding.setSectionCollapsed(inner, true);
			notebook.sectionFolding.setSectionCollapsed(outer, true);
			expect(hiddenIndexes(notebook)).toEqual([1, 2]);

			notebook.sectionFolding.revealCell(codeCell);
			expect(hiddenIndexes(notebook)).toEqual([]);
		});
	});

	describe('selection with collapsed sections', () => {
		function createCollapsedNotebook(): { notebook: TestPositronNotebookInstance; cells: IPositronNotebookCell[] } {
			// [# A, code, code, # B] with section A collapsed (cells 1-2 hidden).
			const notebook = createTestPositronNotebookInstance(
				[md('# A'), code('1'), code('2'), md('# B')],
				ctx,
			);
			const cells = notebook.cells.get();
			notebook.sectionFolding.setSectionCollapsed(cells[0], true);
			return { notebook, cells };
		}

		it('keyboard navigation skips hidden cells going down', () => {
			const { notebook, cells } = createCollapsedNotebook();
			notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Normal);
			notebook.selectionStateMachine.moveSelectionDown(false);
			expect(getActiveCell(notebook.selectionStateMachine.state.get())).toBe(cells[3]);
		});

		it('keyboard navigation skips hidden cells going up', () => {
			const { notebook, cells } = createCollapsedNotebook();
			notebook.selectionStateMachine.selectCell(cells[3], CellSelectionType.Normal);
			notebook.selectionStateMachine.moveSelectionUp(false);
			expect(getActiveCell(notebook.selectionStateMachine.state.get())).toBe(cells[0]);
		});

		it('selecting a hidden cell expands its containing sections', () => {
			const { notebook, cells } = createCollapsedNotebook();
			// Programmatic selection (e.g. outline or find) of a hidden cell.
			notebook.selectionStateMachine.selectCell(cells[1], CellSelectionType.Normal);
			expect(notebook.sectionFolding.isSectionCollapsed(cells[0])).toBe(false);
			expect(notebook.sectionFolding.hiddenCellHandles.get().size).toBe(0);
		});
	});
});
