/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./topBarSelectBox';
import * as React from 'react';
import { PropsWithChildren } from 'react'; // eslint-disable-line no-duplicate-imports
import { positronClassNames } from 'vs/base/common/positronClassNames';

export interface TopBarSelectBoxProps {
	onClick?: (event: React.MouseEvent) => void;
	onDropDownClick?: (event: React.MouseEvent) => void;
	className?: string;
}

export const TopBarSelectBox = (props: PropsWithChildren<TopBarSelectBoxProps>) => {

	const classNames = positronClassNames(
		'top-bar-select-box',
		{ 'top-bar-select-box-drop-down-click': props.onDropDownClick },
		props.className
	);

	// Render.
	return (
		<div className={classNames}>
			<div className='top-bar-select-box-main' onClick={props.onClick}>
				{props.children}
			</div>
			<div className='top-bar-select-box-drop-down' onClick={props.onDropDownClick || props.onClick}>
				<span className='codicon codicon-chevron-down'></span>
			</div>
		</div>
	);
};
