/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/environmentComponent';
const React = require('react');
import { useEffect, useState } from 'react';

/**
 * EnvironmentComponentProps interface.
 */
interface EnvironmentComponentProps {
	placeholder: string;
}

/**
 * EnvironmentComponent.
 * @param props An EnvironmentComponentProps that contains the component properties.
 * @returns The component.
 */
export const EnvironmentComponent = (props: EnvironmentComponentProps) => {
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
