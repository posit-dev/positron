/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './runtimePendingInput.css';

// Other dependencies.
import { FontInfo } from '../../../../../editor/common/config/fontInfo.js';
import { OutputRun } from '../../../../browser/positronAnsiRenderer/outputRun.js';
import { RuntimeItemPendingInput } from '../../../../services/positronConsole/browser/classes/runtimeItemPendingInput.js';

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
						<OutputRun key={outputRun.id} outputRun={outputRun} />
					)}
				</div>
			)}
		</div>
	);
};
