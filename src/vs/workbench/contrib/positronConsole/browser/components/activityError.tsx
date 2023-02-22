/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./activityError';
import * as React from 'react';
import { useMemo } from 'react'; // eslint-disable-line no-duplicate-imports
import { lineSplitter } from 'vs/workbench/services/positronConsole/common/classes/utils';
import { ReplLines } from 'vs/workbench/contrib/positronConsole/browser/components/replLines';
import { ActivityItemError } from 'vs/workbench/services/positronConsole/common/classes/ativityItemError';

// ActivityErrorProps interface.
export interface ActivityErrorProps {
	activityItemError: ActivityItemError;
}

/**
 * ActivityError component.
 * @param props An ActivityErrorProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActivityError = ({ activityItemError }: ActivityErrorProps) => {
	// Hooks.
	const lines = useMemo(() => {
		return lineSplitter(activityItemError.message);
	}, [activityItemError]);

	// Render.
	return (
		<div className='activity-error'>
			<div style={{ color: 'red' }}>
				<ReplLines lines={lines} />
			</div>
		</div>
	);
};
