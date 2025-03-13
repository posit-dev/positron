/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './activityOutputPlot.css';

// React.
import React from 'react';

// Other dependencies.
import * as nls from '../../../../../nls.js';
import { ConsoleOutputLines } from './consoleOutputLines.js';
import { ActivityItemOutputPlot } from '../../../../services/positronConsole/browser/classes/activityItemOutputPlot.js';

// ActivityOutputPlot interface.
export interface ActivityOutputPlotProps {
	activityItemOutputPlot: ActivityItemOutputPlot;
}

const linkTitle = nls.localize('activityOutputPlotLinkTitle', "Select this plot in the Plots pane.");

/**
 * ActivityOutputPlot component.
 * @param props An ActivityErrorMessageProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActivityOutputPlot = (props: ActivityOutputPlotProps) => {
	// Handles clicks on the plot. This raises a selection event that eventually
	// selects the plot (by its ID) in the Plots pane.
	const handleClick = (event: React.MouseEvent<HTMLAnchorElement, MouseEvent>) => {
		props.activityItemOutputPlot.onSelected();
	};

	// Render.
	return (
		<>
			<ConsoleOutputLines outputLines={props.activityItemOutputPlot.outputLines} />
			<a className='activity-output-plot'
				title={linkTitle}
				onClick={handleClick}>
				<img src={props.activityItemOutputPlot.plotUri} />
				<span className='inspect codicon codicon-positron-search' />
			</a>
		</>
	);
};
