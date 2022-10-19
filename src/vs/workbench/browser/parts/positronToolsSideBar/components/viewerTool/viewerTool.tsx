/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./viewerTool';
const React = require('react');
import { useEffect, useState } from 'react';

/**
 * ViewerToolProps interface.
 */
interface ViewerToolProps {
	placeholder: string;
}

/**
 * ViewerTool component.
 * @param props A ViewerToolProps that contains the component properties.
 * @returns The component.
 */
export const ViewerTool = (props: ViewerToolProps) => {
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
