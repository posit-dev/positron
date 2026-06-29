/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IAction } from '../../../../../base/common/actions.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IContextMenuDelegate } from '../../../../../base/browser/contextmenu.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { AddCellSplitButton } from '../../browser/AddCellButtons.js';
import { IPositronNotebookInstance } from '../../browser/IPositronNotebookInstance.js';

describe('AddCellSplitButton', () => {
	const showContextMenu = vi.fn();
	const ctx = createTestContainer()
		.withReactServices()
		// The dropdown opens via the context menu service; capturing the call
		// lets us inspect the actions and invoke them without rendering a menu.
		.stub(IContextMenuService, { showContextMenu })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	function renderButton(index: number) {
		const addCell = vi.fn();
		const notebookInstance = stubInterface<IPositronNotebookInstance>({ addCell });
		rtl.render(<AddCellSplitButton index={index} notebookInstance={notebookInstance} />);
		return { addCell };
	}

	/** Open the dropdown and return the actions handed to the context menu. */
	async function openDropdownActions(user: ReturnType<typeof userEvent.setup>): Promise<IAction[]> {
		await user.click(screen.getByRole('button', { name: 'Choose cell type' }));
		const delegate = showContextMenu.mock.calls.at(-1)?.[0] as IContextMenuDelegate;
		return delegate.getActions() as IAction[];
	}

	it('primary button inserts a code cell in edit mode by default', async () => {
		const { addCell } = renderButton(1);

		const user = userEvent.setup();
		await user.click(screen.getByRole('button', { name: 'New Code Cell' }));

		expect(addCell).toHaveBeenCalledTimes(1);
		// enterEditMode === true is how the new cell is focused.
		expect(addCell).toHaveBeenCalledWith(CellKind.Code, 1, true, '', undefined);
	});

	it('dropdown offers exactly Code and Raw', async () => {
		renderButton(1);

		const user = userEvent.setup();
		const actions = await openDropdownActions(user);

		// Markdown is intentionally absent: it has its own dedicated button.
		expect(actions.map(a => a.label)).toEqual(['Code', 'Raw']);
	});

	it('dropdown "Code" option inserts a code cell in edit mode', async () => {
		const { addCell } = renderButton(1);

		const user = userEvent.setup();
		const actions = await openDropdownActions(user);
		act(() => { actions.find(a => a.label === 'Code')!.run(); });

		expect(addCell).toHaveBeenCalledWith(CellKind.Code, 1, true, '', undefined);
	});

	it('dropdown "Raw" option inserts a raw cell (code cell, language "raw") in edit mode', async () => {
		const { addCell } = renderButton(1);

		const user = userEvent.setup();
		const actions = await openDropdownActions(user);
		act(() => { actions.find(a => a.label === 'Raw')!.run(); });

		expect(addCell).toHaveBeenCalledWith(CellKind.Code, 1, true, '', 'raw');
	});

	it('signals the menu open on dropdown click and closed on hide', async () => {
		// The group's container hides itself when focus/hover leave it. The menu
		// renders at the body level, so without this signal opening the dropdown
		// would make the whole group vanish. onHide covers escape, selection, and
		// click-away alike.
		const onMenuOpenChange = vi.fn();
		const notebookInstance = stubInterface<IPositronNotebookInstance>({ addCell: vi.fn() });
		rtl.render(<AddCellSplitButton index={1} notebookInstance={notebookInstance} onMenuOpenChange={onMenuOpenChange} />);

		const user = userEvent.setup();
		await user.click(screen.getByRole('button', { name: 'Choose cell type' }));
		expect(onMenuOpenChange).toHaveBeenLastCalledWith(true);

		const delegate = showContextMenu.mock.calls.at(-1)?.[0] as IContextMenuDelegate;
		act(() => { delegate.onHide?.(false); });
		expect(onMenuOpenChange).toHaveBeenLastCalledWith(false);
	});

	it('passes the index prop through to addCell', async () => {
		const { addCell } = renderButton(0);

		const user = userEvent.setup();
		await user.click(screen.getByRole('button', { name: 'New Code Cell' }));

		expect(addCell).toHaveBeenCalledWith(CellKind.Code, 0, true, '', undefined);
	});
});
