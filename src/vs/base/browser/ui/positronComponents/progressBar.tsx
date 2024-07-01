/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
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
