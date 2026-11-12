/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';
import { useCounterStore } from './useCounterStore.js';
import { RenderCount, useRenderCount } from './useRenderCount.js';

/** Shows the current value. Selects only `value`. */
export const CounterValue = () => {
	const value = useCounterStore(s => s.value);
	const renders = useRenderCount();
	return (
		<section className='counter-panel' data-render-count={renders} data-testid='counter-value'>
			<output aria-label={localize('positron.counter.valueLabel', "Counter value")} className='counter-value-number'>
				{value}
			</output>
			<RenderCount renders={renders} />
		</section>
	);
};
