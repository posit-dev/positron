/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./previewTool';
const React = require('react');
import { useEffect, useState } from 'react';

/**
 * PreviewToolProps interface.
 */
interface PreviewToolProps {
	placeholder: string;
}

/**
 * PreviewTool component.
 * @param props A PreviewToolProps that contains the component properties.
 * @returns The component.
 */
export const PreviewTool = (props: PreviewToolProps) => {
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
		<div>Preview {props.placeholder} {time}</div>
	);
};
