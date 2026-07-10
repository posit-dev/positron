/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { IHoverManager } from '../../../../../platform/hover/browser/hoverManager.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { AddMarkdownCellButton } from '../../browser/AddCellButtons.js';
import { IPositronNotebookInstance } from '../../browser/IPositronNotebookInstance.js';

describe('AddMarkdownCellButton', () => {
	const rtl = setupRTLRenderer();

	function renderWithSpy(index: number) {
		const addCell = vi.fn();
		const notebookInstance = stubInterface<IPositronNotebookInstance>({
			addCell,
			// IconedButton -> ActionButton -> Button reads `showHover` (and
			// `hideHover` on unmount) on a hover; stub both as no-ops.
			hoverManager: stubInterface<IHoverManager>({
				showHover: () => { },
				hideHover: () => { },
			}),
		});
		rtl.render(<AddMarkdownCellButton index={index} notebookInstance={notebookInstance} />);
		return { addCell };
	}

	it('click invokes addCell(CellKind.Markup, index, true) on the notebook instance', async () => {
		const { addCell } = renderWithSpy(1);

		const user = userEvent.setup();
		await user.click(screen.getByRole('button', { name: 'New Markdown Cell' }));

		expect(addCell).toHaveBeenCalledTimes(1);
		expect(addCell).toHaveBeenCalledWith(CellKind.Markup, 1, true);
	});

	it('passes the index prop through to addCell', async () => {
		const { addCell } = renderWithSpy(0);

		const user = userEvent.setup();
		await user.click(screen.getByRole('button', { name: 'New Markdown Cell' }));

		expect(addCell).toHaveBeenCalledWith(CellKind.Markup, 0, true);
	});
});
