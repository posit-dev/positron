/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./runtimePendingInput';
import * as React from 'react';
import { FontInfo } from 'vs/editor/common/config/fontInfo';
import { OutputRun } from 'vs/workbench/browser/positronAnsiRenderer/outputRun';
import { RuntimeItemPendingInput } from 'vs/workbench/services/positronConsole/browser/classes/runtimeItemPendingInput';
import { usePositronConsoleContext } from 'vs/workbench/contrib/positronConsole/browser/positronConsoleContext';

// RuntimePendingInputProps interface.
export interface RuntimePendingInputProps {
	fontInfo: FontInfo;
	runtimeItemPendingInput: RuntimeItemPendingInput;
}

/**
 * RuntimePendingInput component.
 * @param props A RuntimePendingInputProps that contains the component properties.
 * @returns The rendered component.
 */
export const RuntimePendingInput = (props: RuntimePendingInputProps) => {
	// Get services from the context.
	const { openerService, notificationService } = usePositronConsoleContext();

	// Calculate the prompt width.
	const promptWidth = Math.ceil(
		(props.runtimeItemPendingInput.inputPrompt.length + 1) *
		props.fontInfo.typicalHalfwidthCharacterWidth
	);

	// Render.
	return (
		<div className='pending-input'>
			{props.runtimeItemPendingInput.outputLines.map((outputLine, index) =>
				<div key={outputLine.id}>
					<span style={{ width: promptWidth }}>
						{props.runtimeItemPendingInput.inputPrompt + ' '}
					</span>
					{outputLine.outputRuns.map(outputRun =>
						<OutputRun
							key={outputRun.id}
							outputRun={outputRun}
							openerService={openerService}
							notificationService={notificationService}
						/>
					)}
				</div>
			)}
		</div>
	);
};
