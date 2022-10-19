/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./environmentTool';
const React = require('react');
import { useEffect, useState } from 'react';

/**
 * EnvironmentToolProps interface.
 */
interface EnvironmentToolProps {
	placeholder: string;
}

/**
 * EnvironmentTool component.
 * @param props An EnvironmentToolProps that contains the component properties.
 * @returns The component.
 */
export const EnvironmentTool = (props: EnvironmentToolProps) => {
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
		<div>Environment {props.placeholder} {time}</div>
	);
};
