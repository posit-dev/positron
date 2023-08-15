/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./activityOutputHtml';
import * as React from 'react';
import { ActivityItemOutputHtml } from 'vs/workbench/services/positronConsole/common/classes/activityItemOutputHtml';

// ActivityOutputHtml interface.
export interface ActivityOutputHtmlProps {
	activityItemOutputHtml: ActivityItemOutputHtml;
}

/**
 * ActivityOutputHtml component.
 * @param props An ActivityErrorMessageProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActivityOutputHtml = (props: ActivityOutputHtmlProps) => {
	const html = 'data:text/html,' + props.activityItemOutputHtml.html;

	// Render the raw HTML in the div
	return (
		<div className='activity-output-html'>
			<iframe src={html} />
		</div>
	);
};
