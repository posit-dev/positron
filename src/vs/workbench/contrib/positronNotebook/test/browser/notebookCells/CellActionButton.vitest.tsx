/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

/* eslint-disable no-restricted-syntax */
/* eslint-disable local/code-no-dangerous-type-assertions */

import { act } from '@testing-library/react';
import { setupRTLRenderer } from '../../../../../../test/vitest/reactTestingLibrary.js';
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
		// act() drains the pending microtask so React state settles before the assertion.
		await act(async () => {
			this.button.click();
			await timeout(0);
		});
	}
}

describe('CellActionButton', () => {
	const rtl = setupRTLRenderer();

	let selectCellStub: ReturnType<typeof vi.fn>;
	let instance: IPositronNotebookInstance;
	let cell: IPositronNotebookCell;

	beforeEach(() => {
		selectCellStub = vi.fn();
		instance = {
			hoverManager: undefined,
			currentContainer: undefined,
			selectionStateMachine: { selectCell: selectCellStub },
		} as unknown as IPositronNotebookInstance;
		cell = { id: 'cell-1' } as unknown as IPositronNotebookCell;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	function renderButton(
		action: MenuItemAction | SubmenuItemAction,
		options?: { showSeparator?: boolean },
	) {
		const { container } = rtl.render(
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

		expect(fixture.hasSeparator).toBe(true);
	});

	it('does not apply separator-after class when showSeparator is false', () => {
		const fixture = renderButton(mockAction(), { showSeparator: false });

		expect(fixture.hasSeparator).toBe(false);
	});

	it('selects cell before running action', () => {
		const fixture = renderButton(mockAction());

		fixture.click();

		expect(selectCellStub, 'Expected selectCell to be called').toHaveBeenCalledOnce();
		expect(selectCellStub.mock.calls[0][1]).toBe(CellSelectionType.Normal);
	});

	it('runs the action when clicked', async () => {
		const runStub = vi.fn().mockResolvedValue(undefined);
		const fixture = renderButton(mockAction({ run: runStub }));

		fixture.click();

		await new Promise(resolve => setTimeout(resolve, 0));
		expect(runStub, 'Expected action.run to be called').toHaveBeenCalledOnce();
	});

	it('does not throw when action.run rejects', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => { });
		const fixture = renderButton(mockAction({
			run: () => Promise.reject(new Error('action failed')),
		}));

		fixture.click();
		await new Promise(resolve => setTimeout(resolve, 0));
	});

	it('renders icon when action has one', () => {
		const fixture = renderButton(mockAction({ iconId: 'chevron-down' }));

		expect(fixture.iconClass).toBe('codicon-chevron-down');
	});

	it('renders DevErrorIcon when action has no icon', () => {
		const fixture = renderButton(mockAction({ iconId: undefined }));

		expect(fixture.iconClass, 'Missing developer error icon').toBe('codicon-blank');
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

			// act() wraps the timer advance because the 1500ms setTimeout calls setState to reset the icon.
			await act(async () => {
				await timeout(1500);
				await timeout(0);
			});

			expect(fixture.iconClass, 'Original icon should be restored').toBe('codicon-copy');
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
			vi.spyOn(console, 'log').mockImplementation(() => { });
			const fixture = renderSuccessButton(() => Promise.reject(new Error('fail')));

			await fixture.clickAndFlush();

			expect(fixture.iconClass).toBe('codicon-copy');
		}));
	});
});
