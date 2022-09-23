/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./testComponent';
const React = require('react');
import { useEffect, useState } from 'react';
import { IDisposable } from 'vs/base/common/lifecycle';
import TestSubcomponent from 'vs/base/browser/ui/testSubcomponent/testSubcomponent';
import { ReactComponentRenderer } from 'vs/base/browser/reactComponentRenderer';

// TestComponentProps interface.
interface TestComponentProps {
	message: string;
}

/**
 * Renders the TestComponent into the specified container HTMLElement.
 * @param container The container HTMLElement into which the TestComponent is rendered.
 * @param props The properties for the TestComponent.
 * @returns An IDisposable that unmounts the component.
 */
export const renderTestComponent = (container: HTMLElement, props: TestComponentProps): IDisposable => {
	return new ReactComponentRenderer(container, <TestComponent {...props} />);
};

// TestComponent component.
const TestComponent = (props: TestComponentProps) => {
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
			<div>
				TestComponent
			</div>
			<div className='test' >
				Message: {props.message} Time: {time}
			</div>
			<TestSubcomponent {...props} />
		</>
	);
};
