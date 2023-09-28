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
	// Click handler.
	const handleClick = (event: React.MouseEvent<HTMLImageElement, MouseEvent>) => {
		props.activityItemOutputPlot.onSelected();
	};

	// Render.
	return (
		<>
			<OutputLines outputLines={props.activityItemOutputPlot.outputLines} />
			<div className='activity-output-plot'>
				<img src={props.activityItemOutputPlot.plotUri} onClick={handleClick} />
				<span className='inspect codicon codicon-positron-search' />
			</div>
		</>
	);
};
