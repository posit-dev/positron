/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./runtimeStarted';
import * as React from 'react';
import { OutputRun } from 'vs/workbench/contrib/positronConsole/browser/components/outputRun';
import { OutputLines } from 'vs/workbench/contrib/positronConsole/browser/components/outputLines';
import { RuntimeItemPrompt } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemPrompt';
import { IPositronConsoleInstance } from 'vs/workbench/services/positronConsole/common/interfaces/positronConsoleService';

// RuntimePromptProps interface.
export interface RuntimePromptProps {
	runtimeItemPrompt: RuntimeItemPrompt;
	positronConsoleInstance: IPositronConsoleInstance;
}

/**
 * RuntimePrompt component.
 * @param props A RuntimePromptProps that contains the component properties.
 * @returns The rendered component.
 */
export const RuntimePrompt = (props: RuntimePromptProps) => {
	const clickHandler = () => {
		props.runtimeItemPrompt.answered = true;
		props.positronConsoleInstance.runtime.replyToPrompt(props.runtimeItemPrompt.id, 'Some Value');
	};

	// Render.
	return (
		<div>
			<OutputLines outputLines={props.runtimeItemPrompt.outputLines.slice(0, -1)} />
			{props.runtimeItemPrompt.outputLines.slice(-1).map(outputLine =>
				outputLine.outputRuns.map(outputRun =>
					<OutputRun key={outputRun.id} outputRun={outputRun} />
				)
			)}
			{!props.runtimeItemPrompt.answered && <span onClick={clickHandler}>[blinky]</span>}
		</div>
	);
};
