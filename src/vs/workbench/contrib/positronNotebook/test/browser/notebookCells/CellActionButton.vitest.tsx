/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
/// <reference types="vitest/globals" />

/* eslint-disable no-restricted-syntax */
/// <reference types="vitest/globals" />
/* eslint-disable local/code-no-dangerous-type-assertions */
/// <reference types="vitest/globals" />

import sinon from 'sinon';
import { flushSync } from 'react-dom';
import { ensureNoLeakedDisposables } from '../../../../../../base/test/common/vitestSetup.js';
import { setupReactRenderer } from '../../../../../../base/test/browser/reactVitest.js';
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
/// <reference types="vitest/globals" />
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

describe('CellActionButton', () => {
	ensureNoLeakedDisposables();
	const { render } = setupReactRenderer();

	let selectCellStub: sinon.SinonStub;
	let instance: IPositronNotebookInstance;
	let cell: IPositronNotebookCell;

	beforeEach(() => {
		selectCellStub = sinon.stub();
		instance = {
			hoverManager: undefined,
			currentContainer: undefined,
			selectionStateMachine: { selectCell: selectCellStub },
		} as unknown as IPositronNotebookInstance;
		cell = { id: 'cell-1' } as unknown as IPositronNotebookCell;
	});

	afterEach(() => {
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

	it('renders with aria-label from action', () => {
		const action = mockAction({ label: 'Collapse Output' });
		const fixture = renderButton(action);

		expect(fixture.ariaLabel).toBe(action.label);
	});

	it('applies separator-after class when showSeparator is true', () => {
		const fixture = renderButton(mockAction(), { showSeparator: true });

		expect(fixture.hasSeparator).toBeTruthy();
	});

	it('does not apply separator-after class when showSeparator is false', () => {
		const fixture = renderButton(mockAction(), { showSeparator: false });

		expect(!fixture.hasSeparator).toBeTruthy();
	});

	it('selects cell before running action', () => {
		const fixture = renderButton(mockAction());

		fixture.click();

		expect(selectCellStub.calledOnce).toBeTruthy();
		expect(selectCellStub.firstCall.args[1]).toBe(CellSelectionType.Normal);
	});

	it('runs the action when clicked', async () => {
		const runStub = sinon.stub().resolves();
		const fixture = renderButton(mockAction({ run: runStub }));

		fixture.click();

		await new Promise(resolve => setTimeout(resolve, 0));
		expect(runStub.calledOnce).toBeTruthy();
	});

	it('does not throw when action.run rejects', async () => {
		const logStub = sinon.stub(console, 'log');
		const fixture = renderButton(mockAction({
			run: () => Promise.reject(new Error('action failed')),
		}));

		fixture.click();
		await new Promise(resolve => setTimeout(resolve, 0));
		logStub.restore();
	});

	it('renders icon when action has one', () => {
		const fixture = renderButton(mockAction({ iconId: 'chevron-down' }));

		expect(fixture.iconClass).toBe('codicon-chevron-down');
	});

	it('renders DevErrorIcon when action has no icon', () => {
		const fixture = renderButton(mockAction({ iconId: undefined }));

		expect(fixture.iconClass).toBe('codicon-blank');
	});

	describe('success feedback', () => {
		function renderSuccessButton(run?: () => Promise<void>) {
			return renderButton(mockAction({
				id: PositronNotebookActionId.CopyOutputImage,
				iconId: 'copy',
				run: run ?? (() => Promise.resolve()),
			}));
		}

		it('momentarily shows feedback after successful action', () => runWithFakedTimers({}, async () => {
			const fixture = renderSuccessButton();

			await fixture.clickAndFlush();

			expect(fixture.iconClass).toBe('codicon-check');

			// Advance past the 1500ms success feedback duration.
			await timeout(1500);

			// Let the set state flush; flushSync does not work here.
			await timeout(0);

			expect(fixture.iconClass).toBe('codicon-copy');
		}));

		it('does not show check icon for non-opted-in actions', () => runWithFakedTimers({}, async () => {
			const fixture = renderButton(mockAction({
				id: 'some-other-action',
				iconId: 'copy',
				run: () => Promise.resolve(),
			}));

			await fixture.clickAndFlush();

			expect(fixture.iconClass).toBe('codicon-copy');
		}));

		it('does not show check icon when action rejects', () => runWithFakedTimers({}, async () => {
			const logStub = sinon.stub(console, 'log');
			const fixture = renderSuccessButton(() => Promise.reject(new Error('fail')));

			await fixture.clickAndFlush();

			expect(fixture.iconClass).toBe('codicon-copy');
			logStub.restore();
		}));
	});
});
