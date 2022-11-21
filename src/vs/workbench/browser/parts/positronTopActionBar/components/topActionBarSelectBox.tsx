/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./topActionBarSelectBox';
import * as React from 'react';
import { PropsWithChildren } from 'react'; // eslint-disable-line no-duplicate-imports
import { positronClassNames } from 'vs/base/common/positronUtilities';

export interface TopActionBarSelectBoxProps {
	onClick?: (event: React.MouseEvent) => void;
	onDropDownClick?: (event: React.MouseEvent) => void;
	className?: string;
}

export const TopActionBarSelectBox = (props: PropsWithChildren<TopActionBarSelectBoxProps>) => {
	// Create the class names.
	const classNames = positronClassNames(
		'top-action-bar-select-box',
		{ 'top-action-bar-select-box-drop-down-click': props.onDropDownClick },
		props.className
	);

	// Render.
	return (
		<div className={classNames}>
			<div className='top-action-bar-select-box-main' onClick={props.onClick}>
				{props.children}
			</div>
			<div className='top-action-bar-select-box-drop-down' onClick={props.onDropDownClick || props.onClick}>
				<span className='codicon codicon-chevron-down'></span>
			</div>
		</div>
	);
};
