/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

/* eslint-disable local/code-no-dangerous-type-assertions */

import { screen } from '@testing-library/react';
import { setupRTLRenderer } from '../../../../../../test/vitest/reactTestingLibrary.js';
import { CellOutputCollapseButton } from '../../../browser/notebookCells/CellOutputCollapseButton.js';
import { PositronNotebookCodeCell } from '../../../browser/PositronNotebookCells/PositronNotebookCodeCell.js';
import { observableValue, ISettableObservable } from '../../../../../../base/common/observable.js';
import { CellSelectionType } from '../../../browser/selectionMachine.js';
import { IPositronNotebookInstance } from '../../../browser/IPositronNotebookInstance.js';
import { NotebookInstanceProvider } from '../../../browser/NotebookInstanceProvider.js';

describe('CellOutputCollapseButton', () => {
	const rtl = setupRTLRenderer();

	let outputIsCollapsed: ISettableObservable<boolean>;
	let selectStub: ReturnType<typeof vi.fn>;
	let toggleStub: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		outputIsCollapsed = observableValue('outputIsCollapsed', false);
		selectStub = vi.fn();
		toggleStub = vi.fn();
	});

	function renderButton() {
		const cell = {
			outputIsCollapsed,
			toggleOutputCollapse: toggleStub,
		} as unknown as PositronNotebookCodeCell;

		const instance = {
			hoverManager: undefined,
			selectionStateMachine: {
				selectCell: selectStub,
			},
		} as unknown as IPositronNotebookInstance;

		return rtl.render(
			<NotebookInstanceProvider instance={instance}>
				<CellOutputCollapseButton cell={cell} />
			</NotebookInstanceProvider>
		);
	}

	it('renders collapse button when not collapsed', () => {
		renderButton();

		expect(screen.getByRole('button', { name: 'Collapse Output' })).toBeInTheDocument();
	});

	it('renders expand button when outputs are collapsed', () => {
		outputIsCollapsed.set(true, undefined);
		renderButton();

		expect(screen.getByRole('button', { name: 'Expand Output' })).toBeInTheDocument();
	});

	it('selects cell and toggles collapse on click', () => {
		renderButton();

		screen.getByRole('button', { name: 'Collapse Output' }).click();

		expect(selectStub).toHaveBeenCalledOnce();
		expect(selectStub.mock.calls[0][1]).toBe(CellSelectionType.Normal);
		expect(toggleStub).toHaveBeenCalledOnce();
	});
});
