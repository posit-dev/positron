/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./runtimeActivity';
import * as React from 'react';
import { ActivityItem } from 'vs/workbench/services/positronConsole/common/classes/activityItem';
import { ActivityInput } from 'vs/workbench/contrib/positronConsole/browser/components/activityInput';
import { ActivityError } from 'vs/workbench/contrib/positronConsole/browser/components/activityError';
import { ActivityOutput } from 'vs/workbench/contrib/positronConsole/browser/components/activityOutput';
import { ActivityItemError } from 'vs/workbench/services/positronConsole/common/classes/ativityItemError';
import { ActivityItemInput } from 'vs/workbench/services/positronConsole/common/classes/activityItemInput';
import { ActivityItemOutput } from 'vs/workbench/services/positronConsole/common/classes/activityItemOutput';
import { RuntimeItemActivity } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemActivity';

// RuntimeActivityProps interface.
export interface RuntimeActivityProps {
	runtimeItemActivity: RuntimeItemActivity;
}

/**
 * RuntimeActivity component.
 * @param props A RuntimeActivityProps that contains the component properties.
 * @returns The rendered component.
 */
export const RuntimeActivity = ({ runtimeItemActivity }: RuntimeActivityProps) => {

	/**
	 * Renders am activity item.
	 * @param activityItem The activity item.
	 * @returns The rendered activity item.
	 */
	const renderActivityItem = (activityItem: ActivityItem) => {
		if (activityItem instanceof ActivityItemInput) {
			return <ActivityInput key={activityItem.id} activityItemInput={activityItem} />;
		} else if (activityItem instanceof ActivityItemOutput) {
			return <ActivityOutput key={activityItem.id} activityItemOutput={activityItem} />;
		} else if (activityItem instanceof ActivityItemError) {
			return <ActivityError key={activityItem.id} activityItemError={activityItem} />;
		} else {
			// This indicates a bug.
			return null;
		}
	};

	// Render.
	return (
		<div className='runtime-activity'>
			{runtimeItemActivity.activityItems.map(activityItem =>
				renderActivityItem(activityItem)
			)}
		</div>
	);
};
