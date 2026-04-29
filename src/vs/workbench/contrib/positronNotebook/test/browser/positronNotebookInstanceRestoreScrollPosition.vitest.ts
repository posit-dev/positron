/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { createTestPositronNotebookInstance } from './testPositronNotebookInstance.js';

describe('PositronNotebookInstance scroll position restore contract', () => {
	const ctx = createTestContainer().withNotebookEditorServices().build();

	describe('restoreEditorViewState + consumeRestoredScrollPosition', () => {
		it('resolves a valid cellIndex to a position the next consume returns', () => {
			const notebook = createTestPositronNotebookInstance(
				[['print("a")', 'python', CellKind.Code]],
				ctx,
			);

			notebook.restoreEditorViewState({ scrollPosition: { cellIndex: 0, offsetFromCell: 100 } });

			const consumed = notebook.consumeRestoredScrollPosition();
			expect(consumed).toBeDefined();
			expect(consumed!.offsetFromCell).toBe(100);
			expect(consumed!.cell).toBe(notebook.cells.get()[0]);
		});

		it('resolves to undefined when no viewState is provided', () => {
			const notebook = createTestPositronNotebookInstance(
				[['print("a")', 'python', CellKind.Code]],
				ctx,
			);

			notebook.restoreEditorViewState(undefined);

			expect(notebook.consumeRestoredScrollPosition()).toBeUndefined();
		});

		it('resolves to undefined when cellIndex is out of range', () => {
			const notebook = createTestPositronNotebookInstance(
				[['print("a")', 'python', CellKind.Code]],
				ctx,
			);

			notebook.restoreEditorViewState({ scrollPosition: { cellIndex: 5, offsetFromCell: 100 } });

			expect(notebook.consumeRestoredScrollPosition()).toBeUndefined();
		});

		it('consume is once-only', () => {
			const notebook = createTestPositronNotebookInstance(
				[['print("a")', 'python', CellKind.Code]],
				ctx,
			);

			notebook.restoreEditorViewState({ scrollPosition: { cellIndex: 0, offsetFromCell: 100 } });

			expect(notebook.consumeRestoredScrollPosition()).toBeDefined();
			expect(notebook.consumeRestoredScrollPosition()).toBeUndefined();
		});
	});

	describe('restoreScrollPositionRequest observable', () => {
		it('bumps on each restoreEditorViewState call so React layout effects re-fire', () => {
			const notebook = createTestPositronNotebookInstance(
				[['print("a")', 'python', CellKind.Code]],
				ctx,
			);

			const before = notebook.restoreScrollPositionRequest.get();

			notebook.restoreEditorViewState({ scrollPosition: { cellIndex: 0, offsetFromCell: 100 } });
			const afterFirst = notebook.restoreScrollPositionRequest.get();
			expect(afterFirst).toBeGreaterThan(before);

			notebook.restoreEditorViewState({ scrollPosition: { cellIndex: 0, offsetFromCell: 200 } });
			expect(notebook.restoreScrollPositionRequest.get()).toBeGreaterThan(afterFirst);
		});

		it('bumps even when the resolved position is undefined', () => {
			const notebook = createTestPositronNotebookInstance(
				[['print("a")', 'python', CellKind.Code]],
				ctx,
			);

			const before = notebook.restoreScrollPositionRequest.get();
			notebook.restoreEditorViewState(undefined);
			expect(notebook.restoreScrollPositionRequest.get()).toBeGreaterThan(before);
		});
	});
});
