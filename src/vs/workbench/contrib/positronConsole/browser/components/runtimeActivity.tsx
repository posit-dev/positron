/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./runtimeActivity';
import * as React from 'react';
import { ActivityInput } from 'vs/workbench/contrib/positronConsole/browser/components/activityInput';
import { ActivityItemInput } from 'vs/workbench/services/positronConsole/common/classes/activityItemInput';
import { RuntimeItemActivity } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemActivity';
import { ActivityOutputPlot } from 'vs/workbench/contrib/positronConsole/browser/components/activityOutputPlot';
import { ActivityErrorMessage } from 'vs/workbench/contrib/positronConsole/browser/components/activityErrorMessage';
import { ActivityItemOutputPlot } from 'vs/workbench/services/positronConsole/common/classes/activityItemOutputPlot';
import { ActivityOutputMessage } from 'vs/workbench/contrib/positronConsole/browser/components/activityOutputMessage';
import { ActivityItemErrorMessage } from 'vs/workbench/services/positronConsole/common/classes/activityItemErrorMessage';
import { ActivityItemOutputMessage } from 'vs/workbench/services/positronConsole/common/classes/activityItemOutputMessage';
import { ActivityErrorStreamGroup } from 'vs/workbench/contrib/positronConsole/browser/components/activityErrorStreamGroup';
import { ActivityOutputStreamGroup } from 'vs/workbench/contrib/positronConsole/browser/components/activityOutputStreamGroup';
import { ActivityItemErrorStreamGroup } from 'vs/workbench/services/positronConsole/common/classes/activityItemErrorStreamGroup';
import { ActivityItemOutputStreamGroup } from 'vs/workbench/services/positronConsole/common/classes/activityItemOutputStreamGroup';

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
	// Render.
	return (
		<div className='runtime-activity'>
			{runtimeItemActivity.renderActivityItems.map(renderActivityItem => {
				if (renderActivityItem instanceof ActivityItemInput) {
					return <ActivityInput key={renderActivityItem.id} activityItemInput={renderActivityItem} />;
				} else if (renderActivityItem instanceof ActivityItemOutputStreamGroup) {
					return <ActivityOutputStreamGroup key={renderActivityItem.id} activityItemOutputStreamGroup={renderActivityItem} />;
				} else if (renderActivityItem instanceof ActivityItemErrorStreamGroup) {
					return <ActivityErrorStreamGroup key={renderActivityItem.id} activityItemErrorStreamGroup={renderActivityItem} />;
				} else if (renderActivityItem instanceof ActivityItemOutputMessage) {
					return <ActivityOutputMessage key={renderActivityItem.id} activityItemOutputMessage={renderActivityItem} />;
				} else if (renderActivityItem instanceof ActivityItemOutputPlot) {
					return <ActivityOutputPlot key={renderActivityItem.id} activityItemOutputPlot={renderActivityItem} />;
				} else if (renderActivityItem instanceof ActivityItemErrorMessage) {
					return <ActivityErrorMessage key={renderActivityItem.id} activityItemErrorMessage={renderActivityItem} />;
				} else {
					// This indicates a bug.
					return null;
				}
			})}
		</div>
	);
};
