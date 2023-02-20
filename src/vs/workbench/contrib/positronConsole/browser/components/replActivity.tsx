/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./replActivity';
import * as React from 'react';
import { RuntimeItemActivity } from 'vs/workbench/contrib/positronConsole/browser/classes/runtimeItemActivity';
import { ActivityItem } from 'vs/workbench/contrib/positronConsole/browser/classes/activityItem';
import { ActivityItemInput } from 'vs/workbench/contrib/positronConsole/browser/classes/activityItemInput';
import { ActivityItemOutput } from 'vs/workbench/contrib/positronConsole/browser/classes/activityItemOutput';
import { ActivityItemError } from 'vs/workbench/contrib/positronConsole/browser/classes/ativityItemError';
import { ReplActivityRunInput } from 'vs/workbench/contrib/positronConsole/browser/components/replActivityRunInput';
import { ReplActivityRunOutput } from 'vs/workbench/contrib/positronConsole/browser/components/replActivityRunOutput';

// ReplActivityProps interface.
export interface ReplActivityProps {
	replItemActivity: RuntimeItemActivity;
}

/**
 * ReplActivity component.
 * @param props A ReplActivityProps that contains the component properties.
 * @returns The rendered component.
 */
export const ReplActivity = ({ replItemActivity }: ReplActivityProps) => {

	/**
	 * Renders a repl item activity run.
	 * @param replItemActivityRun The repl item activity run.
	 * @returns The rendered repl item activity run.
	 */
	const renderReplItemActivityRun = (replItemActivityRun: ActivityItem) => {
		if (replItemActivityRun instanceof ActivityItemInput) {
			return <ReplActivityRunInput key={replItemActivityRun.id} replItemActivityRunInput={replItemActivityRun} />;
		} else if (replItemActivityRun instanceof ActivityItemOutput) {
			return <ReplActivityRunOutput key={replItemActivityRun.id} replItemActivityRunOutput={replItemActivityRun} />;
		} else if (replItemActivityRun instanceof ActivityItemError) {
			return <div key={replItemActivityRun.id}>[error]</div>;
		} else {
			// This indicates a bug. Be resilient and simply skip rendering the repl item activity run.
			return null;
		}
	};

	// Render.
	return (
		<div className='repl-activity'>
			{replItemActivity.activityItems.map(replItemActivityRun =>
				renderReplItemActivityRun(replItemActivityRun)
			)}
		</div>
	);
};
