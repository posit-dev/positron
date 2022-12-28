/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./testItem';
import * as React from 'react';
import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports

// TestComponentProps interface.
interface TestItemProps {
	entry: number;
}

/**
 * TestItem component.
 * @param props A TestItemProps that contains the component properties.
 * @returns The rendered component.
 */
export const TestItem = (props: TestItemProps) => {
	// Hooks.
	const [time, setTime] = useState<string>('...');

	// The timer.
	useEffect(() => {
		// Set the interval.
		const interval = setInterval(() => {
			setTime(new Date().toLocaleString());
		}, 200);

		// Return the cleanup function.
		return () => {
			clearInterval(interval);
		};
	}, []);

	// Render.
	return (
		<div className='test-item'>
			Entry #{props.entry} {time}
		</div>
	);
};

