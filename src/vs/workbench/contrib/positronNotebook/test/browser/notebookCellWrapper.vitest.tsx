/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { observableValue } from '../../../../../base/common/observable.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { CellSelectionStatus } from '../../browser/PositronNotebookCells/IPositronNotebookCell.js';
import { CellSelectionType } from '../../browser/selectionMachine.js';
import { NotebookCellWrapper } from '../../browser/notebookCells/NotebookCellWrapper.js';
import { NotebookInstanceProvider } from '../../browser/NotebookInstanceProvider.js';
import { EnvironentProvider } from '../../browser/EnvironmentProvider.js';
import { createLabelledTestNotebook, TestPositronNotebookInstance } from './testPositronNotebookInstance.js';
import { ISize } from '../../../../../base/browser/positronReactRenderer.js';
import { IScopedContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';

// Each mock isolates the click-routing logic from a child that pulls in
// heavy transitive deps. `.stub()` via the builder can't reach inside React
// component imports, so module-level mocks are the right escape hatch here.

// Avoids IMenuService + the entire menu/action wiring chain.
vi.mock('../../browser/notebookCells/NotebookCellActionBar.js', () => ({
	NotebookCellActionBar: () => null,
}));
// Avoids the context-key binding effect (subscribes to many cell observables
// and creates a real scoped IContextKeyService per cell). Returning undefined
// is what the wrapper sees during its initial render before cellElement attaches.
vi.mock('../../browser/notebookCells/useCellContextKeys.js', () => ({
	useCellContextKeys: () => undefined,
}));
// Passthrough so the wrapper renders even when useCellContextKeys returns undefined.
vi.mock('../../browser/notebookCells/CellContextKeyServiceProvider.js', () => ({
	CellScopedContextKeyServiceProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('NotebookCellWrapper onClick', () => {
	const ctx = createTestContainer().withNotebookEditorServices().withReactServices().build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	function renderCell(notebook: TestPositronNotebookInstance, cellIndex = 0, children: React.ReactNode = null) {
		const cell = notebook.cells.get()[cellIndex];
		const environmentBundle = {
			size: observableValue<ISize>('test-size', { width: 800, height: 600 }),
			// Never invoked: useCellContextKeys is mocked above.
			scopedContextKeyProviderCallback: () => stubInterface<IScopedContextKeyService>({}),
		};
		rtl.render(
			<NotebookInstanceProvider instance={notebook}>
				<EnvironentProvider environmentBundle={environmentBundle}>
					<NotebookCellWrapper cell={cell}>
						{children}
					</NotebookCellWrapper>
				</EnvironentProvider>
			</NotebookInstanceProvider>
		);
		return cell;
	}

	it('default click on cell body invokes selectCell(Normal)', async () => {
		const notebook = createLabelledTestNotebook(2, ctx);
		const cells = notebook.cells.get();
		// Move the active selection away so clicking cells[1] is a state change.
		notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Normal);
		const spy = vi.spyOn(notebook.selectionStateMachine, 'selectCell');

		renderCell(notebook, 1);
		const user = userEvent.setup();
		await user.click(screen.getByRole('article'));

		expect(spy).toHaveBeenCalledWith(cells[1], CellSelectionType.Normal);
	});

	it('shift-click invokes selectCell(Add)', async () => {
		const notebook = createLabelledTestNotebook(2, ctx);
		const cells = notebook.cells.get();
		notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Normal);
		const spy = vi.spyOn(notebook.selectionStateMachine, 'selectCell');

		renderCell(notebook, 1);
		const user = userEvent.setup();
		await user.keyboard('{Shift>}');
		await user.click(screen.getByRole('article'));
		await user.keyboard('{/Shift}');

		expect(spy).toHaveBeenCalledWith(cells[1], CellSelectionType.Add);
	});

	it('meta-click (Cmd) invokes selectCell(Add)', async () => {
		const notebook = createLabelledTestNotebook(2, ctx);
		const cells = notebook.cells.get();
		notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Normal);
		const spy = vi.spyOn(notebook.selectionStateMachine, 'selectCell');

		renderCell(notebook, 1);
		const user = userEvent.setup();
		await user.keyboard('{Meta>}');
		await user.click(screen.getByRole('article'));
		await user.keyboard('{/Meta}');

		expect(spy).toHaveBeenCalledWith(cells[1], CellSelectionType.Add);
	});

	it('click inside .positron-cell-editor-monaco-widget descendant is a no-op', async () => {
		const notebook = createLabelledTestNotebook(2, ctx);
		const cells = notebook.cells.get();
		notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Normal);
		const spy = vi.spyOn(notebook.selectionStateMachine, 'selectCell');

		renderCell(
			notebook,
			1,
			<div className='positron-cell-editor-monaco-widget'>
				<button>inside editor</button>
			</div>,
		);
		const user = userEvent.setup();
		await user.click(screen.getByRole('button', { name: 'inside editor' }));

		// No selectCell call other than the initial setup call (which happened before spying).
		expect(spy).not.toHaveBeenCalled();
	});

	it('click on an <a> link descendant is a no-op (lets navigation proceed)', async () => {
		const notebook = createLabelledTestNotebook(2, ctx);
		const cells = notebook.cells.get();
		notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Normal);
		const spy = vi.spyOn(notebook.selectionStateMachine, 'selectCell');

		renderCell(
			notebook,
			1,
			<a href='#'>link</a>,
		);
		const user = userEvent.setup();
		await user.click(screen.getByRole('link'));

		expect(spy).not.toHaveBeenCalled();
	});

	it('click outside the editor while editing exits edit mode', async () => {
		const notebook = createLabelledTestNotebook(2, ctx);
		const cells = notebook.cells.get();
		notebook.selectionStateMachine.selectCell(cells[1], CellSelectionType.Edit);
		expect(cells[1].selectionStatus.get()).toBe(CellSelectionStatus.Editing);
		const exitSpy = vi.spyOn(notebook.selectionStateMachine, 'exitEditor');
		const selectSpy = vi.spyOn(notebook.selectionStateMachine, 'selectCell');

		renderCell(notebook, 1);
		const user = userEvent.setup();
		await user.click(screen.getByRole('article'));

		expect(exitSpy).toHaveBeenCalled();
		// The editing-exit branch returns before reaching selectCell.
		expect(selectSpy).not.toHaveBeenCalled();
	});

	it('click on already-selected cell in SingleSelection is a no-op', async () => {
		const notebook = createLabelledTestNotebook(2, ctx);
		const cells = notebook.cells.get();
		notebook.selectionStateMachine.selectCell(cells[1], CellSelectionType.Normal);
		const spy = vi.spyOn(notebook.selectionStateMachine, 'selectCell');

		renderCell(notebook, 1);
		const user = userEvent.setup();
		await user.click(screen.getByRole('article'));

		expect(spy).not.toHaveBeenCalled();
	});

	it('click on a Multi-selected cell collapses to selectCell(Normal)', async () => {
		const notebook = createLabelledTestNotebook(3, ctx);
		const cells = notebook.cells.get();
		notebook.selectionStateMachine.selectCell(cells[0], CellSelectionType.Normal);
		notebook.selectionStateMachine.selectCell(cells[1], CellSelectionType.Add);
		// cells[1] is selected and active; clicking its body in Multi state collapses to Single.
		const spy = vi.spyOn(notebook.selectionStateMachine, 'selectCell');

		renderCell(notebook, 1);
		const user = userEvent.setup();
		await user.click(screen.getByRole('article'));

		expect(spy).toHaveBeenCalledWith(cells[1], CellSelectionType.Normal);
	});
});
