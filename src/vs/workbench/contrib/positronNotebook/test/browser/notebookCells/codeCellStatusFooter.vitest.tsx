/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import { observableValue, ISettableObservable } from '../../../../../../base/common/observable.js';
import { setupRTLRenderer } from '../../../../../../test/vitest/reactTestingLibrary.js';
import { stubInterface } from '../../../../../../test/vitest/stubInterface.js';
import { CodeCellStatusFooter } from '../../../browser/notebookCells/CodeCellStatusFooter.js';
import { ExecutionStatus } from '../../../browser/PositronNotebookCells/IPositronNotebookCell.js';
import { PositronNotebookCodeCell } from '../../../browser/PositronNotebookCells/PositronNotebookCodeCell.js';

interface CellState {
	executionStatus?: ExecutionStatus;
	lastExecutionOrder?: number;
	lastExecutionDuration?: number;
	lastRunEndTime?: number;
	lastRunSuccess?: boolean;
}

describe('CodeCellStatusFooter', () => {
	const rtl = setupRTLRenderer();

	let executionStatus: ISettableObservable<ExecutionStatus>;
	let lastExecutionOrder: ISettableObservable<number | undefined>;
	let lastExecutionDuration: ISettableObservable<number | undefined>;
	let lastRunEndTime: ISettableObservable<number | undefined>;
	let lastRunSuccess: ISettableObservable<boolean | undefined>;

	beforeEach(() => {
		executionStatus = observableValue<ExecutionStatus>('executionStatus', 'idle');
		lastExecutionOrder = observableValue<number | undefined>('lastExecutionOrder', undefined);
		lastExecutionDuration = observableValue<number | undefined>('lastExecutionDuration', undefined);
		lastRunEndTime = observableValue<number | undefined>('lastRunEndTime', undefined);
		lastRunSuccess = observableValue<boolean | undefined>('lastRunSuccess', undefined);
	});

	function renderFooter(state: CellState = {}, hasError = false) {
		if (state.executionStatus !== undefined) { executionStatus.set(state.executionStatus, undefined); }
		if (state.lastExecutionOrder !== undefined) { lastExecutionOrder.set(state.lastExecutionOrder, undefined); }
		if (state.lastExecutionDuration !== undefined) { lastExecutionDuration.set(state.lastExecutionDuration, undefined); }
		if (state.lastRunEndTime !== undefined) { lastRunEndTime.set(state.lastRunEndTime, undefined); }
		if (state.lastRunSuccess !== undefined) { lastRunSuccess.set(state.lastRunSuccess, undefined); }

		const cell = stubInterface<PositronNotebookCodeCell>({
			executionStatus,
			lastExecutionOrder,
			lastExecutionDuration,
			lastRunEndTime,
			lastRunSuccess,
			isInViewport: () => true,
		});

		return rtl.render(<CodeCellStatusFooter cell={cell} hasError={hasError} />);
	}

	function getFooter({ hidden = false }: { hidden?: boolean } = {}): HTMLElement {
		// hidden: true lets the query traverse aria-hidden subtrees (collapsed footer).
		return screen.getByRole('status', { hidden });
	}

	it('renders succeeded state with success icon, duration, and aria-label', () => {
		const { container } = renderFooter({
			executionStatus: 'idle',
			lastRunSuccess: true,
			lastExecutionDuration: 1234,
			lastRunEndTime: Date.now(),
		});

		const footer = getFooter();
		expect(footer).toHaveAttribute('data-execution-status', 'idle');
		expect(footer).toHaveAttribute('aria-label', expect.stringMatching(/^Cell execution succeeded\. /));
		// eslint-disable-next-line no-restricted-syntax -- icon is a structural element with no role/label
		expect(container.querySelector('.code-cell-footer-icon.success')).toBeInTheDocument();
		// eslint-disable-next-line no-restricted-syntax -- duration is a styling-only span, no role
		expect(container.querySelector('.code-cell-footer-duration')).toHaveTextContent(/\d+(ms|s)/);
	});

	it('renders failed state with error icon and aria-label when lastRunSuccess is false', () => {
		const { container } = renderFooter({
			executionStatus: 'idle',
			lastRunSuccess: false,
			lastExecutionDuration: 56,
			lastRunEndTime: Date.now(),
		});

		const footer = getFooter();
		expect(footer).toHaveAttribute('data-execution-status', 'idle');
		expect(footer).toHaveAttribute('aria-label', expect.stringMatching(/^Cell execution failed\. /));
		// eslint-disable-next-line no-restricted-syntax -- icon is a structural element with no role/label
		expect(container.querySelector('.code-cell-footer-icon.error')).toBeInTheDocument();
	});

	it('renders failed state when hasError prop is true even if lastRunSuccess is true', () => {
		const { container } = renderFooter({
			executionStatus: 'idle',
			lastRunSuccess: true,
			lastExecutionDuration: 56,
			lastRunEndTime: Date.now(),
		}, /* hasError */ true);

		expect(getFooter()).toHaveAttribute('aria-label', expect.stringMatching(/^Cell execution failed\. /));
		// eslint-disable-next-line no-restricted-syntax -- icon is a structural element with no role/label
		expect(container.querySelector('.code-cell-footer-icon.error')).toBeInTheDocument();
	});

	it('renders running state with running icon and aria-label', () => {
		const { container } = renderFooter({ executionStatus: 'running' });

		const footer = getFooter();
		expect(footer).toHaveAttribute('data-execution-status', 'running');
		expect(footer).toHaveAttribute('aria-label', 'Cell is executing');
		expect(footer).toHaveAttribute('aria-live', 'polite');
		// eslint-disable-next-line no-restricted-syntax -- icon is a structural element with no role/label
		expect(container.querySelector('.code-cell-footer-icon.running')).toBeInTheDocument();
	});

	it('renders pending state with pending icon and aria-label', () => {
		const { container } = renderFooter({ executionStatus: 'pending' });

		const footer = getFooter();
		expect(footer).toHaveAttribute('data-execution-status', 'pending');
		expect(footer).toHaveAttribute('aria-label', 'Cell is queued for execution');
		// eslint-disable-next-line no-restricted-syntax -- icon is a structural element with no role/label
		expect(container.querySelector('.code-cell-footer-icon.pending')).toBeInTheDocument();
	});

	it('shows a relative completion time for recently-finished cells', () => {
		const { container } = renderFooter({
			executionStatus: 'idle',
			lastRunSuccess: true,
			lastExecutionDuration: 100,
			lastRunEndTime: Date.now(),
		});

		// eslint-disable-next-line no-restricted-syntax -- text container is a styling-only span, no role
		const footerText = container.querySelector('.code-cell-footer-text');
		expect(footerText).toHaveTextContent(/Just now|seconds ago/);
	});

	it('collapses for cells that have never been run', () => {
		renderFooter();

		const footer = getFooter({ hidden: true });
		expect(footer).toHaveClass('collapsed');
		expect(footer).toHaveAttribute('aria-hidden', 'true');
		// Collapsed footer has no aria-label.
		expect(footer).not.toHaveAttribute('aria-label');
	});

	it('also collapses when only an execution order from a previous session is present', () => {
		// Previous-session-only state has hasCurrentSessionContent=false, so
		// isCollapsed evaluates the same as never-been-run.
		renderFooter({ lastExecutionOrder: 1 });

		expect(getFooter({ hidden: true })).toHaveClass('collapsed');
	});
});
