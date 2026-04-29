/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ISettableObservable } from '../../../../../base/common/observable.js';
import { assertDefined } from '../../../../../base/common/types.js';
import { MenuId } from '../../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { IPositronNotebookInstance } from '../../browser/IPositronNotebookInstance.js';
import { OpenMarkdownEditorAction, ViewMarkdownAction } from '../../browser/positronNotebook.contribution.js';
import { IPositronNotebookMarkdownCell } from '../../browser/PositronNotebookCells/IPositronNotebookCell.js';
import { PositronNotebookMarkdownCell } from '../../browser/PositronNotebookCells/PositronNotebookMarkdownCell.js';
import { CellSelectionType } from '../../browser/selectionMachine.js';
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

		it('with enterEditMode=false does NOT route to selectionStateMachine.enterEditor', async () => {
			const notebook = createTestPositronNotebookInstance([
				['# Cell 0', 'python', CellKind.Code],
			], ctx);
			const enterEditorSpy = vi.spyOn(notebook.selectionStateMachine, 'enterEditor')
				.mockResolvedValue(undefined);

			notebook.addCell(CellKind.Markup, 1, false);
			await new Promise(resolve => setTimeout(resolve, 0));

			expect(enterEditorSpy).not.toHaveBeenCalled();
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

	describe('Action wiring (markdown editor toggle)', () => {
		// Test-only subclasses expose the protected runNotebookAction so the
		// action body can be invoked without standing up an active editor pane.
		class TestableOpenMarkdownEditorAction extends OpenMarkdownEditorAction {
			public testRun(notebook: IPositronNotebookInstance, accessor: ServicesAccessor) {
				return this.runNotebookAction(notebook, accessor);
			}
		}
		class TestableViewMarkdownAction extends ViewMarkdownAction {
			public testRun(notebook: IPositronNotebookInstance, accessor: ServicesAccessor) {
				return this.runNotebookAction(notebook, accessor);
			}
		}

		const unusedAccessor: ServicesAccessor = {
			get() { throw new Error('ServicesAccessor must not be used in this action test'); },
		};

		it('OpenMarkdownEditorAction declares its action-bar binding', () => {
			const action = new OpenMarkdownEditorAction();
			expect(action.desc.id).toBe('positronNotebook.cell.openMarkdownEditor');
			expect(action.desc.menu).toMatchObject({ id: MenuId.PositronNotebookCellActionBarLeft });
		});

		it('ViewMarkdownAction declares its action-bar binding', () => {
			const action = new ViewMarkdownAction();
			expect(action.desc.id).toBe('positronNotebook.cell.viewMarkdown');
			expect(action.desc.menu).toMatchObject({ id: MenuId.PositronNotebookCellActionBarLeft });
		});

		it('OpenMarkdownEditorAction.runNotebookAction calls toggleEditor on the active markdown cell', () => {
			const notebook = createTestPositronNotebookInstance([
				['# Heading', 'markdown', CellKind.Markup],
			], ctx);
			const cell = getMarkdownCell(notebook, 0);
			notebook.selectionStateMachine.selectCell(cell, CellSelectionType.Normal);
			// getMarkdownCell asserts cell.isMarkdownCell() before returning, so
			// the cast to the concrete class is safe.
			const toggleEditorSpy = vi.spyOn(cell as PositronNotebookMarkdownCell, 'toggleEditor')
				.mockResolvedValue(undefined);

			new TestableOpenMarkdownEditorAction().testRun(notebook, unusedAccessor);

			expect(toggleEditorSpy).toHaveBeenCalledTimes(1);
		});

		it('ViewMarkdownAction.runNotebookAction calls toggleEditor on the active markdown cell', () => {
			const notebook = createTestPositronNotebookInstance([
				['# Heading', 'markdown', CellKind.Markup],
			], ctx);
			const cell = getMarkdownCell(notebook, 0);
			notebook.selectionStateMachine.selectCell(cell, CellSelectionType.Normal);
			const toggleEditorSpy = vi.spyOn(cell as PositronNotebookMarkdownCell, 'toggleEditor')
				.mockResolvedValue(undefined);

			new TestableViewMarkdownAction().testRun(notebook, unusedAccessor);

			expect(toggleEditorSpy).toHaveBeenCalledTimes(1);
		});

		it('OpenMarkdownEditorAction is a no-op when the active cell is not a markdown cell', () => {
			// Both actions share the `if (cell && cell.isMarkdownCell())` guard,
			// so testing one covers both negative paths.
			const notebook = createTestPositronNotebookInstance([
				['print("hi")', 'python', CellKind.Code],
			], ctx);
			const codeCell = notebook.cells.get()[0];
			assertDefined(codeCell, 'cell at index 0');
			notebook.selectionStateMachine.selectCell(codeCell, CellSelectionType.Normal);

			expect(() => new TestableOpenMarkdownEditorAction().testRun(notebook, unusedAccessor)).not.toThrow();
		});
	});
});
