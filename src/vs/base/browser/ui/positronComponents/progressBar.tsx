/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import 'vs/css!./progressBar';

export interface ProgressBarProps {
	value?: number;
}

export const ProgressBar = (props: ProgressBarProps) => {
	return (
		<progress className='progress-bar-item' value={props.value} />
	);
};
