/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./plotTool';
import * as React from 'react';
import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports

/**
 * PlotToolProps interface.
 */
interface PlotToolProps {
	placeholder: string;
}

/**
 * PlotTool component.
 * @param props A PlotToolProps that contains the component properties.
 * @returns The component.
 */
export const PlotTool = (props: PlotToolProps) => {
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
		<div>Plot {props.placeholder} {time}</div>
	);
};
