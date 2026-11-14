/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './counterView.css';

import { CounterControls } from './counterControls.js';
import { CounterHistory } from './counterHistory.js';
import { CounterStats } from './counterStats.js';
import { CounterValue } from './counterValue.js';

/**
 * The Counter editor body. Each panel selects its own slice of the counter
 * store, so the render counts show which panels an update actually touched.
 */
export const CounterView = () => (
	<div className='counter-view'>
		<CounterValue />
		<CounterControls />
		<CounterStats />
		<CounterHistory />
	</div>
);
