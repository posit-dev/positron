/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronTestComponent';
const React = require('react');
import { useEffect, useState } from 'react';
import { PositronTestSubcomponent } from 'vs/workbench/contrib/positronModalDialogs/browser/positronModalDialogComponent/components/positronTestSubcomponent';

// PositronTestComponentProps interface.
interface PositronTestComponentProps {
	message: string;
}

// PositronTestComponent component.
export const PositronTestComponent = (props: PositronTestComponentProps) => {
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
		<>
			<div className='positron-test-component' >
				<div>
					TestComponent
				</div>
				<div>
					Message: {props.message} Time: {time}
				</div>
			</div>
			<PositronTestSubcomponent {...props} />
		</>
	);
};

