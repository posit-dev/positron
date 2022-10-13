/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/viewerComponent';
const React = require('react');
import { useEffect, useState } from 'react';

/**
 * ViewerComponentProps interface.
 */
interface ViewerComponentProps {
	placeholder: string;
}

/**
 * ViewerComponent.
 * @param props A ViewerComponentProps that contains the component properties.
 * @returns The component.
 */
export const ViewerComponent = (props: ViewerComponentProps) => {
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
		<div>Viewer {props.placeholder} {time}</div>
	);
};
