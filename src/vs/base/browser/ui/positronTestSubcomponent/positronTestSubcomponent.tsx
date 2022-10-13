/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronTestSubcomponent';
const React = require('react');
import { useEffect, useState } from 'react';

// PositronTestSubcomponentProps interface.
interface PositronTestSubcomponentProps {
	message: string;
}

// PositronTestSubcomponent component.
export const PositronTestSubcomponent = (props: PositronTestSubcomponentProps) => {
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
		<div className='positron-test-subcomponent' >
			<div>
				TestSubcomponent
			</div>
			<div>
				Message: {props.message} Time: {time}
			</div>
		</div>
	);
};
