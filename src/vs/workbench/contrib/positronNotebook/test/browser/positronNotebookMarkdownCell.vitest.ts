/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ISettableObservable } from '../../../../../base/common/observable.js';
import { assertDefined } from '../../../../../base/common/types.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { IPositronNotebookMarkdownCell } from '../../browser/PositronNotebookCells/IPositronNotebookCell.js';
import { createTestPositronNotebookInstance } from './testPositronNotebookInstance.js';

describe('PositronNotebookMarkdownCell', () => {
	const ctx = createTestContainer().withNotebookEditorServices().build();

	function getMarkdownCell(notebook: ReturnType<typeof createTestPositronNotebookInstance>, index: number): IPositronNotebookMarkdownCell {
		const cell = notebook.cells.get()[index];
		assertDefined(cell, `cell at index ${index}`);
		expect(cell.isMarkdownCell(), 'cell should be a markdown cell').toBe(true);
		return cell as IPositronNotebookMarkdownCell;
	}

	describe('addCell(CellKind.Markup, ...)', () => {
		it('creates a markdown cell with kind=Markup and language=markdown', () => {
			const notebook = createTestPositronNotebookInstance([
				['# Cell 0', 'python', CellKind.Code],
			], ctx);

			notebook.addCell(CellKind.Markup, 1, false);

			const cells = notebook.cells.get();
			expect(cells.length).toBe(2);
			const markdownCell = getMarkdownCell(notebook, 1);
			expect(markdownCell.kind).toBe(CellKind.Markup);
			expect(markdownCell.model.language).toBe('markdown');
		});

		it('with enterEditMode=true routes to selectionStateMachine.enterEditor on the new cell', async () => {
			const notebook = createTestPositronNotebookInstance([
				['# Cell 0', 'python', CellKind.Code],
			], ctx);
			const enterEditorSpy = vi.spyOn(notebook.selectionStateMachine, 'enterEditor')
				.mockResolvedValue(undefined);

			notebook.addCell(CellKind.Markup, 1, true);

			// _syncCells defers the enterEditor call to the next tick so React
			// can mount the new cell component first.
			await new Promise(resolve => setTimeout(resolve, 0));

			expect(enterEditorSpy).toHaveBeenCalledTimes(1);
			const newCell = getMarkdownCell(notebook, 1);
			expect(enterEditorSpy).toHaveBeenCalledWith(newCell);
		});
	});

	describe('toggleEditor', () => {
		it('when editorShown=true exits via selectionStateMachine.exitEditor and sets editorShown=false', async () => {
			const notebook = createTestPositronNotebookInstance([
				['# Heading', 'markdown', CellKind.Markup],
			], ctx);
			const cell = getMarkdownCell(notebook, 0);
			// IPositronNotebookMarkdownCell exposes editorShown as IObservable
			// (read-only); the concrete class uses observableValue, so the cast
			// to ISettableObservable is safe at runtime.
			(cell.editorShown as ISettableObservable<boolean>).set(true, undefined);
			const exitEditorSpy = vi.spyOn(notebook.selectionStateMachine, 'exitEditor');

			await cell.toggleEditor();

			expect(exitEditorSpy).toHaveBeenCalledWith(cell);
			expect(cell.editorShown.get()).toBe(false);
		});

		it('when editorShown=false routes to selectionStateMachine.enterEditor', async () => {
			const notebook = createTestPositronNotebookInstance([
				['# Heading', 'markdown', CellKind.Markup],
			], ctx);
			const cell = getMarkdownCell(notebook, 0);
			expect(cell.editorShown.get(), 'preview mode is the default starting state').toBe(false);
			const enterEditorSpy = vi.spyOn(notebook.selectionStateMachine, 'enterEditor')
				.mockResolvedValue(undefined);

			await cell.toggleEditor();

			expect(enterEditorSpy).toHaveBeenCalledWith(cell);
		});
	});
});
