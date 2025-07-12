/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './runtimePendingInput.css';

// React.
import React from 'react';

// Other dependencies.
import { FontInfo } from '../../../../../editor/common/config/fontInfo.js';
import { OutputRun } from '../../../../browser/positronAnsiRenderer/outputRun.js';
import { RuntimeItemPendingInput } from '../../../../services/positronConsole/browser/classes/runtimeItemPendingInput.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';

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
	const { openerService, notificationService, workbenchEnvironmentService, pathService } = usePositronReactServicesContext();

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
							environmentService={workbenchEnvironmentService}
							notificationService={notificationService}
							openerService={openerService}
							outputRun={outputRun}
							pathService={pathService}
						/>
					)}
				</div>
			)}
		</div>
	);
};
