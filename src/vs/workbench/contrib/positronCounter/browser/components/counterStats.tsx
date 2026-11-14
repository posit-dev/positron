/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';
import { useCounterStore } from './useCounterStore.js';
import { RenderCount, useRenderCount } from './useRenderCount.js';

/**
 * Lifetime statistics. Selects `stats` as-is: immer keeps the same object when
 * an update (such as undo) leaves stats untouched, so this skips re-rendering.
 */
export const CounterStats = () => {
	const stats = useCounterStore(s => s.stats);
	const renders = useRenderCount();
	return (
		<section className='counter-panel' data-render-count={renders} data-testid='counter-stats'>
			<h3>{localize('positron.counter.stats', "Stats")}</h3>
			<dl className='counter-stats'>
				<dt>{localize('positron.counter.min', "Min")}</dt>
				<dd>{stats.min}</dd>
				<dt>{localize('positron.counter.max', "Max")}</dt>
				<dd>{stats.max}</dd>
				<dt>{localize('positron.counter.increments', "Increments")}</dt>
				<dd>{stats.counts.increment}</dd>
				<dt>{localize('positron.counter.decrements', "Decrements")}</dt>
				<dd>{stats.counts.decrement}</dd>
				<dt>{localize('positron.counter.resets', "Resets")}</dt>
				<dd>{stats.counts.reset}</dd>
			</dl>
			<RenderCount renders={renders} />
		</section>
	);
};
