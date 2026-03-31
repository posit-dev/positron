/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable no-restricted-syntax */
/* eslint-disable local/code-no-dangerous-type-assertions */

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { setupReactRenderer } from '../../../../../../base/test/browser/react.js';
import { CellOutputCollapseButton } from '../../../browser/notebookCells/CellOutputCollapseButton.js';
import { PositronNotebookCodeCell } from '../../../browser/PositronNotebookCells/PositronNotebookCodeCell.js';
import { observableValue, ISettableObservable } from '../../../../../../base/common/observable.js';
import { CellSelectionType } from '../../../browser/selectionMachine.js';
import { IPositronNotebookInstance } from '../../../browser/IPositronNotebookInstance.js';
import { NotebookInstanceProvider } from '../../../browser/NotebookInstanceProvider.js';
import sinon, { SinonStub } from 'sinon';

class CellOutputCollapseButtonFixture {
	constructor(private readonly container: HTMLElement) { }

	get root() {
		return this.container.querySelector<HTMLDivElement>('.cell-output-collapse-button-container');
	}

	get button() {
		const el = this.container.querySelector<HTMLElement>('.cell-output-collapse-button');
		assert.ok(el, 'Expected to find the collapse/expand button');
		return el;
	}
}

suite('CellOutputCollapseButton', () => {
	const { render } = setupReactRenderer();
	ensureNoDisposablesAreLeakedInTestSuite();

	let outputIsCollapsed: ISettableObservable<boolean>;
	let selectStub: SinonStub;
	let toggleStub: SinonStub;

	setup(() => {
		outputIsCollapsed = observableValue('outputIsCollapsed', false);
		selectStub = sinon.stub();
		toggleStub = sinon.stub();
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

		const container = render(
			<NotebookInstanceProvider instance={instance}>
				<CellOutputCollapseButton cell={cell} />
			</NotebookInstanceProvider>
		);
		return new CellOutputCollapseButtonFixture(container);
	}

	test('renders collapse button when not collapsed', () => {
		const fixture = renderButton();

		assert.strictEqual(fixture.button.getAttribute('aria-label'), 'Collapse Output');
	});

	test('renders expand button when outputs are collapsed', () => {
		outputIsCollapsed.set(true, undefined);
		const fixture = renderButton();

		assert.strictEqual(fixture.button.getAttribute('aria-label'), 'Expand Output');
	});

	test('selects cell and toggles collapse on click', () => {
		const fixture = renderButton();

		fixture.button.click();

		assert.strictEqual(selectStub.callCount, 1);
		assert.strictEqual(selectStub.getCall(0).args[1], CellSelectionType.Normal);
		assert.strictEqual(toggleStub.callCount, 1);
	});
});
