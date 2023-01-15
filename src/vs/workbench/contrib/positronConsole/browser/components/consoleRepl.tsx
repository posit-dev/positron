/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./consoleRepl';
import * as React from 'react';
import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { ConsoleReplInstance } from 'vs/workbench/contrib/positronConsole/browser/classes/consoleReplInstance';

// ConsoleReplProps interface.
interface ConsoleReplProps {
	hidden: boolean;
	consoleReplInstance: ConsoleReplInstance;
}

interface Item {
	key: number;
	value: string;
}

/**
 * ConsoleRepl component.
 * @param props A ConsoleProps that contains the component properties.
 * @returns The rendered component.
 */
export const ConsoleRepl = ({ hidden, consoleReplInstance }: ConsoleReplProps) => {
	// Hooks.
	const [items, setItems] = useState<Item[]>([]);

	// useEffect for appending items.
	useEffect(() => {
		// Start the interval.
		const interval = setInterval(() => {
			const now = new Date();
			setItems(items => [...items, { key: now.getTime(), value: `${consoleReplInstance.displayName} item at ${now.toLocaleTimeString()}` }]);
		}, 1000);

		// Return the cleanup function.
		return () => clearInterval(interval);
	}, []);

	// Render.
	return (
		<div className='console-repl' hidden={hidden}>
			<div>
				Console for {consoleReplInstance.displayName}
			</div>
			{items.map(item =>
				<div key={item.key}>
					{item.value}
				</div>)}
		</div>
	);
};
