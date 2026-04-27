/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { createTestPositronNotebookInstance } from './testPositronNotebookInstance.js';

/**
 * Verifies that PositronNotebookInstance.applyRestoredScrollPosition drives
 * scroll restoration imperatively. The editor's cache-hit path relies on this
 * because the cached React tree is reused across tab switches, so
 * useScrollRestoration's mount-time consume only runs once per mount and
 * a fresh restored position would otherwise sit unread in the instance.
 */
describe('PositronNotebookInstance.applyRestoredScrollPosition', () => {
	const ctx = createTestContainer().withNotebookEditorServices().build();

	it('returns undefined when no cells container is set', () => {
		const notebook = createTestPositronNotebookInstance(
			[['print("a")', 'python', CellKind.Code]],
			ctx,
		);
		// No setCellsContainer call -- _cellsContainer is undefined.

		notebook.restoreEditorViewState({ scrollPosition: { cellIndex: 0, offsetFromCell: 100 } });

		expect(notebook.applyRestoredScrollPosition()).toBeUndefined();
	});

	it('returns undefined when no scroll position has been restored', () => {
		const notebook = createTestPositronNotebookInstance(
			[['print("a")', 'python', CellKind.Code]],
			ctx,
		);

		const cellsContainer = document.createElement('div');
		notebook.setCellsContainer(cellsContainer);

		// No restoreEditorViewState call, or one that yields no resolved position.
		expect(notebook.applyRestoredScrollPosition()).toBeUndefined();
	});

	it('drops a stale resolved position when the saved cellIndex is out of range', () => {
		const notebook = createTestPositronNotebookInstance(
			[['print("a")', 'python', CellKind.Code]],
			ctx,
		);

		const cellsContainer = document.createElement('div');
		notebook.setCellsContainer(cellsContainer);

		// cellIndex=5 doesn't exist in a one-cell notebook -- restoreEditorViewState
		// should resolve to undefined, so applyRestoredScrollPosition has nothing
		// to do.
		notebook.restoreEditorViewState({ scrollPosition: { cellIndex: 5, offsetFromCell: 100 } });

		expect(notebook.applyRestoredScrollPosition()).toBeUndefined();
	});

	it('returns a disposable and consumes the restored position', () => {
		const notebook = createTestPositronNotebookInstance(
			[['print("a")', 'python', CellKind.Code]],
			ctx,
		);

		const cellsContainer = document.createElement('div');
		document.body.appendChild(cellsContainer);
		ctx.disposables.add({ dispose: () => cellsContainer.remove() });
		notebook.setCellsContainer(cellsContainer);

		notebook.restoreEditorViewState({ scrollPosition: { cellIndex: 0, offsetFromCell: 100 } });

		const disposable = notebook.applyRestoredScrollPosition();
		expect(disposable).toBeDefined();
		ctx.disposables.add(disposable!);

		// The position has been consumed: a second call now returns undefined,
		// matching the once-only contract of consumeRestoredScrollPosition().
		expect(notebook.applyRestoredScrollPosition()).toBeUndefined();
	});
});
