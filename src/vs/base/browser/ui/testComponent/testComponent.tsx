/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./testComponent';
const React = require('react');
import { useEffect, useState } from 'react';
import { TestSubcomponent } from 'vs/base/browser/ui/testSubcomponent/testSubcomponent';

// TestComponentProps interface.
interface TestComponentProps {
	message: string;
}

// TestComponent component.
export const TestComponent = (props: TestComponentProps) => {
	// Hooks.
	const [time, setTime] = useState<string>('Loading time...');
	useEffect(() => {
		const interval = setInterval(() => {
			setTime(new Date().toLocaleString());
		}, 1000);
		return () => {
			clearInterval(interval);
		};
	}, []);

	// Render.
	return (
		<>
			<div className='test-component' >
				<div>
					TestComponent
				</div>
				<div>
					Message: {props.message} Time: {time}
				</div>
			</div>
			<TestSubcomponent {...props} />
		</>
	);
};

