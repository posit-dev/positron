/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './runtimeActivity.css';

// React.
import React from 'react';

// Other dependencies.
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
import { ActivityItemStream, ActivityItemStreamType } from '../../../../services/positronConsole/browser/classes/activityItemStream.js';

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
			{props.runtimeItemActivity.activityItems.filter(activityItem => !activityItem.isHidden).map(activityItem => {

				if (activityItem instanceof ActivityItemInput) {
					return <ActivityInput key={activityItem.id} activityItemInput={activityItem} fontInfo={props.fontInfo} positronConsoleInstance={props.positronConsoleInstance} />;
				} else if (activityItem instanceof ActivityItemStream) {
					if (activityItem.type === ActivityItemStreamType.OUTPUT) {
						return <ActivityOutputStream key={activityItem.id} activityItemStream={activityItem} />;
					} else if (activityItem.type === ActivityItemStreamType.ERROR) {
						return <ActivityErrorStream key={activityItem.id} activityItemStream={activityItem} />;
					} else {
						// This indicates a bug. A new stream type was added but not handled here.
						return null;
					}
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
					// This indicates a bug. A new activity item was added but not handled here.
					return null;
				}
			})}
		</div>
	);
};
