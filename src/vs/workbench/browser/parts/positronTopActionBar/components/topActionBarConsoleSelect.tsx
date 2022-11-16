/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./topActionBarConsoleSelect';
import * as React from 'react';
import { TopActionBarSelectBox } from 'vs/workbench/browser/parts/positronTopActionBar/components/topActionBarSelectBox';

export interface TopActionBarConsoleSelectProps {
}

export const TopActionBarConsoleSelect = (props: TopActionBarConsoleSelectProps) => {
	// Click handler.
	const clickHandler = () => {

	};

	// Render.
	return (
		<TopActionBarSelectBox className='top-action-bar-console-select' onClick={clickHandler}>
			<span className='top-action-bar-console-select-text'>
				Console: Python
			</span>
		</TopActionBarSelectBox>
	);
};
