/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./runtimeActivity';
import * as React from 'react';
import { ActivityInput } from 'vs/workbench/contrib/positronConsole/browser/components/activityInput';
import { ActivityError } from 'vs/workbench/contrib/positronConsole/browser/components/activityError';
import { ActivityItemError } from 'vs/workbench/services/positronConsole/common/classes/ativityItemError';
import { ActivityItemInput } from 'vs/workbench/services/positronConsole/common/classes/activityItemInput';
import { RuntimeItemActivity } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemActivity';
import { ActivityOutputGroup } from 'vs/workbench/contrib/positronConsole/browser/components/activityOutputGroup';
import { ActivityItemOutputGroup } from 'vs/workbench/services/positronConsole/common/classes/activityItemOutputGroup';

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
	const renderActivityItem = (activityItem: ActivityItemOutputGroup | ActivityItemInput | ActivityItemError) => {
		if (activityItem instanceof ActivityItemOutputGroup) {
			return <ActivityOutputGroup key={activityItem.id} activityItemOutputGroup={activityItem} />;
		} else if (activityItem instanceof ActivityItemInput) {
			return <ActivityInput key={activityItem.id} activityItemInput={activityItem} />;
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
