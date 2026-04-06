/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
/// <reference types="vitest/globals" />

import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { createTestPositronNotebookInstance } from './testPositronNotebookInstance.js';
import {
	buildOutlineEntries,
	buildTree,
	getMarkdownHeaders,
	getFirstNonEmptyLine,
} from '../../browser/contrib/outline/positronNotebookOutline.contribution.js';

describe('PositronNotebookOutline', () => {
	let disposables: DisposableStore;

	beforeEach(() => {
		disposables = new DisposableStore();
	});

	afterEach(() => {
		disposables.dispose();
	});

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
				disposables,
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
				disposables,
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
				disposables,
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
			], disposables);
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
				disposables,
			);
			const cells = notebook.cells.get();
			const entries = buildOutlineEntries(cells);

			expect(entries.length).toBe(1);
			expect(entries[0].label.length > 0).toBeTruthy();
		});

		it('non-header markdown uses first-line preview', () => {
			const notebook = createTestPositronNotebookInstance(
				[['Some paragraph text\nMore text here', 'markdown', CellKind.Markup]],
				disposables,
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
				disposables,
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
			], disposables);
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
			], disposables);
			const cells = notebook.cells.get();
			const flatEntries = buildOutlineEntries(cells);
			const tree = buildTree(flatEntries);

			expect(tree.length).toBe(1);
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
			], disposables);
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
			], disposables);
			const cells = notebook.cells.get();
			const flatEntries = buildOutlineEntries(cells);
			const tree = buildTree(flatEntries);

			expect(tree.length).toBe(3);
		});

		it('returns empty array for empty input', () => {
			const tree = buildTree([]);
			expect(tree.length).toBe(0);
		});
	});
});
