/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './activityOutputStream.css';

// React.
import React from 'react';

// Other dependencies.
import { OutputLines } from './outputLines.js';
import { ActivityItemOutputStream } from '../../../../services/positronConsole/browser/classes/activityItemStream.js';

// ActivityOutputStreamProps interface.
export interface ActivityOutputStreamProps {
	activityItemOutputStream: ActivityItemOutputStream;
}

/**
 * ActivityOutputStream component.
 * @param props An ActivityOutputStreamProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActivityOutputStream = (props: ActivityOutputStreamProps) => {
	// Render.
	return (
		<OutputLines outputLines={props.activityItemOutputStream.outputLines} />
	);
};
