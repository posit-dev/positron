/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./testContent';
const React = require('react');
import { useEffect, useState } from 'react';

// TestContentProps interface.
interface TestContentProps {
	message: string;
}

// TestContent component.
export const TestContent = (props: TestContentProps) => {
	// Hooks.
	const [time, setTime] = useState<string>(new Date().toLocaleString());
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
		<div className='test-content' >
			<div>
				Test Content
			</div>
			<div>
				Message: {props.message} Time: {time}
			</div>
		</div>
	);
};

