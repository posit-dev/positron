/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/helpComponent';
const React = require('react');
import { useEffect, useState } from 'react';

/**
 * HelpComponentProps interface.
 */
interface HelpComponentProps {
	placeholder: string;
}

/**
 * HelpComponent.
 * @param props A HelpComponentProps that contains the component properties.
 * @returns The component.
 */
export const HelpComponent = (props: HelpComponentProps) => {
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
		<div>Help {props.placeholder} {time}</div>
	);
};
