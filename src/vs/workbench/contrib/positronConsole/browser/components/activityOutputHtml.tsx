/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./activityOutputHtml';
import * as React from 'react';
import { ActivityItemOutputHtml } from '../../../../services/positronConsole/browser/classes/activityItemOutputHtml.js';
import { renderHtml } from '../../../../../base/browser/positron/renderHtml.js';

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

	// Render the raw HTML in the div
	return (
		<div className='activity-output-html'>
			{renderHtml(props.activityItemOutputHtml.html)}
		</div>
	);
};
