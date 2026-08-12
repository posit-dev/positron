/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />
/// <reference types="@testing-library/jest-dom/vitest" />

// eslint-disable-next-line local/code-import-patterns -- Semantic DOM queries for a non-React presenter.
import { within } from '@testing-library/dom';
// eslint-disable-next-line local/code-import-patterns -- User events exercise the presenter's native DOM buttons.
import { userEvent } from '@testing-library/user-event';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { CanvasStartupPresenter } from '../../browser/canvasStartupPresenter.js';
import { CanvasEntryOutcome } from '../../common/positronCanvasMode.js';

const ENTERED: CanvasEntryOutcome = { entered: true };
const AI_DISABLED: CanvasEntryOutcome = {
	entered: false,
	reason: 'ai-disabled',
	message: 'Canvas is unavailable because AI features are disabled.',
};

describe('CanvasStartupPresenter', () => {
	const disposables = ensureNoLeakedDisposables();

	/** Creates an attached DOM root compatible with jest-dom presence checks. */
	function createContainer(): HTMLElement {
		const container = document.createElement('div');
		document.body.appendChild(container);
		disposables.add(toDisposable(() => container.remove()));
		return container;
	}

	/** Adds a stand-in for the covered workbench so inert handling is checkable. */
	function addWorkbenchSibling(container: HTMLElement): HTMLElement {
		const sibling = document.createElement('div');
		sibling.textContent = 'workbench';
		container.appendChild(sibling);
		return sibling;
	}

	function createPresenter(container: HTMLElement, callbacks: {
		enter: () => Promise<CanvasEntryOutcome>;
		recoverMainWindow?: () => Promise<void>;
		quit?: () => Promise<void>;
		logError?: (message: string, error: unknown) => void;
	}): CanvasStartupPresenter {
		return disposables.add(new CanvasStartupPresenter(
			container,
			callbacks.enter,
			callbacks.recoverMainWindow ?? vi.fn().mockResolvedValue(undefined),
			callbacks.quit ?? vi.fn().mockResolvedValue(undefined),
			stubInterface<ILogService>({ error: callbacks.logError ?? vi.fn(), info: vi.fn() }),
		));
	}

	// The point of the curtain: it has to be on screen before the workbench gets
	// a chance to paint, so nothing about presenting loading may be deferred.
	it('shows one loading curtain synchronously and enters behind it', () => {
		const entry = new DeferredPromise<CanvasEntryOutcome>();
		const enter = vi.fn().mockReturnValue(entry.p);
		const container = createContainer();
		const presenter = createPresenter(container, { enter });

		presenter.present();
		presenter.present();

		const curtain = within(container).getByRole('status');
		expect(curtain).toHaveAttribute('aria-busy', 'true');
		expect(within(curtain).getByRole('progressbar', { name: 'Loading Canvas' })).toBeInTheDocument();
		expect(within(curtain).getByRole('button', { name: 'Open Positron' })).toBeInTheDocument();
		expect(within(container).getAllByRole('status')).toHaveLength(1);
		expect(enter).toHaveBeenCalledTimes(1);
	});

	// Entry can take a while (extension activation plus the assistant's ensure
	// deadline); the loading curtain must offer a way out for its whole
	// duration, not only once it has failed.
	it('cancels a long entry into Positron from the loading curtain', async () => {
		const entry = new DeferredPromise<CanvasEntryOutcome>();
		const recoverMainWindow = vi.fn().mockResolvedValue(undefined);
		const container = createContainer();
		const presenter = createPresenter(container, {
			enter: vi.fn().mockReturnValue(entry.p),
			recoverMainWindow,
		});

		presenter.present();
		const curtain = within(container).getByRole('status');

		const user = userEvent.setup();
		await user.click(within(curtain).getByRole('button', { name: 'Open Positron' }));

		expect(recoverMainWindow).toHaveBeenCalledTimes(1);
		await vi.waitFor(() => expect(within(container).queryByRole('status')).not.toBeInTheDocument());

		// The superseded entry resolving later must not resurrect the curtain.
		await entry.complete({
			entered: false,
			reason: 'superseded',
			message: 'Canvas stopped opening because Positron was asked for the IDE.'
		} satisfies CanvasEntryOutcome);
		expect(within(container).queryByRole('dialog')).not.toBeInTheDocument();
	});

	it('takes the curtain down once Canvas is being presented', async () => {
		const container = createContainer();
		const presenter = createPresenter(container, { enter: vi.fn().mockResolvedValue(ENTERED) });

		presenter.present();

		await vi.waitFor(() => expect(within(container).queryByRole('status')).not.toBeInTheDocument());
	});

	// The curtain covering the workbench visually isn't enough: the covered
	// elements must also drop out of the tab order and accessibility tree while
	// it's up, and rejoin once it comes down.
	it('marks the covered workbench inert while the curtain is up, then releases it', async () => {
		const container = createContainer();
		const sibling = addWorkbenchSibling(container);
		const presenter = createPresenter(container, { enter: vi.fn().mockResolvedValue(ENTERED) });

		presenter.present();
		expect(sibling.inert).toBe(true);

		await vi.waitFor(() => expect(within(container).queryByRole('status')).not.toBeInTheDocument());
		expect(sibling.inert).toBe(false);
	});

	it('stands down without a dialog when the entry was superseded', async () => {
		const container = createContainer();
		const presenter = createPresenter(container, {
			enter: vi.fn().mockResolvedValue({
				entered: false,
				reason: 'superseded',
				message: 'Canvas stopped opening because Positron was asked for the IDE.'
			} satisfies CanvasEntryOutcome)
		});

		presenter.present();

		// The user already chose the IDE; a failure card demanding a second
		// choice would be the curtain arguing with them.
		await vi.waitFor(() => expect(within(container).queryByRole('status')).not.toBeInTheDocument());
		expect(within(container).queryByRole('alertdialog')).not.toBeInTheDocument();
	});

	it('presents a non-entry outcome as a dialog focused on Retry', async () => {
		const container = createContainer();
		const presenter = createPresenter(container, { enter: vi.fn().mockResolvedValue(AI_DISABLED) });

		presenter.present();

		// The curtain starts as a status region (loading); once it needs the user
		// to act, it becomes a dialog, so it's found by its new role here.
		const curtain = await vi.waitFor(() => within(container).getByRole('dialog'));
		expect(within(curtain).getAllByRole('button')).toHaveLength(3);
		expect(curtain).toHaveAttribute('aria-busy', 'false');
		expect(curtain).toHaveAccessibleName('Canvas could not start');
		expect(within(curtain).getByText('Canvas is unavailable because AI features are disabled.')).toBeInTheDocument();
		expect(within(curtain).getByRole('button', { name: 'Retry' })).toHaveFocus();
		expect(within(curtain).getByRole('button', { name: 'Open Positron' })).toBeInTheDocument();
		expect(within(curtain).getByRole('button', { name: 'Quit' })).toBeInTheDocument();
	});

	it('keeps a thrown entry failure behind the curtain', async () => {
		const error = new Error('entry failed');
		const logError = vi.fn();
		const container = createContainer();
		const presenter = createPresenter(container, { enter: vi.fn().mockRejectedValue(error), logError });

		presenter.present();

		const curtain = within(container).getByRole('status');
		await vi.waitFor(() => expect(within(curtain).getAllByRole('button')).toHaveLength(3));
		expect(within(container).getAllByRole('dialog')).toHaveLength(1);
		expect(within(curtain).getByText('Canvas could not be loaded. Try again, open Positron, or quit.')).toBeInTheDocument();
		expect(within(curtain).getByRole('button', { name: 'Retry' })).toHaveFocus();
		expect(logError).toHaveBeenCalledWith('[canvas] Standalone startup failed.', error);
	});

	it('returns to loading and enters again when Retry is clicked', async () => {
		const firstEntry = new DeferredPromise<CanvasEntryOutcome>();
		const retryEntry = new DeferredPromise<CanvasEntryOutcome>();
		const enter = vi.fn()
			.mockReturnValueOnce(firstEntry.p)
			.mockReturnValueOnce(retryEntry.p);
		const container = createContainer();
		const presenter = createPresenter(container, { enter });

		presenter.present();
		const curtain = within(container).getByRole('status');
		await firstEntry.complete(AI_DISABLED);
		await vi.waitFor(() => expect(within(curtain).getAllByRole('button')).toHaveLength(3));

		const user = userEvent.setup();
		await user.click(within(curtain).getByRole('button', { name: 'Retry' }));

		await vi.waitFor(() => expect(enter).toHaveBeenCalledTimes(2));
		expect(curtain).toHaveAttribute('aria-busy', 'true');
		// Back to loading: only the cancel affordance remains.
		expect(within(curtain).queryAllByRole('button')).toHaveLength(1);
		expect(within(curtain).getByRole('button', { name: 'Open Positron' })).toBeInTheDocument();

		await retryEntry.complete(ENTERED);
		await vi.waitFor(() => expect(within(container).queryByRole('status')).not.toBeInTheDocument());
	});

	it('hands Open Positron and Quit to their callbacks', async () => {
		const recoverMainWindow = vi.fn().mockResolvedValue(undefined);
		const quit = vi.fn().mockResolvedValue(undefined);
		const container = createContainer();
		const presenter = createPresenter(container, {
			enter: vi.fn().mockResolvedValue(AI_DISABLED),
			recoverMainWindow,
			quit,
		});

		presenter.present();
		const curtain = within(container).getByRole('status');
		await vi.waitFor(() => expect(within(curtain).getAllByRole('button')).toHaveLength(3));

		const user = userEvent.setup();
		await user.click(within(curtain).getByRole('button', { name: 'Quit' }));
		expect(quit).toHaveBeenCalledTimes(1);

		await user.click(within(curtain).getByRole('button', { name: 'Open Positron' }));
		expect(recoverMainWindow).toHaveBeenCalledTimes(1);
		// Recovering leaves the IDE on screen, so the curtain has nothing left to
		// cover.
		await vi.waitFor(() => expect(within(container).queryByRole('status')).not.toBeInTheDocument());
	});
});
