/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { notebookToPercentScript } from '../percentNotebookExporter.js';

function mockCell(text: string, languageId: string, kind: 'code' | 'markup') {
	return {
		kind: kind === 'code' ? vscode.NotebookCellKind.Code : vscode.NotebookCellKind.Markup,
		document: {
			getText: () => text,
			languageId,
		},
	} as vscode.NotebookCell;
}

function mockNotebook(cells: ReturnType<typeof mockCell>[]) {
	return {
		getCells: () => cells,
	} as vscode.NotebookDocument;
}

// We only test the internal export logic here.
// The exporter classes are thin wrappers over this,
// much of which is tested in extension.test.ts.
suite('notebookToPercentScript', () => {
	let disposables: vscode.Disposable[] = [];

	teardown(() => {
		disposables.forEach(d => d.dispose());
		disposables = [];
		sinon.restore();
	});

	test('code cell', () => {
		const actual = notebookToPercentScript(mockNotebook([
			mockCell('print("Hello, world!")', 'python', 'code'),
		]), { commentPrefix: '#' });
		assert.strictEqual(actual, `# %%
print("Hello, world!")
`);
	});

	test('markdown cell', () => {
		const actual = notebookToPercentScript(mockNotebook([
			mockCell('# Heading\n\nContent', 'markdown', 'markup'),
		]), { commentPrefix: '#' });
		assert.strictEqual(actual, `# %% [markdown]
# # Heading
#
# Content
`);
	});

	test('raw cell', () => {
		const actual = notebookToPercentScript(mockNotebook([
			mockCell('---\ntitle: My Title\n---', 'raw', 'code'),
		]), { commentPrefix: '#' });
		assert.strictEqual(actual, `# %% [raw]
# ---
# title: My Title
# ---
`);
	});

	test('multiple cells of different types', () => {
		const actual = notebookToPercentScript(mockNotebook([
			mockCell('---\ntitle: My Title\n---', 'raw', 'code'),
			mockCell('# Heading\n\nContent', 'markdown', 'markup'),
			mockCell('print("Hello, world!")', 'python', 'code'),
		]), { commentPrefix: '#' });
		assert.strictEqual(actual, `# %% [raw]
# ---
# title: My Title
# ---

# %% [markdown]
# # Heading
#
# Content

# %%
print("Hello, world!")
`);
	});

	test('custom comment prefix', () => {
		const actual = notebookToPercentScript(mockNotebook([
			mockCell('# Heading\n\nContent', 'markdown', 'markup'),
		]), { commentPrefix: '//' });
		assert.strictEqual(actual, `// %% [markdown]
// # Heading
//
// Content
`);
	});

	// No special treatment for cell delimiters inside code cells, for now.
	// Notebooks containing this case will not round-trip, however this
	// matches `jupytext` behavior, which is the current standard.
	test('cell delimiter in code cell', () => {
		const actual = notebookToPercentScript(mockNotebook([
			mockCell('# %%', 'python', 'code'),
		]), { commentPrefix: '#' });
		assert.strictEqual(actual, `# %%
# %%
`);
	});
});
