/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { CellKind, INotebookTextModel } from '../../../notebook/common/notebookCommon.js';
import { buildNotebookLMContext, type VariableSnapshot } from '../../common/notebookLMContext.js';

function mockCell(content: string, language: string, kind: CellKind, outputs: Array<{ mime: string; data: string }> = []) {
	return {
		cellKind: kind,
		language,
		getValue: () => content,
		outputs: outputs.length > 0 ? [{
			outputs: outputs.map(o => ({ mime: o.mime, data: VSBuffer.fromString(o.data) })),
		}] : [],
	};
}

function mockNotebook(cells: ReturnType<typeof mockCell>[]) {
	// eslint-disable-next-line local/code-no-dangerous-type-assertions -- partial mock; only `cells` is accessed by buildNotebookLMContext
	return { cells } as unknown as INotebookTextModel;
}

// The context exposes a single public method, toMarkdown(). Every test asserts
// against that rendered output -- the exact string the LM consumer receives --
// rather than reaching into intermediate fields.
describe('buildNotebookLMContext', () => {
	it('throws on out-of-bounds index', () => {
		const notebook = mockNotebook([mockCell('x = 1', 'python', CellKind.Code)]);
		expect(() => buildNotebookLMContext(notebook, -1)).toThrow();
		expect(() => buildNotebookLMContext(notebook, 1)).toThrow();
	});

	it('renders language and cell position', () => {
		const notebook = mockNotebook([
			mockCell('x = 1', 'python', CellKind.Code),
			mockCell('y = 2', 'python', CellKind.Code),
		]);
		const md = buildNotebookLMContext(notebook, 1).toMarkdown();
		expect(md).toContain('- Language: python');
		expect(md).toContain('- Cell position: 2 of 2');
	});

	it('renders the executed cell as a fenced code block', () => {
		const notebook = mockNotebook([mockCell('print("hi")', 'python', CellKind.Code)]);
		const md = buildNotebookLMContext(notebook, 0).toMarkdown();
		expect(md).toContain('```python\nprint("hi")\n```');
	});

	it('renders text/plain outputs', () => {
		const notebook = mockNotebook([
			mockCell('1+1', 'python', CellKind.Code, [
				{ mime: 'text/plain', data: '2' },
			]),
		]);
		const md = buildNotebookLMContext(notebook, 0).toMarkdown();
		expect(md).toContain('## Cell Output\n```\n2\n```');
	});

	it('renders stdout and stderr outputs and flags the error status', () => {
		const notebook = mockNotebook([
			mockCell('print("hi")', 'python', CellKind.Code, [
				{ mime: 'application/vnd.code.notebook.stdout', data: 'hi' },
				{ mime: 'application/vnd.code.notebook.stderr', data: 'warn' },
			]),
		]);
		const md = buildNotebookLMContext(notebook, 0).toMarkdown();
		expect(md).toContain('## Cell Output\n```\nhi\nwarn\n```');
		expect(md).toContain('- Status: Cell execution produced an error');
	});

	it('parses error output JSON for the stack', () => {
		const errorJson = JSON.stringify({ stack: 'TypeError: x is not a function\n  at line 1' });
		const notebook = mockNotebook([
			mockCell('x()', 'python', CellKind.Code, [
				{ mime: 'application/vnd.code.notebook.error', data: errorJson },
			]),
		]);
		const md = buildNotebookLMContext(notebook, 0).toMarkdown();
		expect(md).toContain('TypeError: x is not a function');
		expect(md).toContain('- Status: Cell execution produced an error');
	});

	it('falls back to raw text for invalid error JSON', () => {
		const notebook = mockNotebook([
			mockCell('x()', 'python', CellKind.Code, [
				{ mime: 'application/vnd.code.notebook.error', data: 'not json' },
			]),
		]);
		const md = buildNotebookLMContext(notebook, 0).toMarkdown();
		expect(md).toContain('## Cell Output\n```\nnot json\n```');
	});

	it('truncates outputs to maxOutputLength', () => {
		const longOutput = 'x'.repeat(2000);
		const notebook = mockNotebook([
			mockCell('x', 'python', CellKind.Code, [
				{ mime: 'text/plain', data: longOutput },
			]),
		]);
		const md = buildNotebookLMContext(notebook, 0, undefined, { maxOutputLength: 100 }).toMarkdown();
		expect(md).toContain('x'.repeat(100) + '...');
		expect(md).not.toContain('x'.repeat(101));
	});

	it('renders previous code cells skipping markdown', () => {
		const notebook = mockNotebook([
			mockCell('import pandas', 'python', CellKind.Code),
			mockCell('# docs', 'markdown', CellKind.Markup),
			mockCell('df = pd.read_csv("f")', 'python', CellKind.Code),
			mockCell('df.head()', 'python', CellKind.Code),
		]);
		const md = buildNotebookLMContext(notebook, 3, undefined, { maxPreviousCells: 2 }).toMarkdown();
		expect(md).toContain('## Previous Context');
		expect(md).toContain('import pandas');
		expect(md).toContain('df = pd.read_csv');
		expect(md).not.toContain('# docs');
	});

	it('omits the previous-context section for the first cell', () => {
		const notebook = mockNotebook([mockCell('x = 1', 'python', CellKind.Code)]);
		const md = buildNotebookLMContext(notebook, 0).toMarkdown();
		expect(md).not.toContain('## Previous Context');
	});

	it('sorts variables by priority and formats as pipe-delimited', () => {
		const variables: VariableSnapshot[] = [
			{ name: 'x', type: 'int' },
			{ name: 'df', type: 'DataFrame' },
			{ name: 'items', type: 'list' },
		];
		const md = buildNotebookLMContext(
			mockNotebook([mockCell('x', 'python', CellKind.Code)]),
			0,
			variables,
		).toMarkdown();
		// DataFrame (priority 1) before list (2) before int (3), one per line.
		expect(md).toContain('df|DataFrame\nitems|list\nx|int');
	});

	it('includes typeInfo when present', () => {
		const variables: VariableSnapshot[] = [
			{ name: 'df', type: 'DataFrame', typeInfo: '100 rows x 5 cols' },
		];
		const md = buildNotebookLMContext(
			mockNotebook([mockCell('x', 'python', CellKind.Code)]),
			0,
			variables,
		).toMarkdown();
		expect(md).toContain('df|DataFrame|100 rows x 5 cols');
	});

	it('respects maxVariables', () => {
		const variables: VariableSnapshot[] = Array.from({ length: 50 }, (_, i) => ({
			name: `var${i}`, type: 'int',
		}));
		const md = buildNotebookLMContext(
			mockNotebook([mockCell('x', 'python', CellKind.Code)]),
			0,
			variables,
			{ maxVariables: 5 },
		).toMarkdown();
		// Equal priority keeps insertion order, so the first 5 (var0..var4) survive.
		expect(md).toContain('var4|int');
		expect(md).not.toContain('var5|int');
	});

	it('omits the variables section when none are provided', () => {
		const md = buildNotebookLMContext(
			mockNotebook([mockCell('x', 'python', CellKind.Code)]),
			0,
		).toMarkdown();
		expect(md).not.toContain('## Session Variables');
	});

	it('omits empty sections', () => {
		const notebook = mockNotebook([mockCell('x = 1', 'python', CellKind.Code)]);
		const md = buildNotebookLMContext(notebook, 0).toMarkdown();
		expect(md).not.toContain('## Cell Output');
		expect(md).not.toContain('## Previous Context');
		expect(md).not.toContain('## Session Variables');
	});

	it('includes all sections when present', () => {
		const notebook = mockNotebook([
			mockCell('import pandas', 'python', CellKind.Code),
			mockCell('df.head()', 'python', CellKind.Code, [
				{ mime: 'text/plain', data: '  col1\n0  1' },
			]),
		]);
		const variables: VariableSnapshot[] = [{ name: 'df', type: 'DataFrame' }];
		const md = buildNotebookLMContext(notebook, 1, variables).toMarkdown();
		expect(md).toContain('## Notebook Context');
		expect(md).toContain('## Just Executed Cell');
		expect(md).toContain('## Cell Output');
		expect(md).toContain('## Previous Context');
		expect(md).toContain('## Session Variables');
	});

	it('ends with a trailing newline', () => {
		const notebook = mockNotebook([mockCell('x', 'python', CellKind.Code)]);
		const md = buildNotebookLMContext(notebook, 0).toMarkdown();
		expect(md.endsWith('\n')).toBe(true);
	});
});
