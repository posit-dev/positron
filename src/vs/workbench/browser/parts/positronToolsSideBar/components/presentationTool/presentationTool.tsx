/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./presentationTool';
import * as React from 'react';
import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports

/**
 * PresentationToolProps interface.
 */
interface PresentationToolProps {
	placeholder: string;
}

/**
 * PresentationTool component.
 * @param props A PresentationToolProps that contains the component properties.
 * @returns The component.
 */
export const PresentationTool = (props: PresentationToolProps) => {
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
		<div>Presentation {props.placeholder} {time}</div>
	);
};
