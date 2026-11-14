/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IStatusbarEntry, IStatusbarService, StatusbarAlignment } from '../../../services/statusbar/browser/statusbar.js';
import { COUNTER_OPEN_COMMAND_ID, ICounterService } from '../common/counter.js';

/**
 * Shows the counter in the status bar. A plain (non-React) consumer of the
 * counter store: it subscribes with `store.subscribe` and disposes the
 * subscription with the contribution.
 */
export class CounterStatusBarContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.positronCounterStatusBar';

	constructor(
		@ICounterService counterService: ICounterService,
		@IStatusbarService statusbarService: IStatusbarService,
	) {
		super();

		const entry = this._register(statusbarService.addEntry(
			createEntry(counterService.store.getState().value),
			'positron.counter.statusbar',
			StatusbarAlignment.RIGHT
		));

		this._register(toDisposable(counterService.store.subscribe((state, previous) => {
			if (state.value !== previous.value) {
				entry.update(createEntry(state.value));
			}
		})));
	}
}

/** Builds the status bar entry for a value. */
function createEntry(value: number): IStatusbarEntry {
	const text = localize('positron.counter.statusbar', "Counter: {0}", value);
	return {
		name: localize('positron.counter.statusbarName', "Counter"),
		text,
		ariaLabel: text,
		command: COUNTER_OPEN_COMMAND_ID,
	};
}
