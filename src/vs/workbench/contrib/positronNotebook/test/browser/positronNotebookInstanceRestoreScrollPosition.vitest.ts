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

	describe('snapToRestoredScrollPosition', () => {
		it('writes scrollTop to (cellTop + offsetFromCell) on the cells container', () => {
			const notebook = createTestPositronNotebookInstance(
				[['print("a")', 'python', CellKind.Code]],
				ctx,
			);
			const cellsContainer = document.createElement('div');
			const cellElement = document.createElement('div');
			cellsContainer.appendChild(cellElement);
			notebook.setCellsContainer(cellsContainer);
			notebook.cells.get()[0].attachContainer(cellElement);

			// Stub geometry so cellTop is non-zero -- without this jsdom returns
			// all zeros and a buggy `scrollTop = offsetFromCell` would still pass.
			vi.spyOn(cellsContainer, 'getBoundingClientRect').mockReturnValue({ top: 200, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) });
			vi.spyOn(cellElement, 'getBoundingClientRect').mockReturnValue({ top: 250, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) });

			notebook.restoreEditorViewState({ scrollPosition: { cellIndex: 0, offsetFromCell: 100 } });

			notebook.snapToRestoredScrollPosition();

			// cellTop = (cellRect.top - containerRect.top) + container.scrollTop
			//         = (250 - 200) + 0 = 50
			// scrollTop = cellTop + offsetFromCell = 50 + 100 = 150
			expect(cellsContainer.scrollTop).toBe(150);
		});

		it('does not consume the restored position', () => {
			const notebook = createTestPositronNotebookInstance(
				[['print("a")', 'python', CellKind.Code]],
				ctx,
			);
			const cellsContainer = document.createElement('div');
			notebook.setCellsContainer(cellsContainer);
			notebook.restoreEditorViewState({ scrollPosition: { cellIndex: 0, offsetFromCell: 100 } });

			notebook.snapToRestoredScrollPosition();

			expect(notebook.consumeRestoredScrollPosition()).toBeDefined();
		});

		it('is a no-op when no cells container is set', () => {
			const notebook = createTestPositronNotebookInstance(
				[['print("a")', 'python', CellKind.Code]],
				ctx,
			);
			notebook.restoreEditorViewState({ scrollPosition: { cellIndex: 0, offsetFromCell: 100 } });

			expect(() => notebook.snapToRestoredScrollPosition()).not.toThrow();
			expect(notebook.consumeRestoredScrollPosition()).toBeDefined();
		});

		it('is a no-op when no scroll position has been restored', () => {
			const notebook = createTestPositronNotebookInstance(
				[['print("a")', 'python', CellKind.Code]],
				ctx,
			);
			const cellsContainer = document.createElement('div');
			cellsContainer.scrollTop = 42;
			notebook.setCellsContainer(cellsContainer);

			notebook.snapToRestoredScrollPosition();

			expect(cellsContainer.scrollTop).toBe(42);
		});
	});
});
