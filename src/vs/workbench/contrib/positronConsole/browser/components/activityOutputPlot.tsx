/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./activityOutputPlot';
import * as React from 'react';
import { OutputLines } from 'vs/workbench/contrib/positronConsole/browser/components/outputLines';
import { ActivityItemOutputPlot } from 'vs/workbench/services/positronConsole/common/classes/activityItemOutputPlot';

// ActivityOutputPlot interface.
export interface ActivityOutputPlotProps {
	activityItemOutputPlot: ActivityItemOutputPlot;
}

/**
 * ActivityOutputPlot component.
 * @param props An ActivityErrorMessageProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActivityOutputPlot = (props: ActivityOutputPlotProps) => {
	// Render.
	return (
		<div className='activity-output-plot'>
			<OutputLines outputLines={props.activityItemOutputPlot.outputLines} />
			<img src={props.activityItemOutputPlot.plotUri} />
		</div>
	);
};
