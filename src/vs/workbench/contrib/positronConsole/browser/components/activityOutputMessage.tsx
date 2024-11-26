/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import './activityOutputMessage.css';
import * as React from 'react';
import { OutputLines } from './outputLines.js';
import { ActivityItemOutputMessage } from '../../../../services/positronConsole/browser/classes/activityItemOutputMessage.js';

// ActivityOutputMessageProps interface.
export interface ActivityOutputMessageProps {
	activityItemOutputMessage: ActivityItemOutputMessage;
}

/**
 * ActivityOutputMessage component.
 * @param props An ActivityOutputMessageProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActivityOutputMessage = (props: ActivityOutputMessageProps) => {
	// Render.
	return (
		<OutputLines outputLines={props.activityItemOutputMessage.outputLines} />
	);
};
