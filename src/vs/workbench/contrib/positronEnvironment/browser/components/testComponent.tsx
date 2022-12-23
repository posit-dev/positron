/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./testComponent';
import * as React from 'react';
import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// TestComponent component.
export const TestComponent = () => {
	// Hooks.
	const [time, setTime] = useState<string>('Loading...');

	// The timer.
	useEffect(() => {
		// Set the interval.
		const interval = setInterval(() => {
			setTime(`Now ${new Date().toLocaleString()}`);
		}, 200);

		// Return the cleanup function.
		return () => {
			clearInterval(interval);
		};
	}, []);

	// Render.
	return (
		<div>
			{time}
		</div>
	);
};

