/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./activityOutputStream';
import * as React from 'react';
import { OutputLines } from 'vs/workbench/contrib/positronConsole/browser/components/outputLines';
import { ActivityItemOutputStream } from 'vs/workbench/services/positronConsole/browser/classes/activityItemStream';

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
