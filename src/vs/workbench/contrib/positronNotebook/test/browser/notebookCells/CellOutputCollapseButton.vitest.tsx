/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

/* eslint-disable no-restricted-syntax */
/* eslint-disable local/code-no-dangerous-type-assertions */

import { setupRTLRenderer } from '../../../../../../test/vitest/reactTestingLibrary.js';
import { CellOutputCollapseButton } from '../../../browser/notebookCells/CellOutputCollapseButton.js';
import { PositronNotebookCodeCell } from '../../../browser/PositronNotebookCells/PositronNotebookCodeCell.js';
import { observableValue, ISettableObservable } from '../../../../../../base/common/observable.js';
import { CellSelectionType } from '../../../browser/selectionMachine.js';
import { IPositronNotebookInstance } from '../../../browser/IPositronNotebookInstance.js';
import { NotebookInstanceProvider } from '../../../browser/NotebookInstanceProvider.js';

class CellOutputCollapseButtonFixture {
	constructor(private readonly container: HTMLElement) { }

	get root() {
		return this.container.querySelector<HTMLDivElement>('.cell-output-collapse-button-container');
	}

	get button() {
		const el = this.container.querySelector<HTMLElement>('.cell-output-collapse-button');
		expect(el, 'Expected to find the collapse/expand button').toBeDefined();
		return el!;
	}
}

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

		const { container } = rtl.render(
			<NotebookInstanceProvider instance={instance}>
				<CellOutputCollapseButton cell={cell} />
			</NotebookInstanceProvider>
		);
		return new CellOutputCollapseButtonFixture(container);
	}

	it('renders collapse button when not collapsed', () => {
		const fixture = renderButton();

		expect(fixture.button.getAttribute('aria-label')).toBe('Collapse Output');
	});

	it('renders expand button when outputs are collapsed', () => {
		outputIsCollapsed.set(true, undefined);
		const fixture = renderButton();

		expect(fixture.button.getAttribute('aria-label')).toBe('Expand Output');
	});

	it('selects cell and toggles collapse on click', () => {
		const fixture = renderButton();

		fixture.button.click();

		expect(selectStub).toHaveBeenCalledOnce();
		expect(selectStub.mock.calls[0][1]).toBe(CellSelectionType.Normal);
		expect(toggleStub).toHaveBeenCalledOnce();
	});
});
