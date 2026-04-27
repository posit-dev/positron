/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { screen } from '@testing-library/react';
import { observableValue } from '../../../../../../base/common/observable.js';
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

	function renderFooter(state: CellState = {}, hasError = false) {
		const cell = stubInterface<PositronNotebookCodeCell>({
			executionStatus: observableValue<ExecutionStatus>('executionStatus', state.executionStatus ?? 'idle'),
			lastExecutionOrder: observableValue<number | undefined>('lastExecutionOrder', state.lastExecutionOrder),
			lastExecutionDuration: observableValue<number | undefined>('lastExecutionDuration', state.lastExecutionDuration),
			lastRunEndTime: observableValue<number | undefined>('lastRunEndTime', state.lastRunEndTime),
			lastRunSuccess: observableValue<boolean | undefined>('lastRunSuccess', state.lastRunSuccess),
			isInViewport: () => true,
		});

		return rtl.render(<CodeCellStatusFooter cell={cell} hasError={hasError} />);
	}

	function getFooter({ hidden = false }: { hidden?: boolean } = {}): HTMLElement {
		// hidden: true lets the query traverse aria-hidden subtrees (collapsed footer).
		return screen.getByRole('status', { hidden });
	}

	const completedState = {
		lastExecutionDuration: 1234,
		lastRunEndTime: Date.now(),
	} as const;

	it('renders succeeded state with the right aria-label and visible duration', () => {
		renderFooter({ ...completedState, executionStatus: 'idle', lastRunSuccess: true });

		const footer = getFooter();
		expect(footer).toHaveAttribute('data-execution-status', 'idle');
		expect(footer).toHaveAttribute('aria-label', expect.stringMatching(/^Cell execution succeeded\. /));
		expect(screen.getByText(/\d+(ms|s)/)).toBeInTheDocument();
	});

	it('renders failed state with the right aria-label when lastRunSuccess is false', () => {
		renderFooter({ ...completedState, executionStatus: 'idle', lastRunSuccess: false });

		expect(getFooter()).toHaveAttribute('aria-label', expect.stringMatching(/^Cell execution failed\. /));
	});

	it('renders failed state when hasError prop is true even if lastRunSuccess is true', () => {
		renderFooter({ ...completedState, executionStatus: 'idle', lastRunSuccess: true }, /* hasError */ true);

		expect(getFooter()).toHaveAttribute('aria-label', expect.stringMatching(/^Cell execution failed\. /));
	});

	it('renders running state with aria-live announcement', () => {
		renderFooter({ executionStatus: 'running' });

		const footer = getFooter();
		expect(footer).toHaveAttribute('data-execution-status', 'running');
		expect(footer).toHaveAttribute('aria-label', 'Cell is executing');
		expect(footer).toHaveAttribute('aria-live', 'polite');
	});

	it('renders pending state with the right aria-label', () => {
		renderFooter({ executionStatus: 'pending' });

		const footer = getFooter();
		expect(footer).toHaveAttribute('data-execution-status', 'pending');
		expect(footer).toHaveAttribute('aria-label', 'Cell is queued for execution');
	});

	it('shows a relative completion time for recently-finished cells', () => {
		renderFooter({ ...completedState, executionStatus: 'idle', lastRunSuccess: true });

		expect(screen.getByText(/Just now|seconds ago/)).toBeInTheDocument();
	});

	it('falls back to the generic status indicator when timing info is partial', () => {
		// hasTimingInfo is true (duration set) so footer is not collapsed, but
		// the timing-label branch needs both duration AND lastRunEndTime; with
		// only one set, neither the success/failed nor the never-run label fires.
		renderFooter({ lastExecutionDuration: 100 });

		expect(getFooter()).toHaveAttribute('aria-label', 'Cell execution status indicator');
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

	describe('icon variant', () => {
		// Icons are decorative (no semantic role/label), so we identify them via
		// data-testid -- the documented fallback in vitest-rtl.md when no
		// semantic query fits. The Icon component already forwards data-testid.
		function getIcon() {
			return screen.getByTestId('cell-status-footer-icon');
		}

		it('succeeded state renders the success icon', () => {
			renderFooter({ ...completedState, executionStatus: 'idle', lastRunSuccess: true });
			expect(getIcon()).toHaveClass('success');
		});

		it('failed state (lastRunSuccess=false) renders the error icon', () => {
			renderFooter({ ...completedState, executionStatus: 'idle', lastRunSuccess: false });
			expect(getIcon()).toHaveClass('error');
		});

		it('failed state (hasError prop) renders the error icon', () => {
			renderFooter({ ...completedState, executionStatus: 'idle', lastRunSuccess: true }, /* hasError */ true);
			expect(getIcon()).toHaveClass('error');
		});

		it('running state renders the running icon', () => {
			renderFooter({ executionStatus: 'running' });
			expect(getIcon()).toHaveClass('running');
		});

		it('pending state renders the pending icon', () => {
			renderFooter({ executionStatus: 'pending' });
			expect(getIcon()).toHaveClass('pending');
		});
	});
});
