/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./runtimeActivity';
import * as React from 'react';
import { ActivityInput } from 'vs/workbench/contrib/positronConsole/browser/components/activityInput';
import { ActivityItemInput } from 'vs/workbench/services/positronConsole/common/classes/activityItemInput';
import { RuntimeItemActivity } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemActivity';
import { ActivityErrorMessage } from 'vs/workbench/contrib/positronConsole/browser/components/activityErrorMessage';
import { ActivityOutputMessage } from 'vs/workbench/contrib/positronConsole/browser/components/activityOutputMessage';
import { ActivityItemErrorMessage } from 'vs/workbench/services/positronConsole/common/classes/activityItemErrorMessage';
import { ActivityItemOutputMessage } from 'vs/workbench/services/positronConsole/common/classes/activityItemOutputMessage';
import { ActivityErrorStreamGroup } from 'vs/workbench/contrib/positronConsole/browser/components/activityErrorStreamGroup';
import { ActivityOutputStreamGroup } from 'vs/workbench/contrib/positronConsole/browser/components/activityOutputStreamGroup';
import { ActivityItemErrorStreamGroup } from 'vs/workbench/services/positronConsole/common/classes/activityItemErrorStreamGroup';
import { ActivityItemOutputStreamGroup } from 'vs/workbench/services/positronConsole/common/classes/activityItemOutputStreamGroup';
import { ActivityItemOutputPlot } from 'vs/workbench/services/positronConsole/common/classes/activityItemOutputPlot';
import { ActivityOutputPlot } from 'vs/workbench/contrib/positronConsole/browser/components/activityOutputPlot';

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
	const renderActivityItem = (activityItem: ActivityItemInput | ActivityItemOutputStreamGroup | ActivityItemErrorStreamGroup | ActivityItemOutputMessage | ActivityItemErrorMessage) => {
		if (activityItem instanceof ActivityItemInput) {
			return <ActivityInput key={activityItem.id} activityItemInput={activityItem} />;
		} else if (activityItem instanceof ActivityItemOutputStreamGroup) {
			return <ActivityOutputStreamGroup key={activityItem.id} activityItemOutputStreamGroup={activityItem} />;
		} else if (activityItem instanceof ActivityItemErrorStreamGroup) {
			return <ActivityErrorStreamGroup key={activityItem.id} activityItemErrorStreamGroup={activityItem} />;
		} else if (activityItem instanceof ActivityItemOutputMessage) {
			return <ActivityOutputMessage key={activityItem.id} activityItemOutputMessage={activityItem} />;
		} else if (activityItem instanceof ActivityItemOutputPlot) {
			return <ActivityOutputPlot key={activityItem.id} activityItemOutputPlot={activityItem} />;
		} else if (activityItem instanceof ActivityItemErrorMessage) {
			return <ActivityErrorMessage key={activityItem.id} activityItemErrorMessage={activityItem} />;
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
