/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/presentationComponent';
const React = require('react');
import { useEffect, useState } from 'react';

/**
 * PresentationComponentProps interface.
 */
interface PresentationComponentProps {
	placeholder: string;
}

/**
 * PresentationComponent.
 * @param props A PresentationComponentProps that contains the component properties.
 * @returns The component.
 */
export const PresentationComponent = (props: PresentationComponentProps) => {
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
