/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { URI } from '../../../../../base/common/uri.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { createTextModel } from '../../../../../editor/test/common/testTextModel.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { NotebookTextModel } from '../../../notebook/common/model/notebookTextModel.js';
import { QuartoDocumentModel } from '../../browser/quartoDocumentModel.js';
import { QuartoShadowNotebookSync } from '../../browser/quartoShadowNotebookSync.js';
import { QUARTO_SHADOW_NOTEBOOK_VIEW_TYPE } from '../../common/quartoShadowNotebook.js';

/** Debounce delay of QuartoDocumentModel's reparse, in milliseconds. */
const REPARSE_DEBOUNCE_MS = 100;

function qmd(...cells: [language: string, code: string][]): string {
	const parts = ['---', 'title: test', '---', '', 'Some prose.', ''];
	for (const [language, code] of cells) {
		parts.push('```{' + language + '}', code, '```', '', 'More prose.', '');
	}
	return parts.join('\n');
}

describe('QuartoShadowNotebookSync', () => {
	const ctx = createTestContainer().withWorkbenchServices().build();

	beforeEach(() => {
		vi.useFakeTimers();
	});

	function createSync(content: string, disposables: Pick<DisposableStore, 'add'>) {
		const textModel = disposables.add(createTextModel(content, null, undefined, URI.file('/test.qmd')));
		const documentModel = disposables.add(new QuartoDocumentModel(textModel, new NullLogService()));
		// The sync populates the (initially empty) notebook on construction.
		const notebook: NotebookTextModel = disposables.add(ctx.instantiationService.createInstance(
			NotebookTextModel,
			QUARTO_SHADOW_NOTEBOOK_VIEW_TYPE,
			URI.file('/test.qmd'),
			[],
			{},
			{ transientOutputs: true, transientCellMetadata: {}, transientDocumentMetadata: {}, cellContentMetadata: {} },
		));
		const sync = disposables.add(ctx.instantiationService.createInstance(QuartoShadowNotebookSync, documentModel, notebook));
		return { textModel, documentModel, notebook, sync };
	}

	/** Apply new content to the text model and run the debounced reparse. */
	function setContent(textModel: { setValue(value: string): void }, content: string): void {
		textModel.setValue(content);
		vi.advanceTimersByTime(REPARSE_DEBOUNCE_MS);
	}

	function snapshot(notebook: NotebookTextModel) {
		return notebook.cells.map(cell => ({ language: cell.language, text: cell.getValue() }));
	}

	it('creates cells for the initial document', () => {
		const { notebook } = createSync(qmd(['python', 'x = 1'], ['r', 'y <- 2']), ctx.disposables);
		expect(snapshot(notebook)).toEqual([
			{ language: 'python', text: 'x = 1' },
			{ language: 'r', text: 'y <- 2' },
		]);
	});

	it('applies an edit inside one cell in place, preserving all cell handles', () => {
		const { textModel, notebook } = createSync(qmd(['python', 'x = 1'], ['python', 'y = 2']), ctx.disposables);
		const handlesBefore = notebook.cells.map(cell => cell.handle);

		setContent(textModel, qmd(['python', 'x = 42'], ['python', 'y = 2']));

		expect(snapshot(notebook)).toEqual([
			{ language: 'python', text: 'x = 42' },
			{ language: 'python', text: 'y = 2' },
		]);
		// In-place edit: no cell was closed/reopened.
		expect(notebook.cells.map(cell => cell.handle)).toEqual(handlesBefore);
	});

	it('adds a cell in the middle without disturbing its neighbors', () => {
		const { textModel, notebook } = createSync(qmd(['python', 'a = 1'], ['python', 'c = 3']), ctx.disposables);
		const handlesBefore = notebook.cells.map(cell => cell.handle);

		setContent(textModel, qmd(['python', 'a = 1'], ['r', 'b <- 2'], ['python', 'c = 3']));

		expect(snapshot(notebook)).toEqual([
			{ language: 'python', text: 'a = 1' },
			{ language: 'r', text: 'b <- 2' },
			{ language: 'python', text: 'c = 3' },
		]);
		// The neighbors kept their identity; only the new cell is new.
		expect(notebook.cells[0].handle).toBe(handlesBefore[0]);
		expect(notebook.cells[2].handle).toBe(handlesBefore[1]);
	});

	it('removes a cell without disturbing its neighbors', () => {
		const { textModel, notebook } = createSync(
			qmd(['python', 'a = 1'], ['r', 'b <- 2'], ['python', 'c = 3']), ctx.disposables);
		const handlesBefore = notebook.cells.map(cell => cell.handle);

		setContent(textModel, qmd(['python', 'a = 1'], ['python', 'c = 3']));

		expect(snapshot(notebook)).toEqual([
			{ language: 'python', text: 'a = 1' },
			{ language: 'python', text: 'c = 3' },
		]);
		expect(notebook.cells.map(cell => cell.handle)).toEqual([handlesBefore[0], handlesBefore[2]]);
	});

	it('replaces a cell whose fence language changed', () => {
		const { textModel, notebook } = createSync(qmd(['python', 'x'], ['python', 'keep']), ctx.disposables);
		const keepHandle = notebook.cells[1].handle;
		const changedHandle = notebook.cells[0].handle;

		setContent(textModel, qmd(['r', 'x'], ['python', 'keep']));

		expect(snapshot(notebook)).toEqual([
			{ language: 'r', text: 'x' },
			{ language: 'python', text: 'keep' },
		]);
		// Language change is structural: the cell is replaced.
		expect(notebook.cells[0].handle).not.toBe(changedHandle);
		expect(notebook.cells[1].handle).toBe(keepHandle);
	});

	it('reorders cells of different languages', () => {
		const { textModel, notebook } = createSync(qmd(['python', 'a = 1'], ['r', 'b <- 2']), ctx.disposables);

		setContent(textModel, qmd(['r', 'b <- 2'], ['python', 'a = 1']));

		expect(snapshot(notebook)).toEqual([
			{ language: 'r', text: 'b <- 2' },
			{ language: 'python', text: 'a = 1' },
		]);
	});

	it('mirrors a document with no code cells as an empty notebook', () => {
		const { notebook } = createSync('---\ntitle: prose only\n---\n\nJust some prose.\n', ctx.disposables);
		expect(notebook.cells.length).toBe(0);
	});

	it('mirrors an empty document as an empty notebook', () => {
		const { notebook } = createSync('', ctx.disposables);
		expect(notebook.cells.length).toBe(0);
	});

	it('ignores an unclosed fence until it is closed', () => {
		const { textModel, notebook } = createSync('```{python}\nx = 1\n', ctx.disposables);
		expect(notebook.cells.length).toBe(0);

		setContent(textModel, '```{python}\nx = 1\n```\n');

		expect(snapshot(notebook)).toEqual([{ language: 'python', text: 'x = 1' }]);
	});

	it('mirrors an empty cell body', () => {
		const { notebook } = createSync('```{python}\n```\n', ctx.disposables);
		expect(snapshot(notebook)).toEqual([{ language: 'python', text: '' }]);
	});

	it('converges under rapid consecutive edits', () => {
		const { textModel, notebook } = createSync(qmd(['python', 'x = 1']), ctx.disposables);

		// Several edits landing within one debounce window plus one after.
		textModel.setValue(qmd(['python', 'x = 2']));
		textModel.setValue(qmd(['python', 'x = 2'], ['python', 'y = 3']));
		vi.advanceTimersByTime(REPARSE_DEBOUNCE_MS);
		setContent(textModel, qmd(['python', 'x = 2'], ['python', 'y = 30'], ['r', 'z <- 4']));

		expect(snapshot(notebook)).toEqual([
			{ language: 'python', text: 'x = 2' },
			{ language: 'python', text: 'y = 30' },
			{ language: 'r', text: 'z <- 4' },
		]);
	});

	it('materializes a cell text model for in-place edits and updates the notebook version', () => {
		const { textModel, notebook } = createSync(qmd(['python', 'x = 1']), ctx.disposables);
		const modelService = ctx.get(IModelService);
		const cellUri = notebook.cells[0].uri;

		// No cell text model until the first in-place edit needs one.
		expect(modelService.getModel(cellUri)).toBeNull();
		const versionBefore = notebook.versionId;

		setContent(textModel, qmd(['python', 'x = 42']));

		// The edit materialized a model sharing the cell's buffer, and the
		// change bumped the notebook version (what drives the ext host sync).
		expect(modelService.getModel(cellUri)?.getValue()).toBe('x = 42');
		expect(notebook.cells[0].getValue()).toBe('x = 42');
		expect(notebook.versionId).toBeGreaterThan(versionBefore);
	});

	it('disposes cell text models it created when cells are removed', () => {
		const disposables = new DisposableStore();
		const { textModel, notebook } = createSync(qmd(['python', 'x = 1'], ['python', 'y = 2']), disposables);
		const modelService = ctx.get(IModelService);

		// Materialize the first cell's text model via an in-place edit.
		setContent(textModel, qmd(['python', 'x = 42'], ['python', 'y = 2']));
		const cellUri = notebook.cells[0].uri;
		expect(modelService.getModel(cellUri)).not.toBeNull();

		// Removing the cell disposes the materialized model.
		setContent(textModel, qmd(['python', 'y = 2']));
		expect(modelService.getModel(cellUri)).toBeNull();

		// Disposing the sync disposes remaining materialized models.
		setContent(textModel, qmd(['python', 'y = 20']));
		const remainingUri = notebook.cells[0].uri;
		expect(modelService.getModel(remainingUri)).not.toBeNull();
		disposables.dispose();
		expect(modelService.getModel(remainingUri)).toBeNull();
	});

	it('stops syncing after disposal', () => {
		const { textModel, notebook, sync } = createSync(qmd(['python', 'x = 1']), ctx.disposables);

		sync.dispose();
		setContent(textModel, qmd(['python', 'x = 2'], ['r', 'y <- 3']));

		expect(snapshot(notebook)).toEqual([{ language: 'python', text: 'x = 1' }]);
	});
});
