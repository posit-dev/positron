/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable no-restricted-syntax */
/* eslint-disable local/code-no-dangerous-type-assertions */

import assert from 'assert';
import sinon from 'sinon';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { setupReactRenderer } from '../../../../../../base/test/browser/react.js';
import { IPositronNotebookInstance } from '../../../browser/IPositronNotebookInstance.js';
import { NotebookInstanceProvider } from '../../../browser/NotebookInstanceProvider.js';
import { CellActionButton } from '../../../browser/notebookCells/actionBar/CellActionButton.js';
import { IPositronNotebookCell } from '../../../browser/PositronNotebookCells/IPositronNotebookCell.js';
import { MenuItemAction, SubmenuItemAction } from '../../../../../../platform/actions/common/actions.js';
import { ThemeIcon } from '../../../../../../base/common/themables.js';
import { CellSelectionType } from '../../../browser/selectionMachine.js';

function mockAction(overrides?: Partial<{
	id: string;
	label: string;
	tooltip: string;
	iconId: string;
	run: () => Promise<void>;
}>): MenuItemAction {
	const id = overrides?.id ?? 'test-action';
	const label = overrides?.label ?? 'Test';
	return {
		id,
		label,
		tooltip: overrides?.tooltip ?? '',
		enabled: true,
		item: {
			id,
			title: label,
			icon: overrides?.iconId ? ThemeIcon.fromId(overrides.iconId) : undefined,
		},
		run: overrides?.run ?? (() => Promise.resolve()),
		dispose: () => { },
	} as unknown as MenuItemAction;
}

suite('CellActionButton', () => {
	const { render } = setupReactRenderer();
	ensureNoDisposablesAreLeakedInTestSuite();

	let selectCellStub: sinon.SinonStub;

	function renderButton(
		action: MenuItemAction | SubmenuItemAction,
		options?: { showSeparator?: boolean },
	) {
		selectCellStub = sinon.stub();
		const instance = {
			hoverManager: undefined,
			selectionStateMachine: { selectCell: selectCellStub },
		} as unknown as IPositronNotebookInstance;

		const cell = { id: 'cell-1' } as unknown as IPositronNotebookCell;

		const container = render(
			<NotebookInstanceProvider instance={instance}>
				<CellActionButton
					action={action}
					cell={cell}
					showSeparator={options?.showSeparator}
				/>
			</NotebookInstanceProvider>
		);
		return container.querySelector<HTMLButtonElement>('button.action-button')!;
	}

	teardown(() => {
		sinon.restore();
	});

	test('renders with aria-label from action', () => {
		const button = renderButton(mockAction({ label: 'Collapse Output' }));

		assert.ok(button);
		assert.strictEqual(button.getAttribute('aria-label'), 'Collapse Output');
	});

	test('applies cell-action-button class', () => {
		const button = renderButton(mockAction());

		assert.ok(button.classList.contains('cell-action-button'));
	});

	test('applies separator-after class when showSeparator is true', () => {
		const button = renderButton(mockAction(), { showSeparator: true });

		assert.ok(button.classList.contains('separator-after'));
	});

	test('does not apply separator-after class when showSeparator is false', () => {
		const button = renderButton(mockAction(), { showSeparator: false });

		assert.ok(!button.classList.contains('separator-after'));
	});

	test('selects cell before running action', () => {
		const button = renderButton(mockAction());

		button.click();

		assert.ok(selectCellStub.calledOnce, 'Expected selectCell to be called');
		assert.strictEqual(selectCellStub.firstCall.args[1], CellSelectionType.Normal);
	});

	test('runs the action when clicked', async () => {
		const runStub = sinon.stub().resolves();
		const button = renderButton(mockAction({ run: runStub }));

		button.click();

		await new Promise(resolve => setTimeout(resolve, 0));
		assert.ok(runStub.calledOnce, 'Expected action.run to be called');
	});

	test('does not throw when action.run rejects', async () => {
		const logStub = sinon.stub(console, 'log');
		const button = renderButton(mockAction({
			run: () => Promise.reject(new Error('action failed')),
		}));

		button.click();
		await new Promise(resolve => setTimeout(resolve, 0));
		logStub.restore();
	});

	test('renders icon when action has one', () => {
		const button = renderButton(mockAction({ iconId: 'chevron-down' }));

		const icon = button.querySelector<HTMLElement>('.codicon');
		assert.ok(icon, 'Expected icon element');
	});

	test('renders DevErrorIcon when action has no icon', () => {
		const button = renderButton(mockAction({ iconId: undefined }));

		const errorIcon = button.querySelector<HTMLElement>('.codicon-blank');
		assert.ok(errorIcon, 'Expected DevErrorIcon (codicon-blank) for missing action icon');
	});
});
