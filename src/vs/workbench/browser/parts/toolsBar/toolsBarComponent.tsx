/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/toolsBarComponent';
const React = require('react');
import { createContext, useContext, useEffect, useState } from 'react';

/**
 * ToolsBarTopMode enumeration.
 */
export enum ToolsBarTopMode {
	Empty,
	Environment,
	Preview,
	Help
}

/**
 * ToolsBarBottomMode enumeration.
 */
export enum ToolsBarBottomMode {
	Empty,
	Plot,
	Viewer,
	Presentation
}

/**
 * ToolsBarState interface.
 */
export interface ToolsBarState {
	counter: number;
	topMode: ToolsBarTopMode;
	bottomMode?: ToolsBarBottomMode;
}

/**
 * ToolsBarContext React context.
 */
export const ToolsBarContext = createContext<ToolsBarState>({
	counter: 0,
	topMode: ToolsBarTopMode.Empty,
	bottomMode: ToolsBarBottomMode.Empty
});

/**
 * ToolsBarComponentProps interface.
 */
interface ToolsBarComponentProps {
	placeholder: string;
}

// ToolsBarComponent component.
export const ToolsBarComponent = (props: ToolsBarComponentProps) => {
	// Hooks.
	const toolsBarContext = useContext(ToolsBarContext);

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
		<div>ToolsBar {props.placeholder} {time} {toolsBarContext.counter}</div>
	);
};
