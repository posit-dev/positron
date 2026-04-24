/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, screen, within } from '@testing-library/react';
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
import { stubInterface } from '../../../../../../test/vitest/stubInterface.js';

function mockAction(overrides?: Partial<{
	id: string;
	label: string;
	tooltip: string;
	iconId: string;
	run: () => Promise<void>;
}>): MenuItemAction {
	const id = overrides?.id ?? 'test-action';
	const label = overrides?.label ?? 'Test';
	return stubInterface<MenuItemAction>({
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
	});
}

/** Returns the button's icon element, scoped via the `cell-action-button-icon` testid. */
function getIcon(button: HTMLElement): HTMLElement {
	return within(button).getByTestId('cell-action-button-icon');
}

async function clickAndFlush(button: HTMLElement) {
	// act() drains the pending microtask so React state settles before the assertion.
	await act(async () => {
		button.click();
		await timeout(0);
	});
}

describe('CellActionButton', () => {
	const rtl = setupRTLRenderer();

	let selectCellStub: ReturnType<typeof vi.fn>;
	let instance: IPositronNotebookInstance;
	let cell: IPositronNotebookCell;

	beforeEach(() => {
		selectCellStub = vi.fn();
		instance = stubInterface<IPositronNotebookInstance>({
			hoverManager: undefined,
			currentContainer: undefined,
			selectionStateMachine: stubInterface<IPositronNotebookInstance['selectionStateMachine']>({
				selectCell: selectCellStub,
			}),
		});
		cell = stubInterface<IPositronNotebookCell>({ id: 'cell-1' });
	});

	function renderButton(
		action: MenuItemAction | SubmenuItemAction,
		options?: { showSeparator?: boolean },
	) {
		rtl.render(
			<NotebookInstanceProvider instance={instance}>
				<CellActionButton
					action={action}
					cell={cell}
					showSeparator={options?.showSeparator}
				/>
			</NotebookInstanceProvider>
		);
		return screen.getByRole('button', { name: action.label });
	}

	it('renders with aria-label from action', () => {
		const action = mockAction({ label: 'Collapse Output' });
		const button = renderButton(action);

		expect(button).toHaveAttribute('aria-label', 'Collapse Output');
	});

	it('applies separator-after class when showSeparator is true', () => {
		const button = renderButton(mockAction(), { showSeparator: true });

		expect(button).toHaveClass('separator-after');
	});

	it('does not apply separator-after class when showSeparator is false', () => {
		const button = renderButton(mockAction(), { showSeparator: false });

		expect(button).not.toHaveClass('separator-after');
	});

	it('selects cell before running action', () => {
		const button = renderButton(mockAction());

		button.click();

		expect(selectCellStub, 'Expected selectCell to be called').toHaveBeenCalledOnce();
		expect(selectCellStub.mock.calls[0][1]).toBe(CellSelectionType.Normal);
	});

	it('runs the action when clicked', async () => {
		const runStub = vi.fn().mockResolvedValue(undefined);
		const button = renderButton(mockAction({ run: runStub }));

		button.click();

		await new Promise(resolve => setTimeout(resolve, 0));
		expect(runStub, 'Expected action.run to be called').toHaveBeenCalledOnce();
	});

	it('does not throw when action.run rejects', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => { });
		const button = renderButton(mockAction({
			run: () => Promise.reject(new Error('action failed')),
		}));

		button.click();
		await new Promise(resolve => setTimeout(resolve, 0));
	});

	it('renders icon when action has one', () => {
		const button = renderButton(mockAction({ iconId: 'chevron-down' }));

		expect(getIcon(button)).toHaveClass('codicon-chevron-down');
	});

	it('renders DevErrorIcon when action has no icon', () => {
		const button = renderButton(mockAction({ iconId: undefined }));

		expect(getIcon(button), 'Missing developer error icon').toHaveClass('codicon-blank');
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
			const button = renderSuccessButton();

			await clickAndFlush(button);

			expect(getIcon(button)).toHaveClass('codicon-check');

			// act() wraps the timer advance because the 1500ms setTimeout calls setState to reset the icon.
			await act(async () => {
				await timeout(1500);
				await timeout(0);
			});

			expect(getIcon(button), 'Original icon should be restored').toHaveClass('codicon-copy');
		}));

		it('does not show check icon for non-opted-in actions', () => runWithFakedTimers({}, async () => {
			const button = renderButton(mockAction({
				id: 'some-other-action',
				iconId: 'copy',
				run: () => Promise.resolve(),
			}));

			await clickAndFlush(button);

			expect(getIcon(button)).toHaveClass('codicon-copy');
		}));

		it('does not show check icon when action rejects', () => runWithFakedTimers({}, async () => {
			vi.spyOn(console, 'log').mockImplementation(() => { });
			const button = renderSuccessButton(() => Promise.reject(new Error('fail')));

			await clickAndFlush(button);

			expect(getIcon(button)).toHaveClass('codicon-copy');
		}));
	});
});
