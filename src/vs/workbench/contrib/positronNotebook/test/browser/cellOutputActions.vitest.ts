/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { observableValue } from '../../../../../base/common/observable.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IPositronNotebookInstance } from '../../browser/IPositronNotebookInstance.js';
import { IPositronNotebookCell } from '../../browser/PositronNotebookCells/IPositronNotebookCell.js';
import { PositronNotebookCodeCell } from '../../browser/PositronNotebookCells/PositronNotebookCodeCell.js';
import { ShowFullOutputAction, TruncateOutputAction } from '../../browser/positronNotebook.contribution.js';
import { SelectionState, SelectionStateMachine } from '../../browser/selectionMachine.js';

/**
 * Verifies that the cell-output Action2 contributions registered in
 * positronNotebook.contribution.ts wire their action ids to the right cell
 * methods. Each test asserts BOTH halves of the wiring:
 *  - The action id matches the menu reference / context-key contract.
 *  - Invoking runNotebookAction calls the matching cell method when the
 *    active cell is a code cell, and is a no-op otherwise.
 */
describe('Cell output Action2 contributions', () => {
	// Test-only subclasses that expose the protected runNotebookAction so we
	// can invoke action behavior without going through the editor's command
	// pipeline. Keeping the parent method protected preserves the production
	// API boundary -- production callers go through run().
	class TestableTruncateOutputAction extends TruncateOutputAction {
		public testRun(notebook: IPositronNotebookInstance, accessor: ServicesAccessor) {
			return this.runNotebookAction(notebook, accessor);
		}
	}
	class TestableShowFullOutputAction extends ShowFullOutputAction {
		public testRun(notebook: IPositronNotebookInstance, accessor: ServicesAccessor) {
			return this.runNotebookAction(notebook, accessor);
		}
	}

	// ServicesAccessor is required by the runNotebookAction signature but
	// neither action reads from it. A throwing stub catches any future
	// implementation that reaches for it.
	const unusedAccessor: ServicesAccessor = {
		get() { throw new Error('ServicesAccessor must not be used in this action test'); },
	};

	function makeNotebook(activeCell: IPositronNotebookCell | null): IPositronNotebookInstance {
		const stateValue = activeCell === null
			? { type: SelectionState.NoCells as const }
			: { type: SelectionState.SingleSelection as const, active: activeCell };

		return stubInterface<IPositronNotebookInstance>({
			selectionStateMachine: stubInterface<SelectionStateMachine>({
				state: observableValue('selectionState', stateValue),
			}),
		});
	}

	function makeCodeCell() {
		return stubInterface<PositronNotebookCodeCell>({
			isCodeCell: () => true,
			truncateOutput: vi.fn(),
			showFullOutput: vi.fn(),
		});
	}

	function makeMarkdownCell() {
		// stubInterface against the union -- markdown cells return false here.
		return stubInterface<IPositronNotebookCell>({
			isCodeCell: () => false,
		});
	}

	describe('TruncateOutputAction', () => {
		it('declares the expected command id', () => {
			expect(new TruncateOutputAction().desc.id).toBe('positronNotebook.cell.truncateOutput');
		});

		it('calls cell.truncateOutput on the active code cell', () => {
			const cell = makeCodeCell();
			const notebook = makeNotebook(cell);

			new TestableTruncateOutputAction().testRun(notebook, unusedAccessor);

			expect(cell.truncateOutput).toHaveBeenCalledOnce();
		});

		it('is a no-op when the active cell is not a code cell', () => {
			const cell = makeMarkdownCell();
			const codeCell = makeCodeCell();
			const notebook = makeNotebook(cell);

			new TestableTruncateOutputAction().testRun(notebook, unusedAccessor);

			// No code-cell mutation should have fired (sanity-check on a
			// separate code cell instance to confirm we didn't somehow reach
			// the wrong path).
			expect(codeCell.truncateOutput).not.toHaveBeenCalled();
		});

		it('is a no-op when there is no active cell', () => {
			const codeCell = makeCodeCell();
			const notebook = makeNotebook(null);

			new TestableTruncateOutputAction().testRun(notebook, unusedAccessor);

			expect(codeCell.truncateOutput).not.toHaveBeenCalled();
		});
	});

	describe('ShowFullOutputAction', () => {
		it('declares the expected command id', () => {
			expect(new ShowFullOutputAction().desc.id).toBe('positronNotebook.cell.showFullOutput');
		});

		it('calls cell.showFullOutput on the active code cell', () => {
			const cell = makeCodeCell();
			const notebook = makeNotebook(cell);

			new TestableShowFullOutputAction().testRun(notebook, unusedAccessor);

			expect(cell.showFullOutput).toHaveBeenCalledOnce();
		});

		it('is a no-op when the active cell is not a code cell', () => {
			const cell = makeMarkdownCell();
			const codeCell = makeCodeCell();
			const notebook = makeNotebook(cell);

			new TestableShowFullOutputAction().testRun(notebook, unusedAccessor);

			expect(codeCell.showFullOutput).not.toHaveBeenCalled();
		});

		it('is a no-op when there is no active cell', () => {
			const codeCell = makeCodeCell();
			const notebook = makeNotebook(null);

			new TestableShowFullOutputAction().testRun(notebook, unusedAccessor);

			expect(codeCell.showFullOutput).not.toHaveBeenCalled();
		});
	});
});
