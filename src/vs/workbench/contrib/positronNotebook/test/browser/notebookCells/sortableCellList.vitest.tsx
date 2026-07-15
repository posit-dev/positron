/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { setupRTLRenderer } from '../../../../../../test/vitest/reactTestingLibrary.js';
import { stubInterface } from '../../../../../../test/vitest/stubInterface.js';
import { IPositronNotebookCell } from '../../../browser/PositronNotebookCells/IPositronNotebookCell.js';
import { SortableCell } from '../../../browser/notebookCells/SortableCell.js';
import { SortableCellList } from '../../../browser/notebookCells/SortableCellList.js';

describe('SortableCellList', () => {
	const rtl = setupRTLRenderer();

	function makeCells(n: number): IPositronNotebookCell[] {
		return Array.from({ length: n }, (_, i) =>
			stubInterface<IPositronNotebookCell>({ handle: i, index: i })
		);
	}

	// handleDragCancel removes the body class inside requestAnimationFrame
	// (SortableCellList.tsx). If the rAF doesn't drain before the test ends,
	// the class leaks onto document.body and any future test that checks it
	// gets a stale state. Belt-and-suspenders cleanup.
	afterEach(() => {
		document.body.classList.remove('dragging-notebook-cell');
	});

	it('Escape during a keyboard drag cancels without invoking onReorder', async () => {
		const onReorder = vi.fn();
		const cells = makeCells(3);

		rtl.render(
			<SortableCellList cells={cells} onReorder={onReorder}>
				{cells.map(cell => (
					<SortableCell key={cell.handle} cell={cell}>
						<div>{`Cell ${cell.index}`}</div>
					</SortableCell>
				))}
			</SortableCellList>
		);

		// dnd-kit's KeyboardSensor activates on Space while the activator
		// (drag handle) is focused. Each cell's handle is a button labelled
		// 'Drag to reorder cell'; we grab the first to start a drag at cell 0.
		const handle = screen.getAllByRole('button', { name: 'Drag to reorder cell' })[0];
		handle.focus();
		expect(handle).toHaveFocus();

		const user = userEvent.setup();

		// Space starts the drag. handleDragStart adds the body class as a
		// side effect -- assert it landed so the test fails loudly if the
		// drag never started, instead of silently passing on a no-op Escape.
		await user.keyboard(' ');
		expect(document.body).toHaveClass('dragging-notebook-cell');

		// Escape routes through dnd-kit's onDragCancel -> handleDragCancel,
		// which clears state without dispatching onReorder. The cleanup runs
		// inside requestAnimationFrame, so wait for the class to be removed
		// before asserting -- a stronger assertion than just "no reorder".
		await user.keyboard('{Escape}');

		expect(onReorder).not.toHaveBeenCalled();
		await waitFor(() => {
			expect(document.body).not.toHaveClass('dragging-notebook-cell');
		});
	});
});
