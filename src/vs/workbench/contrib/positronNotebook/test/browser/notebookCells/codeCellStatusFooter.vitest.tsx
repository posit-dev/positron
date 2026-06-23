/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { act, screen } from '@testing-library/react';
import { observableValue } from '../../../../../../base/common/observable.js';
import { createTestContainer } from '../../../../../../test/vitest/positronTestContainer.js';
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
	tags?: string[];
	isAddingTag?: boolean;
	cellTagsHidden?: boolean;
}

describe('CodeCellStatusFooter', () => {
	// The footer embeds CellTagsBar, which reads the React services context, so
	// render through the provider tree rather than the prop-only renderer.
	const ctx = createTestContainer().withReactServices().build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	function renderFooter(state: CellState = {}, hasError = false) {
		// Mirrors the real cell's tagUIVisible derivation (tags or an in-progress
		// add, unless the notebook hides tags).
		const tagUIVisible = ((state.tags?.length ?? 0) > 0 || (state.isAddingTag ?? false)) && !(state.cellTagsHidden ?? false);
		const cell = stubInterface<PositronNotebookCodeCell>({
			executionStatus: observableValue<ExecutionStatus>('executionStatus', state.executionStatus ?? 'idle'),
			lastExecutionOrder: observableValue<number | undefined>('lastExecutionOrder', state.lastExecutionOrder),
			lastExecutionDuration: observableValue<number | undefined>('lastExecutionDuration', state.lastExecutionDuration),
			lastRunEndTime: observableValue<number | undefined>('lastRunEndTime', state.lastRunEndTime),
			lastRunSuccess: observableValue<boolean | undefined>('lastRunSuccess', state.lastRunSuccess),
			tags: observableValue<string[]>('tags', state.tags ?? []),
			isAddingTag: observableValue<boolean>('isAddingTag', state.isAddingTag ?? false),
			tagUIVisible: observableValue<boolean>('tagUIVisible', tagUIVisible),
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

	// The footer hosts the tag bar, so its collapse/stack layout depends on the
	// cell's tag UI visibility as well as execution metadata: a visible tag UI
	// (tags or an in-progress tag-add) keeps it open, hiding tags notebook-wide
	// collapses it, and the execution-metadata row appears above the tags only
	// when there is execution metadata to show (otherwise the tags are alone).
	const tagLayoutCases: { name: string; state: CellState; collapsed: boolean; metadata: boolean }[] = [
		{ name: 'execution metadata and tags', state: { ...completedState, executionStatus: 'idle', lastRunSuccess: true, tags: ['wip'] }, collapsed: false, metadata: true },
		{ name: 'execution metadata and a tag-add in progress', state: { ...completedState, executionStatus: 'idle', lastRunSuccess: true, isAddingTag: true }, collapsed: false, metadata: true },
		{ name: 'tags only', state: { tags: ['wip'] }, collapsed: false, metadata: false },
		{ name: 'tags hidden notebook-wide', state: { tags: ['wip'], cellTagsHidden: true }, collapsed: true, metadata: false },
		{ name: 'a tag-add in progress', state: { isAddingTag: true }, collapsed: false, metadata: false },
	];

	it.each(tagLayoutCases)('tag footer layout with $name', ({ state, collapsed, metadata }) => {
		renderFooter(state);
		const footer = getFooter({ hidden: true });

		if (collapsed) {
			expect(footer).toHaveClass('collapsed');
		} else {
			expect(footer).not.toHaveClass('collapsed');
		}
		if (metadata) {
			expect(screen.getByTestId('cell-footer-metadata')).toBeInTheDocument();
		} else {
			expect(screen.queryByTestId('cell-footer-metadata')).not.toBeInTheDocument();
		}
	});

	it('refreshes the relative time for each footer in a one minute interval', async () => {
		vi.useFakeTimers();
		try {
			const startTime = Date.now();
			renderFooter({
				lastExecutionDuration: 500,
				lastRunEndTime: startTime - 60_000,
				lastRunSuccess: true,
			});

			expect(screen.getByText('1 min ago')).toBeInTheDocument();
			await act(async () => {
				vi.advanceTimersByTime(60_000);
			});
			expect(screen.getByText('2 mins ago')).toBeInTheDocument();
		} finally {
			vi.useRealTimers();
		}
	});
});
