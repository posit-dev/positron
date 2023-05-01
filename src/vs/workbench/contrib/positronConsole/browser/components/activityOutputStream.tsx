/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./activityOutputStream';
import * as React from 'react';
import { OutputLines } from 'vs/workbench/contrib/positronConsole/browser/components/outputLines';
import { ActivityItemOutputStream } from 'vs/workbench/services/positronConsole/common/classes/activityItemOutputStream';

// ActivityOutputStreamProps interface.
export interface ActivityOutputStreamProps {
	activityItemOutputStream: ActivityItemOutputStream;
}

/**
 * ActivityOutputStream component.
 * @param activityItemOutputStream The ActivityItemOutputStream to render.
 * @returns The rendered component.
 */
export const ActivityOutputStream = ({ activityItemOutputStream }: ActivityOutputStreamProps) => {
	// Render.
	return (
		<OutputLines outputLines={activityItemOutputStream.outputLines} />
	);
};
