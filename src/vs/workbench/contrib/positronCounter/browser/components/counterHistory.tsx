/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';
import { CounterOp } from '../../common/counter.js';
import { useCounterStore } from './useCounterStore.js';
import { RenderCount, useRenderCount } from './useRenderCount.js';

/** Returns the localized label for an operation. */
function opLabel(op: CounterOp): string {
	switch (op) {
		case 'increment': return localize('positron.counter.op.increment', "Increment");
		case 'decrement': return localize('positron.counter.op.decrement', "Decrement");
		case 'reset': return localize('positron.counter.op.reset', "Reset");
	}
}

/** The in-memory history, newest first. Selects only `history`. */
export const CounterHistory = () => {
	const history = useCounterStore(s => s.history);
	const renders = useRenderCount();
	return (
		<section className='counter-panel' data-render-count={renders} data-testid='counter-history'>
			<h3>{localize('positron.counter.history', "History")}</h3>
			{history.length === 0 ?
				<p>{localize('positron.counter.noHistory', "No changes yet.")}</p> :
				<ol reversed className='counter-history'>
					{history.map((entry, index) => (
						<li key={`${entry.at}-${index}`}>
							{localize('positron.counter.historyEntry', "{0} by {1}: {2} -> {3}", opLabel(entry.op), entry.amount, entry.from, entry.to)}
						</li>
					)).reverse()}
				</ol>
			}
			<RenderCount renders={renders} />
		</section>
	);
};
