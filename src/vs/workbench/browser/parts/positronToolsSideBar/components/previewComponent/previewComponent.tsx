/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/previewComponent';
const React = require('react');
import { useEffect, useState } from 'react';

/**
 * PreviewComponentProps interface.
 */
interface PreviewComponentProps {
	placeholder: string;
}

/**
 * PreviewComponent.
 * @param props A PreviewComponentProps that contains the component properties.
 * @returns The component.
 */
export const PreviewComponent = (props: PreviewComponentProps) => {
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
