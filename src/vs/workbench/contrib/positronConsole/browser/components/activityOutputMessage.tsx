/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './activityOutputMessage.css';

// Other dependencies.
import { ConsoleOutputLines } from './consoleOutputLines.js';
import { ActivityItemOutputMessage } from '../../../../services/positronConsole/browser/classes/activityItemOutputMessage.js';

// ActivityOutputMessageProps interface.
export interface ActivityOutputMessageProps {
	activityItemOutputMessage: ActivityItemOutputMessage;
}

/**
 * ActivityOutputMessage component.
 * @param props An ActivityOutputMessageProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActivityOutputMessage = (props: ActivityOutputMessageProps) => {
	// Render.
	return (
		<ConsoleOutputLines outputLines={props.activityItemOutputMessage.outputLines} />
	);
};
