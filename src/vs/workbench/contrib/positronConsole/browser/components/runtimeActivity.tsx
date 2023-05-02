/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./runtimeActivity';
import * as React from 'react';
import { ActivityInput } from 'vs/workbench/contrib/positronConsole/browser/components/activityInput';
import { ActivityItemInput } from 'vs/workbench/services/positronConsole/common/classes/activityItemInput';
import { RuntimeItemActivity } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemActivity';
import { ActivityOutputPlot } from 'vs/workbench/contrib/positronConsole/browser/components/activityOutputPlot';
import { ActivityErrorStream } from 'vs/workbench/contrib/positronConsole/browser/components/activityErrorStream';
import { ActivityOutputStream } from 'vs/workbench/contrib/positronConsole/browser/components/activityOutputStream';
import { ActivityErrorMessage } from 'vs/workbench/contrib/positronConsole/browser/components/activityErrorMessage';
import { ActivityItemOutputPlot } from 'vs/workbench/services/positronConsole/common/classes/activityItemOutputPlot';
import { ActivityOutputMessage } from 'vs/workbench/contrib/positronConsole/browser/components/activityOutputMessage';
import { ActivityItemErrorStream } from 'vs/workbench/services/positronConsole/common/classes/activityItemErrorStream';
import { ActivityItemOutputStream } from 'vs/workbench/services/positronConsole/common/classes/activityItemOutputStream';
import { ActivityItemErrorMessage } from 'vs/workbench/services/positronConsole/common/classes/activityItemErrorMessage';
import { ActivityItemOutputMessage } from 'vs/workbench/services/positronConsole/common/classes/activityItemOutputMessage';

// RuntimeActivityProps interface.
export interface RuntimeActivityProps {
	runtimeItemActivity: RuntimeItemActivity;
}

/**
 * RuntimeActivity component.
 * @param props A RuntimeActivityProps that contains the component properties.
 * @returns The rendered component.
 */
export const RuntimeActivity = (props: RuntimeActivityProps) => {
	// Render.
	return (
		<div className='runtime-activity'>
			{props.runtimeItemActivity.activityItems.map(activityItem => {
				if (activityItem instanceof ActivityItemInput) {
					return <ActivityInput key={activityItem.id} activityItemInput={activityItem} />;
				} else if (activityItem instanceof ActivityItemOutputStream) {
					return <ActivityOutputStream key={activityItem.id} activityItemOutputStream={activityItem} />;
				} else if (activityItem instanceof ActivityItemErrorStream) {
					return <ActivityErrorStream key={activityItem.id} activityItemErrorStream={activityItem} />;
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
			})}
		</div>
	);
};
