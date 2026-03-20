/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable no-restricted-syntax */
/* eslint-disable local/code-no-dangerous-type-assertions */

import assert from 'assert';
import sinon from 'sinon';
import { flushSync } from 'react-dom';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { setupReactRenderer } from '../../../../../../base/test/browser/react.js';
import { runWithFakedTimers } from '../../../../../../base/test/common/timeTravelScheduler.js';
import { timeout } from '../../../../../../base/common/async.js';
import { IPositronNotebookInstance } from '../../../browser/IPositronNotebookInstance.js';
import { NotebookInstanceProvider } from '../../../browser/NotebookInstanceProvider.js';
import { CellActionButton } from '../../../browser/notebookCells/actionBar/CellActionButton.js';
import { IPositronNotebookCell } from '../../../browser/PositronNotebookCells/IPositronNotebookCell.js';
import { MenuItemAction, SubmenuItemAction } from '../../../../../../platform/actions/common/actions.js';
import { ThemeIcon } from '../../../../../../base/common/themables.js';
import { CellSelectionType } from '../../../browser/selectionMachine.js';
import { PositronNotebookActionId } from '../../../common/positronNotebookCommon.js';

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

/* DOM queries and actions for a rendered CellActionButton. */
class CellActionButtonFixture {
	constructor(private readonly button: HTMLButtonElement) { }

	get ariaLabel() { return this.button.getAttribute('aria-label'); }
	get hasSeparator() { return this.button.classList.contains('separator-after'); }

	get iconClass() {
		return this.button.querySelector<HTMLElement>('.codicon')
			?.className.split(' ').find(c => c.startsWith('codicon-') && c !== 'codicon');
	}

	click() { this.button.click(); }

	async clickAndFlush() {
		this.button.click();
		// Let the async handler (action.run()) resolve so setState fires.
		await timeout(0);
		// Flush React state update to the DOM.
		flushSync(() => { });
	}
}

suite('CellActionButton', () => {
	const { render } = setupReactRenderer();
	ensureNoDisposablesAreLeakedInTestSuite();

	let selectCellStub: sinon.SinonStub;
	let instance: IPositronNotebookInstance;
	let cell: IPositronNotebookCell;

	setup(() => {
		selectCellStub = sinon.stub();
		instance = {
			hoverManager: undefined,
			selectionStateMachine: { selectCell: selectCellStub },
		} as unknown as IPositronNotebookInstance;
		cell = { id: 'cell-1' } as unknown as IPositronNotebookCell;
	});

	teardown(() => {
		sinon.restore();
	});

	function renderButton(
		action: MenuItemAction | SubmenuItemAction,
		options?: { showSeparator?: boolean },
	) {
		const container = render(
			<NotebookInstanceProvider instance={instance}>
				<CellActionButton
					action={action}
					cell={cell}
					showSeparator={options?.showSeparator}
				/>
			</NotebookInstanceProvider>
		);
		const button = container.querySelector<HTMLButtonElement>('button.action-button')!;
		return new CellActionButtonFixture(button);
	}

	test('renders with aria-label from action', () => {
		const action = mockAction({ label: 'Collapse Output' });
		const fixture = renderButton(action);

		assert.strictEqual(fixture.ariaLabel, action.label);
	});

	test('applies separator-after class when showSeparator is true', () => {
		const fixture = renderButton(mockAction(), { showSeparator: true });

		assert.ok(fixture.hasSeparator);
	});

	test('does not apply separator-after class when showSeparator is false', () => {
		const fixture = renderButton(mockAction(), { showSeparator: false });

		assert.ok(!fixture.hasSeparator);
	});

	test('selects cell before running action', () => {
		const fixture = renderButton(mockAction());

		fixture.click();

		assert.ok(selectCellStub.calledOnce, 'Expected selectCell to be called');
		assert.strictEqual(selectCellStub.firstCall.args[1], CellSelectionType.Normal);
	});

	test('runs the action when clicked', async () => {
		const runStub = sinon.stub().resolves();
		const fixture = renderButton(mockAction({ run: runStub }));

		fixture.click();

		await new Promise(resolve => setTimeout(resolve, 0));
		assert.ok(runStub.calledOnce, 'Expected action.run to be called');
	});

	test('does not throw when action.run rejects', async () => {
		const logStub = sinon.stub(console, 'log');
		const fixture = renderButton(mockAction({
			run: () => Promise.reject(new Error('action failed')),
		}));

		fixture.click();
		await new Promise(resolve => setTimeout(resolve, 0));
		logStub.restore();
	});

	test('renders icon when action has one', () => {
		const fixture = renderButton(mockAction({ iconId: 'chevron-down' }));

		assert.strictEqual(fixture.iconClass, 'codicon-chevron-down');
	});

	test('renders DevErrorIcon when action has no icon', () => {
		const fixture = renderButton(mockAction({ iconId: undefined }));

		assert.strictEqual(fixture.iconClass, 'codicon-blank', 'Missing developer error icon');
	});

	suite('success feedback', () => {
		function renderSuccessButton(run?: () => Promise<void>) {
			return renderButton(mockAction({
				id: PositronNotebookActionId.CopyOutputImage,
				iconId: 'copy',
				run: run ?? (() => Promise.resolve()),
			}));
		}

		test('momentarily shows feedback after successful action', () => runWithFakedTimers({}, async () => {
			const fixture = renderSuccessButton();

			await fixture.clickAndFlush();

			assert.strictEqual(fixture.iconClass, 'codicon-check');

			// Advance past the 1500ms success feedback duration.
			await timeout(1500);
			flushSync(() => { });

			assert.strictEqual(fixture.iconClass, 'codicon-copy', 'Original icon should be restored');
		}));

		test('does not show check icon for non-opted-in actions', () => runWithFakedTimers({}, async () => {
			const fixture = renderButton(mockAction({
				id: 'some-other-action',
				iconId: 'copy',
				run: () => Promise.resolve(),
			}));

			await fixture.clickAndFlush();

			assert.strictEqual(fixture.iconClass, 'codicon-copy');
		}));

		test('does not show check icon when action rejects', () => runWithFakedTimers({}, async () => {
			const logStub = sinon.stub(console, 'log');
			const fixture = renderSuccessButton(() => Promise.reject(new Error('fail')));

			await fixture.clickAndFlush();

			assert.strictEqual(fixture.iconClass, 'codicon-copy');
			logStub.restore();
		}));
	});
});
