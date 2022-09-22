/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./testComponent';
import * as React from 'react';
// eslint-disable-next-line no-duplicate-imports
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

// TestComponentProps interface.
interface TestComponentProps {
	message: string;
}

/**
 * Renders the TestComonent into the specified container.
 * @param container The container into which the TestComonent is rendered.
 * @param props The properties for the comonent.
 */
export const renderTestComponent = (container: HTMLElement, props: TestComponentProps) => {
	const root = createRoot(container);
	root.render(<TestComponent {...props} />);
};

// TestComponent component.
const TestComponent = (props: TestComponentProps) => {
	// Hooks.
	const [time, setTime] = useState<string>('Loading time...');
	useEffect(() => {
		const interval = setInterval(() => {
			setTime(new Date().toLocaleString());
		}, 1000);
		return () => clearInterval(interval);
	}, []);

	// Render.
	return (
		<div className='test' >
			React: Message: {props.message} Time: {time}
		</div>
	);
};

// Export the TestComponent component.
export default TestComponent;
