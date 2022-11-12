/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./topBarConsoleSelect';
import * as React from 'react';
import { TopBarSelectBox } from 'vs/workbench/browser/parts/positronTopBar/components/topBarSelectBox/topBarSelectBox';

export interface TopBarConsoleSelectProps {
}

export const TopBarConsoleSelect = (props: TopBarConsoleSelectProps) => {

	const clickHandler = () => {

	};

	// Render.
	return (
		<TopBarSelectBox className='top-bar-console-select' onClick={clickHandler}>
			<span className='top-bar-console-select-text'>
				Console: Python
			</span>
		</TopBarSelectBox>
	);
};
