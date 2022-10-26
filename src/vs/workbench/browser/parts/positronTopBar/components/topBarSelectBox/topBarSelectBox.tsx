/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./topBarSelectBox';
const React = require('react');
import { PropsWithChildren } from 'react';


export interface TopBarSelectBoxProps {
	onClick?: (event: React.MouseEvent) => void;
	onDropDownClick?: (event: React.MouseEvent) => void;
	className?: string;
}


export const TopBarSelectBox = (props: PropsWithChildren<TopBarSelectBoxProps>) => {

	const classes = ['top-bar-select-box'];
	if (props.onDropDownClick) {
		classes.push('top-bar-select-box-drop-down-click');
	}

	// Render.
	return (
		<div className={`${classes.join(' ')}${props.className ? (' ' + props.className) : ''}`}>
			<div className='top-bar-select-box-main' onClick={props.onClick}>
				{props.children}
			</div>
			<div className='top-bar-select-box-drop-down' onClick={props.onDropDownClick || props.onClick}>
				<span className='codicon codicon-chevron-down'></span>
			</div>
		</div>
	);
};
