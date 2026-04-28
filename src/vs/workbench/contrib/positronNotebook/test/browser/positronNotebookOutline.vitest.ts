/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { createTestPositronNotebookInstance } from './testPositronNotebookInstance.js';
import {
	buildOutlineEntries,
	buildTree,
	getMarkdownHeaders,
	getFirstNonEmptyLine,
	PositronNotebookCellOutline,
} from '../../browser/contrib/outline/positronNotebookOutline.contribution.js';
import { PositronNotebookEditor } from '../../browser/PositronNotebookEditor.js';
import { OutlineTarget } from '../../../../services/outline/browser/outline.js';
import { getActiveCell } from '../../browser/selectionMachine.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';

describe('PositronNotebookOutline', () => {
	const ctx = createTestContainer().withNotebookEditorServices().build();

	describe('getFirstNonEmptyLine', () => {
		it('returns first non-empty line', () => {
			expect(getFirstNonEmptyLine('hello\nworld')).toBe('hello');
		});

		it('skips blank lines', () => {
			expect(getFirstNonEmptyLine('\n\n  \nhello')).toBe('hello');
		});

		it('returns empty string for empty input', () => {
			expect(getFirstNonEmptyLine('')).toBe('');
		});

		it('returns empty string for whitespace-only input', () => {
			expect(getFirstNonEmptyLine('   \n  \n  ')).toBe('');
		});
	});

	describe('getMarkdownHeaders', () => {
		it('extracts markdown headers', () => {
			const headers = getMarkdownHeaders('# Title\nsome text\n## Subtitle');
			expect(headers.length).toBe(2);
			expect(headers[0].depth).toBe(1);
			expect(headers[0].text).toBe('Title');
			expect(headers[1].depth).toBe(2);
			expect(headers[1].text).toBe('Subtitle');
		});

		it('returns empty for no headers', () => {
			const headers = getMarkdownHeaders('just some text\nno headers here');
			expect(headers.length).toBe(0);
		});

		it('falls back to HTML heading tags', () => {
			const headers = getMarkdownHeaders('<h2>HTML Heading</h2>');
			expect(headers.length).toBe(1);
			expect(headers[0].depth).toBe(2);
			expect(headers[0].text).toBe('HTML Heading');
		});

		it('prefers markdown headers over HTML tags', () => {
			const headers = getMarkdownHeaders('# Markdown\n<h2>HTML</h2>');
			expect(headers.length).toBe(1);
			expect(headers[0].text).toBe('Markdown');
		});
	});

	describe('buildOutlineEntries', () => {
		it('builds entries from markdown headers', () => {
			const notebook = createTestPositronNotebookInstance(
				[['# Title\n## Section', 'markdown', CellKind.Markup]],
				ctx,
			);
			const cells = notebook.cells.get();
			const entries = buildOutlineEntries(cells);

			expect(entries.length).toBe(2);
			expect(entries[0].label).toBe('Title');
			expect(entries[0].level).toBe(1);
			expect(entries[1].label).toBe('Section');
			expect(entries[1].level).toBe(2);
		});

		it('builds entries from code cells', () => {
			const notebook = createTestPositronNotebookInstance(
				[['print("hello")', 'python', CellKind.Code]],
				ctx,
			);
			const cells = notebook.cells.get();
			const entries = buildOutlineEntries(cells);

			expect(entries.length).toBe(1);
			expect(entries[0].label).toBe('print("hello")');
			expect(entries[0].level).toBe(7); // NonHeaderOutlineLevel
		});

		it('skips raw cells', () => {
			const notebook = createTestPositronNotebookInstance(
				[['raw content', 'raw', CellKind.Code]],
				ctx,
			);
			const cells = notebook.cells.get();
			const entries = buildOutlineEntries(cells);

			expect(entries.length).toBe(0);
		});

		it('handles mixed cell types', () => {
			const notebook = createTestPositronNotebookInstance([
				['# Introduction', 'markdown', CellKind.Markup],
				['x = 1', 'python', CellKind.Code],
				['## Analysis', 'markdown', CellKind.Markup],
				['plot(x)', 'python', CellKind.Code],
			], ctx);
			const cells = notebook.cells.get();
			const entries = buildOutlineEntries(cells);

			expect(entries.length).toBe(4);
			expect(entries[0].label).toBe('Introduction');
			expect(entries[1].label).toBe('x = 1');
			expect(entries[2].label).toBe('Analysis');
			expect(entries[3].label).toBe('plot(x)');
		});

		it('empty markdown cell shows fallback label', () => {
			const notebook = createTestPositronNotebookInstance(
				[['', 'markdown', CellKind.Markup]],
				ctx,
			);
			const cells = notebook.cells.get();
			const entries = buildOutlineEntries(cells);

			expect(entries.length).toBe(1);
			expect(entries[0].label.length, 'Should have a fallback label').toBeGreaterThan(0);
		});

		it('non-header markdown uses first-line preview', () => {
			const notebook = createTestPositronNotebookInstance(
				[['Some paragraph text\nMore text here', 'markdown', CellKind.Markup]],
				ctx,
			);
			const cells = notebook.cells.get();
			const entries = buildOutlineEntries(cells);

			expect(entries.length).toBe(1);
			expect(entries[0].level).toBe(7); // NonHeaderOutlineLevel
		});
	});

	describe('duplicate heading IDs', () => {
		it('de-duplicates heading IDs within a cell', () => {
			const notebook = createTestPositronNotebookInstance(
				[['## Details\n## Details\n## Details', 'markdown', CellKind.Markup]],
				ctx,
			);
			const cells = notebook.cells.get();
			const entries = buildOutlineEntries(cells);

			expect(entries.length).toBe(3);
			expect(entries[0].headingId).toBe('details');
			expect(entries[1].headingId).toBe('details-1');
			expect(entries[2].headingId).toBe('details-2');
		});

		it('resets slug counter between cells', () => {
			const notebook = createTestPositronNotebookInstance([
				['## Details', 'markdown', CellKind.Markup],
				['## Details', 'markdown', CellKind.Markup],
			], ctx);
			const cells = notebook.cells.get();
			const entries = buildOutlineEntries(cells);

			expect(entries.length).toBe(2);
			// Each cell gets its own slug counter, so both are "details"
			expect(entries[0].headingId).toBe('details');
			expect(entries[1].headingId).toBe('details');
		});
	});

	describe('buildTree', () => {
		it('nests entries by header level', () => {
			const notebook = createTestPositronNotebookInstance([
				['# H1\n## H2\n### H3', 'markdown', CellKind.Markup],
			], ctx);
			const cells = notebook.cells.get();
			const flatEntries = buildOutlineEntries(cells);
			const tree = buildTree(flatEntries);

			expect(tree.length, 'Should have 1 root entry').toBe(1);
			expect(tree[0].label).toBe('H1');
			const h2Children = Array.from(tree[0].children);
			expect(h2Children.length).toBe(1);
			expect(h2Children[0].label).toBe('H2');
			const h3Children = Array.from(h2Children[0].children);
			expect(h3Children.length).toBe(1);
			expect(h3Children[0].label).toBe('H3');
		});

		it('code cells nest under preceding header', () => {
			const notebook = createTestPositronNotebookInstance([
				['# Title', 'markdown', CellKind.Markup],
				['x = 1', 'python', CellKind.Code],
			], ctx);
			const cells = notebook.cells.get();
			const flatEntries = buildOutlineEntries(cells);
			const tree = buildTree(flatEntries);

			expect(tree.length).toBe(1);
			const children = Array.from(tree[0].children);
			expect(children.length).toBe(1);
			expect(children[0].label).toBe('x = 1');
		});

		it('sibling headers stay at same level', () => {
			const notebook = createTestPositronNotebookInstance([
				['## A\n## B\n## C', 'markdown', CellKind.Markup],
			], ctx);
			const cells = notebook.cells.get();
			const flatEntries = buildOutlineEntries(cells);
			const tree = buildTree(flatEntries);

			expect(tree.length, 'All h2s should be roots').toBe(3);
		});

		it('returns empty array for empty input', () => {
			const tree = buildTree([]);
			expect(tree.length).toBe(0);
		});
	});

	describe('reveal selects the corresponding cell', () => {
		// The IOutline.reveal() method is what the workbench tree's click handler
		// binds to, so testing it directly covers the click-to-navigate behavior
		// without standing up the workbench tree. The PositronNotebookEditor is
		// narrowed to its `notebookInstance` getter, which is the only field the
		// outline reads from the editor.
		const revealOptions: IEditorOptions = {};

		function createOutline(notebook: ReturnType<typeof createTestPositronNotebookInstance>) {
			// PositronNotebookCellOutline only reads `_editor.notebookInstance` --
			// narrowing the editor to that single property is sufficient.
			const editor = stubInterface<PositronNotebookEditor>({ notebookInstance: notebook });
			const outline = ctx.disposables.add(ctx.instantiationService.createInstance(
				PositronNotebookCellOutline,
				editor,
				OutlineTarget.OutlinePane,
			));
			return outline;
		}

		it('reveals a markdown-header entry and selects that header\'s cell', async () => {
			const notebook = createTestPositronNotebookInstance([
				['# First Section', 'markdown', CellKind.Markup],
				['x = 1', 'python', CellKind.Code],
				['# Second Section', 'markdown', CellKind.Markup],
			], ctx);
			const outline = createOutline(notebook);

			// Flatten the tree to find the entry for "Second Section".
			const flat: ReturnType<typeof buildOutlineEntries> = [];
			for (const root of outline.entries) {
				root.asFlatList(flat);
			}
			const secondSection = flat.find(e => e.label === 'Second Section');
			expect(secondSection, 'Second Section entry should exist').toBeDefined();

			await outline.reveal(secondSection!, revealOptions, false);

			const cells = notebook.cells.get();
			const activeCell = getActiveCell(notebook.selectionStateMachine.state.get());
			expect(activeCell).toBe(cells[2]);
		});

		it('reveals a code-cell entry and selects that code cell', async () => {
			const notebook = createTestPositronNotebookInstance([
				['# Title', 'markdown', CellKind.Markup],
				['x = 1', 'python', CellKind.Code],
				['# Analysis', 'markdown', CellKind.Markup],
			], ctx);
			const outline = createOutline(notebook);

			const flat: ReturnType<typeof buildOutlineEntries> = [];
			for (const root of outline.entries) {
				root.asFlatList(flat);
			}
			const codeEntry = flat.find(e => e.label === 'x = 1');
			expect(codeEntry, 'Code-cell entry should exist').toBeDefined();

			await outline.reveal(codeEntry!, revealOptions, false);

			const cells = notebook.cells.get();
			const activeCell = getActiveCell(notebook.selectionStateMachine.state.get());
			expect(activeCell).toBe(cells[1]);
		});
	});
});
