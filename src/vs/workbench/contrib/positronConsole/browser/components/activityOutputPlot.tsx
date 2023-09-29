/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./activityOutputPlot';
import * as React from 'react';
import * as nls from 'vs/nls';
import { OutputLines } from 'vs/workbench/contrib/positronConsole/browser/components/outputLines';
import { ActivityItemOutputPlot } from 'vs/workbench/services/positronConsole/common/classes/activityItemOutputPlot';

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
			<OutputLines outputLines={props.activityItemOutputPlot.outputLines} />
			<a className='activity-output-plot'
				onClick={handleClick}
				title={linkTitle}>
				<img src={props.activityItemOutputPlot.plotUri} />
				<span className='inspect codicon codicon-positron-search' />
			</a>
		</>
	);
};
