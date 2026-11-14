/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { localize } from '../../../../../nls.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { useCounterStore } from './useCounterStore.js';
import { RenderCount, useRenderCount } from './useRenderCount.js';

/**
 * The action buttons and the amount input. Selects a new `{ canUndo }` object on
 * every check, so it uses `useShallow`: it re-renders only when `canUndo` flips.
 */
export const CounterControls = () => {
	const { counterService } = usePositronReactServicesContext();
	const { canUndo } = useCounterStore(useShallow(s => ({ canUndo: s.history.length > 0 })));
	const [amountText, setAmountText] = useState('1');
	const renders = useRenderCount();

	const amount = amountText.trim() === '' ? NaN : Number(amountText);
	const amountValid = Number.isFinite(amount);

	return (
		<section className='counter-panel counter-controls' data-render-count={renders} data-testid='counter-controls'>
			<label className='counter-amount'>
				{localize('positron.counter.amount', "Amount")}
				<input type='number' value={amountText} onChange={e => setAmountText(e.target.value)} />
			</label>
			<div className='counter-buttons'>
				<button disabled={!amountValid} onClick={() => counterService.increment(amount)}>
					{localize('positron.counter.increment', "Increment")}
				</button>
				<button disabled={!amountValid} onClick={() => counterService.decrement(amount)}>
					{localize('positron.counter.decrement', "Decrement")}
				</button>
				<button onClick={() => counterService.reset()}>
					{localize('positron.counter.reset', "Reset")}
				</button>
				<button disabled={!canUndo} onClick={() => counterService.undo()}>
					{localize('positron.counter.undo', "Undo")}
				</button>
			</div>
			<RenderCount renders={renders} />
		</section>
	);
};
