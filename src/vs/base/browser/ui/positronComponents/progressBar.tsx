/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './progressBar.css';

// React.
import React from 'react';

export interface ProgressBarProps {
	value?: number;
	max?: number;
}

/**
 * Progress bar component.
 *
 * The props set the `value` and `max` attributes of the HTML `<progress>` element.
 * Leave `value` undefined for an indeterminate progress bar. The `max` defaults to 100.
 *
 * @param props Props for the progress bar.
 * @returns
 */
export const ProgressBar = (props: ProgressBarProps) => {
	return (
		<progress className='progress-bar-item' max={props.max || 100} value={props.value} />
	);
};
