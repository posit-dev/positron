/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { createTestContainer } from '../../../../test/browser/positronTestContainer.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { createTestPositronNotebookInstance } from './testPositronNotebookInstance.js';
import {
	buildOutlineEntries,
	buildTree,
	getMarkdownHeaders,
	getFirstNonEmptyLine,
} from '../../browser/contrib/outline/positronNotebookOutline.contribution.js';

suite('PositronNotebookOutline', () => {
	const ctx = createTestContainer().build();

	suite('getFirstNonEmptyLine', () => {
		test('returns first non-empty line', () => {
			assert.strictEqual(getFirstNonEmptyLine('hello\nworld'), 'hello');
		});

		test('skips blank lines', () => {
			assert.strictEqual(getFirstNonEmptyLine('\n\n  \nhello'), 'hello');
		});

		test('returns empty string for empty input', () => {
			assert.strictEqual(getFirstNonEmptyLine(''), '');
		});

		test('returns empty string for whitespace-only input', () => {
			assert.strictEqual(getFirstNonEmptyLine('   \n  \n  '), '');
		});
	});

	suite('getMarkdownHeaders', () => {
		test('extracts markdown headers', () => {
			const headers = getMarkdownHeaders('# Title\nsome text\n## Subtitle');
			assert.strictEqual(headers.length, 2);
			assert.strictEqual(headers[0].depth, 1);
			assert.strictEqual(headers[0].text, 'Title');
			assert.strictEqual(headers[1].depth, 2);
			assert.strictEqual(headers[1].text, 'Subtitle');
		});

		test('returns empty for no headers', () => {
			const headers = getMarkdownHeaders('just some text\nno headers here');
			assert.strictEqual(headers.length, 0);
		});

		test('falls back to HTML heading tags', () => {
			const headers = getMarkdownHeaders('<h2>HTML Heading</h2>');
			assert.strictEqual(headers.length, 1);
			assert.strictEqual(headers[0].depth, 2);
			assert.strictEqual(headers[0].text, 'HTML Heading');
		});

		test('prefers markdown headers over HTML tags', () => {
			const headers = getMarkdownHeaders('# Markdown\n<h2>HTML</h2>');
			assert.strictEqual(headers.length, 1);
			assert.strictEqual(headers[0].text, 'Markdown');
		});
	});

	suite('buildOutlineEntries', () => {
		test('builds entries from markdown headers', () => {
			const notebook = createTestPositronNotebookInstance(
				[['# Title\n## Section', 'markdown', CellKind.Markup]],
				ctx.disposables,
			);
			const cells = notebook.cells.get();
			const entries = buildOutlineEntries(cells);

			assert.strictEqual(entries.length, 2);
			assert.strictEqual(entries[0].label, 'Title');
			assert.strictEqual(entries[0].level, 1);
			assert.strictEqual(entries[1].label, 'Section');
			assert.strictEqual(entries[1].level, 2);
		});

		test('builds entries from code cells', () => {
			const notebook = createTestPositronNotebookInstance(
				[['print("hello")', 'python', CellKind.Code]],
				ctx.disposables,
			);
			const cells = notebook.cells.get();
			const entries = buildOutlineEntries(cells);

			assert.strictEqual(entries.length, 1);
			assert.strictEqual(entries[0].label, 'print("hello")');
			assert.strictEqual(entries[0].level, 7); // NonHeaderOutlineLevel
		});

		test('skips raw cells', () => {
			const notebook = createTestPositronNotebookInstance(
				[['raw content', 'raw', CellKind.Code]],
				ctx.disposables,
			);
			const cells = notebook.cells.get();
			const entries = buildOutlineEntries(cells);

			assert.strictEqual(entries.length, 0);
		});

		test('handles mixed cell types', () => {
			const notebook = createTestPositronNotebookInstance([
				['# Introduction', 'markdown', CellKind.Markup],
				['x = 1', 'python', CellKind.Code],
				['## Analysis', 'markdown', CellKind.Markup],
				['plot(x)', 'python', CellKind.Code],
			], ctx.disposables);
			const cells = notebook.cells.get();
			const entries = buildOutlineEntries(cells);

			assert.strictEqual(entries.length, 4);
			assert.strictEqual(entries[0].label, 'Introduction');
			assert.strictEqual(entries[1].label, 'x = 1');
			assert.strictEqual(entries[2].label, 'Analysis');
			assert.strictEqual(entries[3].label, 'plot(x)');
		});

		test('empty markdown cell shows fallback label', () => {
			const notebook = createTestPositronNotebookInstance(
				[['', 'markdown', CellKind.Markup]],
				ctx.disposables,
			);
			const cells = notebook.cells.get();
			const entries = buildOutlineEntries(cells);

			assert.strictEqual(entries.length, 1);
			assert.ok(entries[0].label.length > 0, 'Should have a fallback label');
		});

		test('non-header markdown uses first-line preview', () => {
			const notebook = createTestPositronNotebookInstance(
				[['Some paragraph text\nMore text here', 'markdown', CellKind.Markup]],
				ctx.disposables,
			);
			const cells = notebook.cells.get();
			const entries = buildOutlineEntries(cells);

			assert.strictEqual(entries.length, 1);
			assert.strictEqual(entries[0].level, 7); // NonHeaderOutlineLevel
		});
	});

	suite('duplicate heading IDs', () => {
		test('de-duplicates heading IDs within a cell', () => {
			const notebook = createTestPositronNotebookInstance(
				[['## Details\n## Details\n## Details', 'markdown', CellKind.Markup]],
				ctx.disposables,
			);
			const cells = notebook.cells.get();
			const entries = buildOutlineEntries(cells);

			assert.strictEqual(entries.length, 3);
			assert.strictEqual(entries[0].headingId, 'details');
			assert.strictEqual(entries[1].headingId, 'details-1');
			assert.strictEqual(entries[2].headingId, 'details-2');
		});

		test('resets slug counter between cells', () => {
			const notebook = createTestPositronNotebookInstance([
				['## Details', 'markdown', CellKind.Markup],
				['## Details', 'markdown', CellKind.Markup],
			], ctx.disposables);
			const cells = notebook.cells.get();
			const entries = buildOutlineEntries(cells);

			assert.strictEqual(entries.length, 2);
			// Each cell gets its own slug counter, so both are "details"
			assert.strictEqual(entries[0].headingId, 'details');
			assert.strictEqual(entries[1].headingId, 'details');
		});
	});

	suite('buildTree', () => {
		test('nests entries by header level', () => {
			const notebook = createTestPositronNotebookInstance([
				['# H1\n## H2\n### H3', 'markdown', CellKind.Markup],
			], ctx.disposables);
			const cells = notebook.cells.get();
			const flatEntries = buildOutlineEntries(cells);
			const tree = buildTree(flatEntries);

			assert.strictEqual(tree.length, 1, 'Should have 1 root entry');
			assert.strictEqual(tree[0].label, 'H1');
			const h2Children = Array.from(tree[0].children);
			assert.strictEqual(h2Children.length, 1);
			assert.strictEqual(h2Children[0].label, 'H2');
			const h3Children = Array.from(h2Children[0].children);
			assert.strictEqual(h3Children.length, 1);
			assert.strictEqual(h3Children[0].label, 'H3');
		});

		test('code cells nest under preceding header', () => {
			const notebook = createTestPositronNotebookInstance([
				['# Title', 'markdown', CellKind.Markup],
				['x = 1', 'python', CellKind.Code],
			], ctx.disposables);
			const cells = notebook.cells.get();
			const flatEntries = buildOutlineEntries(cells);
			const tree = buildTree(flatEntries);

			assert.strictEqual(tree.length, 1);
			const children = Array.from(tree[0].children);
			assert.strictEqual(children.length, 1);
			assert.strictEqual(children[0].label, 'x = 1');
		});

		test('sibling headers stay at same level', () => {
			const notebook = createTestPositronNotebookInstance([
				['## A\n## B\n## C', 'markdown', CellKind.Markup],
			], ctx.disposables);
			const cells = notebook.cells.get();
			const flatEntries = buildOutlineEntries(cells);
			const tree = buildTree(flatEntries);

			assert.strictEqual(tree.length, 3, 'All h2s should be roots');
		});

		test('returns empty array for empty input', () => {
			const tree = buildTree([]);
			assert.strictEqual(tree.length, 0);
		});
	});
});
