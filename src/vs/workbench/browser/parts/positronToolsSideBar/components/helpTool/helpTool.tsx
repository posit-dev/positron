/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./helpTool';
import * as React from 'react';
import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports

/**
 * HelpToolProps interface.
 */
interface HelpToolProps {
	placeholder: string;
}

/**
 * HelpTool component.
 * @param props A HelpToolProps that contains the component properties.
 * @returns The component.
 */
export const HelpTool = (props: HelpToolProps) => {
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
