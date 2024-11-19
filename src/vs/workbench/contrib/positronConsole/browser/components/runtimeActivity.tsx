/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./runtimeActivity';
import * as React from 'react';
import { FontInfo } from '../../../../../editor/common/config/fontInfo.js';
import { ActivityInput } from './activityInput.js';
import { ActivityPrompt } from './activityPrompt.js';
import { ActivityItemInput } from '../../../../services/positronConsole/browser/classes/activityItemInput.js';
import { ActivityItemPrompt } from '../../../../services/positronConsole/browser/classes/activityItemPrompt.js';
import { RuntimeItemActivity } from '../../../../services/positronConsole/browser/classes/runtimeItemActivity.js';
import { ActivityOutputPlot } from './activityOutputPlot.js';
import { ActivityOutputHtml } from './activityOutputHtml.js';
import { ActivityErrorStream } from './activityErrorStream.js';
import { ActivityOutputStream } from './activityOutputStream.js';
import { ActivityErrorMessage } from './activityErrorMessage.js';
import { ActivityItemOutputPlot } from '../../../../services/positronConsole/browser/classes/activityItemOutputPlot.js';
import { ActivityItemOutputHtml } from '../../../../services/positronConsole/browser/classes/activityItemOutputHtml.js';
import { ActivityOutputMessage } from './activityOutputMessage.js';
import { ActivityItemErrorMessage } from '../../../../services/positronConsole/browser/classes/activityItemErrorMessage.js';
import { IPositronConsoleInstance } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { ActivityItemOutputMessage } from '../../../../services/positronConsole/browser/classes/activityItemOutputMessage.js';
import { ActivityItemErrorStream, ActivityItemOutputStream } from '../../../../services/positronConsole/browser/classes/activityItemStream.js';

// RuntimeActivityProps interface.
export interface RuntimeActivityProps {
	fontInfo: FontInfo;
	runtimeItemActivity: RuntimeItemActivity;
	positronConsoleInstance: IPositronConsoleInstance;
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
					return <ActivityInput key={activityItem.id} fontInfo={props.fontInfo} activityItemInput={activityItem} />;
				} else if (activityItem instanceof ActivityItemOutputStream) {
					return <ActivityOutputStream key={activityItem.id} activityItemOutputStream={activityItem} />;
				} else if (activityItem instanceof ActivityItemErrorStream) {
					return <ActivityErrorStream key={activityItem.id} activityItemErrorStream={activityItem} />;
				} else if (activityItem instanceof ActivityItemPrompt) {
					return <ActivityPrompt key={activityItem.id} activityItemPrompt={activityItem} positronConsoleInstance={props.positronConsoleInstance} />;
				} else if (activityItem instanceof ActivityItemOutputHtml) {
					return <ActivityOutputHtml key={activityItem.id} activityItemOutputHtml={activityItem} />;
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
